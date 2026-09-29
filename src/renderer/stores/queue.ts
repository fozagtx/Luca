import type { Chip } from '@shared/types'
import { create } from 'zustand'
import { useChat } from './chat'
import { usePlayer } from './player'
import { useProject } from './project'

/** Where a request came from: voice mode, a dictation, or typed while Luca was busy. */
export type QueueSource = 'voice' | 'dictation' | 'typed'

/**
 * `review`: heard or dictated, waiting for your OK. `queued`: approved, waiting for Luca to be
 * free. `sending`: being handed to Luca right now.
 */
export type QueueStatus = 'review' | 'queued' | 'sending'

export type QueueItem = {
  id: string
  /** The project it was asked in; null on Home (notes for the footage on the start card). */
  dir: string | null
  text: string
  chips: Chip[]
  source: QueueSource
  status: QueueStatus
  createdAt: number
  /** Voice mode keeps adding what you say to this request until you approve or discard it. */
  open?: boolean
  /** Asked out loud: Luca answers in a sentence or two that can be read aloud. */
  spoken?: boolean
  /** Playhead to report instead of the one at send time (a comment on a frame). */
  time?: number
}

type QueueStore = {
  items: QueueItem[]
  /** Nothing is handed to Luca while paused (after Stop, or when a send failed). */
  paused: boolean
  /** Voice mode: add a finished turn to the open request, or start one. */
  hear: (text: string) => void
  /** Voice mode ended: the next thing said starts a new request. */
  closeTake: () => void
  /** A finished dictation, waiting for your OK. */
  review: (text: string, source: QueueSource) => void
  /** Approved already (typed and sent while Luca works): wait for Luca. */
  enqueue: (
    text: string,
    chips: Chip[],
    source: QueueSource,
    extra?: Pick<QueueItem, 'time'>
  ) => void
  approve: (id: string) => void
  approveAll: () => void
  /** The open voice request, else the oldest one waiting for your OK (voice "send it", ⌘↩). */
  approveNext: () => boolean
  discard: (id: string) => void
  /** Drop the open voice request ("scratch that"). */
  discardTake: () => boolean
  edit: (id: string, text: string) => void
  /** Move the words into the message box to rework them there. */
  toComposer: (id: string) => void
  pause: () => void
  resume: () => void
}

let seq = 0
const nextId = (): string => `q${Date.now().toString(36)}${(seq++).toString(36)}`
const currentDir = (): string | null => useProject.getState().project?.dir ?? null

/** Approved requests go after the ones already waiting, ahead of those still in review. */
function toQueued(items: QueueItem[], id: string): QueueItem[] {
  const item = items.find((i) => i.id === id)
  if (!item || item.status !== 'review' || !item.text.trim()) return items
  const rest = items.filter((i) => i.id !== id)
  const at = rest.findLastIndex((i) => i.status !== 'review') + 1
  return [...rest.slice(0, at), { ...item, status: 'queued', open: false }, ...rest.slice(at)]
}

export const useQueue = create<QueueStore>((set, get) => ({
  items: [],
  paused: false,

  hear: (text) => {
    const t = text.trim()
    if (!t) return
    const dir = currentDir()
    const take = get().items.find((i) => i.open && i.dir === dir)
    if (take) {
      set((s) => ({
        items: s.items.map((i) => (i.id === take.id ? { ...i, text: `${i.text} ${t}` } : i))
      }))
      return
    }
    set((s) => ({
      items: [
        ...s.items,
        {
          id: nextId(),
          dir,
          text: t,
          chips: [],
          source: 'voice',
          status: 'review',
          createdAt: Date.now(),
          open: true,
          spoken: true
        }
      ]
    }))
  },

  closeTake: () =>
    set((s) => ({ items: s.items.map((i) => (i.open ? { ...i, open: false } : i)) })),

  review: (text, source) => {
    const t = text.trim()
    if (!t) return
    set((s) => ({
      items: [
        ...s.items,
        {
          id: nextId(),
          dir: currentDir(),
          text: t,
          chips: [],
          source,
          status: 'review',
          createdAt: Date.now()
        }
      ]
    }))
  },

  enqueue: (text, chips, source, extra) => {
    const item: QueueItem = {
      ...extra,
      id: nextId(),
      dir: currentDir(),
      text: text.trim(),
      chips,
      source,
      status: 'review',
      createdAt: Date.now()
    }
    set((s) => ({ items: toQueued([...s.items, item], item.id) }))
    drain()
  },

  approve: (id) => {
    set((s) => ({ items: toQueued(s.items, id) }))
    drain()
  },

  approveAll: () => {
    const dir = currentDir()
    let items = get().items
    for (const i of items) if (i.status === 'review' && i.dir === dir) items = toQueued(items, i.id)
    set({ items })
    drain()
  },

  approveNext: () => {
    const dir = currentDir()
    const waiting = get().items.filter(
      (i) => i.status === 'review' && i.dir === dir && i.text.trim()
    )
    const next = waiting.find((i) => i.open) ?? waiting[0]
    if (!next) return false
    get().approve(next.id)
    return true
  },

  discard: (id) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== id || i.status === 'sending') })),

  discardTake: () => {
    const take = get().items.find((i) => i.open && i.dir === currentDir())
    if (!take) return false
    get().discard(take.id)
    return true
  },

  edit: (id, text) => {
    const t = text.trim()
    if (!t) {
      get().discard(id)
      return
    }
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id && i.status !== 'sending' ? { ...i, text: t, open: false } : i
      )
    }))
  },

  toComposer: (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.status === 'sending') return
    get().discard(id)
    const chat = useChat.getState()
    chat.setDraft(chat.draft.trim() ? `${chat.draft.trimEnd()} ${item.text}` : item.text)
    for (const c of item.chips) chat.addChip(c)
    requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
  },

  pause: () => set({ paused: true }),
  resume: () => {
    set({ paused: false })
    drain()
  }
}))

/** Stop Luca, and hold what's queued so it doesn't start right away. */
export function stopLuca(): Promise<void> {
  const dir = currentDir()
  if (useQueue.getState().items.some((i) => i.status === 'queued' && i.dir === dir))
    useQueue.getState().pause()
  return useChat.getState().stop()
}

let sending = false

/** Hand the next approved request to Luca once Luca is free. */
function drain(): void {
  const { items, paused } = useQueue.getState()
  if (sending || paused) return
  const state = useChat.getState().state
  if (state !== 'idle' && state !== 'ready') return
  const dir = currentDir()
  const next = items.find((i) => i.status === 'queued' && i.dir === dir)
  if (!next) return
  sending = true
  useQueue.setState((s) => ({
    items: s.items.map((i) => (i.id === next.id ? { ...i, status: 'sending' } : i))
  }))
  const context = {
    time: next.time ?? usePlayer.getState().currentTime,
    ...(next.spoken ? { voice: true } : {})
  }
  void useChat
    .getState()
    .send(next.text, context, { keepDraft: true, chips: next.chips })
    .then((ok) => {
      useQueue.setState((s) =>
        ok
          ? { items: s.items.filter((i) => i.id !== next.id) }
          : {
              paused: true,
              items: s.items.map((i) => (i.id === next.id ? { ...i, status: 'queued' } : i))
            }
      )
    })
    .finally(() => {
      // the next one goes when this turn ends (the state change below), or on Resume after a failure
      sending = false
    })
}

// Luca finishing a turn (or starting up idle) is the moment to hand over the next request.
useChat.subscribe((s, prev) => {
  if (s.state !== prev.state) drain()
})
useProject.subscribe((s, prev) => {
  if (s.project?.dir !== prev.project?.dir) drain()
})
