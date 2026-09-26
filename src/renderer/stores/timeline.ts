import { create } from 'zustand'
import type { Clip, Timeline, TimelineEdit } from '../../shared/types'
import { luca } from '../lib/luca'

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
  /** Apply optimistically, then let the file watcher reconcile. */
  edit: (e: TimelineEdit) => Promise<void>
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
    set({ timeline: null, thumbs: null, peaks: null, selected: null, error: null })
  },
  select: (selected) => set({ selected }),
  setZoom: (zoom) => set({ zoom: Math.min(600, Math.max(10, zoom)) }),
  zoomBy: (f) => get().setZoom(get().zoom * f),

  edit: async (e) => {
    const t = get().timeline
    if (!t) return
    const patch = (fn: (c: Clip) => Clip): Timeline => ({
      ...t,
      tracks: t.tracks.map((tr) => ({
        ...tr,
        clips: tr.clips.flatMap((c) => (c.ref === e.ref ? [fn(c)] : [c]))
      }))
    })
    let optimistic: Timeline | null = null
    if (e.op === 'move')
      optimistic = patch((c) => ({ ...c, start: e.time, end: e.time + (c.end - c.start) }))
    else if (e.op === 'trim')
      optimistic = patch((c) => ({ ...c, start: e.start ?? c.start, end: e.end ?? c.end }))
    else if (e.op === 'delete')
      optimistic = {
        ...t,
        tracks: t.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => c.ref !== e.ref) }))
      }
    if (optimistic) set({ timeline: optimistic })
    const res = await luca.timeline.edit(e)
    if (!res.ok) {
      set({ timeline: t, error: res.error ?? 'Edit failed' })
      setTimeout(() => set((s) => (s.error === res.error ? { error: null } : {})), 4000)
    }
  }
}))
