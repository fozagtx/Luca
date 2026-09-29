/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * Pictures nobody took: choose a model that fits the video, get its exact price, make one
 * picture, save it in the project and (with a time) put it on screen as a cutaway.
 */
import type { ImageReq, ImageResult } from '../shared/ai33'
import type { Aspect } from '../shared/types'
import type { MakeCtx } from './ai33-ctx'

/** The image model for this video's shape, and the aspect ratio ("16:9") to ask it for. */
export function pickImageModel(_aspect: Aspect): Promise<{ modelId: string; aspect: string }> {
  throw new Error('not implemented')
}

/** The exact credits ai33 will charge for `count` pictures from this model at this aspect. */
export function imagePrice(_modelId: string, _aspect: string, _count: number): Promise<number> {
  throw new Error('not implemented')
}

/** Make one picture (saved, checked and downscaled for Luca to look at), and place it when `at` is given. */
export function makeImage(_req: ImageReq, _c: MakeCtx): Promise<ImageResult> {
  throw new Error('not implemented')
}
