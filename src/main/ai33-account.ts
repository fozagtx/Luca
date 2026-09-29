/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * The ai33 account as the app sees it (the Electron side): the key (one saved in Luca, else
 * AI33_API_KEY for development), credits and health for the UI, notices for the renderer, and
 * the settings the integration keeps. The key never leaves main.
 */
import type { Ai33Notice, Ai33SetKeyResult, Ai33Status } from '../shared/ai33'
import type { Settings } from '../shared/types'

/** The key: the session's, else the one saved in Luca, else AI33_API_KEY; null when none. */
export function ai33Key(): string | null {
  throw new Error('not implemented')
}

/** Whether a key exists; everything that spends gates on this, never on hasSecret('ai33'). */
export function hasAi33Key(): boolean {
  throw new Error('not implemented')
}

/**
 * Save a key after checking it with ai33 (an empty key disconnects). Rejects with a plain message
 * when ai33 refuses it; a key that can't be checked (offline) is kept. Wakes whoever waits for
 * a key (a chat card).
 */
export function saveAi33Key(_key: string): Promise<Ai33SetKeyResult> {
  throw new Error('not implemented')
}

/** Connected, credits, health and running jobs, for the key card and the Connections sheet. */
export function status(): Promise<Ai33Status> {
  throw new Error('not implemented')
}

/** Called once a key is saved; returns the way to stop listening. */
export function onKeyConnected(_cb: () => void): () => void {
  throw new Error('not implemented')
}

/** Tell the renderer something (queued while no window is open, shown at the next one). */
export function notice(_n: Ai33Notice): void {
  throw new Error('not implemented')
}

/** Where ai33's app-level files live (jobs.json, rates.json, cache/): userData/ai33. */
export function userDataDir(): string {
  throw new Error('not implemented')
}

/** Keeps the Mac awake while any job runs: every start() is matched by one stop(). */
export const powerBlock: { start(): void; stop(): void } = {
  start() {
    throw new Error('not implemented')
  },
  stop() {
    throw new Error('not implemented')
  }
}

/**
 * The one place ai33's settings are written: reads the current `settings.ai33`, merges the
 * patch and saves it (updateSettings replaces the whole `ai33` object it is given).
 */
export function patchAi33Settings(
  _patch: NonNullable<Settings['ai33']>
): NonNullable<Settings['ai33']> {
  throw new Error('not implemented')
}

/**
 * Start-up wiring, called from registerHandlers: gives the client its key and data folder and
 * sets up notices for windows that open later.
 */
export function initAi33(): void {
  // nothing to wire until the account is written
}
