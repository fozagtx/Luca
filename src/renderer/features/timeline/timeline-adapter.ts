import type { TimelineRow } from '@xzdarcy/timeline-engine'
import type { Clip, ClipKind, Timeline } from '../../../shared/types'

export const STRIP_ROW = '__strip'
export const ROW_HEIGHT = 36
export const STRIP_HEIGHT = 44

export type RowMeta = { kind: ClipKind | 'strip'; label: string; index: number }

/**
 * Maps Luca's `Timeline` (already adapted from `hyperframes timeline --json` in main)
 * onto react-timeline-editor rows. Clip refs (`#id`) double as action ids so edits
 * can go straight back to the CLI.
 */
export function toRows(
  t: Timeline,
  duration: number
): { rows: TimelineRow[]; meta: Map<string, RowMeta>; clips: Map<string, Clip> } {
  const meta = new Map<string, RowMeta>()
  const clips = new Map<string, Clip>()
  const rows: TimelineRow[] = [
    {
      id: STRIP_ROW,
      rowHeight: STRIP_HEIGHT,
      actions: [
        {
          id: STRIP_ROW,
          start: 0,
          end: duration,
          effectId: 'strip',
          movable: false,
          flexible: false
        }
      ]
    }
  ]
  meta.set(STRIP_ROW, { kind: 'strip', label: '', index: -1 })
  const order: Record<ClipKind, number> = { video: 0, block: 1, component: 1, caption: 2, audio: 3 }
  const tracks = [...t.tracks].sort((a, b) => order[a.kind] - order[b.kind] || a.index - b.index)
  for (const tr of tracks) {
    const id = `track-${tr.index}`
    meta.set(id, { kind: tr.kind, label: tr.label, index: tr.index })
    rows.push({
      id,
      rowHeight: ROW_HEIGHT,
      actions: tr.clips.map((c) => {
        clips.set(c.ref, c)
        return {
          id: c.ref,
          start: c.start,
          end: c.end,
          effectId: c.kind,
          minStart: 0,
          maxEnd: duration
        }
      })
    })
  }
  return { rows, meta, clips }
}

/** Choose a ruler step so a major tick is roughly 90–140 px wide at the current zoom. */
export function rulerStep(pxPerSecond: number): { scale: number; splits: number } {
  const target = 110 / pxPerSecond
  const steps: [number, number][] = [
    [0.1, 5],
    [0.25, 5],
    [0.5, 5],
    [1, 2],
    [2, 4],
    [5, 10],
    [10, 5],
    [15, 3],
    [30, 6],
    [60, 6]
  ]
  let best = steps[steps.length - 1]
  for (const s of steps) {
    if (s[0] >= target) {
      best = s
      break
    }
  }
  return { scale: best[0], splits: best[1] }
}
