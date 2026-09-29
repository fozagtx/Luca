/**
 * The ai33 account as the app sees it (the Electron side): the key (one saved in Luca, else
 * AI33_API_KEY for development), credits and health for the UI, notices for the renderer, and
 * the settings the integration keeps. The key never leaves main.
 */
import { app, BrowserWindow, powerSaveBlocker } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI33_NO_KEYCHAIN,
  AI33_REJECTED,
  AI33_UNCHECKED,
  type Ai33HealthMap,
  type Ai33Notice,
  type Ai33SetKeyResult,
  type Ai33Status
} from '../shared/ai33'
import type { Settings } from '../shared/types'
import { checkKey, configure, getCredits, getHealth, resetAccount } from './ai33-client'
import { onJobEvent, runningCount } from './ai33-jobs'
import { announceSettled } from './ai33-late'
import { broadcast, Channels } from './ipc'
import { canStoreSecurely, getSecret, setSecret } from './secrets'
import { getSettings, updateSettings } from './settings'

const API = 'https://api.ai33.pro'

// ------------------------------------------------------------------ the key

/** A key kept only until Luca quits (there is no Keychain to hold it). */
let sessionKey: string | null = null
/** What the Keychain holds, read once (undefined until then); the key is asked for on every poll. */
let savedKey: string | null | undefined

function keychainKey(): string | null {
  if (savedKey === undefined) savedKey = getSecret('ai33')
  return savedKey
}

/** The key: the session's, else the one saved in Luca, else AI33_API_KEY; null when none. */
export function ai33Key(): string | null {
  return sessionKey || keychainKey() || process.env.AI33_API_KEY?.trim() || null
}

/** Whether a key exists; everything that spends gates on this, never on hasSecret('ai33'). */
export function hasAi33Key(): boolean {
  return !!ai33Key()
}

const waiters = new Set<() => void>()

/** Called once a key is saved; returns the way to stop listening. */
export function onKeyConnected(cb: () => void): () => void {
  waiters.add(cb)
  return () => waiters.delete(cb)
}

/**
 * Save a key after checking it with ai33 (an empty key disconnects). Rejects with a plain message
 * when ai33 refuses it; a key that can't be checked (offline) is kept. Wakes whoever waits for
 * a key (a chat card). Without the Keychain the key is held in memory only, never written down.
 */
export async function saveAi33Key(key: string): Promise<Ai33SetKeyResult> {
  const k = key.trim()
  if (!k) {
    sessionKey = null
    try {
      setSecret('ai33', '')
    } catch (err) {
      console.warn('[ai33] removing the saved key failed', err instanceof Error ? err.message : err)
    }
    savedKey = null
    resetAccount()
    // a key from AI33_API_KEY (development) stays, and so does the connection
    const connected = hasAi33Key()
    return {
      connected,
      credits: connected ? await getCredits({ fresh: true }) : null,
      persisted: true,
      checked: true
    }
  }
  const check = await checkKey(k)
  if (check.status === 'rejected') throw new Error(AI33_REJECTED)
  let persisted = false
  if (canStoreSecurely()) {
    try {
      setSecret('ai33', k)
      savedKey = k
      sessionKey = null
      persisted = true
    } catch (err) {
      console.warn('[ai33] saving the key failed', err instanceof Error ? err.message : err)
    }
  }
  if (!persisted) sessionKey = k
  resetAccount()
  for (const cb of [...waiters]) {
    try {
      cb()
    } catch (err) {
      console.warn('[ai33] a key listener failed', err instanceof Error ? err.message : err)
    }
  }
  const note =
    check.status === 'unreachable' ? AI33_UNCHECKED : persisted ? undefined : AI33_NO_KEYCHAIN
  return {
    connected: true,
    credits: check.credits,
    persisted,
    checked: check.status === 'ok',
    ...(note ? { note } : {})
  }
}

const UNKNOWN_HEALTH: Ai33HealthMap = { elevenlabs: 'unknown', minimax: 'unknown' }

/** Connected, credits, health and running jobs, for the key card and the Connections sheet. */
export async function status(): Promise<Ai33Status> {
  const connected = hasAi33Key()
  const [credits, health] = connected
    ? await Promise.all([getCredits({ fresh: true }), getHealth()])
    : [null, UNKNOWN_HEALTH]
  return { connected, credits, health, running: runningCount(), persisted: sessionKey === null }
}

// ------------------------------------------------------------------ notices

/** Notices raised while no window is open, shown at the next one (the newest twenty). */
const queued: Ai33Notice[] = []
const MAX_QUEUED = 20

const liveWindow = (): boolean =>
  BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && !w.webContents.isLoading())

/** Tell the renderer something (queued while no window is open, shown at the next one). */
export function notice(n: Ai33Notice): void {
  if (liveWindow()) {
    broadcast(Channels.ai33Notice, n)
    return
  }
  queued.push(n)
  if (queued.length > MAX_QUEUED) queued.shift()
}

function flushNotices(): void {
  if (!liveWindow()) return
  for (const n of queued.splice(0)) broadcast(Channels.ai33Notice, n)
}

// ------------------------------------------------------------------ files, power and settings

/** Where ai33's app-level files live (jobs.json, rates.json, cache/): userData/ai33. */
export function userDataDir(): string {
  const dir = join(app.getPath('userData'), 'ai33')
  mkdirSync(dir, { recursive: true })
  return dir
}

let blockId: number | null = null
let blockRefs = 0

/** Keeps the Mac awake while any job runs: every start() is matched by one stop(). */
export const powerBlock: { start(): void; stop(): void } = {
  start() {
    if (blockRefs++ === 0) blockId = powerSaveBlocker.start('prevent-app-suspension')
  },
  stop() {
    if (blockRefs === 0) return
    if (--blockRefs === 0 && blockId !== null) {
      powerSaveBlocker.stop(blockId)
      blockId = null
    }
  }
}

/**
 * The one place ai33's settings are written: reads the current `settings.ai33`, merges the
 * patch and saves it (updateSettings replaces the whole `ai33` object it is given).
 */
export function patchAi33Settings(
  patch: NonNullable<Settings['ai33']>
): NonNullable<Settings['ai33']> {
  const current = getSettings().ai33 ?? {}
  const next: NonNullable<Settings['ai33']> = {
    ...current,
    ...patch,
    // the voice last used for each language: a patch for one language keeps the others
    ...(patch.lastVoice ? { lastVoice: { ...current.lastVoice, ...patch.lastVoice } } : {})
  }
  updateSettings({ ai33: next })
  return next
}

// ------------------------------------------------------------------ start-up

let started = false

/**
 * Start-up wiring, called from registerHandlers: gives the client its key and data folder and
 * sets up notices for windows that open later.
 */
export function initAi33(): void {
  if (started) return
  started = true
  const settings = { getKey: ai33Key, dataDir: userDataDir() }
  // the server for development (a fake ai33 on this Mac) is never honoured in a release build
  const override = app.isPackaged ? '' : (process.env.AI33_BASE_URL?.trim() ?? '')
  try {
    configure({ baseUrl: override || API, ...settings })
  } catch (err) {
    console.warn('[ai33] ignoring AI33_BASE_URL:', err instanceof Error ? err.message : err)
    configure({ baseUrl: API, ...settings })
  }
  let awake = false
  onJobEvent((e) => {
    if (e.type === 'settled') {
      void announceSettled(e, notice)
      return
    }
    if (e.count > 0 && !awake) {
      awake = true
      powerBlock.start()
    } else if (e.count === 0 && awake) {
      awake = false
      powerBlock.stop()
    }
  })
  // a notice raised while every window was closed appears at the next one, once its page has loaded
  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('did-finish-load', () => setTimeout(flushNotices, 1000))
  })
}
