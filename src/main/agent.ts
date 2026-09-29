import {
  query,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { Ai33Ask, ToolProgress } from '../shared/ai33'
import type {
  AgentEvent,
  AgentState,
  ChatContentPart,
  ChatMessage,
  Chip,
  PermissionDecision,
  Project
} from '../shared/types'
import { alwaysAllowRule, describeActivity, describeResult, shellWords } from '../shared/activity'
import { hasAi33Key, onKeyConnected } from './ai33-account'
import type { Ai33Ctx, Ai33Turn, ToolName } from './ai33-ctx'
import { ASK_TIMEOUT_MS, endPreapproval } from './ai33-spend'
import { childEnv, HYPERFRAMES, run, which } from './env'
import { Channels, broadcast, notifyInBackground } from './ipc'
import { catalogTitle } from './library'
import { lucaMcpServer } from './mcp'
import { describeMedia } from './footage'
import { lucaDir } from './projects'
import { getSettings, updateSettings } from './settings'
import { reportingCall } from './tools/common'

const SYSTEM_RULES = [
  'You are Luca, the agent inside Luca, a tool that makes explainer videos for its user built on HyperFrames HTML compositions. People bring a brief, a voiceover, footage or screenshots — sometimes only words — and you plan and build the whole video for them: launch films, concept explainers, tutorials and talking videos, motion design or a classic edit.',
  '1. The HTML files are the source of truth; never edit anything in media/ or renders/.',
  '2. Before building any visual from scratch (text, titles, lower thirds, callouts, overlays, transitions, effects, charts), call the catalog_search tool to find a ready-made HyperFrames or Remocn component. Never grep, list or script the catalog yourself.',
  `3. Add HyperFrames items with \`npx ${HYPERFRAMES} add <name> --json\`, then insert the returned snippet yourself. For remocn components, use the remocn_install and remocn_place tools and never put React in the HTML.`,
  `4. After every edit, run \`npx ${HYPERFRAMES} lint --json\` and fix errors before replying. Always run the CLI as \`npx ${HYPERFRAMES}\` (this exact version, the one Luca uses), never plain \`npx hyperframes\`.`,
  '5. When there is footage, it is the video and fills the frame: never put a stock or animated background behind it. Use broll_search and broll_add only to show something named in what is said (mostly in explainers, faceless and product videos) or when the user asks: a cutaway or a card over the footage for 1.5–4 s while the audio keeps playing. With only a voiceover, the visuals you make (B-roll, animated key words, simple diagrams) are the picture and follow what is said. You may tell the user B-roll comes from Pexels.',
  '6. The words come from transcribe, with their times; never guess what is said. Cutting ums, pauses and retakes goes through clean_edit; never cut the source by hand. Time titles, zooms and B-roll to the times these tools return.',
  '7. Captions of what is said in the video always go through captions_apply: adding them and every change to their style, font, size, position, colors, outline, box or animation (to match a reference image, read its look and pass it as overrides). Never write or edit the captions file by hand; Luca rebuilds it from the transcript and keeps it in sync with every cut. For a font that is not built in (one that comes with Luca, or a Google Fonts link or name the user gives), call font_add first.',
  '7b. A color look on the footage itself (cinematic, moody, warm, cool, black and white, or a named LUT) goes through lut_apply — never write data-color-grading attributes by hand.',
  '7c. How loud a sound is (footage, voiceover, music, B-roll too loud or too quiet, music fighting the talking) goes through sound_mix — never write data-volume by hand. When you add music or a sound under speech, mix it down with sound_mix right away (about 0.2) so the words stay clear.',
  `8. The person watches the video in Luca’s own preview. Never start a preview or dev server, never open a browser, window or URL, and never use browser-automation tools. To see what a frame looks like, run \`npx ${HYPERFRAMES} snapshot\`; to check an edit, run lint. If playback in Luca seems wrong, check the HTML and lint output and describe what you find; do not try to watch it yourself.`,
  '9. When the user attaches a video and asks to make theirs like it, move like it, or use it as a reference or inspiration, call reference_study with it instead of putting it on the timeline, then follow the instructions it returns.',
  '10. Sound nobody recorded is made with speech_generate (a voiceover from words, a spoken line, or a conversation between voices), music_generate (music under the video) and sfx_generate (a whoosh, a hit, an ambience). They spend the user’s ai33 credits and take from seconds to a few minutes: use them only when the user asks or the edit plan in .luca/EDIT.md switches them on, one item per request unless they ask for more (music already comes with a second take; sfx_generate takes several effects in one call), and say in one short line what you are about to make, and that it takes a minute or two when it does, before you call. The tools place the result on the timeline themselves at a good level: never write audio tags by hand and never change a level the user set. You cannot hear: report what you made, where it plays and how long it is, never how it sounds, and offer one next step (the other take, a different voice or mood). Music is instrumental and sits quietly under the voice, made after the cuts and titles so it fits the final length; a sound effect marks one moment (a title landing, a hit, a turn) and is never a texture under everything. The user’s own music always wins over making some.',
  '11. The tools ask the user themselves before anything that costs a lot, so do not ask permission; for a batch (many effects) say the rough total in one short line first. If a tool says the user declined, has not connected ai33, has too few credits, or failed, say what it tells you in one plain sentence and stop: never call it again for the same thing, never make it another way, never blame the user. If it says a job is still working, tell the user it will be ready in a few minutes and do not start it again; when asked, call ai33_status. After an undo the files are still saved: look with ai33_status (saved) and use audio_place before making anything again. Say credits (never dollars) when a tool tells you to. You may say ai33 when the key, the credits or an error make it useful; never name the companies behind the voices or music, never say a voice or music is royalty free or safe to sell (if asked, say ai33’s terms apply).',
  '12. Voices: when the user names a tone or a kind of person (calm, warm, a deep man), let speech_generate pick and go ahead; when they want to hear, browse or change the voice, call voice_search, say one short line and stop so they can listen and pick. Read a script exactly as written; names, brands and acronyms that need a special sound go in say, with one line telling the user how you will say them. Never clone or imitate a real person’s voice. When a video already has a voice, a line made with speech_generate needs a start time and the captions still follow the original recording. A voiceover Luca recorded from the user’s script has exact words and times already: call transcribe to read them (it is free and sends nothing anywhere), never pass force, and never call clean_edit on it; to change its voice or speed, tell the user it means starting again from the script (a different voice or speed is recorded and charged again; only an identical retry is free).',
  'The person you are helping is a video creator, not a programmer. In replies never mention file names, HTML, CSS, selectors, code, commands or tools; describe what changed in the video (what, where on screen, when in seconds).',
  'Never name the technology behind Luca in replies: no HyperFrames, Remocn, Remotion, GSAP, Three.js, WebGL, shaders, compositions, keyframes, snippets or lint. Call things what the viewer sees (a cut, zoom, title, caption, B-roll, animation, effect, transition) and use the plain-English title of anything you added, not its id.',
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

/** Nothing Luca does may open a browser, a window or a server the person can see. */
const NO_WINDOW = [
  'preview',
  'play',
  'present',
  'browser',
  'publish',
  'cloud',
  'cloudrun',
  'lambda'
]
const DISALLOWED_TOOLS = [
  ...NO_WINDOW.flatMap((sub) => [
    `Bash(npx ${HYPERFRAMES} ${sub}*)`,
    `Bash(npx hyperframes ${sub}*)`,
    `Bash(npx hyperframes@* ${sub}*)`
  ]),
  'Bash(open *)',
  'Bash(npm run dev*)',
  'Bash(npm run check*)',
  'Bash(npm run publish*)',
  'WebFetch',
  'WebSearch',
  'mcp__playwright__*',
  'mcp__chrome-devtools__*'
]

/** Files Luca writes itself: what the person agreed to (ai33) and where a project's words come from (script). */
const LUCA_OWNED = new Set(['.luca/ai33.json', '.luca/script.json'])

/**
 * The same, as deny rules. A tool in ALLOWED_TOOLS is allowed without canUseTool being asked, so
 * the check there alone would not hold; a deny rule is looked at first.
 */
const NO_EDIT = [...LUCA_OWNED].flatMap((f) => [`Edit(${f})`, `Write(${f})`])

type Pending = {
  resolve: (r: PermissionResult) => void
  /** The always-allow rule, or null when this request may only be allowed once. */
  rule: string | null
  /** Set for a question one of Luca's own tools asks (connect ai33, spend credits). */
  ask?: Ai33Ask
}

type TurnOutcome = { isError: boolean; error?: string }

type Turn = {
  text: string
  chips: Chip[]
  context: unknown
  /** The user message this turn answers. */
  userId?: string
  /** Called once when this turn ends, is dropped from the queue, or the agent stops. */
  done?: (outcome: TurnOutcome) => void
}

/** SDK result subtypes, as people should read them. */
const PLAIN_ERRORS: Record<string, string> = {
  error_during_execution: 'Something went wrong while working on this.',
  error_max_turns: 'This needed more steps than Luca can take in one go.',
  error_max_budget_usd: 'This reached the spending limit for a single request.',
  error_max_structured_output_retries: 'Something went wrong while working on this.',
  restarted: 'Luca restarted before finishing this.',
  closed: 'The project was closed before Luca finished.',
  ended: 'Luca stopped unexpectedly before finishing this.'
}

type ToolPart = Extract<ChatContentPart, { type: 'tool' }>

/** Luca's ai33 tools as the SDK names them: the steps a question of theirs stops. */
const AI33_STEPS = new Set<string>(
  (
    [
      'speech_generate',
      'voice_search',
      'music_generate',
      'sfx_generate',
      'audio_place',
      'ai33_status'
    ] satisfies ToolName[]
  ).map((t) => `mcp__luca__${t}`)
)

/** The card a tool shows when it needs an ai33 key (the key card itself is the renderer's). */
const CONNECT_ASK: Ai33Ask = {
  kind: 'connect',
  title: 'Luca needs an ai33 key',
  detail:
    'Connect your ai33 account and Luca can record a voiceover from your script, make music and sound effects. ai33 is a separate paid service: you buy credits from ai33, and every job uses them. Luca asks before spending a lot. The key stays on this Mac.',
  labels: { allow: 'Connect', deny: 'Not now' }
}

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

/** The opening of a reply, short enough for a notification. */
function firstSentence(text: string): string {
  const flat = text
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const end = flat.search(/[.!?](\s|$)/)
  const s = end > 0 ? flat.slice(0, end + 1) : flat
  return s.length > 140 ? `${s.slice(0, 139)}…` : s
}

function describeInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command ?? '')
  if (name === 'Edit')
    return `--- ${String(input.old_string ?? '')}\n+++ ${String(input.new_string ?? '')}`
  if (name === 'Write') return String(input.content ?? '')
  return JSON.stringify(input, null, 2)
}

/**
 * A chip saved in the chat history as it is today: projects started before the editing pivot
 * saved start-step choices (`style`) and picked backgrounds, which read as the edit and as
 * B-roll now; catalog items can't be added from the chat any more, so theirs are dropped.
 */
function currentChip(chip: Chip): Chip[] {
  const old = chip as unknown as { kind: string; label?: string }
  if (old.kind === 'style') return [{ kind: 'edit', label: old.label ?? '' }]
  if (old.kind === 'background') return [{ ...(chip as object), kind: 'broll' } as Chip]
  if (old.kind === 'catalog') return []
  return [chip]
}

let signedIn = false

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
  /** The turn has ended and its listeners are still running: nothing else is dispatched until they are done. */
  private ending = false
  private queued: Turn[] = []
  /** The turn being answered now. */
  private active: Turn | null = null
  private interrupted = false
  private starting: Promise<void> | null = null
  private abort = new AbortController()
  /** What the ai33 tools are given for the turn being answered (one per turn, so its id tells turns apart). */
  private aiTurn: Ai33Turn | null = null
  private aiTurnCount = 0
  /** Aborted by Stop: the turn's ai33 jobs are cancelled at ai33 too. */
  private stopTurn = new AbortController()
  /** Which step each tool call reports progress to (a call is bound at its first report). */
  private bound = new Map<symbol, ToolPart>()
  private claimed = new WeakSet<ToolPart>()
  private progressAt = new WeakMap<ToolPart, number>()
  /** Progress waiting for its second to be up, and the timers that will show it. */
  private heldProgress = new Map<ToolPart, ToolProgress>()
  private holds = new Map<ToolPart, NodeJS.Timeout>()

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
        const m = JSON.parse(line) as ChatMessage
        if (m.chips) m.chips = m.chips.flatMap(currentChip)
        // a turn cut off by a crash or quit was saved mid-step; those steps can't finish now
        for (const p of m.parts ?? []) {
          if (p.type === 'tool' && p.status === 'running') p.status = 'error'
          else if (p.type === 'permission' && !p.resolved) {
            p.resolved = 'deny'
            p.cancelled = true
          }
        }
        out.push(m)
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
  /** The request being answered now, else the last one sent (checkpoint labels). */
  lastUserText(): string | undefined {
    if (this.active) return this.active.text
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
    if (state === 'needs-login') signedIn = false
    this.state = state
    this.stateDetail = detail
    this.emit({ type: 'status', state, detail })
  }
  /** Send the renderer one message that changed, not the whole (growing) history. */
  private pushMessage(m: ChatMessage | null): void {
    if (m) broadcast(Channels.agentMessage, m)
  }

  // ---------------------------------------------------------------- lifecycle
  /** Start the session. Calls while one is starting share it, so there is never a second query. */
  start(): Promise<void> {
    if (this.q || this.closed) return Promise.resolve()
    this.starting ??= this.boot().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async boot(): Promise<void> {
    const claude = await which('claude')
    if (!claude) {
      this.setState('missing-claude', 'claude not found on PATH')
      return
    }
    this.setState('starting')
    const env = await childEnv()
    // signed in once this session is enough: opening another project skips the 1–2 s check
    const auth = signedIn ? true : await authStatus(claude, env)
    signedIn = auth === true
    if (this.closed) return
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
      settingSources: [],
      strictMcpConfig: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_RULES },
      permissionMode: 'acceptEdits',
      allowedTools: ALLOWED_TOOLS,
      disallowedTools: [...DISALLOWED_TOOLS, ...NO_EDIT],
      mcpServers: { luca: lucaMcpServer(this.project.dir, this.ai33Ctx()) },
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
    // nothing may be dispatched into the closing session, and queued turns won't run
    this.q = null
    for (const t of this.queued.splice(0)) t.done?.({ isError: true, error: PLAIN_ERRORS.closed })
    this.abort.abort()
    for (const w of this.waiters.splice(0)) w(null)
    this.cancelPending('Project closed')
    // ends the turn the normal way, so clean edit / Look waiters are released too
    if (this.working) this.finishTurn(true, 'closed')
  }

  async restart(): Promise<void> {
    this.abort.abort()
    for (const w of this.waiters.splice(0)) w(null)
    // a message the old session never read belongs to the turn that ends below
    this.inbox.length = 0
    this.q = null
    this.closed = false
    this.cancelPending('Luca restarted')
    // q is null, so finishing here can't dispatch a queued turn into the dead session
    if (this.working) this.finishTurn(true, 'restarted')
    this.interrupted = false
    await this.start()
    // messages sent while the old session ran are answered by the new one
    if (this.q && !this.working) {
      const next = this.queued.shift()
      if (next) this.dispatch(next)
    }
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
      chips: turn.chips,
      context: turn.context
    }
    this.messages.push(user)
    this.rewriteHistory()
    this.pushMessage(user)
    // through the queue, so anything still waiting (e.g. after a restart) goes first
    this.queued.push({ ...turn, userId: user.id })
    if (!this.working) this.dispatch(this.queued.shift()!)
  }

  /**
   * Send a turn and wait for that turn to end: when Luca is busy it is queued, and the turn
   * running now ends first.
   */
  run(turn: Omit<Turn, 'done'>): Promise<TurnOutcome> {
    return new Promise((resolve, reject) => {
      this.send({ ...turn, done: resolve }).catch(reject)
    })
  }

  private dispatch(turn: Turn): void {
    this.interrupted = false
    this.active = turn
    this.working = true
    this.turnStartedAt = Date.now()
    this.streamedText = ''
    this.tools.clear()
    this.bound.clear()
    this.aiTurn = this.newAiTurn()
    this.current = {
      id: randomUUID(),
      role: 'assistant',
      createdAt: new Date().toISOString(),
      text: '',
      parts: [],
      pending: true,
      replyTo: turn.userId
    }
    this.messages.push(this.current)
    this.pushMessage(this.current)
    this.emit({ type: 'turn-start' })
    this.setState('working')

    const content: Array<
      | { type: 'text'; text: string }
      | {
          type: 'image'
          source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string }
        }
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
      } else if (chip.kind === 'clip') {
        lines.push(
          `Timeline clip ${chip.clipId} on track ${chip.track}, ${chip.start.toFixed(2)}s–${chip.end.toFixed(2)}s`
        )
      } else if (chip.kind === 'transcript') {
        lines.push(`Transcript ${chip.start.toFixed(2)}s–${chip.end.toFixed(2)}s: "${chip.text}"`)
      } else if (chip.kind === 'broll') {
        const len = chip.duration ? `, ${Math.round(chip.duration)}s` : ''
        lines.push(
          `B-roll the user picked (Pexels ${chip.media}${len}): “${chip.title}”. Add it with broll_add {"id":"${chip.id}"} and show it at the playhead time (or where it best fits what is being said around then) as broll_add says to place it (a cutaway over the footage, or with only a voiceover a scene of its own), unless they ask for something else.`
        )
      } else if (chip.kind === 'edit') {
        // a start-card choice: the full plan is in the first request's brief (and .luca/EDIT.md)
        lines.push(`Picked on the start card: ${chip.label}.`)
      } else if (chip.kind === 'media') {
        // a file the user added in the chat: Luca sees the image (or a frame of the video)
        const { line, image } = describeMedia(this.project.dir, chip)
        lines.push(line)
        if (image)
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data }
          })
      }
    }
    if (turn.context && typeof turn.context === 'object') {
      const ctx = turn.context as { time?: number; note?: string; voice?: boolean }
      if (typeof ctx.time === 'number') lines.push(`Playhead is at ${ctx.time.toFixed(2)}s.`)
      // detail the UI keeps out of the visible message (e.g. the start brief)
      if (typeof ctx.note === 'string' && ctx.note.trim()) lines.push(ctx.note.trim())
      if (ctx.voice)
        lines.push(
          'The user said this out loud in voice mode (speech recognition, so allow for misheard words) and your reply will be read aloud: answer in one or two short spoken sentences, with no markdown, lists or code.'
        )
    }
    const own = lucaDir(this.project.dir)
    if (existsSync(join(own, 'LOOK.md')))
      lines.push('An active Look is set: read .luca/LOOK.md and follow it for every visual choice.')
    // projects started before video types kept the look picked at the start here
    else if (existsSync(join(own, 'STYLE.md')))
      lines.push(
        'The user picked a look when they started this video (.luca/STYLE.md): keep new titles, text and motion in that look unless they ask for something else.'
      )
    if (existsSync(join(own, 'EDIT.md')))
      lines.push(
        'The user described this video when they started (.luca/EDIT.md): keep new edits in line with it unless they ask otherwise.'
      )
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

  /** Stop the current turn. Messages sent while it ran stay queued and are answered next. */
  async interrupt(): Promise<void> {
    // messages queued meanwhile stay queued and are answered next ("Luca will read this next")
    if (this.working && !this.ending) {
      this.interrupted = true
      // the person's Stop is the one thing that cancels an ai33 job at ai33
      this.stopTurn.abort()
    }
    // answer any open permission card now, so the turn isn't left waiting on it
    this.cancelPending('Stopped')
    try {
      await this.q?.interrupt()
    } catch {
      // the turn may already be over
    }
  }

  // ---------------------------------------------------------------- permissions
  private canUseTool: CanUseTool = async (toolName, input) => {
    // DISALLOWED_TOOLS is matched literally by the SDK; this also catches oblique forms
    if (toolName === 'Bash') {
      let w = shellWords(String(input.command ?? ''))
      if (w?.[0] === 'npx') w = w.slice(w[1] === '--yes' || w[1] === '-y' ? 2 : 1)
      if (
        w &&
        ((/^hyperframes(@[\w.-]+)?$/.test(w[0] ?? '') && NO_WINDOW.includes(w[1] ?? '')) ||
          w[0] === 'open')
      ) {
        return {
          behavior: 'deny',
          message:
            'Luca shows the preview itself; nothing may open a browser, a window or a preview server.'
        }
      }
    }
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
      // lower case: the Mac's disk doesn't tell .luca/AI33.json from .luca/ai33.json
      const rel = abs.slice(resolve(this.project.dir).length + 1).toLowerCase()
      if (rel.startsWith(`media${sep}`) || rel.startsWith(`renders${sep}`)) {
        return { behavior: 'deny', message: 'media/ and renders/ are immutable in Luca.' }
      }
      if (LUCA_OWNED.has(rel.split(sep).join('/'))) {
        return {
          behavior: 'deny',
          message: 'Luca keeps that file itself; it can’t be edited here.'
        }
      }
    }
    if (getSettings().approvals === 'full') return { behavior: 'allow', updatedInput: input }
    // "Always allow" remembers a command by its first word, so it is only offered (and only
    // honoured) for plain read-only commands; anything that could change, delete, download or
    // chain something asks every time
    const rule = toolName !== 'Bash' ? toolName : alwaysAllowRule(String(input.command ?? ''))
    const always = getSettings().alwaysAllow?.[this.project.id] ?? []
    if (rule && always.includes(rule)) return { behavior: 'allow', updatedInput: input }

    const id = randomUUID()
    // `rule` is what "Always allow" stores, so the card can say exactly what it would permit
    const part: ChatContentPart = {
      type: 'permission',
      id,
      tool: toolName,
      input,
      ...(rule ? { rule } : {})
    }
    this.current?.parts?.push(part)
    this.pushMessage(this.current)
    this.emit({ type: 'permission', id, tool: toolName, input, ...(rule ? { rule } : {}) })
    notifyInBackground(
      'Luca needs your OK',
      `${describeActivity(toolName, input, catalogTitle).active}. Open Luca to allow it.`
    )
    return new Promise<PermissionResult>((resolvePerm) => {
      this.pending.set(id, { resolve: resolvePerm, rule })
    })
  }

  decide(id: string, decision: PermissionDecision): void {
    const p = this.pending.get(id)
    if (!p) return
    // a request for the ai33 key is answered by the key, never by a click: an allow while there is
    // none changes nothing and the card stays
    if (p.ask?.kind === 'connect' && decision !== 'deny' && !hasAi33Key()) return
    this.pending.delete(id)
    // a request that can't be always-allowed is allowed once, whatever was clicked
    if (decision === 'allow-always' && !p.rule) decision = 'allow'
    const part = this.current?.parts?.find(
      (x): x is Extract<ChatContentPart, { type: 'permission' }> =>
        x.type === 'permission' && x.id === id
    )
    if (part) part.resolved = decision
    this.emit({ type: 'permission-resolved', id })
    this.pushMessage(this.current)
    if (decision === 'deny') {
      p.resolve({ behavior: 'deny', message: 'The user denied this action in Luca.' })
      return
    }
    if (decision === 'allow-always' && p.rule) {
      const s = getSettings()
      const list = new Set(s.alwaysAllow?.[this.project.id] ?? [])
      list.add(p.rule)
      updateSettings({ alwaysAllow: { ...(s.alwaysAllow ?? {}), [this.project.id]: [...list] } })
    }
    // Luca keeps its own always-allow list; the SDK's suggested rules can be broader than the card says
    p.resolve({ behavior: 'allow' })
  }

  // ---------------------------------------------------------------- ai33 tools

  private newAiTurn(): Ai33Turn {
    this.stopTurn = new AbortController()
    return {
      id: ++this.aiTurnCount,
      stop: this.stopTurn.signal,
      // the session ending (project closed, restart) stops polling but leaves the job running
      detach: this.abort.signal,
      spent: { credits: 0, paid: 0, byKind: {} }
    }
  }

  /** What Luca's ai33 tools are given: where to report progress, and how to ask the person. */
  private ai33Ctx(): Ai33Ctx {
    return {
      projectDir: this.project.dir,
      projectId: this.project.id,
      progress: (tool, p) => this.reportProgress(tool, p),
      ask: (ask) => this.openAsk(ask).answer,
      connect: () => this.askForKey(),
      turn: () => (this.aiTurn ??= this.newAiTurn())
    }
  }

  /** The step a tool call reports to: the one it is bound to, else the oldest of its name no call has claimed. */
  private stepFor(tool: ToolName): ToolPart | undefined {
    const call = reportingCall()
    const bound = call ? this.bound.get(call) : undefined
    if (bound) return bound
    const name = `mcp__luca__${tool}`
    const open = [...this.tools.values()].filter((t) => t.name === name && t.status === 'running')
    const part = open.find((t) => !this.claimed.has(t)) ?? (call ? undefined : open[0])
    if (part && call) {
      this.bound.set(call, part)
      this.claimed.add(part)
    }
    return part
  }

  /**
   * Percent, a note and the time it began, on the running step. A new note (a phase) goes out at
   * once; percent moves are held to one a second, and the latest one is shown when the second is up.
   */
  private reportProgress(tool: ToolName, p: { pct: number | null; note?: string }): void {
    const part = this.stepFor(tool)
    if (!part || part.status !== 'running') return
    const shown = part.progress
    const next: ToolProgress = {
      pct: p.pct,
      ...(p.note ? { note: p.note } : {}),
      since: shown?.since ?? Date.now()
    }
    const last = this.heldProgress.get(part) ?? shown
    if (last && last.pct === next.pct && last.note === next.note) return
    const wait = 1000 - (Date.now() - (this.progressAt.get(part) ?? 0))
    if (shown && shown.note === next.note && wait > 0) {
      this.heldProgress.set(part, next)
      if (!this.holds.has(part)) {
        const timer = setTimeout(() => {
          this.holds.delete(part)
          const held = this.heldProgress.get(part)
          if (held && part.status === 'running') this.showProgress(part, held)
        }, wait)
        timer.unref()
        this.holds.set(part, timer)
      }
      return
    }
    this.showProgress(part, next)
  }

  private showProgress(part: ToolPart, next: ToolProgress): void {
    this.heldProgress.delete(part)
    part.progress = next
    this.progressAt.set(part, Date.now())
    this.emit(part)
    this.pushMessage(this.current)
  }

  /** A step that ended shows no progress, and none held back may appear after it. */
  private dropProgress(part: ToolPart): void {
    clearTimeout(this.holds.get(part))
    this.holds.delete(part)
    this.heldProgress.delete(part)
    part.progress = undefined
  }

  /**
   * A question one of Luca's own tools asks: a card in the chat that the tool waits on. Stop, a
   * restart, the project closing or ASK_TIMEOUT_MS answer it 'deny'.
   */
  private openAsk(ask: Ai33Ask): { id: string; answer: Promise<'allow' | 'deny'> } {
    const id = randomUUID()
    // the step it stops: the oldest ai33 step still running
    const step = [...this.tools.values()].find(
      (t) => t.status === 'running' && AI33_STEPS.has(t.name)
    )
    const tool = step?.name ?? 'mcp__luca__ai33'
    const part: ChatContentPart = { type: 'permission', id, tool, input: {}, ask }
    this.current?.parts?.push(part)
    this.pushMessage(this.current)
    this.emit({ type: 'permission', id, tool, input: {}, ask })
    if (ask.kind === 'connect')
      notifyInBackground('Luca needs your ai33 key', 'Open Luca to connect it.')
    else notifyInBackground('Luca needs your OK', ask.title)
    const answer = new Promise<'allow' | 'deny'>((resolveAsk) => {
      const timer = setTimeout(() => this.decide(id, 'deny'), ASK_TIMEOUT_MS)
      timer.unref()
      this.pending.set(id, {
        rule: null,
        ask,
        resolve: (r) => {
          clearTimeout(timer)
          resolveAsk(r.behavior === 'allow' ? 'allow' : 'deny')
        }
      })
    })
    return { id, answer }
  }

  /** Ask for an ai33 key in the chat; true once one is saved, false on Not now, Stop or a timeout. */
  private async askForKey(): Promise<boolean> {
    if (hasAi33Key()) return true
    const { id, answer } = this.openAsk(CONNECT_ASK)
    // saving the key (here or in Connections) is what answers this card
    const off = onKeyConnected(() => this.decide(id, 'allow'))
    try {
      return (await answer) === 'allow' && hasAi33Key()
    } finally {
      off()
    }
  }

  /** Allow every open permission request (the person switched to full access). */
  allowPending(): void {
    if (!this.pending.size) return
    for (const [id, p] of this.pending) {
      const part = this.current?.parts?.find(
        (x): x is Extract<ChatContentPart, { type: 'permission' }> =>
          x.type === 'permission' && x.id === id
      )
      if (part) part.resolved = 'allow'
      this.emit({ type: 'permission-resolved', id })
      p.resolve({ behavior: 'allow' })
    }
    this.pending.clear()
    this.pushMessage(this.current)
  }

  /** Answer every open permission request with deny (the turn it belongs to is over). */
  private cancelPending(message: string): void {
    for (const [id, p] of this.pending) {
      p.resolve({ behavior: 'deny', message })
      this.emit({ type: 'permission-resolved', id })
    }
    this.pending.clear()
  }

  // ---------------------------------------------------------------- event mapping
  private async consume(q: Query): Promise<void> {
    let failure: string | null = null
    try {
      for await (const m of q) {
        if (this.q !== q) return
        this.onMessage(m)
      }
    } catch (err) {
      failure = String(err)
    }
    if (this.q !== q) return
    // the session is over: nothing more goes into it, and queued turns wait for the next start
    this.q = null
    for (const w of this.waiters.splice(0)) w(null)
    this.inbox.length = 0
    if (failure !== null) {
      if (/not logged in|\/login|invalid api key|authentication/i.test(failure)) {
        this.setState('needs-login', failure)
      } else if (!this.abort.signal.aborted) {
        this.setState('error', failure)
      }
    }
    if (this.working) this.finishTurn(true, 'ended')
    if (this.state === 'working' || this.state === 'ready') this.setState('idle')
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
            this.pushMessage(this.current)
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
            part.status = b.is_error ? (this.interrupted ? 'stopped' : 'error') : 'done'
            this.dropProgress(part)
            const out = Array.isArray(b.content)
              ? (b.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
              : typeof b.content === 'string'
                ? b.content
                : ''
            if (out && part.name !== 'Edit' && part.name !== 'Write') {
              part.detail = out.length > 4000 ? out.slice(0, 4000) + '\n…' : out
            }
            if (!b.is_error && part.activity && part.name.startsWith('mcp__luca__')) {
              // what a voiceover, music or sound effect step made and cost, or that the person said no
              const r = describeResult(part.name, out.split('\n')[0])
              if (r.done) part.activity = { ...part.activity, done: r.done }
              if (r.status) part.status = r.status
            }
            if (part.name === 'mcp__luca__broll_search' && !b.is_error && part.activity) {
              try {
                // the first line is the summary; previews follow it
                const r = JSON.parse(out.split('\n')[0]) as { total?: number; query?: string }
                if (typeof r.total === 'number') {
                  const q = r.query ?? ''
                  part.activity = {
                    ...part.activity,
                    done:
                      r.total > 0
                        ? `Found ${r.total} B-roll ${r.total === 1 ? 'shot' : 'shots'} for “${q}”`
                        : `No B-roll matched “${q}”`
                  }
                }
              } catch {
                // keep the neutral label
              }
            }
            if (part.name === 'mcp__luca__catalog_search' && !b.is_error && part.activity) {
              try {
                const r = JSON.parse(out) as { total?: number; query?: string }
                if (typeof r.total === 'number') {
                  const q = r.query ?? ''
                  part.activity = {
                    ...part.activity,
                    done:
                      r.total > 0
                        ? `Found ${r.total} option${r.total === 1 ? '' : 's'} for “${q}”`
                        : `Nothing ready-made for “${q}”`
                  }
                }
              } catch {
                // keep the neutral label
              }
            }
            this.emit(part)
            this.pushMessage(this.current)
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
    this.emit({ type: 'text-delta', id: this.current.id, text })
  }

  /** End the in-flight assistant message: open steps and permission cards can't finish now. */
  private settleCurrent(isError: boolean, stopped: boolean): void {
    if (!this.current) return
    for (const p of this.current.parts ?? []) {
      if (p.type === 'tool' && p.status === 'running') {
        p.status = stopped ? 'stopped' : 'error'
        this.dropProgress(p)
        this.emit(p)
      } else if (p.type === 'permission' && !p.resolved) {
        p.resolved = 'deny'
        p.cancelled = true
      }
    }
    this.current.pending = false
    this.current.isError = isError
    if (stopped) this.current.stopped = true
    this.current.durationMs = Date.now() - this.turnStartedAt
  }

  private finishTurn(isError: boolean, error?: string): void {
    if (!this.working || this.ending) return
    // still `working` until the listeners are done: a message sent meanwhile is queued, not dispatched
    this.ending = true
    // a turn the person stopped isn't shown as a failure, but whoever waits on it must not
    // carry on as if it had succeeded
    const stopped = this.interrupted
    this.interrupted = false
    this.cancelPending(stopped ? 'Stopped' : 'The turn ended')
    if (this.current) {
      this.settleCurrent(isError && !stopped, stopped)
      if (stopped && !this.current.text) this.appendText('Stopped.')
      else if (isError && error && !this.current.text) {
        this.appendText(
          this.state === 'needs-login'
            ? 'Sign in to Claude Code to continue.'
            : (PLAIN_ERRORS[error] ?? error)
        )
      }
      this.pushMessage(this.current)
      // you stopped it, or the project closed or restarted: nothing is waiting on you
      if (!stopped && error !== 'closed' && error !== 'restarted')
        notifyInBackground(
          isError ? 'Luca couldn’t finish' : `Luca finished in ${this.project.name}`,
          firstSentence(this.current.text) ||
            (isError ? 'Open Luca to try again.' : 'Your video is updated.')
        )
      this.current = null
    }
    this.rewriteHistory()
    const end: Extract<AgentEvent, { type: 'turn-end' }> = {
      type: 'turn-end',
      sessionId: this.sessionId ?? '',
      durationMs: Date.now() - this.turnStartedAt,
      isError: isError || stopped,
      stopped,
      error: stopped ? 'Stopped' : error
    }
    this.emit(end)
    // the Music start chip covered this project's first turn, whether or not it made any music
    endPreapproval(this.project.dir)
    // each listener starts now, in order; the turn is over for whoever waits on it only once they
    // are all done (captions re-timed, the version queued), and before the next turn starts
    const listeners = [...turnEndListeners].map((cb) => {
      try {
        return Promise.resolve(cb(this.project, end))
      } catch (err) {
        return Promise.reject(err)
      }
    })
    void listenersDone(listeners).then(() => {
      const turn = this.active
      this.active = null
      this.working = false
      this.ending = false
      // a stopped turn is not a success for whoever waits on it (clean edit, Save Look), and
      // they show the error to the person, so it is in plain words
      turn?.done?.({
        isError: end.isError,
        error: stopped ? 'Stopped' : error && (PLAIN_ERRORS[error] ?? error)
      })
      if (this.state === 'working') this.setState('ready')
      // without a live session the queue waits for the next start (restart, or the next send)
      if (this.q) {
        const next = this.queued.shift()
        if (next) this.dispatch(next)
      }
    })
  }
}

/** How long a turn's end waits for its listeners: one that hangs must not leave the chat stuck. */
const LISTENERS_MAX_MS = 120_000

/** Settled when every listener has finished (a failing one is only logged) or the wait is up. */
async function listenersDone(listeners: Promise<void>[]): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, LISTENERS_MAX_MS)
    timer.unref()
  })
  const all = Promise.allSettled(listeners).then((rs) => {
    for (const r of rs)
      if (r.status === 'rejected') console.warn('[luca] turn end failed', r.reason)
  })
  await Promise.race([all, late])
  clearTimeout(timer)
}

// ------------------------------------------------------------------ registry
let active: ProjectAgent | null = null
type TurnEndListener = (
  project: Project,
  e: Extract<AgentEvent, { type: 'turn-end' }>
) => void | Promise<void>
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
