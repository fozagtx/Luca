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
  /** Frames and waveform peaks per media file (a clip's src), loaded as clips appear. */
  thumbs: Record<string, Thumbs>
  peaks: Record<string, Peaks>
  load: () => Promise<void>
  /** Load frames for `video` files and peaks for `audio` files that aren't loaded yet. */
  loadMedia: (need: { video: string[]; audio: string[] }) => Promise<void>
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

export type Thumbs = { dir: string; count: number; interval: number }
export type Peaks = { peaksPerSecond: number; peaks: number[] }

let loadSeq = 0
/** Bumped on reset so frames of the previous project never land in the next one. */
let mediaSeq = 0
const requested = new Set<string>()

export const useTimeline = create<TimelineStore>((set, get) => ({
  timeline: null,
  loading: false,
  error: null,
  selected: null,
  zoom: 80,
  thumbs: {},
  peaks: {},
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
  loadMedia: async ({ video, audio }) => {
    const seq = mediaSeq
    const fresh = (kind: string, srcs: string[]): string[] =>
      srcs.filter((src) => {
        const key = `${kind}:${src}`
        if (requested.has(key)) return false
        requested.add(key)
        return true
      })
    // nothing back (a file still being written, ffmpeg failing once): try again next time
    const retry = (kind: string, src: string): void => {
      if (seq === mediaSeq) requested.delete(`${kind}:${src}`)
    }
    await Promise.all([
      ...fresh('video', video).map(async (src) => {
        const t = await luca.timeline.thumbs(src).catch(() => null)
        if (!t?.count) retry('video', src)
        else if (seq === mediaSeq) set((s) => ({ thumbs: { ...s.thumbs, [src]: t } }))
      }),
      ...fresh('audio', audio).map(async (src) => {
        const p = await luca.timeline.peaks(src).catch(() => null)
        if (!p?.peaks.length) retry('audio', src)
        else if (seq === mediaSeq) set((s) => ({ peaks: { ...s.peaks, [src]: p } }))
      })
    ])
  },
  reset: () => {
    loadSeq++
    mediaSeq++
    requested.clear()
    set({ timeline: null, thumbs: {}, peaks: {}, selected: null, error: null, locked: [] })
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
      refs = new Set(e.op === 'mute' || e.op === 'volume' ? e.refs : [e.ref])
    ): Timeline => ({
      ...t,
      tracks: t.tracks.map((tr) => ({
        ...tr,
        clips: tr.clips.flatMap((c) => (refs.has(c.ref) ? [fn(c)] : [c]))
      }))
    })
    let optimistic: Timeline | null = null
    if (e.op === 'mute') optimistic = patch((c) => ({ ...c, volume: e.muted ? 0 : 1 }))
    else if (e.op === 'volume') optimistic = patch((c) => ({ ...c, volume: e.volume }))
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
