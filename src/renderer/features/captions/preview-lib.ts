import { useEffect, useMemo, useState } from 'react'
import { bundledFont, googleFontUrl } from '../../../shared/captions'
import type { CaptionGroup, ProjectFontFace } from '../../../shared/types'

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

/** Each face from its URL, with its weight, style and characters. */
function loadFaces(family: string, faces: ProjectFontFace[], url: (file: string) => string): void {
  for (const f of faces) {
    const src = url(f.file)
    const key = `${family}|${src}`
    if (loaded.has(key)) continue
    loaded.add(key)
    const face = new FontFace(family, `url(${src})`, {
      weight: f.weightMax ? `${f.weight} ${f.weightMax}` : String(f.weight),
      style: f.italic ? 'italic' : 'normal',
      ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {})
    })
    void face
      .load()
      .then((x) => document.fonts.add(x))
      .catch(() => loaded.delete(key))
  }
}

/**
 * Google Fonts stylesheet for a built-in font, the app's files for a font that comes with Luca, or
 * a project font's files via the Luca server, each with its weight, style and characters so the
 * preview picks the same file the video does.
 */
export function ensurePreviewFont(
  family: string,
  projectId?: string,
  faces?: ProjectFontFace[]
): void {
  const bundled = bundledFont(family)
  if (bundled) {
    loadFaces(bundled.family, bundled.faces, (file) => `/fonts/${encodeURIComponent(file)}`)
    return
  }
  if (faces?.length && projectId) {
    loadFaces(family, faces, (file) => `/p/${encodeURIComponent(projectId)}/${file}`)
    return
  }
  const key = `${family}|`
  if (loaded.has(key)) return
  loaded.add(key)
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
