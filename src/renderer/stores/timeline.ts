import { create } from 'zustand'
import type { Clip, Timeline, TimelineEdit } from '../../shared/types'
import { luca } from '../lib/luca'

/** A clip being moved or trimmed right now, for the live readout in the timeline header. */
export type TimelineDrag = { ref: string; mode: 'move' | 'trim'; start: number; end: number }

type TimelineStore = {
  timeline: Timeline | null
  loading: boolean
  error: string | null
  selected: string | null
  /** pixels per second */
  zoom: number
  thumbs: { dir: string; count: number; interval: number } | null
  peaks: { peaksPerSecond: number; peaks: number[] } | null
  load: () => Promise<void>
  loadMedia: () => Promise<void>
  reset: () => void
  select: (ref: string | null) => void
  setZoom: (z: number) => void
  zoomBy: (factor: number) => void
  /** Width in px of the visible track area, reported by the Timeline for zoom-to-fit. */
  viewportWidth: number
  setViewportWidth: (w: number) => void
  zoomToFit: (duration: number) => void
  drag: TimelineDrag | null
  setDrag: (d: TimelineDrag | null) => void
  /** Track indices whose clips can't be moved or trimmed. */
  locked: number[]
  toggleLock: (track: number) => void
  /** Apply optimistically, then let the file watcher reconcile. Resolves false on failure. */
  edit: (e: TimelineEdit) => Promise<boolean>
}

let loadSeq = 0

export const useTimeline = create<TimelineStore>((set, get) => ({
  timeline: null,
  loading: false,
  error: null,
  selected: null,
  zoom: 80,
  thumbs: null,
  peaks: null,
  drag: null,
  setDrag: (drag) => set({ drag }),
  locked: [],
  toggleLock: (track) =>
    set((s) => ({
      locked: s.locked.includes(track) ? s.locked.filter((t) => t !== track) : [...s.locked, track]
    })),

  load: async () => {
    const seq = ++loadSeq
    set({ loading: true })
    try {
      const t = await luca.timeline.get()
      if (seq !== loadSeq) return
      set({ timeline: t, loading: false, error: null })
    } catch (err) {
      if (seq !== loadSeq) return
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },
  loadMedia: async () => {
    const [thumbs, peaks] = await Promise.all([
      luca.timeline.thumbs().catch(() => null),
      luca.timeline.peaks().catch(() => null)
    ])
    set({ thumbs, peaks })
  },
  reset: () => {
    loadSeq++
    set({ timeline: null, thumbs: null, peaks: null, selected: null, error: null, locked: [] })
  },
  select: (selected) => set({ selected }),
  setZoom: (zoom) => set({ zoom: Math.min(600, Math.max(10, zoom)) }),
  zoomBy: (f) => get().setZoom(get().zoom * f),
  viewportWidth: 0,
  setViewportWidth: (viewportWidth) => set({ viewportWidth }),
  zoomToFit: (duration) => {
    const w = get().viewportWidth
    if (w > 0 && duration > 0) get().setZoom((w - 24) / duration)
  },

  edit: async (e) => {
    const t = get().timeline
    if (!t) return false
    const patch = (
      fn: (c: Clip) => Clip,
      refs = new Set(e.op === 'mute' ? e.refs : [e.ref])
    ): Timeline => ({
      ...t,
      tracks: t.tracks.map((tr) => ({
        ...tr,
        clips: tr.clips.flatMap((c) => (refs.has(c.ref) ? [fn(c)] : [c]))
      }))
    })
    let optimistic: Timeline | null = null
    if (e.op === 'mute') optimistic = patch((c) => ({ ...c, volume: e.muted ? 0 : 1 }))
    else if (e.op === 'move')
      optimistic = patch((c) => ({ ...c, start: e.time, end: e.time + (c.end - c.start) }))
    else if (e.op === 'trim')
      optimistic = patch((c) => ({ ...c, start: e.start ?? c.start, end: e.end ?? c.end }))
    else if (e.op === 'delete') {
      const gone = new Set([e.ref, ...(e.with ?? [])])
      optimistic = {
        ...t,
        tracks: t.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => !gone.has(c.ref)) }))
      }
    }
    if (optimistic) set({ timeline: optimistic })
    const res = await luca.timeline.edit(e)
    if (!res.ok) {
      set({ timeline: t, error: res.error ?? 'Edit failed' })
      setTimeout(() => set((s) => (s.error === res.error ? { error: null } : {})), 4000)
    }
    return res.ok
  }
}))
