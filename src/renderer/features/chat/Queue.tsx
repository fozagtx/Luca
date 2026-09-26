import type { ChatMessage } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUp,
  AudioLines,
  Check,
  Keyboard,
  LoaderCircle,
  Mic,
  Pause,
  PenLine,
  Play,
  Square,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { TextShimmer } from '../../components/ai/text-shimmer'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { useChat } from '../../stores/chat'
import { useProject } from '../../stores/project'
import { stopLuca, useQueue, type QueueItem } from '../../stores/queue'
import { ChipPill } from './Message'
import { activityOf } from './activity'

const EASE = [0.2, 0.8, 0.2, 1] as const

/**
 * Requests that aren't finished yet, above the message box: what Luca is doing now, what's
 * lined up next, and what you said or dictated that is waiting for your OK. Nothing here is in
 * the conversation until Luca starts on it.
 */
export function QueueTray(): ReactElement | null {
  const dir = useProject((s) => s.project?.dir ?? null)
  const all = useQueue((s) => s.items)
  const paused = useQueue((s) => s.paused)
  const working = useChat((s) => s.state === 'working')
  const items = useMemo(() => all.filter((i) => i.dir === dir), [all, dir])
  const lined = items.filter((i) => i.status !== 'review')
  const review = items.filter((i) => i.status === 'review')

  useEffect(() => {
    if (review.length === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing) return
      if ((e.target as HTMLElement | null)?.dataset.queueEdit) return
      e.preventDefault()
      e.stopPropagation()
      useQueue.getState().approveNext()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [review.length])

  if (items.length === 0) return null

  return (
    <motion.section
      aria-label="Requests queue"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="queue-tray mx-3 mb-2 overflow-hidden"
    >
      <header className="flex h-8 items-center gap-2 px-3">
        <span className="queue-orb" aria-hidden />
        <span className="text-[11.5px] font-semibold tracking-[-0.01em] text-text">Queue</span>
        <span className="rounded-full bg-bg-muted px-1.5 text-[10.5px] font-medium text-text-2 tabular-nums">
          {items.length}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {paused && lined.length > 0 ? (
            <button
              type="button"
              onClick={() => useQueue.getState().resume()}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-warning/15 px-2 text-[11px] font-medium text-text transition-colors hover:bg-warning/25"
            >
              <Play size={10} fill="currentColor" /> Resume
            </button>
          ) : lined.length > 0 ? (
            <Tip label="Hold the queue" side="top">
              <button
                type="button"
                aria-label="Pause the queue"
                onClick={() => useQueue.getState().pause()}
                className="icon-btn size-6"
              >
                <Pause size={11} />
              </button>
            </Tip>
          ) : null}
          {review.length > 1 ? (
            <button
              type="button"
              onClick={() => useQueue.getState().approveAll()}
              className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              <Check size={11} strokeWidth={2.5} /> Approve all
            </button>
          ) : null}
        </span>
      </header>
      <div className="scroll max-h-[260px] px-1.5 pb-1.5">
        {working ? <NowRow /> : null}
        <AnimatePresence initial={false}>
          {lined.map((i, n) => (
            <Row key={i.id}>
              <LinedUp item={i} position={n} paused={paused} working={working} />
            </Row>
          ))}
          {review.map((i) => (
            <Row key={i.id}>
              <Review item={i} busy={working || lined.length > 0} />
            </Row>
          ))}
        </AnimatePresence>
      </div>
    </motion.section>
  )
}

function Row({ children }: { children: ReactElement }): ReactElement {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <div className="pt-1">{children}</div>
    </motion.div>
  )
}

/** The request Luca is working on, with what it's doing right now. */
function NowRow(): ReactElement {
  const messages = useChat((s) => s.messages)
  const { asked, doing } = useMemo(() => nowOf(messages), [messages])
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5">
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/25 [animation-duration:1.6s]" />
        <span className="relative size-2 rounded-full bg-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-text">{asked || 'Your request'}</div>
        <TextShimmer className="block truncate text-[11px]">{doing}</TextShimmer>
      </div>
      <Tip label="Stop" side="top">
        <button
          type="button"
          aria-label="Stop Luca"
          onClick={() => void stopLuca()}
          className="icon-btn size-7 shrink-0"
        >
          <Square size={10} fill="currentColor" />
        </button>
      </Tip>
    </div>
  )
}

function nowOf(messages: ChatMessage[]): { asked: string; doing: string } {
  let asked = ''
  let doing = 'Luca is thinking…'
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.pending) {
      const parts = m.parts ?? []
      const last = parts[parts.length - 1]
      if (last?.type === 'text') doing = 'Luca is writing back…'
      else if (last?.type === 'permission' && !last.resolved)
        doing = 'Waiting for your OK in the chat'
      else if (last?.type === 'tool') doing = `${activityOf(last).active}…`
    }
    if (m.role === 'user') {
      asked = m.text
      break
    }
  }
  return { asked, doing }
}

/** Approved and waiting its turn. */
function LinedUp({
  item,
  position,
  paused,
  working
}: {
  item: QueueItem
  position: number
  paused: boolean
  working: boolean
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const sending = item.status === 'sending'
  const label = sending
    ? 'Starting…'
    : paused
      ? 'On hold'
      : position === 0
        ? working
          ? 'Next up'
          : 'Starting…'
        : `#${position + 1} in line`
  return (
    <div className="group/row flex items-start gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-hover">
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
          sending ? 'text-accent' : 'bg-bg-muted text-text-2'
        )}
      >
        {sending ? <LoaderCircle size={13} className="animate-spin" /> : position + 1}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <InlineEdit item={item} onDone={() => setEditing(false)} />
        ) : (
          <button
            type="button"
            disabled={sending}
            onClick={() => setEditing(true)}
            className="line-clamp-2 w-full text-left text-[12px] leading-[1.45] text-text"
          >
            {item.text}
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-text-3">
          <SourceIcon source={item.source} />
          {label}
          {item.chips.length > 0 ? ` · ${item.chips.length} attached` : ''}
        </div>
      </div>
      {!sending && !editing ? (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
          <Tip label="Edit" side="top">
            <button
              type="button"
              aria-label="Edit"
              onClick={() => setEditing(true)}
              className="icon-btn size-6"
            >
              <PenLine size={12} />
            </button>
          </Tip>
          <Tip label="Remove from the queue" side="top">
            <button
              type="button"
              aria-label="Remove from the queue"
              onClick={() => useQueue.getState().discard(item.id)}
              className="icon-btn size-6"
            >
              <X size={12} />
            </button>
          </Tip>
        </span>
      ) : null}
    </div>
  )
}

/** Heard or dictated, waiting for your OK before Luca sees it. */
function Review({ item, busy }: { item: QueueItem; busy: boolean }): ReactElement {
  const [editing, setEditing] = useState(false)
  const { approve, discard, toComposer } = useQueue.getState()
  return (
    <div className="queue-review rounded-[12px] p-2.5">
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-text-2">
        <SourceIcon source={item.source} />
        {item.source === 'voice' ? 'You said' : item.source === 'dictation' ? 'Dictated' : 'Typed'}
        {item.open ? (
          <span className="ml-1 inline-flex items-center gap-1 text-accent">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
            still listening
          </span>
        ) : null}
        <span className="ml-auto text-text-3">Needs your OK</span>
      </div>
      {editing ? (
        <div className="mt-1.5">
          <InlineEdit item={item} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Click to edit"
          className="mt-1 block w-full text-left text-[13px] leading-[1.5] text-text select-text"
        >
          {item.text}
        </button>
      )}
      {item.chips.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.chips.map((c, i) => (
            <ChipPill key={i} chip={c} />
          ))}
        </div>
      ) : null}
      {!editing ? (
        <div className="mt-2 flex items-center gap-1">
          <Tip label="Discard" side="top">
            <button
              type="button"
              aria-label="Discard"
              onClick={() => discard(item.id)}
              className="icon-btn size-7"
            >
              <X size={13} />
            </button>
          </Tip>
          <Tip label="Rework it in the message box" side="top">
            <button
              type="button"
              aria-label="Move to the message box"
              onClick={() => toComposer(item.id)}
              className="icon-btn size-7"
            >
              <PenLine size={13} />
            </button>
          </Tip>
          <span className="ml-auto pr-1 text-[10.5px] text-text-3">
            {item.open ? 'Say “send it” or' : ''} ⌘↩
          </span>
          <button
            type="button"
            onClick={() => approve(item.id)}
            className="btn-gradient inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold"
          >
            {busy ? (
              <ArrowUp size={12} strokeWidth={2.5} />
            ) : (
              <Check size={12} strokeWidth={2.75} />
            )}
            {busy ? 'Add to queue' : 'Send to Luca'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function InlineEdit({ item, onDone }: { item: QueueItem; onDone: () => void }): ReactElement {
  const [text, setText] = useState(item.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])
  const save = (): void => {
    useQueue.getState().edit(item.id, text)
    onDone()
  }
  return (
    <textarea
      ref={ref}
      data-queue-edit="true"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onDone()
        }
      }}
      rows={1}
      className="block w-full resize-none rounded-[8px] border border-border-strong bg-input px-2 py-1.5 text-[12.5px] leading-[1.5] text-text outline-none select-text focus:border-accent"
    />
  )
}

function SourceIcon({ source }: { source: QueueItem['source'] }): ReactElement {
  const Icon = source === 'voice' ? AudioLines : source === 'dictation' ? Mic : Keyboard
  return <Icon size={11} className="shrink-0 text-text-3" />
}
