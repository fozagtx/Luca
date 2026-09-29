/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * What every ai33 tool shares: the wrapper that checks the key, joins the abort signals and never
 * throws; the spend gate; the result helpers; and the words tools use to refuse or fail. They
 * live here (not in mcp-ai33.ts) because that file imports the tool files.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { formatCredits, type Grant, type SpendReq } from '../../shared/ai33'
import type { Ai33Ctx, SpendCtx, ToolName } from '../ai33-ctx'

/** One block of a tool result: text, or a picture Luca can look at. */
export type ToolContent =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** What `guarded` hands a tool's body. */
export type Guard = {
  /** Aborted by Stop, the project closing or a restart: stop waiting. */
  signal: AbortSignal
  /** Aborted only by Stop: cancel the job at ai33 too. */
  stop: AbortSignal
  progress: (p: { pct: number | null; note?: string }) => void
}

/**
 * Runs a tool's body: waits for a key (asking for one in the chat) when there is none, turns a
 * failure into a plain error result, a declined ask into the declined result, and never throws.
 * `extra` is the second argument the SDK gives every tool handler.
 */
export function guarded(
  _ctx: Ai33Ctx,
  _tool: ToolName,
  _extra: unknown,
  _body: (g: Guard) => Promise<CallToolResult>
): Promise<CallToolResult> {
  throw new Error('not implemented')
}

/** The spend gate for a tool: a Grant to settle after the job, or the result to return instead. */
export function spend(_ctx: SpendCtx, _req: SpendReq): Promise<Grant | CallToolResult> {
  throw new Error('not implemented')
}

/** A failed call: shown red in the chat and told to Luca in plain words. */
export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/**
 * A finished call: `first` as one line of JSON (the chat reads the first line of a result), then
 * any further blocks (a picture to look at).
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

export const NOT_ENOUGH = (balance: number, need: number): string =>
  `There aren’t enough ai33 credits for this (${formatCredits(balance)} left, it needs about ${formatCredits(need)}). Tell the user in one short sentence they can add credits with ai33, then ask again. Do not make it another way.`

/** A job still running when the tool's wait ran out (a non-error result). */
export const STILL_WORKING =
  'ai33 is still working on it. It may take a few more minutes; Luca will let you know when it’s ready.'

export const OVERLOADED =
  'The voice service is busy right now, so Luca didn’t start it. Nothing was charged. Tell the user in one short sentence to try again in a few minutes or pick a Standard voice. Do not retry.'

/** After a task fails, from the balance before and after: whether the credits came back. One place to blank it. */
export const REFUND_LINE = (before: number | null, after: number | null): string => {
  if (after === null) return ''
  return before !== null && Math.abs(after - before) <= Math.max(1, before * 0.01)
    ? `Your credits are back (${formatCredits(after)} left).`
    : `ai33 returns credits for a job that fails. You have ${formatCredits(after)} credits.`
}
