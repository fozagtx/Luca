/**
 * The saved Studio plan (.luca/studio.json) and what the captions need from it: where they sit in
 * each stretch of the video and in what color, and the words shown in the italic serif. Kept free
 * of the captions module so captions can read it without a cycle.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CaptionPlacement, CaptionZone } from '../captions-html'
import { findTagById } from '../html'
import { STUDIO_ID } from './compose'
import { checkFiles } from './files'
import { studioGeometry } from './geometry'
import { lookOf } from './look'
import { normalizePlan, planSchema, segments, type StudioPlan } from './schema'

/** .luca/studio.json: the plan last applied, and the footage it was built over. */
export type SavedStudio = { plan: StudioPlan; appliedAt?: string; footage?: string }

export const studioFile = (dir: string): string => join(dir, '.luca', 'studio.json')

export function readStudio(dir: string): SavedStudio | null {
  try {
    if (!existsSync(studioFile(dir))) return null
    const saved = JSON.parse(readFileSync(studioFile(dir), 'utf8')) as SavedStudio
    const plan = planSchema.safeParse(saved?.plan)
    return plan.success ? { ...saved, plan: plan.data } : null
  } catch {
    return null
  }
}

/**
 * Where captions go while the Studio look is on the timeline (null when it isn't): above the
 * speaker's card when there is one, on the chin line over the face, low over a card alone; dark
 * on paper, light on ink and on the face. Zone times are in the captions track's own time, which
 * starts `offset` seconds into the video.
 */
export function studioCaptionPlacement(
  dir: string,
  html: string,
  d: { w: number; h: number; duration: number },
  offset: number
): CaptionPlacement | null {
  if (!findTagById(html, STUDIO_ID)) return null
  const saved = readStudio(dir)
  if (!saved) return null
  // the plan as the picture was built from it: beats whose files are gone are gone here too
  const { plan } = normalizePlan(checkFiles(dir, saved.plan).plan, d.duration)
  const look = lookOf(plan.look)
  const geo = studioGeometry(d.w, d.h, look.id)
  const zones: CaptionZone[] = segments(plan, d.duration).map((s) => {
    const c = geo.captions[s.speaker]
    const light = s.bg === 'paper' && s.speaker !== 'full'
    return {
      start: Math.round((s.start - offset) * 1000) / 1000,
      end: Math.round((s.end - offset) * 1000) / 1000,
      x: c.x,
      y: c.y,
      w: c.w,
      color: light ? look.themes.paper['--fg'] : look.themes.ink['--fg'],
      light
    }
  })
  return { zones, emphasis: plan.emphasis ?? [], emphasisFont: look.fonts.serif }
}
