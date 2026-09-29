/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * Putting sound and pictures into a composition's HTML, as strings: which row a clip goes on, the
 * tags themselves, and shortening music that outlasts the video. Pure (the smoke script bundles
 * it); place.ts reads and writes the files.
 */
import type { PlaceAudio, PlaceImage, Placed } from '../shared/ai33'

export type RowRole = PlaceAudio['role'] | 'image'

/**
 * The row for a clip of `role` between `start` and `end`: a row of the same role where nothing
 * overlaps (at most `maxPerRow` clips of pictures), else a new row that no other role uses.
 */
export function rowFor(
  _html: string,
  _role: RowRole,
  _start: number,
  _end: number,
  _o?: { maxPerRow?: number }
): number {
  throw new Error('not implemented')
}

/** Add an `<audio>` clip on `o.row`, and where it went. */
export function insertAudio(
  _html: string,
  _o: PlaceAudio & { row: number; duration: number }
): { html: string; placed: Placed } {
  throw new Error('not implemented')
}

/** Add an `<img>` cutaway on `o.row`, and where it went. */
export function insertImage(
  _html: string,
  _o: PlaceImage & { row: number }
): { html: string; placed: Placed } {
  throw new Error('not implemented')
}

/**
 * Shorten music clips that run past the end of the video (or their file): never lengthens, so a
 * bed the person trimmed stays trimmed.
 */
export function clampBeds(
  _html: string,
  _o: { rootDuration: number; fileDurations: Record<string, number> }
): { html: string; changed: boolean } {
  throw new Error('not implemented')
}

/** Whether the composition already has a voice: audible `source` footage, or a clip with role voice. */
export function hasVoice(_html: string, _source: string): boolean {
  throw new Error('not implemented')
}
