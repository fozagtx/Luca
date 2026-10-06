/**
 * Color grades the user's own footage: a LUT that comes with Luca (resources/luts/, generated into
 * src/shared/luts.generated.ts) applied to every footage <video> in index.html via HyperFrames'
 * `data-color-grading` attribute. The .cube file is copied into the project (luts/), so previews
 * and exports never need the app's copy — the same deal as fonts that come with Luca.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { bundledLut, type ColorGrade } from '../shared/luts'
import type { ColorState, Project } from '../shared/types'
import { bundledLutsDir } from './resources'
import { findTags, replaceTag, setAttrs, type TagMatch } from './html'
import { refreshStudio } from './studio'
import { checkpoint } from './versions'

const GRADING_ATTR = 'data-color-grading'

const readIndex = (dir: string): string => readFileSync(join(dir, 'index.html'), 'utf8')

/**
 * Every <video> in index.html playing the user's own footage (the first video, which init keeps
 * at the project root, and media/, but not B-roll Luca added — or a background, in projects from
 * before B-roll — or animations it rendered: grading those would fight the look they were made
 * with).
 */
export function footageVideos(html: string): TagMatch[] {
  return findTags(html, 'video').filter((t) => {
    const src = (t.attrs.src ?? '').replace(/^\.\//, '').split(/[?#]/)[0]
    return (
      (src.startsWith('media/') || /^[^/:]+$/.test(src)) &&
      !src.startsWith('media/broll/') &&
      !src.startsWith('media/backgrounds/') &&
      !src.startsWith('media/remocn/')
    )
  })
}

function gradingOf(tag: TagMatch): Record<string, unknown> {
  const raw = tag.attrs[GRADING_ATTR]
  if (!raw) return {}
  try {
    const v = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The grade on the footage now (the first footage video's), and how many clips it covers. */
export function colorState(p: Pick<Project, 'dir'>): ColorState {
  const videos = footageVideos(readIndex(p.dir))
  let grade: ColorGrade = null
  const first = videos[0]
  if (first) {
    const lut = gradingOf(first).lut
    const src =
      lut && typeof lut === 'object' ? (lut as { src?: string; intensity?: number }).src : undefined
    const file = src?.startsWith('luts/') ? src.slice('luts/'.length) : undefined
    const match = file && bundledLut(file.replace(/\.cube$/i, ''))
    if (match) {
      const intensity = (lut as { intensity?: number }).intensity
      grade = { lut: match.id, intensity: typeof intensity === 'number' ? intensity : 1 }
    }
  }
  return { grade, targets: videos.length }
}

const clampIntensity = (n: number): number =>
  Math.round(Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1)) * 100) / 100

/**
 * Applies a LUT that comes with Luca to every footage video: copies the .cube into the project's
 * luts/ and merges `lut: { src, intensity }` into each tag's data-color-grading, keeping any other
 * grading keys already there.
 */
export async function applyColor(
  p: Pick<Project, 'dir'>,
  grade: { lut: string; intensity: number },
  opts: { checkpoint?: boolean } = {}
): Promise<ColorState> {
  const lut = bundledLut(grade.lut)
  if (!lut) throw new Error(`No LUT that comes with Luca named "${grade.lut}"`)
  const intensity = clampIntensity(grade.intensity)
  const targetDir = join(p.dir, 'luts')
  const target = join(targetDir, lut.file)
  const source = join(bundledLutsDir(), lut.file)
  if (!existsSync(target) || statSync(target).size !== statSync(source).size) {
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(source, target)
  }
  const file = join(p.dir, 'index.html')
  let html = readFileSync(file, 'utf8')
  // last tag first: replacing changes the text length, and earlier offsets stay valid
  for (const tag of footageVideos(html).reverse()) {
    const grading = gradingOf(tag)
    grading.lut = { src: `luts/${lut.file}`, intensity }
    html = replaceTag(html, tag, setAttrs(tag, { [GRADING_ATTR]: JSON.stringify(grading) }))
  }
  writeFileSync(file, html)
  // the Studio look frames this footage itself, so it takes the grade too
  refreshStudio(p)
  if (opts.checkpoint !== false) await checkpoint(p.dir, `Color: ${lut.name}`)
  return colorState(p)
}

/**
 * Lifts the LUT off the footage; the copied .cube stays in luts/ — harmless, exports never break.
 * `checkpoint: false` leaves the version to the caller (Luca's turn saves itself).
 */
export async function removeColor(
  p: Pick<Project, 'dir'>,
  opts: { checkpoint?: boolean } = {}
): Promise<ColorState> {
  const file = join(p.dir, 'index.html')
  let html = readFileSync(file, 'utf8')
  for (const tag of footageVideos(html).reverse()) {
    const grading = gradingOf(tag)
    if (!('lut' in grading)) continue
    delete grading.lut
    const rest = Object.keys(grading).length ? JSON.stringify(grading) : null
    html = replaceTag(html, tag, setAttrs(tag, { [GRADING_ATTR]: rest }))
  }
  writeFileSync(file, html)
  // the Studio look frames this footage itself, so it takes the grade too
  refreshStudio(p)
  if (opts.checkpoint !== false) await checkpoint(p.dir, 'Remove color')
  return colorState(p)
}
