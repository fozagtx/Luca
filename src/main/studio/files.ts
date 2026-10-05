/**
 * The plan checked against the files it names. Both the composition and the captions read the
 * checked plan, so they always agree on which beats have a picture.
 */
import { existsSync } from 'node:fs'
import { safeJoin } from '../projects'
import type { StudioGraphic, StudioPlan } from './schema'

/**
 * The plan with every file it names checked: a logo that isn't in the project falls back to
 * letters on its tile, and a missing picture is left out (a window keeps the screenshots it has,
 * a compare or image goes), so the composition never references a file that isn't there.
 */
export function checkFiles(dir: string, plan: StudioPlan): { plan: StudioPlan; notes: string[] } {
  const notes: string[] = []
  const missing = (rel: string): boolean => {
    try {
      return !existsSync(safeJoin(dir, rel))
    } catch {
      return true
    }
  }
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix)
    if (!v || typeof v !== 'object') return v
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = fix(x)
    if (typeof out.logo === 'string' && missing(out.logo)) {
      notes.push(
        `${out.logo} isn't in the project: its tile shows letters instead. Get it with logo_add.`
      )
      delete out.logo
      delete out.tint
    }
    return out
  }
  const fixed = fix(plan) as StudioPlan
  const scenes = fixed.scenes.map((s) => {
    if (!s.graphic) return s
    const list = Array.isArray(s.graphic) ? s.graphic : [s.graphic]
    const kept = list.flatMap((g): StudioGraphic[] => {
      if (g.kind === 'window' && g.images?.length) {
        const gone = g.images.filter((i) => missing(i.image))
        if (!gone.length) return [g]
        const images = g.images.filter((i) => !missing(i.image))
        notes.push(
          `${gone.map((i) => i.image).join(', ')} isn't in the project: the window at ${s.start}s ${images.length ? 'leaves it out' : 'draws a chat app instead'}. Use a path that exists.`
        )
        if (images.length) return [{ ...g, images }]
        const { images: _gone, ...rest } = g
        void _gone
        return [rest]
      }
      if ((g.kind === 'compare' || g.kind === 'image') && missing(g.image)) {
        notes.push(
          `${g.image} isn't in the project: the ${g.kind} at ${s.start}s was left out. Use a path that exists.`
        )
        return []
      }
      return [g]
    })
    if (kept.length === list.length && kept.every((g, i) => g === list[i])) return s
    const { graphic: _old, ...rest } = s
    void _old
    if (!kept.length) return rest
    return { ...rest, graphic: Array.isArray(s.graphic) ? kept : kept[0] }
  })
  return { plan: { ...fixed, scenes }, notes }
}
