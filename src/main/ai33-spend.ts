/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * The spend policy, in code: what a job is estimated to cost, when the person is asked first,
 * what no card can override, and the bookkeeping of each turn. Imports only Node, the client,
 * the ledger, the store and shared code (the smoke script bundles it).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import type { Ai33Estimate, Ai33EstimateReq, Ai33Kind, Grant, SpendReq } from '../shared/ai33'
import type { SpendCtx } from './ai33-ctx'

/** Asked first when a job (or a batch) is estimated at this many credits or more. */
export const ASK_ABOVE = 1500
/** Asked first when one turn's approved spending would pass this. */
export const TURN_CAP = 6000
/** Most a turn may make of each kind (sound effects: effects, not calls) before it must ask the person. */
export const PER_TURN = { speech: 3, music: 1, sfx: 8 }
export const MAX_PAID_PER_TURN = 6
/** The most music may cost and still be made without a card when the start card switched it on. */
export const PREAPPROVE_MAX = 6000
/** How long an ask waits for the person before it counts as No. */
export const ASK_TIMEOUT_MS = 1_800_000
/** What music is assumed to cost until a real price has been seen. */
export const MUSIC_SEED = 3600

/** What a job is expected to cost, from an exact formula, a price ai33 gave, a learned rate or a seed. */
export function estimate(_req: Ai33EstimateReq): Promise<Ai33Estimate> {
  throw new Error('not implemented')
}

/**
 * Before a paid call: a Grant that reserves the estimate (the tool settles it after the job), or
 * the result to return instead (declined, not enough credits, over a cap). Allows everything
 * until the policy is written.
 */
export function gateSpend(
  _ctx: SpendCtx,
  req: SpendReq
): Promise<{ go: true; grant: Grant } | { go: false; result: CallToolResult }> {
  return Promise.resolve({
    go: true,
    grant: {
      id: randomUUID(),
      kind: req.kind,
      reserved: req.estimate?.credits ?? 0,
      preapproved: false
    }
  })
}

/** After the job: replace the reservation with what it really cost (0 when it failed or was cancelled). */
export function settleSpend(_ctx: SpendCtx, _grant: Grant, _actualCredits: number): void {
  // nothing is reserved until the policy is written
}

/** Let the first turn make these without asking (in practice only 'music'), for this project. */
export function grantPreapproval(_projectDir: string, _kinds: Ai33Kind[]): void {
  throw new Error('not implemented')
}

/** A spend context for work that starts before any project or chat exists (a script start). */
export function makeStartCtx(_ask: SpendCtx['ask'], _signal: AbortSignal): SpendCtx {
  throw new Error('not implemented')
}
