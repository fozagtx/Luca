/**
 * Plain-language descriptions of what the agent is doing, for people who edit video rather than
 * code: "Adding Lower Third Classic" instead of `npx hyperframes add lower-third-classic --json`.
 */
import { formatCredits, formatSpan } from './ai33'

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
  if (/(^|\/)EDIT\.md$/.test(p)) return 'the edit plan'
  if (/(^|\/)remocn\/[^/]+\.tsx?$/.test(p)) return `the ${titleCase(stem)} animation`
  if (/(^|\/)(CLAUDE|AGENTS)\.md$/.test(p)) return 'the project notes'
  if (/(^|\/)media\/broll\//.test(p)) return 'the B-roll'
  if (/(^|\/)media\/generated\/(speech|music|sfx)\//.test(p)) return 'the generated audio'
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
 * The words a shell command runs with once the shell has applied its quoting, or null when the
 * command does anything beyond running one simple command: chaining, pipes, redirects (other than
 * discarding output), substitutions, variables, subshells, comments, globs that could expand into
 * options, or anything else this reader doesn't model. Null means "can't tell", never "safe".
 */
export function shellWords(command: string): string[] | null {
  const src = command
    .trim()
    .replace(/[ \t]\d?>&\d(?=[ \t]|$)/g, ' ')
    .replace(/[ \t](?:\d|&)?>[ \t]*\/dev\/null(?=[ \t]|$)/g, ' ')
  const words: string[] = []
  let word = ''
  let inWord = false
  let quote: "'" | '"' | null = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else word += c
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '$' || c === '`' || c === '!') return null
      else if (c === '\\') {
        const n = src[++i]
        if (n === undefined) return null
        // inside double quotes a backslash only escapes $ ` " \ and newline
        if ('$`"\\'.includes(n)) word += n
        else if (n !== '\n') word += c + n
      } else word += c
      continue
    }
    if (c === '\\') {
      const n = src[++i]
      if (n === undefined) return null
      // backslash-newline joins lines; any other escaped character is taken literally
      if (n !== '\n') {
        word += n
        inWord = true
      }
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      inWord = true
      continue
    }
    if (c === ' ' || c === '\t') {
      if (inWord) words.push(word)
      word = ''
      inWord = false
      continue
    }
    // operators, expansions, subshells, comments, history, control characters
    if (/[;&|<>`$(){}#!]/.test(c) || c < ' ') return null
    // a glob at the start of a word could expand to a file named like an option ("-delete")
    if (!inWord && /[*?[]/.test(c)) return null
    word += c
    inWord = true
  }
  if (quote) return null
  if (inWord) words.push(word)
  return words
}

/** Read-only commands that may be "always allowed", and the options that would make them write or run code. */
const READ_ONLY: Record<string, (args: string[]) => boolean> = {
  ls: () => true,
  cat: () => true,
  head: () => true,
  tail: () => true,
  wc: () => true,
  du: () => true,
  stat: () => true,
  pwd: () => true,
  echo: () => true,
  which: () => true,
  grep: () => true,
  rg: (args) => !args.some((a) => a === '--pre' || a.startsWith('--pre=')),
  find: (args) =>
    !args.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a))
}

/**
 * The rule "Always allow" stores for a shell command (`Bash(ls)`), or null when the command could
 * change, delete, download or run anything, or chain further commands. Only plain read-only
 * commands qualify, and every later command is checked again before the rule is applied.
 */
export function alwaysAllowRule(command: string): string | null {
  const words = shellWords(command)
  if (!words?.length) return null
  const [name, ...args] = words
  const ok = Object.hasOwn(READ_ONLY, name) && READ_ONLY[name](args)
  return ok ? `Bash(${name})` : null
}

function bash(command: string, titleOf?: TitleOf): Activity {
  const run = act('other', 'Running a command', 'Ran a command')
  const words = shellWords(command)
  if (!words?.length) return run
  // `npx hyperframes …` is judged on the hyperframes part (npx alone could run anything)
  let w = words
  if (w[0] === 'npx') w = w.slice(w[1] === '--yes' || w[1] === '-y' ? 2 : 1)
  if (/^hyperframes(@[\w.-]+)?$/.test(w[0] ?? '')) {
    const [, sub, arg] = w
    switch (sub) {
      case 'add': {
        const what =
          arg && !arg.startsWith('-') ? (titleOf?.(arg) ?? titleCase(arg)) : 'a title or effect'
        return act('add', `Adding ${what}`, `Added ${what}`)
      }
      case 'lint':
      case 'validate':
        return act('check', 'Checking the edit', 'Checked the edit')
      case 'catalog':
        return act('search', 'Looking for a title or effect', 'Looked for a title or effect')
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
  if (words[0] === 'ffprobe') return act('media', 'Inspecting the footage', 'Inspected the footage')
  if (words[0] === 'ffmpeg') return act('media', 'Processing the footage', 'Processed the footage')
  if (alwaysAllowRule(command))
    return act('look', 'Looking around the project', 'Looked around the project')
  return run
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
        ? act(
            'search',
            `Finding a title or effect for “${q}”`,
            `Looked for a title or effect for “${q}”`
          )
        : act('search', 'Looking for a title or effect', 'Looked for a title or effect')
    }
    case 'mcp__luca__transcribe':
      return act('media', 'Listening to the video', 'Listened to the video')
    case 'mcp__luca__clean_edit':
      return act('edit', 'Cutting ums and pauses', 'Cut ums and pauses')
    case 'mcp__luca__broll_search': {
      const q = String(input.query ?? '').trim()
      return q
        ? act('search', `Finding B-roll for “${q}”`, `Searched B-roll for “${q}”`)
        : act('search', 'Finding B-roll', 'Looked for B-roll')
    }
    case 'mcp__luca__broll_add':
      return act('media', 'Adding B-roll', 'Added B-roll')
    case 'mcp__luca__remocn_install': {
      const name = String(input.name ?? 'component')
      const what = titleOf?.(name) ?? titleCase(name)
      return act('add', `Installing ${what}`, `Installed ${what}`)
    }
    case 'mcp__luca__remocn_place': {
      const what = titleCase(String(input.clipId ?? 'the'))
      return act('render', `Rendering the ${what} animation`, `Placed the ${what} animation`)
    }
    case 'mcp__luca__speech_generate':
      if (Array.isArray(input.speakers) && input.speakers.length)
        return act('media', 'Recording the conversation', 'Recorded the conversation')
      if (typeof input.at === 'number') return act('media', 'Recording a line', 'Recorded a line')
      return act('media', 'Recording the voiceover', 'Recorded the voiceover')
    case 'mcp__luca__voice_search':
      return act('search', 'Finding voices', 'Looked through voices')
    case 'mcp__luca__music_generate':
      return act('media', 'Making music', 'Made music')
    case 'mcp__luca__sfx_generate': {
      const n = Array.isArray(input.effects) ? input.effects.length : 1
      return n > 1
        ? act('media', `Making ${n} sound effects`, `Made ${n} sound effects`)
        : act('media', 'Making a sound effect', 'Made a sound effect')
    }
    case 'mcp__luca__audio_place':
      return act('add', 'Adding the sound to the video', 'Added the sound to the video')
    case 'mcp__luca__ai33_status':
      return act('other', 'Checking your credits', 'Checked your credits')
    case 'mcp__luca__captions_apply':
      return act('edit', 'Styling the captions', 'Styled the captions')
    case 'mcp__luca__sound_mix':
      return act('edit', 'Mixing the sound', 'Mixed the sound')
    case 'mcp__luca__reference_study':
      return act('look', 'Studying the reference', 'Studied the reference')
    case 'mcp__luca__lut_apply':
      return input.lut === 'none'
        ? act('edit', 'Removing the color grade', 'Removed the color grade')
        : act('edit', 'Grading the footage', 'Graded the footage')
    case 'mcp__luca__font_add': {
      // a pasted link says nothing to people; a family name does
      const font = String(input.font ?? '').trim()
      return /^[\p{L}\p{N} ]{1,40}$/u.test(font)
        ? act('add', `Adding the ${font} font`, `Added the ${font} font`)
        : act('add', 'Adding the font', 'Added the font')
    }
    default:
      return act('other', 'Working on it', 'Worked on it')
  }
}

// ------------------------------------------------------------------ what a finished ai33 step made

/** 3 → "0:03", 84 → "1:24": a time in the video. */
const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * What a job cost, as words for the end of a step's label: "610 credits", "no credits" only when
 * the result says the work was reused (nothing was spent), and nothing when the result doesn't say.
 */
const used = (r: { credits?: unknown; reused?: unknown }): string =>
  r.reused === true
    ? 'no credits'
    : typeof r.credits === 'number' && r.credits > 0
      ? `${formatCredits(r.credits)} credits`
      : ''

/** A step's label with its cost after it (` · 610 credits`), or as it is when there is none to say. */
const withCost = (label: string, r: { credits?: unknown; reused?: unknown }): string => {
  const cost = used(r)
  return cost ? `${label} · ${cost}` : label
}

const number = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)

/** What an ai33 tool still working at its wait budget reads, by tool. */
const WORKING: Record<string, string> = {
  speech_generate: 'The voiceover is still being recorded',
  music_generate: 'Music is still being made',
  sfx_generate: 'The sound effect is still being made'
}

/**
 * How a finished ai33 tool step reads in the chat, from its result's first line (single-line JSON,
 * the shape in the tool's description). `done` replaces the step's finished label (with what it
 * made and what it cost); `status: 'stopped'` marks a step the person declined (not an error).
 * Anything unreadable, and every other tool, returns nothing: the neutral label stays.
 */
export function describeResult(
  name: string,
  firstLine: string
): { done?: string; status?: 'stopped' } {
  const tool = name.replace(/^mcp__luca__/, '')
  let r: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(firstLine)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    r = parsed as Record<string, unknown>
  } catch {
    return {}
  }
  if (r.declined === true) return { status: 'stopped' }
  if (r.ok !== true) return {}
  if (r.working === true) return WORKING[tool] ? { done: WORKING[tool] } : {}
  switch (tool) {
    case 'speech_generate': {
      const seconds = number(r.seconds)
      const what = seconds === null ? 'the voiceover' : `a ${formatSpan(seconds)} voiceover`
      return { done: withCost(`Recorded ${what}`, r) }
    }
    case 'music_generate':
      return {
        done:
          r.reused === true ? 'Used the music already made · no credits' : withCost('Made music', r)
      }
    case 'sfx_generate': {
      const placed = Array.isArray(r.placed) ? (r.placed as Record<string, unknown>[]) : []
      const count = Math.max(placed.length, Array.isArray(r.files) ? r.files.length : 0)
      if (count > 1) return { done: withCost(`Made ${count} sound effects`, r) }
      const one = placed[0]
      const title = typeof one?.title === 'string' ? one.title.trim().toLowerCase() : ''
      const start = number(one?.start)
      const noun = title ? `${/^[aeiou]/.test(title) ? 'an' : 'a'} ${title}` : 'a sound effect'
      return {
        done: withCost(start === null ? `Made ${noun}` : `Added ${noun} at ${clock(start)}`, r)
      }
    }
    default:
      return {}
  }
}
