import type { ChatContentPart, ChatMessage, Chip } from '@shared/types'
import {
  AudioLines,
  Check,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Copy,
  Image as ImageIcon,
  MousePointer2,
  Package,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Type,
  Wallpaper,
  X
} from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { describeActivity } from '../../../shared/activity'
import { Markdown } from '../../components/ai/markdown'
import { TextShimmer, TypingDots } from '../../components/ai/text-shimmer'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/cn'
import { formatDuration } from '../../lib/format'
import { clock } from '../../lib/timecode'
import { useChat } from '../../stores/chat'
import { stopLuca } from '../../stores/queue'
import type { ToolPart } from './activity'
import { Steps } from './Steps'

// ------------------------------------------------------------------------------------ chips

function chipIcon(chip: Chip): ReactElement {
  switch (chip.kind) {
    case 'element':
      return <MousePointer2 size={11} />
    case 'frame':
      return <ImageIcon size={11} />
    case 'catalog':
      return <Package size={11} />
    case 'clip':
      return <Scissors size={11} />
    case 'transcript':
      return <Type size={11} />
    case 'background':
      return <Wallpaper size={11} />
    case 'media':
      return chip.media === 'video' ? (
        <Clapperboard size={11} />
      ) : chip.media === 'audio' ? (
        <AudioLines size={11} />
      ) : (
        <ImageIcon size={11} />
      )
  }
}

function chipLabel(chip: Chip): string {
  switch (chip.kind) {
    case 'element':
      return (
        chip.label ??
        (/^#[\w-]+$/.test(chip.selector)
          ? chip.selector.slice(1).replace(/[-_]/g, ' ')
          : `Part of the video at ${clock(chip.time)}`)
      )
    case 'frame':
      return `Frame at ${clock(chip.time)}`
    case 'catalog':
      return chip.title || chip.name
    case 'clip':
      return chip.clipId.replace(/[-_]/g, ' ')
    case 'transcript':
      return `“${chip.text.slice(0, 24)}${chip.text.length > 24 ? '…' : ''}”`
    case 'background':
      return `Background: ${chip.title}`
    case 'media':
      return chip.duration ? `${chip.name} · ${formatDuration(chip.duration)}` : chip.name
  }
}

/** The still shown above a chip on hover: a grabbed frame, a background, an added file. */
function chipPreview(chip: Chip): string | undefined {
  if (chip.kind === 'frame') return `data:image/png;base64,${chip.png}`
  if (chip.kind === 'background') return chip.thumb
  if (chip.kind === 'media') return chip.thumb
  return undefined
}

export function ChipPill({
  chip,
  onRemove,
  tone = 'default'
}: {
  chip: Chip
  onRemove?: () => void
  tone?: 'default' | 'onBubble'
}): ReactElement {
  const preview = chipPreview(chip)
  return (
    <span
      className={cn(
        'group relative inline-flex h-[22px] max-w-full items-center gap-1 rounded-full border px-2 text-[11px] font-medium',
        tone === 'onBubble'
          ? 'border-secondary-border bg-bg/70 text-secondary-fg'
          : 'border-border bg-bg text-text-2'
      )}
    >
      {chipIcon(chip)}
      <span className="max-w-40 truncate">{chipLabel(chip)}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="-mr-0.5 ml-0.5 flex size-3.5 items-center justify-center rounded-full text-text-3 hover:bg-hover hover:text-text"
        >
          <X size={10} />
        </button>
      ) : null}
      {preview ? (
        <img
          src={preview}
          alt=""
          className="pointer-events-none absolute bottom-7 left-0 z-10 hidden w-40 rounded-[6px] border border-border shadow-md group-hover:block"
        />
      ) : null}
    </span>
  )
}

// ------------------------------------------------------------------------------------ user

export function UserMessage({ m, animate }: { m: ChatMessage; animate: boolean }): ReactElement {
  return (
    <div className={cn('flex justify-end pl-8', animate && 'msg-in')}>
      <div className="max-w-full rounded-[16px] rounded-br-[5px] border border-secondary-border bg-secondary px-3 py-2 text-[13px] leading-[1.55] text-text">
        {m.chips && m.chips.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {m.chips.map((c, i) => (
              <ChipPill key={i} chip={c} tone="onBubble" />
            ))}
          </div>
        ) : null}
        <div className="select-text whitespace-pre-wrap">{m.text}</div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------ assistant

type Group =
  | { kind: 'steps'; parts: ToolPart[] }
  | { kind: 'text'; text: string }
  | { kind: 'permission'; part: Extract<ChatContentPart, { type: 'permission' }> }

function group(parts: ChatContentPart[]): Group[] {
  const out: Group[] = []
  for (const p of parts) {
    const last = out[out.length - 1]
    if (p.type === 'tool') {
      if (last?.kind === 'steps') last.parts.push(p)
      else out.push({ kind: 'steps', parts: [p] })
    } else if (p.type === 'text') {
      if (!p.text.trim()) continue
      out.push({ kind: 'text', text: p.text })
    } else out.push({ kind: 'permission', part: p })
  }
  return out
}

function useElapsed(since: string, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return Math.max(0, Math.round((now - new Date(since).getTime()) / 1000))
}

function duration(s: number): string {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** "Luca is thinking" row (prompt-kit ThinkingBar), with elapsed time and a Stop link. */
function Thinking({ since, onStop }: { since: string; onStop: () => void }): ReactElement {
  const secs = useElapsed(since, true)
  return (
    <div className="fade-in flex items-center gap-2 text-[12px]">
      <span className="flex size-4 items-center justify-center text-accent">
        <TypingDots />
      </span>
      <TextShimmer className="font-medium">Luca is thinking…</TextShimmer>
      <span className="ml-auto flex items-center gap-2 text-[11px] text-text-3 tabular-nums">
        {secs >= 3 ? duration(secs) : null}
        <button
          type="button"
          onClick={onStop}
          className="border-b border-dotted border-text-3/60 text-text-3 transition-colors hover:border-text hover:text-text"
        >
          Stop
        </button>
      </span>
    </div>
  )
}

export function AssistantMessage({
  m,
  animate,
  request
}: {
  m: ChatMessage
  animate: boolean
  /** The user message this reply answers, for Try again. */
  request?: ChatMessage
}): ReactElement {
  const resend = useChat((s) => s.resend)
  const [copied, setCopied] = useState(false)
  const parts: ChatContentPart[] =
    m.parts && m.parts.length > 0 ? m.parts : m.text ? [{ type: 'text', text: m.text }] : []
  const groups = group(parts)
  const last = parts[parts.length - 1]
  const lastGroup = groups[groups.length - 1]
  const toolRunning = parts.some((p) => p.type === 'tool' && p.status === 'running')
  const waitingOnPermission = parts.some((p) => p.type === 'permission' && !p.resolved)
  const streaming = !!m.pending && last?.type === 'text'
  const thinking = !!m.pending && !streaming && !toolRunning && !waitingOnPermission
  // reloaded history appears as is; only new or live messages animate
  const anim = animate || !!m.pending

  const copy = (): void => {
    void navigator.clipboard.writeText(m.text.trim()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  return (
    <div className={cn('group/msg flex flex-col gap-2.5', animate && 'msg-in')}>
      {groups.map((g, i) => {
        if (g.kind === 'steps')
          return (
            <Steps
              key={i}
              parts={g.parts}
              live={!!m.pending}
              stopped={!!m.stopped}
              animate={anim}
            />
          )
        if (g.kind === 'permission')
          return (
            <PermissionCard key={g.part.id} part={g.part} stopped={!!m.stopped} animate={anim} />
          )
        return (
          <Markdown
            key={i}
            text={g.text}
            trailing={
              streaming && g === lastGroup ? <span className="stream-dot" aria-hidden /> : null
            }
          />
        )
      })}
      {thinking ? <Thinking since={m.createdAt} onStop={() => void stopLuca()} /> : null}
      {m.isError && !m.pending ? (
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-[12px] border border-danger/20 bg-danger/[0.06] px-3 py-2.5',
            anim && 'fade-in'
          )}
        >
          <CircleAlert size={14} className="mt-px shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-text">
              Luca couldn&apos;t finish this
            </div>
            <div className="mt-0.5 text-[11.5px] leading-[1.45] text-text-2">
              Nothing was lost. You can try again or rephrase what you&apos;d like.
            </div>
          </div>
          {request ? (
            <Button size="sm" onClick={() => void resend(request)} className="shrink-0">
              <RotateCcw size={11} /> Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {!m.pending && m.text.trim() ? (
        <div className="-mt-1 flex h-5 items-center gap-1 text-[11px] text-text-3 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-5 items-center gap-1 rounded-[5px] px-1 transition-colors hover:bg-hover hover:text-text"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {m.durationMs ? (
            <span className="px-1 tabular-nums">
              Worked for {duration(Math.round(m.durationMs / 1000))}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------------------------ permission

/** What "Always allow" would permit. Only plain read-only commands get a rule (see canUseTool). */
function allowScope(rule: string): string {
  const bash = /^Bash\((.+)\)$/.exec(rule)
  return bash ? `read-only “${bash[1]} …” commands` : `every “${rule}” step`
}

function PermissionCard({
  part,
  stopped,
  animate
}: {
  part: Extract<ChatContentPart, { type: 'permission' }>
  /** The turn was stopped, so an unanswered card was closed by Stop, not by the person. */
  stopped: boolean
  animate: boolean
}): ReactElement {
  const decide = useChat((s) => s.decide)
  const [details, setDetails] = useState(false)
  const input = (part.input ?? {}) as Record<string, unknown>
  const activity = describeActivity(part.tool, input)
  const bash = part.tool === 'Bash'
  const exact = bash ? String(input.command ?? '') : JSON.stringify(input, null, 2)
  const scope = part.rule ? allowScope(part.rule) : null

  // ⌘↩ allows once, ⇧⌘↩ always (when offered): Luca is blocked until you answer, so this comes
  // before the queue
  useEffect(() => {
    if (part.resolved) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing) return
      // typing a message: ⌘↩ sends it rather than allowing the step
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      void decide(part.id, e.shiftKey && scope ? 'allow-always' : 'allow')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [part.id, part.resolved, scope, decide])

  if (part.resolved) {
    const denied = part.resolved === 'deny'
    return (
      <div
        className={cn('flex items-center gap-1.5 text-[11.5px] text-text-3', animate && 'fade-in')}
      >
        {denied ? (
          <X size={12} className="shrink-0 text-text-3" />
        ) : (
          <Check size={12} className="shrink-0 text-success" />
        )}
        <span className="min-w-0 truncate">
          {denied
            ? stopped
              ? `Stopped before ${activity.active.toLowerCase()}`
              : part.cancelled
                ? `Skipped: ${activity.active.toLowerCase()}`
                : `You didn't allow: ${activity.active.toLowerCase()}`
            : part.resolved === 'allow-always'
              ? `Always allowed in this project: ${scope ?? activity.active.toLowerCase()}`
              : `Allowed once: ${activity.active.toLowerCase()}`}
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        animate && 'msg-in'
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-secondary text-secondary-fg">
          <ShieldCheck size={15} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-text">Luca needs your OK</div>
          <div className="mt-0.5 text-[12px] leading-[1.45] text-text-2">
            {bash
              ? 'Luca wants to run this command. It isn’t on Luca’s safe list, so check it before allowing.'
              : `${activity.active}. This step isn’t on Luca’s safe list yet.`}
          </div>
          {bash ? (
            <pre className="mt-2 max-h-28 overflow-auto rounded-[8px] bg-bg-muted p-2 font-mono text-[10.5px] leading-[1.45] whitespace-pre-wrap text-text select-text">
              {exact}
            </pre>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setDetails((d) => !d)}
                className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-text-3 transition-colors hover:text-text"
              >
                <ChevronRight
                  size={11}
                  className={cn('transition-transform duration-150', details && 'rotate-90')}
                />
                {details ? 'Hide details' : 'Show details'}
              </button>
              {details ? (
                <pre className="fade-in mt-1.5 max-h-40 overflow-auto rounded-[8px] bg-bg-muted p-2 font-mono text-[10.5px] leading-[1.45] whitespace-pre-wrap text-text-2 select-text">
                  {exact}
                </pre>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 pl-[38px]">
        <Button size="sm" variant="primary" onClick={() => void decide(part.id, 'allow')}>
          Allow once <kbd className="ml-0.5 font-mono text-[10px] opacity-70">⌘↩</kbd>
        </Button>
        {scope ? (
          <Button
            size="sm"
            onClick={() => void decide(part.id, 'allow-always')}
            title={`Lets ${scope} run in this project without asking again`}
          >
            Always allow <kbd className="ml-0.5 font-mono text-[10px] opacity-60">⇧⌘↩</kbd>
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => void decide(part.id, 'deny')}>
          Don&apos;t allow
        </Button>
      </div>
      <p className="mt-2 pl-[38px] text-[10.5px] leading-[1.4] text-text-3">
        {scope
          ? `Always allow lets ${scope} run in this project without asking again.`
          : 'Luca asks every time for commands that could change, delete or download things.'}
      </p>
    </div>
  )
}
