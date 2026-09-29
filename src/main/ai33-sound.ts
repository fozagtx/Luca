/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * Music and sound effects: make them at ai33, save them in the project and (unless told not to)
 * put them on the timeline. Whether to spend is decided by the tool before it calls these.
 */
import type { MusicReq, MusicResult, SfxReq, SfxResult } from '../shared/ai33'
import type { MakeCtx } from './ai33-ctx'

/** Instrumental music: both takes saved, the first under the video (unless `place` is false). */
export function makeMusic(_req: MusicReq, _c: MakeCtx): Promise<MusicResult> {
  throw new Error('not implemented')
}

/** Short sound effects, two at a time, each put at its moment (unless `place` is false). */
export function makeSfx(_req: SfxReq, _c: MakeCtx): Promise<SfxResult> {
  throw new Error('not implemented')
}
