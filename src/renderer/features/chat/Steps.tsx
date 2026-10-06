import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePen,
  FilePlus2,
  FileText,
  Search,
  Square,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react'
import { TextShimmer } from '../../components/ai/text-shimmer'
import { cn } from '../../lib/cn'
import { formatElapsed, useElapsed } from '../../lib/elapsed'
import { useProject } from '../../stores/project'
import { activityOf, inputOf, lowerFirst, type ToolPart } from './activity'

type Status = ToolPart['status']

function StepIcon({ status }: { status: Status }): ReactElement {
  if (status === 'running') return <span className="step-spinner" />
  if (status === 'stopped')
    return (
      <span className="flex size-3 items-center justify-center rounded-full bg-bg-muted text-text-3">
        <Square size={6} fill="currentColor" strokeWidth={0} />
      </span>
    )
  if (status === 'error')
    return (
      <span className="flex size-3 items-center justify-center rounded-full bg-warning/20 text-warning">
        <X size={8} strokeWidth={3} />
      </span>
    )
  return (
    <span className="flex size-3 items-center justify-center rounded-full bg-success/15 text-success">
      <Check size={8} strokeWidth={3} />
    </span>
  )
}

/** How a step reads, by status. */
function label(p: ToolPart, status: Status): string {
  const a = activityOf(p)
  if (status === 'running') return `${a.active}…`
  if (status === 'stopped') return `Stopped while ${lowerFirst(a.active)}`
  if (status === 'error') return `${a.active} didn't work`
  return a.done
}

/**
 * A run of tool calls as one collapsible list of plain-language steps (prompt-kit Steps /
 * Chain of Thought). Open while Luca works, folded to a one-line summary once done. Each step
 * opens to show what it does, live: the command, the edit, the file being written, and what came
 * back.
 */
export function Steps({
  parts,
  live,
  stopped = false,
  animate = true
}: {
  parts: ToolPart[]
  live: boolean
  /** The person pressed Stop during this reply. */
  stopped?: boolean
  animate?: boolean
}): ReactElement {
  // a step can only be running while the reply is live; afterwards it was stopped or cut off
  const statusOf = (p: ToolPart): Status =>
    p.status === 'running' && !live ? (stopped ? 'stopped' : 'error') : p.status
  const running = live ? parts.findLast((p) => p.status === 'running') : undefined
  // a failed step followed by others is a normal retry; only a failed last step is a problem
  const endedBadly = !running && statusOf(parts[parts.length - 1]) === 'error'
  const [toggled, setToggled] = useState<boolean | null>(null)
  // which steps are open (false: opened, then shut); kept here so a lone step's open view
  // stays open when a second step turns it into a list
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const row = (p: ToolPart, text: string, header = false): ReactElement => (
    <StepRow
      key={p.id}
      part={p}
      status={statusOf(p)}
      text={text}
      header={header}
      fresh={live && !header}
      open={!!opened[p.id]}
      shown={p.id in opened}
      onToggle={() => setOpened((o) => ({ ...o, [p.id]: !o[p.id] }))}
    />
  )
  // a lone step is its own header; longer runs stay open for the whole turn so they don't fold
  // and unfold between tool calls
  const single = parts.length === 1
  const open = toggled ?? live
  // several steps can run at once, so Stop can cut off more than the last one
  const cutOff = !running && parts.some((p) => statusOf(p) === 'stopped')
  const finished = parts.filter((p) => statusOf(p) !== 'stopped').length
  const summary = running
    ? `Luca is ${lowerFirst(activityOf(running).active)}…`
    : single
      ? label(parts[0], statusOf(parts[0]))
      : live
        ? `${parts.length} steps so far`
        : cutOff
          ? finished
            ? `Stopped after ${finished} step${finished === 1 ? '' : 's'}`
            : 'Stopped'
          : `Took ${parts.length} steps`

  if (single)
    return (
      <div data-steps className={cn('min-w-0', animate && 'fade-in')}>
        {row(parts[0], summary, true)}
      </div>
    )

  return (
    <div data-steps className={cn('min-w-0', animate && 'fade-in')}>
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="group flex max-w-full items-center gap-2 rounded-[6px] py-0.5 text-left text-[12px] text-text-2 transition-colors hover:text-text"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {running ? (
            <span className="step-spinner" />
          ) : cutOff ? (
            <StepIcon status="stopped" />
          ) : endedBadly ? (
            <StepIcon status="error" />
          ) : (
            <StepIcon status="done" />
          )}
        </span>
        {running ? (
          <TextShimmer className="truncate font-medium">{summary}</TextShimmer>
        ) : (
          <span className="truncate font-medium">{summary}</span>
        )}
        <ChevronDown
          size={12}
          className={cn(
            'shrink-0 text-text-3 transition-transform duration-200',
            open ? 'rotate-180' : ''
          )}
        />
      </button>
      <Reveal open={open}>
        <ol className="relative mt-1 ml-[7px] border-l border-border pl-3.5">
          {parts.map((p) => row(p, label(p, statusOf(p))))}
        </ol>
      </Reveal>
    </div>
  )
}

/** Folds its content open and shut (the grid-rows trick); nothing inside is focusable shut. */
function Reveal({
  open,
  id,
  children
}: {
  open: boolean
  id?: string
  children: ReactNode
}): ReactElement {
  return (
    <div
      id={id}
      inert={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(.2,.8,.2,1)]',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      )}
    >
      <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
  )
}

/**
 * One step: its plain-language label as a button that opens what the step is doing. `header`:
 * a lone step, shown as the group's own header.
 */
function StepRow({
  part,
  status,
  text,
  header,
  fresh,
  open,
  shown,
  onToggle
}: {
  part: ToolPart
  status: Status
  text: string
  header: boolean
  fresh: boolean
  open: boolean
  /** What a step shows is only built once it is first opened, then kept for the closing fold. */
  shown: boolean
  onToggle: () => void
}): ReactElement {
  const running = status === 'running'
  const secs = useElapsed(part.startedAt, running)
  const panel = useId()

  const chevron = (
    <ChevronRight
      size={header ? 12 : 11}
      aria-hidden
      className={cn(
        'shrink-0 text-text-3 transition-[transform,opacity] duration-200',
        open ? 'rotate-90' : 'opacity-60 group-hover/row:opacity-100'
      )}
    />
  )
  const elapsed =
    running && secs >= 3 ? (
      <span className="ml-auto shrink-0 pl-2 font-mono text-[10.5px] text-text-3 tabular-nums">
        {formatElapsed(secs)}
      </span>
    ) : null
  const detail = (
    <Reveal open={open} id={panel}>
      {shown ? <StepDetail part={part} status={status} /> : null}
    </Reveal>
  )

  if (header)
    return (
      <>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panel}
          title={text}
          className="group/row flex w-full min-w-0 items-center gap-2 rounded-[6px] py-0.5 text-left text-[12px] text-text-2 transition-colors hover:text-text"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <StepIcon status={status} />
          </span>
          {running ? (
            <TextShimmer className="min-w-0 truncate font-medium">{text}</TextShimmer>
          ) : (
            <span className="min-w-0 truncate font-medium">{text}</span>
          )}
          {chevron}
          {elapsed}
        </button>
        <div className="pl-6">{detail}</div>
      </>
    )

  return (
    <li className={cn('relative min-w-0', fresh && 'fade-in')}>
      <span className="absolute top-[4px] -left-[21px] flex size-3.5 items-center justify-center bg-panel">
        <StepIcon status={status} />
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panel}
        title={text}
        className={cn(
          'group/row flex w-full min-w-0 items-center gap-1.5 rounded-[5px] py-[3px] text-left text-[11.5px] transition-colors hover:text-text',
          running ? 'font-medium text-text' : 'text-text-2'
        )}
      >
        <span className="min-w-0 truncate">{text}</span>
        {chevron}
        {elapsed}
      </button>
      {detail}
    </li>
  )
}

// ------------------------------------------------------------------------------------ step view

type Tone = 'add' | 'del' | 'ctx' | 'gap'
type Line = { text: string; tone: Tone }

/** What a step's panel shows: what it does (its heading and input) and what came back. */
type View = {
  icon: LucideIcon
  head: string
  /** The command, edit, file content or fields, as Luca wrote them. */
  input: ReactNode
  /** What came back, or null when there is nothing worth showing. */
  output: string | null
  /** Everything above as plain text, for Copy. */
  copy: string
}

/** Tool results wrap failures in tags meant for Claude; blank lines around say nothing. */
const cleanOutput = (s: string): string =>
  s
    .replace(/<\/?tool_use_error>/g, '')
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd()

/** A file as Read returns it, numbered like `cat -n`, with a gutter only as wide as it needs. */
function numbered(s: string): string {
  const rows = s.split('\n').map((l) => /^\s*(\d+)(?:\t|→)(.*)$/.exec(l))
  if (rows.some((r) => !r)) return s
  const width = Math.max(...rows.map((r) => r![1].length))
  return rows.map((r) => `${r![1].padStart(width)}  ${r![2]}`).join('\n')
}

/** The first lines of a long result, with a count of the rest (unless main cut it short: `…`). */
function firstLines(s: string, max = 12): string {
  const lines = s.split('\n')
  if (lines.length <= max) return s
  const cut = lines[lines.length - 1] === '…'
  const more = lines.length - max - (cut ? 1 : 0)
  return `${lines.slice(0, max).join('\n')}\n… ${cut ? 'more' : `${more} more line${more === 1 ? '' : 's'}`}`
}

/**
 * An edit (`--- old\n+++ new`) as a compact line diff: the lines both share at the start and end
 * fold into a line or two of context. While the new text is still streaming in only the start is
 * compared (its end isn't written yet).
 */
function diffLines(detail: string, live: boolean): Line[] {
  const m = /^--- ([\s\S]*?)\n\+\+\+ ([\s\S]*)$/.exec(detail)
  if (!m) return detail ? [{ text: detail, tone: 'ctx' }] : []
  const a = m[1] ? m[1].split('\n') : []
  const b = m[2] ? m[2].split('\n') : []
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let post = 0
  if (!live)
    while (
      post < a.length - pre &&
      post < b.length - pre &&
      a[a.length - 1 - post] === b[b.length - 1 - post]
    )
      post++
  const CONTEXT = 2
  const out: Line[] = []
  if (pre > CONTEXT) out.push({ text: '⋯', tone: 'gap' })
  // an edit's text usually starts mid-line, so its first line has no indent of its own
  const first = new Set([a[0], b[0]])
  for (const text of a.slice(Math.max(0, pre - CONTEXT), pre)) out.push({ text, tone: 'ctx' })
  for (const text of a.slice(pre, a.length - post)) out.push({ text, tone: 'del' })
  for (const text of b.slice(pre, b.length - post)) out.push({ text, tone: 'add' })
  for (const text of b.slice(b.length - post, b.length - post + CONTEXT))
    out.push({ text, tone: 'ctx' })
  if (post > CONTEXT) out.push({ text: '⋯', tone: 'gap' })
  // markup is deeply indented; the indent all lines share only takes width
  const indent = (t: string): number => t.length - t.trimStart().length
  const indents = out
    .filter((l) => l.tone !== 'gap' && l.text.trim() && !first.has(l.text))
    .map((l) => indent(l.text))
  const cut = indents.length ? Math.min(...indents) : 0
  if (!cut) return out
  return out.map((l) =>
    l.tone === 'gap' ? l : { ...l, text: l.text.slice(Math.min(cut, indent(l.text))) }
  )
}

const TONE: Record<Tone, string> = {
  add: 'bg-success/12 text-text',
  del: 'bg-danger/10 text-text',
  ctx: 'text-text-3',
  gap: 'text-text-3 select-none'
}
const SIGN: Record<Tone, string> = { add: '+', del: '-', ctx: ' ', gap: ' ' }

function Diff({ lines }: { lines: Line[] }): ReactElement {
  return (
    <div className="-mx-2.5">
      {lines.map((l, i) => (
        <div key={i} className={cn('flex px-2.5', TONE[l.tone])}>
          <span
            aria-hidden
            className={cn(
              'w-3 shrink-0 select-none',
              l.tone === 'add' ? 'text-success' : l.tone === 'del' ? 'text-danger' : ''
            )}
          >
            {SIGN[l.tone]}
          </span>
          <span className="min-w-0 flex-1">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}

/** A value of a step's input, as people read it. */
const valueText = (v: unknown): string =>
  typeof v === 'string' ? v : (JSON.stringify(v, null, 2) ?? String(v))

/** A tool's input as `key: value` lines, or as written when it isn't whole JSON (yet). */
function Fields({ json }: { json: string }): ReactElement {
  let fields: [string, unknown][] | null = null
  try {
    const v = JSON.parse(json) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) fields = Object.entries(v)
  } catch {
    // shown as written
  }
  if (!fields) return <div className="text-text-2">{json}</div>
  return (
    <div className="flex flex-col gap-0.5">
      {fields.map(([k, v]) => (
        <div key={k}>
          <span className="text-text-3 select-none">{k}: </span>
          <span className="text-text">{valueText(v)}</span>
        </div>
      ))}
    </div>
  )
}

function fieldsText(json: string): string {
  try {
    const v = JSON.parse(json) as Record<string, unknown>
    return Object.entries(v)
      .map(([k, x]) => `${k}: ${valueText(x)}`)
      .join('\n')
  } catch {
    return json
  }
}

/** What a step does and what came back, in a form that suits the tool. */
function viewOf(p: ToolPart, status: Status, projectDir: string | undefined): View {
  const running = status === 'running'
  const input = inputOf(p)
  const raw = input === undefined ? p.detail : p.output
  const out = raw ? cleanOutput(raw) : ''
  const inProject = (path: string): string =>
    projectDir && path.startsWith(`${projectDir}/`) ? path.slice(projectDir.length + 1) : path
  // the file the summary names ("Edited compositions/intro.html")
  const file = inProject(/^(?:Read|Edited|Wrote) (.+)$/.exec(p.summary)?.[1] ?? '')
  const failed = status === 'error'
  const join = (a: string, b: string | null): string => [a, b].filter(Boolean).join('\n\n')

  // history saved before steps kept their input: only what came back is known
  if (input === undefined) {
    return {
      icon: p.name === 'Bash' ? SquareTerminal : Wrench,
      head: file || (p.name === 'Bash' ? 'Command' : p.name.replace(/^mcp__luca__/, '')),
      input: null,
      output: out || null,
      copy: out
    }
  }

  switch (p.name) {
    case 'Bash':
      return {
        icon: SquareTerminal,
        head: 'Command',
        input: input ? (
          <div className="text-text">
            <span className="text-text-3 select-none">$ </span>
            {input}
          </div>
        ) : null,
        output: out || (status === 'done' ? 'No output' : null),
        copy: join(input ? `$ ${input}` : '', out)
      }
    case 'Edit': {
      const lines = diffLines(input, running)
      return {
        icon: FilePen,
        head: file || 'Edit',
        input: lines.length ? <Diff lines={lines} /> : null,
        // a successful edit answers with a snippet of the file; only a failure says something new
        output: failed && out ? out : null,
        copy: join(input, failed ? out : null)
      }
    }
    case 'Write':
      return {
        icon: FilePlus2,
        head: file || 'New file',
        input: input ? <div className="text-text-2">{input}</div> : null,
        output: failed && out ? out : null,
        copy: join(input, failed ? out : null)
      }
    case 'Read':
    case 'Glob':
    case 'Grep': {
      let what: Record<string, unknown> = {}
      try {
        what = JSON.parse(input) as Record<string, unknown>
      } catch {
        // the path or pattern isn't whole yet
      }
      const lines =
        p.name === 'Read'
          ? typeof what.offset === 'number'
            ? `From line ${what.offset}${typeof what.limit === 'number' ? `, ${what.limit} lines` : ''}`
            : ''
          : [
              typeof what.pattern === 'string' ? what.pattern : '',
              typeof what.path === 'string' ? `in ${inProject(what.path)}` : '',
              typeof what.glob === 'string' ? `files ${what.glob}` : ''
            ]
              .filter(Boolean)
              .join('  ')
      const short = out ? firstLines(p.name === 'Read' ? numbered(out) : out) : null
      return {
        icon: p.name === 'Read' ? FileText : Search,
        head: p.name === 'Read' ? file || 'Read a file' : p.name === 'Grep' ? 'Search' : 'Files',
        input: lines ? <div className="text-text">{lines}</div> : null,
        output: short,
        copy: join(lines, short)
      }
    }
    default:
      return {
        icon: Wrench,
        head: p.name.replace(/^mcp__luca__/, ''),
        // `{}`: nothing of the input has come in yet (or the tool takes none)
        input: input && input !== '{}' ? <Fields json={input} /> : null,
        output: out || null,
        copy: join(fieldsText(input), out)
      }
  }
}

/**
 * Keeps a growing panel scrolled to its newest line while the step runs, unless the person
 * scrolled up to read; they are followed again once they scroll back down.
 */
function useFollow(
  running: boolean,
  content: unknown
): {
  ref: RefObject<HTMLDivElement | null>
  onScroll: () => void
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && running && pinned.current) el.scrollTop = el.scrollHeight
  }, [running, content])
  const onScroll = (): void => {
    const el = ref.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 16
  }
  return { ref, onScroll }
}

function CopyButton({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      disabled={!text}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => undefined
        )
      }
      className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] px-1.5 font-sans text-[10.5px] text-text-3 transition-colors enabled:hover:bg-hover enabled:hover:text-text disabled:opacity-40"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** The open panel of a step: what it does, live, and what came back. */
function StepDetail({ part, status }: { part: ToolPart; status: Status }): ReactElement {
  const projectDir = useProject((s) => s.project?.dir)
  const running = status === 'running'
  const view = useMemo(() => viewOf(part, status, projectDir), [part, status, projectDir])
  const { ref, onScroll } = useFollow(running, part.detail)
  const Icon = view.icon
  const empty = !view.input && !view.output
  return (
    <div className="mt-1 mb-1.5 min-w-0 overflow-hidden rounded-[8px] border border-border bg-bg">
      <div className="flex h-7 items-center gap-1.5 border-b border-border pr-1 pl-2.5 text-[10.5px] text-text-3">
        <Icon size={11} strokeWidth={1.9} className="shrink-0" />
        <span className="min-w-0 truncate font-mono" title={view.head}>
          {view.head}
        </span>
        <CopyButton text={view.copy} />
      </div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="scroll max-h-[200px] px-2.5 py-2 font-mono text-[10.5px] leading-[1.6] whitespace-pre-wrap select-text [overflow-wrap:anywhere]"
      >
        {view.input}
        {view.input && view.output ? (
          <div className="my-2 border-t border-dashed border-border" />
        ) : null}
        {view.output ? (
          <div
            className={cn(
              status === 'error' ? 'border-l-2 border-danger/60 pl-2 text-text' : 'text-text-2'
            )}
          >
            {view.output}
          </div>
        ) : null}
        {empty ? (
          running ? (
            <TextShimmer className="font-sans text-[11px]">Luca is writing this step…</TextShimmer>
          ) : (
            <span className="font-sans text-[11px] text-text-3">
              Nothing to show for this step.
            </span>
          )
        ) : null}
      </div>
    </div>
  )
}
