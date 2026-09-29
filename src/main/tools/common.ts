/**
 * What every ai33 tool shares: the wrapper that checks the key, joins the abort signals and never
 * throws; the spend gate; the result helpers; and the words tools use to refuse or fail. They
 * live here (not in mcp-ai33.ts) because that file imports the tool files.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { BrowserWindow } from 'electron'
import type { Grant, SpendReq } from '../../shared/ai33'
import { hasAi33Key } from '../ai33-account'
import { notEnough, plainError, refundLine } from '../ai33-client'
import type { Ai33Ctx, SpendCtx, ToolName } from '../ai33-ctx'
import { gateSpend } from '../ai33-spend'

/** One block of a tool result. */
export type ToolContent = { type: 'text'; text: string }

/** What `guarded` hands a tool's body. */
export type Guard = {
  /** Aborted by Stop, the project closing or a restart: stop waiting. */
  signal: AbortSignal
  /** Aborted only by Stop: cancel the job at ai33 too. */
  stop: AbortSignal
  progress: (p: { pct: number | null; note?: string }) => void
}

/** A refusal a tool body throws when the person said no (the ask it was waiting on was declined). */
export class Declined extends Error {
  constructor(readonly tell: string = SPEND_DECLINED) {
    super(tell)
    this.name = 'Declined'
  }
}

/** The tool call that is reporting progress right now, so the agent can tie the report to its step. */
let reporting: symbol | null = null
export const reportingCall = (): symbol | null => reporting

const hasWindow = (): boolean => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed())

/**
 * The person said no: not an error (the step reads "stopped", not "didn't work"), and Luca is
 * told to say so and stop.
 */
export function declined(tell: string): CallToolResult {
  return okJson({ ok: false, declined: true, tell })
}

/** A failure as the person and Luca should read it: no claim about credits that isn't certain. */
function failure(err: unknown): CallToolResult {
  if (err instanceof Declined) return declined(err.tell)
  const e = plainError(err)
  // Stop needs no advice; everything else says whether a retry would be charged again
  if (e.kind === 'stopped') return fail(e.userMessage)
  if (e.charged === false)
    return fail(
      /nothing was charged/i.test(e.userMessage)
        ? e.userMessage
        : `${e.userMessage} Nothing was charged.`
    )
  return fail(`${e.userMessage} ${DO_NOT_RETRY}`)
}

/**
 * Runs a tool's body: waits for a key (asking for one in the chat) when there is none, turns a
 * failure into a plain error result, a declined ask into the declined result, and never throws.
 * `extra` is the second argument the SDK gives every tool handler.
 */
export async function guarded(
  ctx: Ai33Ctx,
  tool: ToolName,
  extra: unknown,
  body: (g: Guard) => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    if (!hasAi33Key()) {
      // with no window there is nowhere to show the key card
      if (!hasWindow()) return fail(NO_AI33)
      if (!(await ctx.connect())) return declined(NO_AI33_DECLINED)
    }
    const turn = ctx.turn()
    const call = Symbol(tool)
    // the SDK's own signal only ever detaches: only the turn's stop cancels a job at ai33
    const own = (extra as { signal?: AbortSignal } | null | undefined)?.signal
    return await body({
      signal: AbortSignal.any([turn.stop, turn.detach, ...(own ? [own] : [])]),
      stop: turn.stop,
      progress: (p) => {
        reporting = call
        try {
          ctx.progress(tool, p)
        } finally {
          reporting = null
        }
      }
    })
  } catch (err) {
    return failure(err)
  }
}

/** The spend gate for a tool: a Grant to settle after the job, or the result to return instead. */
export async function spend(ctx: SpendCtx, req: SpendReq): Promise<Grant | CallToolResult> {
  const r = await gateSpend(ctx, req)
  return r.go ? r.grant : r.result
}

/** A failed call: shown red in the chat and told to Luca in plain words. */
export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/**
 * A finished call: `first` as one line of JSON (the chat reads the first line of a result), then
 * any further blocks.
 */
export function okJson(first: unknown, ...more: ToolContent[]): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(first) }, ...more] }
}

/** Appended to a billed tool's failure: a retry would be charged again. */
export const DO_NOT_RETRY = 'Do not retry; a retry is a new charge.'

/** No key, and the person chose not to connect one. */
export const NO_AI33_DECLINED =
  'The user chose not to connect ai33, so this can’t be made. Say so in one short sentence and that they can connect it any time (Connections, Cmd+,). Do not make it another way and do not ask again in this conversation.'

/** No key, and no window to ask in. */
export const NO_AI33 =
  'Voices, music and sound aren’t connected yet (no ai33 key). Tell the user in one short sentence to connect ai33 under Connections (Cmd+,), then ask again. Do not make it another way.'

export const SPEND_DECLINED =
  'The user chose not to spend credits on this. Say so in one short sentence and do not try again.'

/** The client words it too (it explains a refused request); this is the same text. */
export const NOT_ENOUGH = (balance: number, need: number): string => notEnough(balance, need)

/** A job still running when the tool's wait ran out (a non-error result). */
export const STILL_WORKING =
  'ai33 is still working on it. It may take a few more minutes; Luca will let you know when it’s ready.'

export const OVERLOADED =
  'The voice service is busy right now, so Luca didn’t start it. Nothing was charged. Tell the user in one short sentence to try again in a few minutes or pick a Standard voice. Do not retry.'

/** After a task fails, from the balance before and after: whether the credits came back. One place to blank it. */
export const REFUND_LINE = refundLine
