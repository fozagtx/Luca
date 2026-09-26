import { useEffect, useMemo, useState } from 'react'
import { googleFontUrl } from '../../../shared/captions'
import type { CaptionGroup } from '../../../shared/types'

// ------------------------------------------------------------------ one clock for every preview

const subs = new Set<(now: number) => void>()
let raf = 0
let last = 0
function loop(now: number): void {
  // ~30 fps is plenty for word timing and keeps a gallery of previews cheap
  if (now - last > 32) {
    last = now
    for (const s of subs) s(now)
  }
  raf = subs.size ? requestAnimationFrame(loop) : 0
}

/** Seconds into a looping `period`, shared by all previews on screen. */
export function useLoopTime(period: number, active = true): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active || period <= 0) return
    const start = performance.now()
    const sub = (now: number): void => setT(((now - start) / 1000) % period)
    subs.add(sub)
    if (!raf) raf = requestAnimationFrame(loop)
    return () => {
      subs.delete(sub)
    }
  }, [period, active])
  return t
}

// ------------------------------------------------------------------ fonts for previews

const loaded = new Set<string>()

/** Google Fonts stylesheet for a built-in font, or a project font file via the Luca server. */
export function ensurePreviewFont(family: string, projectId?: string, file?: string): void {
  const key = `${family}|${file ?? ''}`
  if (loaded.has(key)) return
  loaded.add(key)
  if (file && projectId) {
    const face = new FontFace(family, `url(/p/${encodeURIComponent(projectId)}/${file})`)
    void face
      .load()
      .then((f) => document.fonts.add(f))
      .catch(() => loaded.delete(key))
    return
  }
  const url = googleFontUrl(family)
  if (!url) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  document.head.appendChild(link)
}

/** The first lines of the transcript (or sample words) re-timed from zero, for previews. */
export function useSampleGroups(groups: CaptionGroup[], seconds = 7): CaptionGroup[] {
  return useMemo(() => {
    if (!groups.length) return []
    const t0 = groups[0].start
    const out: CaptionGroup[] = []
    for (const g of groups) {
      if (g.start - t0 > seconds && out.length >= 2) break
      out.push({
        ...g,
        start: g.start - t0,
        end: g.end - t0,
        words: g.words.map((w) => ({ ...w, start: w.start - t0, end: w.end - t0 }))
      })
    }
    return out
  }, [groups, seconds])
}
