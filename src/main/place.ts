/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies (except refitBeds, which is real for now) and drops this line */
/**
 * Everything generated audio needs to become part of a project: checking and saving
 * the files (media/generated), putting them on the timeline, and finding them again after an
 * undo. All placement is deterministic code here; Luca never writes an audio tag itself.
 */
import type { PlaceAudio, Placed, SavedAsset } from '../shared/ai33'
import type { Project } from '../shared/types'

/** The length of an audio file; rejects with a plain message when it has no audio or is unreadable. */
export function probeAudio(_file: string): Promise<{ seconds: number }> {
  throw new Error('not implemented')
}

/**
 * Check a downloaded file (real audio, not a web page saved under the wrong name) and move it
 * to media/generated/<kind>/<slug>-<hash>.mp3, converted to mp3 when it is another format.
 * `rel` is project-relative. The same hash returns the file already saved.
 */
export function importGenerated(
  _p: Project,
  _kind: SavedAsset['kind'],
  _tmp: string,
  _o: { slug: string; hash: string; prompt: string }
): Promise<{ rel: string; abs: string; seconds?: number }> {
  throw new Error('not implemented')
}

/** Project-relative files already saved for this request hash (empty when none). */
export function findSaved(_dir: string, _kind: SavedAsset['kind'], _hash: string): string[] {
  throw new Error('not implemented')
}

/** Put an audio file on the timeline (validated first) and say where it went. */
export function placeAudio(_p: Project, _o: PlaceAudio): Promise<Placed> {
  throw new Error('not implemented')
}

/**
 * Make audio fit a length: join `files` (two takes with a crossfade, tiled if still short) and
 * trim to `seconds`, into a new file in media/generated/<kind>/; returns it, project-relative.
 */
export function fitAudio(_o: {
  project: Project
  kind: 'music' | 'sfx'
  files: string[]
  seconds: number
  slug: string
  hash: string
}): Promise<string> {
  throw new Error('not implemented')
}

/** How loud music under this voice should be (`data-volume`, 0.04 to 0.5), measured against it. */
export function measureLevel(
  _p: Project,
  _file: string,
  _level: 'quiet' | 'medium'
): Promise<number> {
  throw new Error('not implemented')
}

/** Whether the video already has a voice (audible footage, or a clip with role voice). */
export function projectHasVoice(_p: Project): boolean {
  throw new Error('not implemented')
}

/**
 * Shorten music that runs past the end of the video (after a cut or a trim), never lengthen it.
 * Runs before each version is saved; true when it changed the composition.
 */
export function refitBeds(_p: Project): Promise<boolean> {
  return Promise.resolve(false)
}

/** What has been made for this project (media/generated), to put back after an undo. */
export function savedAssets(_p: Project): SavedAsset[] {
  throw new Error('not implemented')
}

/** Add one line to media/generated/CREDITS.txt: what the file is and that ai33 made it. */
export function appendCredit(_dir: string, _line: string): void {
  throw new Error('not implemented')
}
