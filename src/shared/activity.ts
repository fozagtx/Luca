/**
 * Plain-language descriptions of what the agent is doing, for people who edit video rather than
 * code: "Adding Lower Third Classic" instead of `npx hyperframes add lower-third-classic --json`.
 */

export type ActivityKind =
  'look' | 'edit' | 'check' | 'search' | 'add' | 'render' | 'media' | 'plan' | 'other'

export type Activity = {
  kind: ActivityKind
  /** Present tense, shown while it runs: "Adding Lower Third Classic". */
  active: string
  /** Past tense, shown once finished: "Added Lower Third Classic". */
  done: string
}

export const titleCase = (s: string): string =>
  s
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())

/** Catalog title for an item name, when known ("lt-clean-bar" → "Lower Third — Clean Bar"). */
export type TitleOf = (name: string) => string | undefined

/** What a project path means to someone who never sees the files. */
export function friendlyTarget(path: unknown, titleOf?: TitleOf): string {
  if (typeof path !== 'string' || !path) return 'the project'
  const p = path.replace(/\\/g, '/')
  const base = p.slice(p.lastIndexOf('/') + 1)
  const stem = base.replace(/\.[^.]+$/, '')
  if (/(^|\/)index\.html$/.test(p)) return 'your video'
  if (/(^|\/)compositions\/[^/]+\.html$/.test(p))
    return `the “${titleOf?.(stem) ?? titleCase(stem)}” scene`
  if (/(^|\/)LOOK\.md$/.test(p)) return 'your Look'
  if (/(^|\/)remocn\/[^/]+\.tsx?$/.test(p)) return `the ${titleCase(stem)} animation`
  if (/(^|\/)(CLAUDE|AGENTS)\.md$/.test(p)) return 'the project notes'
  if (/(^|\/)media\//.test(p)) return 'your footage'
  if (/(^|\/)transcript(\.original)?\.json$/.test(p)) return 'the transcript'
  if (/(^|\/)edl\.json$/.test(p)) return 'the cut list'
  if (/(^|\/)cut-candidates\.json$/.test(p)) return 'the suggested cuts'
  if (/(^|\/)(hyperframes|meta|package|project|look)\.json$/.test(p)) return 'the project settings'
  if (/\.html$/.test(p)) return 'a scene'
  return 'the project'
}

const act = (kind: ActivityKind, active: string, done: string): Activity => ({
  kind,
  active,
  done
})

/**
 * The command as the shell parses it, with quoted text neutralised: operators inside quotes are
 * just text (though `$(…)` and backticks still run inside double quotes), backslash-newline is a
 * continuation, and harmless stderr redirects (2>&1, 2>/dev/null) are dropped.
 */
function shellProbe(command: string): string {
  let out = ''
  let quote: "'" | '"' | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === "'") {
      if (c === "'") quote = null
      out += c === "'" ? c : 'x'
      continue
    }
    if (c === '\\' && i + 1 < command.length) {
      out += command[i + 1] === '\n' ? ' ' : 'x'
      i++
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = null
      out += /[;&|<>\n]/.test(c) ? ' ' : c
      continue
    }
    if (c === "'" || c === '"') quote = c
    out += c
  }
  return out.replace(/[ \t]\d?>&\d\b/g, ' ').replace(/[ \t]\d?>[ \t]*\/dev\/null\b/g, ' ')
}

/** Commands that change, delete, download or run other code. */
const RISKY_FIRST = new Set([
  'rm',
  'rmdir',
  'mv',
  'cp',
  'tee',
  'dd',
  'chmod',
  'chown',
  'ln',
  'touch',
  'mkdir',
  'curl',
  'wget',
  'git',
  'sudo',
  'kill',
  'pkill',
  'xargs',
  'sh',
  'bash',
  'zsh',
  'python',
  'python3',
  'node',
  'perl',
  'ruby',
  'osascript',
  'open',
  'npx',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'pip',
  'pip3',
  'brew',
  'env',
  'eval',
  'exec'
])

/**
 * Whether a shell command could change or delete anything, download, or chain further commands.
 * Such commands never get a reassuring label and can't be "always allowed".
 */
export function isRiskyCommand(command: string): boolean {
  const probe = shellProbe(command.trim())
  if (/[;&|<>`\n]|\$\(/.test(probe)) return true
  const first = probe.split(/\s+/)[0] ?? ''
  if (!first || first.includes('=')) return true
  const name = first.replace(/^.*\//, '')
  if (RISKY_FIRST.has(name)) return true
  if (name === 'find' && /\s-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)\b/.test(probe))
    return true
  if (name === 'sed' && /\s(-[a-zA-Z]*i|--in-place)/.test(probe)) return true
  if (name === 'tree' && /\s-o\b/.test(probe)) return true
  if (name === 'rg' && /\s--pre\b/.test(probe)) return true
  return false
}

function bash(command: string, titleOf?: TitleOf): Activity {
  const cmd = command.trim()
  // hyperframes' own commands are known; anything else that could change things gets no
  // reassuring label
  // `npx hyperframes …` is judged on the hyperframes part (npx alone could run anything)
  const hf0 = /^npx\s+(?:--yes\s+|-y\s+)?hyperframes(?:@[\w.-]+)?\s/.test(cmd)
  if (isRiskyCommand(hf0 ? cmd.replace(/^npx\s+(?:--yes\s+|-y\s+)?/, '') : cmd))
    return act('other', 'Running a command', 'Ran a command')
  const hf = /(?:^|\s)npx\s+(?:--yes\s+)?hyperframes(?:@[\w.-]+)?\s+(\w+)(?:\s+([\w@/.-]+))?/.exec(
    cmd
  )
  if (hf) {
    const [, sub, arg] = hf
    switch (sub) {
      case 'add': {
        const what =
          arg && !arg.startsWith('-') ? (titleOf?.(arg) ?? titleCase(arg)) : 'a component'
        return act('add', `Adding ${what}`, `Added ${what}`)
      }
      case 'lint':
      case 'validate':
        return act('check', 'Checking the edit', 'Checked the edit')
      case 'catalog':
        return act('search', 'Browsing the component library', 'Browsed the component library')
      case 'snapshot':
        return act('look', 'Looking at a frame', 'Looked at a frame')
      case 'timeline':
        return act('look', 'Reading the timeline', 'Read the timeline')
      case 'render':
        return act('render', 'Rendering a preview', 'Rendered a preview')
      default:
        return act('other', 'Working on your video', 'Worked on your video')
    }
  }
  const first = cmd.split(/\s+/)[0]?.replace(/^.*\//, '') ?? ''
  if (first === 'ffprobe') return act('media', 'Inspecting the footage', 'Inspected the footage')
  if (first === 'ffmpeg') return act('media', 'Processing the footage', 'Processed the footage')
  if (['ls', 'cat', 'head', 'tail', 'find', 'grep', 'rg', 'wc', 'tree'].includes(first))
    return act('look', 'Looking around the project', 'Looked around the project')
  return act('other', 'Running a command', 'Ran a command')
}

export function describeActivity(
  name: string,
  input: Record<string, unknown>,
  titleOf?: TitleOf
): Activity {
  switch (name) {
    case 'Read': {
      const t = friendlyTarget(input.file_path, titleOf)
      return act('look', `Looking at ${t}`, `Looked at ${t}`)
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const t = friendlyTarget(input.file_path ?? input.notebook_path, titleOf)
      return act('edit', `Editing ${t}`, `Edited ${t}`)
    }
    case 'Write': {
      const t = friendlyTarget(input.file_path, titleOf)
      return act('edit', `Writing ${t}`, `Wrote ${t}`)
    }
    case 'Glob':
    case 'Grep':
    case 'LS':
      return act('search', 'Searching the project', 'Searched the project')
    case 'Bash':
      return bash(String(input.command ?? ''), titleOf)
    case 'TodoWrite':
      return act('plan', 'Planning the edit', 'Planned the edit')
    case 'WebFetch':
    case 'WebSearch':
      return act('search', 'Reading the docs', 'Read the docs')
    case 'Task':
    case 'Agent':
      return act('plan', 'Thinking it through', 'Thought it through')
    case 'ToolSearch':
      return act('plan', 'Picking the right tools', 'Picked the right tools')
    case 'mcp__luca__catalog_search': {
      const q = String(input.query ?? '').trim()
      return q
        ? act('search', `Finding components for “${q}”`, `Searched components for “${q}”`)
        : act('search', 'Browsing the component library', 'Browsed the component library')
    }
    case 'mcp__luca__remocn_install': {
      const name = String(input.name ?? 'component')
      const what = titleOf?.(name) ?? titleCase(name)
      return act('add', `Installing ${what}`, `Installed ${what}`)
    }
    case 'mcp__luca__remocn_place': {
      const what = titleCase(String(input.clipId ?? 'the'))
      return act('render', `Rendering the ${what} animation`, `Placed the ${what} animation`)
    }
    default:
      return act('other', 'Working on it', 'Worked on it')
  }
}
