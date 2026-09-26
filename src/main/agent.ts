import {
  query,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type {
  AgentEvent,
  AgentState,
  ChatContentPart,
  ChatMessage,
  Chip,
  PermissionDecision,
  Project
} from '../shared/types'
import { describeActivity } from '../shared/activity'
import { childEnv, HYPERFRAMES, run, which } from './env'
import { Channels, broadcast } from './ipc'
import { catalogTitle } from './library'
import { lucaMcpServer } from './mcp'
import { lucaDir } from './projects'
import { getSettings, updateSettings } from './settings'

const SYSTEM_RULES = [
  'You are Luca, the editing agent inside Luca, a local video editor built on HyperFrames HTML compositions.',
  '1. The HTML files are the source of truth; never edit anything in media/ or renders/.',
  '2. Before building any visual from scratch (text, titles, captions, lower thirds, overlays, transitions, effects, backgrounds, charts), call the catalog_search tool to find a ready-made HyperFrames or Remocn component. Never grep, list or script the catalog yourself.',
  `3. Add HyperFrames items with \`npx ${HYPERFRAMES} add <name> --json\`, then insert the returned snippet yourself. For remocn components, use the remocn_install and remocn_place tools and never put React in the HTML.`,
  `4. After every edit, run \`npx ${HYPERFRAMES} lint --json\` and fix errors before replying. Always run the CLI as \`npx ${HYPERFRAMES}\` (this exact version, the one Luca uses), never plain \`npx hyperframes\`.`,
  'The person you are helping is a video creator, not a programmer. In replies never mention file names, HTML, CSS, selectors, code, commands or tools; describe what changed in the video (what, where on screen, when in seconds).',
  'Never name the technology behind Luca in replies: no HyperFrames, Remocn, Remotion, GSAP, Three.js, WebGL, shaders, compositions, keyframes, snippets or lint. Call things what the viewer sees (a title, caption, scene, animation, effect, transition, background) and use the plain-English title of anything you added, not its id.',
  'Keep replies short: say what you changed and why, no preamble.'
].join('\n')

const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(npx hyperframes *)',
  'Bash(npx hyperframes@* *)',
  'Bash(ffmpeg *)',
  'Bash(ffprobe *)',
  'mcp__luca__*'
]

type Pending = {
  resolve: (r: PermissionResult) => void
  tool: string
  suggestions?: PermissionUpdate[]
}

type Turn = { text: string; chips: Chip[]; context: unknown }

type ToolPart = Extract<ChatContentPart, { type: 'tool' }>

function summarize(name: string, input: Record<string, unknown>): string {
  const rel = (p: unknown): string =>
    typeof p === 'string' ? p.replace(/^.*\/(compositions\/|media\/|index\.html)/, '$1') : ''
  switch (name) {
    case 'Read':
      return `Read ${rel(input.file_path) || String(input.file_path ?? '')}`
    case 'Edit':
    case 'MultiEdit':
      return `Edited ${rel(input.file_path) || String(input.file_path ?? '')}`
    case 'Write':
      return `Wrote ${rel(input.file_path) || String(input.file_path ?? '')}`
    case 'Glob':
      return `Searched files ${String(input.pattern ?? '')}`
    case 'Grep':
      return `Searched for ${String(input.pattern ?? '')}`
    case 'Bash': {
      const cmd = String(input.command ?? '')
      const m = /npx\s+hyperframes(?:@[\w.-]+)?\s+(\w+)/.exec(cmd)
      if (m) return `Ran ${m[1]}`
      return `Ran ${cmd.split('\n')[0].slice(0, 80)}`
    }
    default:
      if (name.startsWith('mcp__luca__')) return name.replace('mcp__luca__', 'Luca: ')
      return name
  }
}

function describeInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command ?? '')
  if (name === 'Edit')
    return `--- ${String(input.old_string ?? '')}\n+++ ${String(input.new_string ?? '')}`
  if (name === 'Write') return String(input.content ?? '')
  return JSON.stringify(input, null, 2)
}

/** true = logged in, false = not, null = unknown (old CLI without `auth status`). */
async function authStatus(claude: string, env: NodeJS.ProcessEnv): Promise<boolean | null> {
  try {
    const res = await run(claude, ['auth', 'status'], { env, timeoutMs: 15_000, cwd: homedir() })
    const j = JSON.parse(res.stdout) as { loggedIn?: boolean }
    return typeof j.loggedIn === 'boolean' ? j.loggedIn : null
  } catch {
    return null
  }
}

export class ProjectAgent {
  private q: Query | null = null
  private inbox: SDKUserMessage[] = []
  private waiters: ((m: SDKUserMessage | null) => void)[] = []
  private closed = false
  private pending = new Map<string, Pending>()
  private state: AgentState = 'idle'
  private stateDetail: string | undefined
  private messages: ChatMessage[] = []
  private current: ChatMessage | null = null
  private tools = new Map<string, ToolPart>()
  private sessionId: string | null = null
  private turnStartedAt = 0
  private streamedText = ''
  private working = false
  private queued: Turn[] = []
  private abort = new AbortController()

  constructor(readonly project: Project) {
    mkdirSync(lucaDir(project.dir), { recursive: true })
    this.messages = this.loadHistory()
    this.sessionId = this.loadSession()
  }

  // ---------------------------------------------------------------- persistence
  private get chatFile(): string {
    return join(lucaDir(this.project.dir), 'chat.jsonl')
  }
  private get sessionFile(): string {
    return join(lucaDir(this.project.dir), 'session.json')
  }
  private loadHistory(): ChatMessage[] {
    if (!existsSync(this.chatFile)) return []
    const out: ChatMessage[] = []
    for (const line of readFileSync(this.chatFile, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as ChatMessage)
      } catch {
        // skip corrupt line
      }
    }
    return out
  }
  private rewriteHistory(): void {
    writeFileSync(
      this.chatFile,
      this.messages.map((m) => JSON.stringify({ ...m, pending: undefined })).join('\n') +
        (this.messages.length ? '\n' : '')
    )
  }
  private loadSession(): string | null {
    try {
      const j = JSON.parse(readFileSync(this.sessionFile, 'utf8')) as { sessionId?: string }
      return j.sessionId ?? null
    } catch {
      return null
    }
  }
  private saveSession(): void {
    writeFileSync(this.sessionFile, JSON.stringify({ sessionId: this.sessionId }, null, 2))
  }

  history(): ChatMessage[] {
    return this.messages
  }
  lastUserText(): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') return this.messages[i].text
    }
    return undefined
  }
  status(): { state: AgentState; detail?: string } {
    return { state: this.state, detail: this.stateDetail }
  }

  // ---------------------------------------------------------------- events
  private emit(e: AgentEvent): void {
    broadcast(Channels.agentEvent, e)
  }
  private setState(state: AgentState, detail?: string): void {
    this.state = state
    this.stateDetail = detail
    this.emit({ type: 'status', state, detail })
  }
  private pushHistory(): void {
    broadcast(Channels.agentHistoryPush, this.messages)
  }

  // ---------------------------------------------------------------- lifecycle
  async start(): Promise<void> {
    if (this.q || this.closed) return
    const claude = await which('claude')
    if (!claude) {
      this.setState('missing-claude', 'claude not found on PATH')
      return
    }
    this.setState('starting')
    const env = await childEnv()
    const auth = await authStatus(claude, env)
    if (auth === false) {
      this.setState('needs-login', 'Not logged in · run /login in Claude Code')
      return
    }
    const envRecord: Record<string, string> = {}
    for (const [k, v] of Object.entries(env)) if (v !== undefined) envRecord[k] = v

    this.abort = new AbortController()
    const options: Options = {
      cwd: this.project.dir,
      pathToClaudeCodeExecutable: claude,
      env: envRecord,
      settingSources: ['user', 'project'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_RULES },
      permissionMode: 'acceptEdits',
      allowedTools: ALLOWED_TOOLS,
      mcpServers: { luca: lucaMcpServer(this.project.dir) },
      canUseTool: this.canUseTool,
      includePartialMessages: true,
      abortController: this.abort,
      resume: this.sessionId ?? undefined,
      stderr: (data) => {
        if (/not logged in|please run \/login|invalid api key/i.test(data)) {
          this.setState('needs-login', data.trim())
        }
      }
    }
    try {
      this.q = query({ prompt: this.stream(), options })
      void this.consume(this.q)
    } catch (err) {
      this.setState('error', String(err))
    }
  }

  async stop(): Promise<void> {
    this.closed = true
    this.abort.abort()
    for (const w of this.waiters.splice(0)) w(null)
    for (const p of this.pending.values())
      p.resolve({ behavior: 'deny', message: 'Project closed' })
    this.pending.clear()
    this.q = null
  }

  async restart(): Promise<void> {
    this.abort.abort()
    for (const w of this.waiters.splice(0)) w(null)
    this.q = null
    this.closed = false
    this.working = false
    await this.start()
  }

  private async *stream(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const next = this.inbox.shift()
      if (next) {
        yield next
        continue
      }
      const m = await new Promise<SDKUserMessage | null>((res) => this.waiters.push(res))
      if (!m) return
      yield m
    }
  }

  // ---------------------------------------------------------------- sending
  async send(turn: Turn): Promise<void> {
    if (!this.q) await this.start()
    if (this.state === 'missing-claude') throw new Error('Claude Code is not installed')
    if (this.state === 'needs-login') throw new Error('Sign in to Claude Code first')
    if (!this.q) throw new Error(this.stateDetail ?? 'Claude Code could not start')
    const user: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      createdAt: new Date().toISOString(),
      text: turn.text,
      chips: turn.chips
    }
    this.messages.push(user)
    this.rewriteHistory()
    this.pushHistory()
    if (this.working) {
      this.queued.push(turn)
      return
    }
    this.dispatch(turn)
  }

  private dispatch(turn: Turn): void {
    this.working = true
    this.turnStartedAt = Date.now()
    this.streamedText = ''
    this.tools.clear()
    this.current = {
      id: randomUUID(),
      role: 'assistant',
      createdAt: new Date().toISOString(),
      text: '',
      parts: [],
      pending: true
    }
    this.messages.push(this.current)
    this.pushHistory()
    this.emit({ type: 'turn-start' })
    this.setState('working')

    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
    > = []
    const lines: string[] = []
    for (const chip of turn.chips) {
      if (chip.kind === 'element') {
        lines.push(
          `Selected element in ${chip.file} (composition ${chip.compositionId}) at ${chip.time.toFixed(2)}s, selector \`${chip.selector}\`:\n\`\`\`html\n${chip.html}\n\`\`\``
        )
      } else if (chip.kind === 'frame') {
        lines.push(`Attached preview frame at ${chip.time.toFixed(2)}s.`)
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: chip.png }
        })
      } else if (chip.kind === 'catalog') {
        lines.push(`Catalog item: ${chip.name} (${chip.type}, ${chip.source ?? 'hyperframes'})`)
      } else if (chip.kind === 'clip') {
        lines.push(
          `Timeline clip ${chip.clipId} on track ${chip.track}, ${chip.start.toFixed(2)}s–${chip.end.toFixed(2)}s`
        )
      } else if (chip.kind === 'transcript') {
        lines.push(`Transcript ${chip.start.toFixed(2)}s–${chip.end.toFixed(2)}s: "${chip.text}"`)
      }
    }
    if (turn.context && typeof turn.context === 'object') {
      const ctx = turn.context as { time?: number; note?: string; voice?: boolean }
      if (typeof ctx.time === 'number') lines.push(`Playhead is at ${ctx.time.toFixed(2)}s.`)
      // technical detail the UI keeps out of the visible message (e.g. a catalog snippet)
      if (typeof ctx.note === 'string' && ctx.note.trim()) lines.push(ctx.note.trim())
      if (ctx.voice)
        lines.push(
          'The user said this out loud in voice mode (speech recognition, so allow for misheard words) and your reply will be read aloud: answer in one or two short spoken sentences, with no markdown, lists or code.'
        )
    }
    if (existsSync(join(lucaDir(this.project.dir), 'LOOK.md')))
      lines.push('An active Look is set: read .luca/LOOK.md and follow it for every visual choice.')
    const text = lines.length
      ? `${turn.text}\n\n<context>\n${lines.join('\n')}\n</context>`
      : turn.text
    content.unshift({ type: 'text', text })

    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? ''
    } as SDKUserMessage
    const w = this.waiters.shift()
    if (w) w(msg)
    else this.inbox.push(msg)
  }

  async interrupt(): Promise<void> {
    this.queued = []
    try {
      await this.q?.interrupt()
    } catch {
      // the turn may already be over
    }
  }

  // ---------------------------------------------------------------- permissions
  private canUseTool: CanUseTool = async (toolName, input, { suggestions }) => {
    // Never let edits escape the project folder.
    const target = input.file_path ?? input.path ?? input.notebook_path
    if (
      typeof target === 'string' &&
      ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName)
    ) {
      const abs = resolve(this.project.dir, target)
      if (!abs.startsWith(resolve(this.project.dir) + sep)) {
        return { behavior: 'deny', message: 'Luca only allows edits inside the project folder.' }
      }
      const rel = abs.slice(resolve(this.project.dir).length + 1)
      if (rel.startsWith(`media${sep}`) || rel.startsWith(`renders${sep}`)) {
        return { behavior: 'deny', message: 'media/ and renders/ are immutable in Luca.' }
      }
    }
    const always = getSettings().alwaysAllow?.[this.project.id] ?? []
    const key =
      toolName === 'Bash' ? `Bash(${String(input.command ?? '').split(/\s+/)[0]})` : toolName
    if (always.includes(key)) return { behavior: 'allow', updatedInput: input }

    const id = randomUUID()
    const part: ChatContentPart = { type: 'permission', id, tool: toolName, input }
    this.current?.parts?.push(part)
    this.pushHistory()
    this.emit({ type: 'permission', id, tool: toolName, input })
    return new Promise<PermissionResult>((resolvePerm) => {
      this.pending.set(id, { resolve: resolvePerm, tool: key, suggestions })
    })
  }

  decide(id: string, decision: PermissionDecision): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    const part = this.current?.parts?.find(
      (x): x is Extract<ChatContentPart, { type: 'permission' }> =>
        x.type === 'permission' && x.id === id
    )
    if (part) part.resolved = decision
    this.emit({ type: 'permission-resolved', id })
    this.pushHistory()
    if (decision === 'deny') {
      p.resolve({ behavior: 'deny', message: 'The user denied this action in Luca.' })
      return
    }
    if (decision === 'allow-always') {
      const s = getSettings()
      const list = new Set(s.alwaysAllow?.[this.project.id] ?? [])
      list.add(p.tool)
      updateSettings({ alwaysAllow: { ...(s.alwaysAllow ?? {}), [this.project.id]: [...list] } })
      p.resolve({ behavior: 'allow', updatedPermissions: p.suggestions })
      return
    }
    p.resolve({ behavior: 'allow' })
  }

  // ---------------------------------------------------------------- event mapping
  private async consume(q: Query): Promise<void> {
    try {
      for await (const m of q) {
        if (this.q !== q) return
        this.onMessage(m)
      }
    } catch (err) {
      if (this.q !== q) return
      const text = String(err)
      if (/not logged in|\/login|invalid api key|authentication/i.test(text)) {
        this.setState('needs-login', text)
      } else if (!this.abort.signal.aborted) {
        this.setState('error', text)
      }
      this.finishTurn(true, text)
    }
    if (this.q === q) {
      this.q = null
      if (this.state === 'working' || this.state === 'ready') this.setState('idle')
    }
  }

  private onMessage(m: SDKMessage): void {
    switch (m.type) {
      case 'system': {
        if (m.subtype === 'init') {
          this.sessionId = m.session_id
          this.saveSession()
          if (this.state === 'starting') this.setState(this.working ? 'working' : 'ready')
        }
        return
      }
      case 'auth_status': {
        if (m.error || m.isAuthenticating)
          this.setState('needs-login', m.error ?? m.output.join('\n'))
        return
      }
      case 'stream_event': {
        if (m.parent_tool_use_id) return
        const ev = m.event
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          this.streamedText += ev.delta.text
          this.appendText(ev.delta.text)
        }
        return
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return
        for (const block of m.message.content) {
          if (block.type === 'tool_use') {
            const input = (block.input ?? {}) as Record<string, unknown>
            const part: ToolPart = {
              type: 'tool',
              id: block.id,
              name: block.name,
              summary: summarize(block.name, input),
              status: 'running',
              detail: describeInput(block.name, input),
              activity: describeActivity(block.name, input, catalogTitle)
            }
            this.tools.set(block.id, part)
            this.current?.parts?.push(part)
            this.emit(part)
            this.pushHistory()
          }
        }
        return
      }
      case 'user': {
        if (m.parent_tool_use_id) return
        const content = m.message.content
        if (!Array.isArray(content)) return
        for (const block of content) {
          if (
            typeof block === 'object' &&
            block &&
            'type' in block &&
            block.type === 'tool_result'
          ) {
            const b = block as { tool_use_id: string; is_error?: boolean; content?: unknown }
            const part = this.tools.get(b.tool_use_id)
            if (!part) continue
            part.status = b.is_error ? 'error' : 'done'
            const out = Array.isArray(b.content)
              ? (b.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
              : typeof b.content === 'string'
                ? b.content
                : ''
            if (out && part.name !== 'Edit' && part.name !== 'Write') {
              part.detail = out.length > 4000 ? out.slice(0, 4000) + '\n…' : out
            }
            this.emit(part)
            this.pushHistory()
          }
        }
        return
      }
      case 'result': {
        this.sessionId = m.session_id
        this.saveSession()
        const isError = m.is_error
        const resultText = m.subtype === 'success' ? m.result : ''
        const err = m.subtype !== 'success' ? m.subtype : isError ? resultText : undefined
        if (isError && /not logged in|\/login|invalid api key|authentication/i.test(resultText)) {
          this.setState('needs-login', resultText)
        } else if (!this.streamedText && resultText) {
          this.appendText(resultText)
        }
        this.finishTurn(isError, err)
        return
      }
      default:
        return
    }
  }

  private appendText(text: string): void {
    if (!this.current) return
    const parts = this.current.parts ?? (this.current.parts = [])
    const last = parts[parts.length - 1]
    if (last && last.type === 'text') last.text += text
    else parts.push({ type: 'text', text })
    this.current.text += text
    this.emit({ type: 'text-delta', text })
  }

  private finishTurn(isError: boolean, error?: string): void {
    if (!this.working) return
    this.working = false
    if (this.current) {
      this.current.pending = false
      this.current.isError = isError
      this.current.durationMs = Date.now() - this.turnStartedAt
      if (isError && error && !this.current.text) {
        this.appendText(
          this.state === 'needs-login' ? 'Sign in to Claude Code to continue.' : error
        )
      }
      this.current = null
    }
    this.rewriteHistory()
    this.pushHistory()
    const end: Extract<AgentEvent, { type: 'turn-end' }> = {
      type: 'turn-end',
      sessionId: this.sessionId ?? '',
      durationMs: Date.now() - this.turnStartedAt,
      isError,
      error
    }
    this.emit(end)
    for (const cb of turnEndListeners) cb(this.project, end)
    if (this.state === 'working') this.setState('ready')
    const next = this.queued.shift()
    if (next && this.q) this.dispatch(next)
  }
}

// ------------------------------------------------------------------ registry
let active: ProjectAgent | null = null
type TurnEndListener = (project: Project, e: Extract<AgentEvent, { type: 'turn-end' }>) => void
const turnEndListeners = new Set<TurnEndListener>()

export function agentFor(project: Project): ProjectAgent {
  if (active && active.project.dir === project.dir) return active
  void active?.stop()
  active = new ProjectAgent(project)
  return active
}

export function activeAgent(): ProjectAgent | null {
  return active
}

export async function closeAgent(): Promise<void> {
  await active?.stop()
  active = null
}

export function onTurnEnd(cb: TurnEndListener): () => void {
  turnEndListeners.add(cb)
  return () => turnEndListeners.delete(cb)
}
