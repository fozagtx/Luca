import type { Rect, StudioGeometry } from '../geometry'
import type { StudioLook } from '../look'
import type { GraphicOf, StudioBg, StudioKind, StudioSpeaker } from '../schema'

/** What a kind knows when it draws one graphic. */
export type KindCtx = {
  /** Unique id prefix for this graphic's elements, e.g. "ls-g4". */
  id: string
  /** The rect the graphic fills, in frame px. Its box is already placed there. */
  zone: Rect
  /** px scale: 1 at a 1080 px short side. */
  k: number
  geo: StudioGeometry
  look: StudioLook
  accent: string
  /** The beat's window on the timeline (the graphic shows only inside it). */
  start: number
  end: number
  /** Background and speaker position when the beat starts. */
  bg: StudioBg
  speaker: StudioSpeaker
  /** Pixel size of an image the plan names (a project path), or null when it isn't known. */
  imageSize: (path: string) => [number, number] | null
}

/**
 * One graphic: `html` goes inside its box; `js` runs once at build with `G` (the box), `H` (the
 * runtime helpers), `tl`, `K` and `root` in scope and adds its tweens at absolute times.
 */
export type KindOut = { html: string; js: string }

export type KindModule<K extends StudioKind> = {
  /** Rules shared by every graphic of this kind, scoped to the composition; once per file. */
  css?: (scope: string, k: number) => string
  render: (g: GraphicOf<K>, ctx: KindCtx) => KindOut
}

/** `at` if given, else `fallback`, never before the beat starts. */
export const when = (at: number | undefined, fallback: number, start: number): number =>
  Math.max(start, at ?? fallback)

/** A JS number literal, rounded to the millisecond. */
export const t = (n: number): string => String(Math.round(n * 1000) / 1000)
