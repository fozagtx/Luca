import { ArrowUp, MessageSquarePlus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { Chip } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { useChat } from '../../stores/chat'
import { useQueue } from '../../stores/queue'
import { useUi } from '../../stores/ui'

export type Anchor = { x: number; y: number; w: number; h: number }

/** Parts of the video you can reply to. */
export type CommentChip = Extract<Chip, { kind: 'element' | 'frame' }>

const WIDTH = 272
const HEIGHT = 124
const GAP = 8

/**
 * Reply to something in the video: a small box next to what you clicked. What you write goes to
 * Luca with that part of the video attached (through the queue, so it waits its turn while Luca
 * is busy).
 */
export function CommentBox({
  chip,
  label,
  anchor,
  onClose
}: {
  chip: CommentChip
  label: string
  /** The clicked element, in the pixels of the overlay the box sits in. */
  anchor: Anchor
  onClose: (sent: boolean) => void
}): ReactElement {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  /** The overlay's size; the box stays hidden until it is known. */
  const [bounds, setBounds] = useState<{ w: number; h: number } | null>(null)
  const working = useChat((s) => s.state === 'working')

  useLayoutEffect(() => {
    const parent = box.current?.parentElement
    if (!parent) return
    const measure = (): void => setBounds({ w: parent.clientWidth, h: parent.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  // focus once it is placed and visible (a hidden box can't take focus)
  const placed = bounds !== null
  useEffect(() => {
    if (placed) ref.current?.focus()
  }, [placed])

  const send = (): void => {
    const t = text.trim()
    if (!t) return
    useQueue.getState().enqueue(t, [chip], 'typed', { time: chip.time })
    const ui = useUi.getState()
    if (!ui.chatOpen) ui.setChat(true)
    onClose(true)
  }
  /** Keep writing in the message box instead, with this part of the video attached. */
  const toComposer = (): void => {
    const chat = useChat.getState()
    chat.addChip(chip)
    const t = text.trim()
    if (t) chat.setDraft(chat.draft.trim() ? `${chat.draft.trimEnd()} ${t}` : t)
    const ui = useUi.getState()
    if (!ui.chatOpen) ui.setChat(true)
    onClose(true)
    requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
  }

  // below what was clicked when it fits, otherwise above; always inside the frame
  const w = bounds?.w ?? WIDTH
  const h = bounds?.h ?? HEIGHT
  const below = anchor.y + anchor.h + GAP + HEIGHT <= h || anchor.y < HEIGHT + GAP
  const top = below
    ? Math.min(anchor.y + anchor.h + GAP, Math.max(0, h - HEIGHT))
    : Math.max(0, anchor.y - HEIGHT - GAP)
  const left = Math.max(GAP, Math.min(anchor.x, w - WIDTH - GAP))

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Comment on this part of the video"
      className="pop-in absolute z-30 flex flex-col rounded-[12px] border border-border bg-bg p-2 shadow-popover"
      style={{
        left,
        top,
        width: Math.min(WIDTH, w - GAP * 2),
        visibility: bounds ? undefined : 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] text-text-2">
        <MessageSquarePlus size={12} className="shrink-0 text-accent" />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose(false)
          }
        }}
        rows={2}
        placeholder="What should change here?"
        className="block w-full resize-none bg-transparent px-1 text-[13px] leading-[20px] text-text placeholder:text-text-3 select-text"
      />
      <div className="flex items-center gap-2 px-1 pt-1">
        <button
          type="button"
          onClick={toComposer}
          className="text-[10.5px] text-text-3 transition-colors hover:text-text"
        >
          Add to message
        </button>
        <span className="ml-auto truncate text-[10.5px] text-text-3">
          {working ? '↩ to queue' : '↩ to send'}
        </span>
        <button
          type="button"
          aria-label={working ? 'Add to the queue' : 'Send to Luca'}
          disabled={!text.trim()}
          onClick={send}
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform,box-shadow] duration-200 ease-out active:scale-90',
            text.trim()
              ? 'bg-accent text-accent-fg shadow-[0_2px_8px_-2px_color-mix(in_srgb,var(--accent)_60%,transparent)]'
              : 'bg-bg-muted text-text-3'
          )}
        >
          <ArrowUp size={14} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  )
}
