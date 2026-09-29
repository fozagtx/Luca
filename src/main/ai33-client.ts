/**
 * The ai33 HTTP client and the one job runner every capability goes through: submit, poll,
 * download, ledger, cancel, failure copy. Pure Node (no Electron: the smoke script bundles it);
 * the key and the data folder are given to it by `configure`.
 */
import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { promises as dnsPromises } from 'node:dns'
import { pipeline } from 'node:stream/promises'
import {
  formatCredits,
  type Ai33Health,
  type Ai33HealthMap,
  type Ai33Kind,
  type Ai33Raw
} from '../shared/ai33'
import {
  attachClient,
  emitJobEvent,
  find,
  inflight,
  list,
  track,
  untrack,
  upsert,
  type LedgerEntry
} from './ai33-jobs'

// ------------------------------------------------------------------ setup

type Config = {
  baseUrl: string
  getKey: () => string | null
  dataDir: string
  /** Scales every wait (a test can run at 0.05); leave out for real time. */
  pace?: number
}

let cfg: { base: string; origin: string; loopbackHttp: boolean; c: Config } | null = null
let pace = 1

const isLoopback = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'

/**
 * Point the client at ai33. The key only ever goes to this address, and only over https (or to a
 * server on this Mac, which is how the development server is reached).
 */
export function configure(c: Config): void {
  const url = new URL(c.baseUrl)
  const loopback = isLoopback(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('ai33 is only reached over https')
  cfg = {
    base: url.href.endsWith('/') ? url.href : `${url.href}/`,
    origin: url.origin,
    loopbackHttp: url.protocol === 'http:',
    c
  }
  pace = c.pace ?? 1
  attachClient(c.dataDir, { finish: background, outcome: outcomeFor })
}

function config(): NonNullable<typeof cfg> {
  if (!cfg) throw new Error('ai33 is not set up yet')
  return cfg
}

/** Where ai33 keeps this app's files (jobs.json, rates.json, cache/), from `configure`. */
export function dataDir(): string {
  return config().c.dataDir
}

// ------------------------------------------------------------------ errors and their words

export type Ai33ErrorKind =
  | 'auth'
  | 'credits'
  | 'rate'
  | 'validation'
  | 'server'
  | 'network'
  | 'task'
  | 'stopped'
  | 'deadline'
  | 'unusable'

/**
 * A failure in plain words for the person (`userMessage`), and whether credits may have been
 * spent: `charged` is false only where no task can exist (a refused request, a full queue).
 */
export class Ai33Error extends Error {
  readonly kind: Ai33ErrorKind
  readonly status?: number
  readonly charged: boolean | 'unknown'
  readonly userMessage: string

  constructor(
    kind: Ai33ErrorKind,
    userMessage: string,
    o: { status?: number; charged?: boolean | 'unknown'; cause?: unknown } = {}
  ) {
    super(userMessage, { cause: o.cause })
    this.name = 'Ai33Error'
    this.kind = kind
    this.status = o.status
    this.charged = o.charged ?? 'unknown'
    this.userMessage = userMessage
  }
}

const KEY_MISSING = 'ai33 isn’t connected. Connect it in Connections (Cmd+,).'
const KEY_REJECTED = 'Your ai33 key wasn’t accepted. Check it in Connections (Cmd+,).'
const BUSY = 'ai33 is busy right now (its queue is full). Wait a minute, then ask again.'
const TROUBLE = 'ai33 is having trouble right now.'
const TROUBLE_SUBMIT = `${TROUBLE} It may have started the job, so Luca didn’t start it again.`
const UNREACHABLE = 'Couldn’t reach ai33. Check your internet connection.'
const NOT_RECOGNISED = 'ai33 doesn’t recognise this request. Luca may need an update.'
const ODD_REDIRECT = 'ai33 answered from somewhere Luca doesn’t trust, so it sent nothing further.'
const TOO_BIG = 'ai33 sent back a file that is bigger than Luca will take, so nothing was added.'

/** What each kind of job makes, as the person would say it. */
const THINGS: Record<Ai33Kind, string> = {
  speech: 'voiceover',
  dialogue: 'conversation',
  music: 'music',
  sfx: 'sound effect'
}

/** What a kind of job makes, as the person would say it ("voiceover", "music"). */
export const thingFor = (kind: Ai33Kind): string => THINGS[kind]

const enoughLine = (balance: number, need?: number | null): string =>
  `There aren’t enough ai33 credits for this (${formatCredits(balance)} left${need ? `, it needs about ${formatCredits(need)}` : ''}).`

/** Not enough credits, as the person reads it (what an Ai33Error carries); `need` when the price is known. */
export const creditsShort = (balance: number, need?: number | null): string =>
  `${enoughLine(balance, need)} You can add credits with ai33.`

/**
 * The same in the words a tool gives Luca (what to say, and not to work around it). Only the
 * spend gate's refusal, which is never shown as an error, uses it; tools/common.ts adds the
 * instruction to a credits failure itself.
 */
export const notEnough = (balance: number, need?: number | null): string =>
  `${enoughLine(balance, need)} Tell the user in one short sentence they can add credits with ai33, then ask again. Do not make it another way.`

/**
 * After a task fails, from the balance before and after: whether the credits came back. One place
 * to blank it. "Back" only when nothing is missing: a smaller balance says nothing about a refund.
 */
export const refundLine = (before: number | null, after: number | null): string => {
  if (after === null) return ''
  return before !== null && after >= before
    ? `Your credits are back (${formatCredits(after)} left).`
    : `You have ${formatCredits(after)} credits.`
}

/** What the background poller says when it gives up: the job stays in the ledger to be collected. */
const deadlineText = (thing: string): string =>
  `Your ${thing} is taking a long time at ai33. It may still finish; ask Luca to check it later.`

/** What a caller is told when a job it asked for again has run past its deadline: it is dropped, so asking again starts it again. */
const pastDeadlineText = (thing: string): string =>
  `Your ${thing} is still not ready at ai33, so Luca stopped waiting for it. Asking again will start it again.`

const goneText = (thing: string): string =>
  `ai33 no longer has your ${thing}, so Luca can’t get it. Asking again will make it again.`

const stoppedError = (thing: string, refund = 0): Ai33Error =>
  new Ai33Error(
    'stopped',
    `Stopped before the ${thing} was ready.${refund > 0 ? ` ai33 returned ${formatCredits(refund)} credits.` : ''}`,
    { charged: 'unknown' }
  )

/** The key must never appear in anything Luca shows, logs or tells the model. */
function scrub(text: string): string {
  const key = cfg?.c.getKey()
  return key && key.length > 5 ? text.split(key).join('…') : text
}

/**
 * Words that came from outside (ai33's answers) as one plain line of at most `max` characters:
 * they reach the person and the model, so no markup, control or invisible characters, and the key
 * is removed first (a key with a line break in it would survive once the lines were joined).
 */
function oneLine(text: string, max: number): string {
  const flat = scrub(text)
    // bounded before the pattern runs, so a huge answer of "<" costs nothing
    .slice(0, 4_000)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\p{Cf}+/gu, '')
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '')
  // by characters, not UTF-16 halves, so an emoji is never cut in two
  return flat.length > max
    ? `${Array.from(flat)
        .slice(0, max - 1)
        .join('')}…`
    : flat
}

/** The longest stretch of ai33's own words shown in an error. */
const SERVER_WORDS_MAX = 120

/** ai33's own words from an error answer (`message`, `error`, `detail`), short and on one line. */
function serverWords(data: Ai33Raw, raw = ''): string {
  const pick = data?.message ?? data?.error?.message ?? data?.error ?? data?.detail ?? data?.msg
  const text = typeof pick === 'string' ? pick : pick ? JSON.stringify(pick) : ''
  return oneLine(text || (data === undefined ? raw : ''), SERVER_WORDS_MAX)
}

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
])

function causeCode(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null
  const code = e?.cause?.code ?? e?.code
  return typeof code === 'string' ? code : ''
}

const isAbort = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')

/** Any error as an Ai33Error, in words for the person; `thing` names what was being made. */
export function plainError(err: unknown, thing = 'result'): Ai33Error {
  if (err instanceof Ai33Error) return err
  if (isAbort(err)) return stoppedError(thing)
  if (
    NETWORK_CODES.has(causeCode(err)) ||
    (err instanceof TypeError && /fetch failed|network/i.test(err.message))
  )
    return new Ai33Error('network', UNREACHABLE, { charged: 'unknown', cause: err })
  // the key comes out before the message is cut to its first line
  const text = scrub(err instanceof Error ? err.message : String(err))
    .split('\n')[0]
    .trim()
  return new Ai33Error('task', text.slice(0, 300) || 'Something went wrong.', {
    charged: 'unknown',
    cause: err
  })
}

// ------------------------------------------------------------------ small helpers

/** A whole number from a number or numeric string (ai33 sends both), else null. */
export function toInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Math.round(Number(v))
  return null
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s)

function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal {
  return AbortSignal.any(signals.filter((s): s is AbortSignal => !!s))
}

/** Waits `ms` of real time; ends early when a signal aborts (the caller looks at the signal). */
function sleepRaw(ms: number, ...signals: (AbortSignal | undefined)[]): Promise<void> {
  const live = signals.filter((s): s is AbortSignal => !!s)
  return new Promise((resolve) => {
    if (live.some((s) => s.aborted)) return resolve()
    const done = (): void => {
      clearTimeout(timer)
      for (const s of live) s.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, Math.max(0, ms))
    for (const s of live) s.addEventListener('abort', done, { once: true })
  })
}

const sleep = (ms: number, ...signals: (AbortSignal | undefined)[]): Promise<void> =>
  sleepRaw(ms * pace, ...signals)

const jitter = (ms: number, rand: () => number = Math.random): number =>
  Math.round(ms * (0.8 + 0.4 * rand()))

// ------------------------------------------------------------------ requests

export type RequestOpts = {
  method?: string
  json?: unknown
  /** Built again for every attempt, so a retried upload never reuses a spent body. */
  form?: () => Promise<FormData>
  signal?: AbortSignal
  timeoutMs?: number
  /** The credits this request needs, when known: tells "out of credits" from "refused" on a 401. */
  needCredits?: number
}

type Reply = { status: number; headers: Headers; text: string }

/** Where a path on the API is, refusing anything that would send the key to another host. */
function endpoint(path: string): URL {
  const { base, origin } = config()
  const url = new URL(path.replace(/^\/+/, ''), base)
  if (url.origin !== origin) throw new Ai33Error('server', ODD_REDIRECT, { charged: false })
  return url
}

/**
 * One exchange with ai33. Redirects are followed by hand for a GET on the same host only (the
 * key must never follow a redirect to another host). Failures before an answer become an
 * Ai33Error: the caller decides what a POST that got none may have done.
 */
async function exchange(method: string, url: URL, key: string, o: RequestOpts): Promise<Reply> {
  const { origin } = config()
  let target = url
  for (let hop = 0; hop < 4; hop++) {
    const headers: Record<string, string> = { 'xi-api-key': key, accept: 'application/json' }
    let body: FormData | string | undefined
    if (o.form) body = await o.form()
    else if (o.json !== undefined) {
      body = JSON.stringify(o.json)
      headers['content-type'] = 'application/json'
    }
    const signal = anySignal(
      o.signal,
      AbortSignal.timeout(o.timeoutMs ?? (method === 'GET' ? 10_000 : 30_000))
    )
    let res: Response
    let text: string
    try {
      res = await fetch(target, { method, headers, body, redirect: 'manual', signal })
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => undefined)
        const where = res.headers.get('location')
        const next = where ? new URL(where, target) : null
        if (method !== 'GET' || !next || next.origin !== origin)
          throw new Ai33Error('server', ODD_REDIRECT, { status: res.status, charged: 'unknown' })
        target = next
        continue
      }
      text = await res.text()
    } catch (err) {
      if (err instanceof Ai33Error) throw err
      if (o.signal?.aborted) throw new Ai33Error('stopped', 'Stopped.', { cause: err })
      // a timeout after a POST left may still have made the job; on a GET it is just no answer
      if (isAbort(err) || /TIMEOUT/.test(causeCode(err)))
        throw method === 'GET'
          ? new Ai33Error('network', UNREACHABLE, { charged: 'unknown', cause: err })
          : new Ai33Error('server', TROUBLE_SUBMIT, { charged: 'unknown', cause: err })
      throw plainError(err)
    }
    return { status: res.status, headers: res.headers, text }
  }
  throw new Ai33Error('server', ODD_REDIRECT, { charged: 'unknown' })
}

const parse = (text: string): Ai33Raw | undefined => {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Seconds (or a date) from a Retry-After header, in ms. */
function retryAfterMs(headers: Headers): number | null {
  const v = headers.get('retry-after')?.trim()
  if (!v) return null
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000)
  const at = Date.parse(v)
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}

/** Waits (ms) before each retry of a 429, then a full queue is told to the person. */
const RATE_STEPS = [2_000, 5_000, 12_000]
const RATE_CAP_MS = 45_000
const RATE_MAX_WAIT_MS = 30_000
/** Whatever ai33 says ("Retry-After: 0"), the queue is never asked again sooner than this... */
const RATE_MIN_WAIT_MS = 500
/** ...and never more than this many times in a row. */
const RATE_TRIES = 5

/**
 * One request to ai33 (JSON or multipart form) with the key; the answer parsed, or an Ai33Error.
 * Only a 429 is retried (the request was refused, so nothing was made): a timeout or a server error
 * after the request left is never repeated, because the job may exist.
 */
export async function request(path: string, o: RequestOpts = {}): Promise<Ai33Raw> {
  const key = config().c.getKey()
  if (!key) throw new Ai33Error('auth', KEY_MISSING, { charged: false })
  const method = o.method ?? (o.json !== undefined || o.form ? 'POST' : 'GET')
  const url = endpoint(path)
  let waited = 0
  for (let attempt = 0; ; attempt++) {
    const res = await exchange(method, url, key, o)
    if (res.status !== 429) return interpret(method, path, res, o)
    const asked = retryAfterMs(res.headers) ?? RATE_STEPS[Math.min(attempt, RATE_STEPS.length - 1)]
    const step = Math.min(Math.max(asked, RATE_MIN_WAIT_MS), RATE_MAX_WAIT_MS)
    if (attempt + 1 >= RATE_TRIES || waited + step > RATE_CAP_MS)
      throw new Ai33Error('rate', BUSY, { status: 429, charged: false })
    await sleep(step, o.signal)
    waited += step
    if (o.signal?.aborted) throw new Ai33Error('stopped', 'Stopped.')
  }
}

async function interpret(
  method: string,
  path: string,
  res: Reply,
  o: RequestOpts
): Promise<Ai33Raw> {
  const { status } = res
  const data = parse(res.text)
  if (status >= 200 && status < 300) {
    if (data === undefined)
      throw new Ai33Error('server', method === 'GET' ? TROUBLE : TROUBLE_SUBMIT, {
        status,
        charged: 'unknown'
      })
    noteBalance(data)
    // a refusal can come with a 200 and success:false; nothing was made
    if (data?.success === false) {
      const why = serverWords(data)
      throw new Ai33Error(
        'validation',
        `ai33 didn’t accept this${why ? `: ${why}` : ''}. Nothing was charged.`,
        { status, charged: false }
      )
    }
    return data
  }
  if (status === 401 || status === 403) throw await refused(status, path, data, o)
  if (status === 404) throw new Ai33Error('validation', NOT_RECOGNISED, { status, charged: false })
  if (status === 408 || status >= 500)
    throw new Ai33Error('server', method === 'GET' ? TROUBLE : TROUBLE_SUBMIT, {
      status,
      charged: 'unknown'
    })
  const why = serverWords(data, res.text)
  throw new Ai33Error(
    'validation',
    `ai33 didn’t accept this${why ? `: ${why}` : ''}. Nothing was charged.`,
    { status, charged: false }
  )
}

/**
 * ai33 answers 401 both for a bad key and for too few credits, so the credits say which: if they
 * can't be read either the key is bad; if they are used up (or below the price) it is the balance;
 * anything else is a refusal of this request.
 */
async function refused(
  status: number,
  path: string,
  data: Ai33Raw,
  o: RequestOpts
): Promise<Ai33Error> {
  const key = config().c.getKey()
  if (!key || path.replace(/^\/+/, '') === 'v1/credits')
    return new Ai33Error('auth', KEY_REJECTED, { status, charged: false })
  let credits: number | null = null
  try {
    const res = await exchange('GET', endpoint('/v1/credits'), key, { timeoutMs: 8_000 })
    if (res.status === 401 || res.status === 403)
      return new Ai33Error('auth', KEY_REJECTED, { status, charged: false })
    if (res.status >= 200 && res.status < 300) {
      credits = toInt(parse(res.text)?.credits)
      if (credits !== null) noteCredits(credits)
    }
  } catch {
    // unreadable: say what ai33 said
  }
  if (credits !== null && (o.needCredits ? credits < o.needCredits : credits <= 0))
    return new Ai33Error('credits', creditsShort(credits, o.needCredits), {
      status,
      charged: false
    })
  const why = serverWords(data)
  return new Ai33Error('validation', `ai33 didn’t accept that request${why ? ` (${why})` : ''}.`, {
    status,
    charged: false
  })
}

// ------------------------------------------------------------------ credits and health

let creditsCache: { value: number; at: number } | null = null
let healthCache: { value: Ai33HealthMap; at: number } | null = null
const CREDITS_TTL_MS = 20_000
const HEALTH_TTL_MS = 60_000
const UNKNOWN_HEALTH: Ai33HealthMap = { elevenlabs: 'unknown', minimax: 'unknown' }

const noteCredits = (n: number): void => {
  creditsCache = { value: n, at: Date.now() }
}

/** Submit answers say what is left (`ec_remain_credits`, a number or a string). */
function noteBalance(data: Ai33Raw): void {
  const left = toInt(data?.ec_remain_credits)
  if (left !== null) noteCredits(left)
}

/** Credits left, or null when unreadable; cached briefly unless `fresh`. */
export async function getCredits(o: { fresh?: boolean } = {}): Promise<number | null> {
  if (!o.fresh && creditsCache && Date.now() - creditsCache.at < CREDITS_TTL_MS)
    return creditsCache.value
  try {
    const n = toInt((await request('/v1/credits'))?.credits)
    if (n !== null) noteCredits(n)
    return n
  } catch {
    return null
  }
}

const asHealth = (v: unknown): Ai33Health =>
  v === 'good' || v === 'degraded' || v === 'overloaded' ? v : 'unknown'

/** How busy the voice services are (cached for a minute). */
export async function getHealth(): Promise<Ai33HealthMap> {
  if (healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.value
  let value = UNKNOWN_HEALTH
  try {
    const res = await request('/v1/health-check')
    const d = res?.data ?? res
    value = { elevenlabs: asHealth(d?.elevenlabs), minimax: asHealth(d?.minimax) }
  } catch {
    // no signal is not a problem signal
  }
  healthCache = { value, at: Date.now() }
  return value
}

/** Forget what was read for the old account (the key changed). */
export function resetAccount(): void {
  creditsCache = null
  healthCache = null
}

/**
 * Whether a string can be a key: printable ASCII with no spaces, of a sensible length. Anything
 * else (a pasted sentence, a line break that would end an HTTP header early) is refused before
 * it is kept or sent.
 */
export const isKeyShape = (key: string): boolean => /^[\x21-\x7e]{8,200}$/.test(key)

/**
 * Whether ai33 accepts a key, before it is kept: 'rejected' for a 401 or 403, and for a string that
 * can't be a key (never sent); a key that merely couldn't be checked, offline or with ai33 down,
 * is 'unreachable' and still kept.
 */
export async function checkKey(
  key: string
): Promise<{ status: 'ok' | 'rejected' | 'unreachable'; credits: number | null }> {
  if (!isKeyShape(key)) return { status: 'rejected', credits: null }
  try {
    const res = await exchange('GET', endpoint('/v1/credits'), key, { timeoutMs: 10_000 })
    if (res.status === 401 || res.status === 403) return { status: 'rejected', credits: null }
    if (res.status >= 200 && res.status < 300)
      return { status: 'ok', credits: toInt(parse(res.text)?.credits) }
  } catch {
    // offline, timed out, ai33 down
  }
  return { status: 'unreachable', credits: null }
}

// ------------------------------------------------------------------ result files

/** Where a finished task's files are. */
export type Ai33Urls = {
  audio?: string
  audios?: string[]
  srt?: string
  json?: string
}

const link = (v: unknown): string | undefined =>
  typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : undefined
const links = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(link).filter((u): u is string => !!u) : []

/**
 * The result files of a finished task, wherever its type puts them (a speech task in
 * `metadata.audio_url`, a sound effect in `metadata.output_uri`, a voice isolate at the top
 * level, music in `all_audio_urls`); an Ai33Error('unusable') if it has none.
 */
export function resultUrls(task: Ai33Raw): Ai33Urls {
  const m: Ai33Raw = task?.metadata && typeof task.metadata === 'object' ? task.metadata : {}
  const clips: Ai33Raw[] = Array.isArray(m.suno_result?.clips) ? m.suno_result.clips : []
  const clipUrls = clips.map((c) => link(c?.audio_url)).filter((u): u is string => !!u)
  const many = [...links(m.all_audio_urls), ...clipUrls]
  const audio =
    link(m.audio_url) ??
    link(m.output_uri) ??
    link(task?.output_uri) ??
    many[0] ??
    link(m.result_url) ??
    link(m.url) ??
    link(m.file_url) ??
    link(task?.audio_url) ??
    link(task?.result_url) ??
    link(task?.url)
  const audios = [...new Set([audio, ...many].filter((u): u is string => !!u))]
  const srt = link(m.srt_url)
  const json = link(m.json_url)
  if (!audio && !srt && !json)
    throw new Ai33Error('unusable', 'ai33 sent back something Luca couldn’t use.', {
      charged: 'unknown'
    })
  return {
    ...(audio ? { audio } : {}),
    ...(audios.length ? { audios } : {}),
    ...(srt ? { srt } : {}),
    ...(json ? { json } : {})
  }
}

// ------------------------------------------------------------------ downloads

/** No answer, or no bytes, for this long ends a download. */
const STALL_MS = 30_000
/** Even a download that keeps trickling in is given up on after this long (files stay at ai33). */
const DOWNLOAD_TOTAL_MS = 5 * 60_000
/** A name is looked up for at most this long; an answer that doesn't come is not a reason to refuse. */
const LOOKUP_MS = 5_000

/** How many audio files a finished job of each kind carries: music comes as two takes, the rest as one. */
const TAKES: Record<Ai33Kind, number> = { speech: 1, dialogue: 1, music: 2, sfx: 1 }

/** The audio files of a finished job worth downloading: what its kind makes, never every link ai33 lists. */
export function takeUrls(kind: Ai33Kind, urls: { audio?: string; audios?: string[] }): string[] {
  const all = urls.audios?.length ? urls.audios : urls.audio ? [urls.audio] : []
  return all.slice(0, TAKES[kind])
}

/** The four numbers of a dotted IPv4 address, or null. */
function v4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  return parts.every((n) => n <= 255) ? parts : null
}

/** Addresses that reach this Mac or its network, not the internet. */
function privateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** The 16 bytes of an IPv6 address (brackets, a zone and a dotted ending allowed), or null. */
function v6Bytes(text: string): number[] | null {
  let s = text.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (dotted) {
    const p = v4Parts(dotted[1])
    if (!p) return null
    s = `${s.slice(0, -dotted[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const groups = (h: string): string[] => (h ? h.split(':') : [])
  const head = groups(halves[0])
  const tail = halves.length === 2 ? groups(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const all = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (!all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null
  return all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255])
}

function privateV6(b: number[]): boolean {
  const zeros = (from: number, to: number): boolean => b.slice(from, to).every((x) => x === 0)
  // ::, ::1 and the old IPv4-compatible form
  if (zeros(0, 12)) return true
  // IPv4-mapped, and NAT64: the address inside decides
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return privateV4(b.slice(12))
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12))
    return privateV4(b.slice(12))
  // 6to4 carries an IPv4 address after its prefix
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(b.slice(2, 6))
  // unique local, link local, site local, multicast
  return (b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0x80) === 0x80) || b[0] === 0xff
}

/** Whether an address (as `dns.lookup` or a URL spells it) is one that isn't on the internet. */
function isPrivateAddress(address: string): boolean {
  const v4 = v4Parts(address)
  if (v4) return privateV4(v4)
  const v6 = v6Bytes(address)
  return v6 ? privateV6(v6) : false
}

const LOCAL_NAME = /(?:^|\.)(?:localhost|local|internal|localdomain|home\.arpa)$/

const refusedLink = (): Ai33Error =>
  new Ai33Error('unusable', 'ai33 sent back a link Luca won’t open, so nothing was added.', {
    charged: 'unknown'
  })

/**
 * Where a download may come from: https to a host on the internet (a link to this Mac or its
 * network would make Luca fetch on ai33's behalf), or http to this Mac while ai33 itself is there
 * (the development server). A name is looked up first and refused if it answers with a private
 * address; a name that can't be looked up is left to the download itself to fail.
 */
async function assertDownloadable(u: URL): Promise<void> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw refusedLink()
  if (config().loopbackHttp && isLoopback(u.hostname)) return
  if (u.protocol !== 'https:') throw refusedLink()
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (host.startsWith('[') || v4Parts(host)) {
    if (isPrivateAddress(host)) throw refusedLink()
    return
  }
  if (LOCAL_NAME.test(host) || !host.includes('.')) throw refusedLink()
  let answers: { address: string }[] = []
  try {
    answers = await Promise.race([
      dnsPromises.lookup(host, { all: true }),
      new Promise<never>((_resolve, reject) => setTimeout(reject, LOOKUP_MS).unref())
    ])
  } catch {
    return
  }
  if (answers.some((a) => isPrivateAddress(a.address))) throw refusedLink()
}

const downloadFailed = (cause?: unknown): Ai33Error =>
  new Ai33Error(
    'network',
    'ai33 made it, but Luca couldn’t download it. It is kept at ai33, so asking again won’t be paid for twice.',
    { charged: true, cause }
  )

/**
 * Download a result file (https only, the key never sent to another host): to `<dest>.part`,
 * renamed when whole. Result files come from CDN hosts without the key; only when the file is on
 * ai33's own host and refuses without it is it asked for again with the key. `totalMs` bounds the
 * whole download (redirects included), however steadily the bytes arrive.
 */
export async function downloadTo(
  url: string,
  dest: string,
  o: { signal?: AbortSignal; maxBytes: number; totalMs?: number }
): Promise<{ bytes: number; mime: string }> {
  const { origin, c } = config()
  const part = `${dest}.part`
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new Ai33Error(
      'unusable',
      'ai33 sent back a link Luca couldn’t use, so nothing was added.',
      {
        charged: 'unknown'
      }
    )
  }
  mkdirSync(dirname(dest), { recursive: true })
  const overall = AbortSignal.timeout(o.totalMs ?? DOWNLOAD_TOTAL_MS)
  let withKey = false
  try {
    for (let hop = 0; hop < 6; hop++) {
      await assertDownloadable(target)
      const headers: Record<string, string> = {}
      const key = c.getKey()
      if (withKey && key && target.origin === origin) headers['xi-api-key'] = key
      const stall = new AbortController()
      const watch = anySignal(o.signal, stall.signal, overall)
      const timer = setTimeout(() => stall.abort(), STALL_MS)
      try {
        const res = await fetch(target, { headers, redirect: 'manual', signal: watch })
        if (res.status >= 300 && res.status < 400) {
          await res.body?.cancel().catch(() => undefined)
          const where = res.headers.get('location')
          if (!where) throw downloadFailed()
          target = new URL(where, target)
          continue
        }
        if ((res.status === 401 || res.status === 403) && !withKey && target.origin === origin) {
          await res.body?.cancel().catch(() => undefined)
          withKey = true
          continue
        }
        if (!res.ok || !res.body) throw downloadFailed()
        if (Number(res.headers.get('content-length')) > o.maxBytes)
          throw new Ai33Error('unusable', TOO_BIG, { charged: 'unknown' })
        let bytes = 0
        const count = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            bytes += chunk.length
            timer.refresh()
            if (bytes > o.maxBytes) cb(new Ai33Error('unusable', TOO_BIG, { charged: 'unknown' }))
            else cb(null, chunk)
          }
        })
        // once the answer starts, only a stall (no bytes for a while) or the total time counts
        timer.refresh()
        await pipeline(
          Readable.fromWeb(res.body as unknown as WebReadableStream),
          count,
          createWriteStream(part),
          { signal: watch }
        )
        renameSync(part, dest)
        return {
          bytes,
          mime:
            (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() ||
            'application/octet-stream'
        }
      } finally {
        clearTimeout(timer)
      }
    }
    throw downloadFailed()
  } catch (err) {
    rmSync(part, { force: true })
    if (err instanceof Ai33Error) throw err
    if (o.signal?.aborted) throw new Ai33Error('stopped', 'Stopped.', { cause: err })
    throw downloadFailed(err)
  }
}

// ------------------------------------------------------------------ finding a job again

const firstArray = (v: Ai33Raw): Ai33Raw[] => {
  if (Array.isArray(v)) return v
  for (const k of ['data', 'tasks', 'items', 'results', 'list']) {
    const inner = v?.[k]
    if (Array.isArray(inner)) return inner
    if (inner && typeof inner === 'object') {
      const deeper = firstArray(inner)
      if (deeper.length) return deeper
    }
  }
  return []
}

/** The account's recent tasks (any type), to find a job whose submit got no answer. */
export async function listRecentTasks(sinceMs: number): Promise<Ai33Raw[]> {
  const res = await request('/v1/tasks?page=1&limit=20')
  return firstArray(res).filter((t) => {
    const at = Date.parse(String(t?.created_at ?? t?.createdAt ?? ''))
    // a task whose time can't be read is kept: the text has to match too
    return Number.isNaN(at) || at >= sinceMs
  })
}

const flat = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : ''

/** Our words are compared by their first this many characters (a list shows only a preview). */
const MATCH_HEAD = 40

/**
 * Whether a listed task is the one we sent: our words at the start of its preview, or our file
 * name. A text shorter than the head must be the whole preview: "a quick whoosh" is only the
 * start of "a quick whoosh, long and deep", which is somebody else's task.
 */
function matches(task: Ai33Raw, m: NonNullable<JobSpec['match']>): boolean {
  const meta: Ai33Raw = task?.metadata ?? {}
  const previews = [
    task?.text,
    task?.prompt,
    meta.text,
    meta.prompt,
    meta.gpt_description_prompt,
    meta.description
  ].map(flat)
  const starts = (ours?: string): boolean => {
    const mine = flat(ours)
    if (!mine) return false
    return mine.length < MATCH_HEAD
      ? previews.some((p) => p === mine)
      : previews.some((p) => p.startsWith(mine.slice(0, MATCH_HEAD)))
  }
  if (starts(m.text) || starts(m.prompt)) return true
  return !!m.fileName && (meta.file_name === m.fileName || task?.file_name === m.fileName)
}

/**
 * Jobs whose submit has not been answered yet, by job: what each would recognise as its own. A
 * task that fits one of these as well as the job looking is nobody's to claim.
 */
const unanswered = new Map<string, NonNullable<JobSpec['match']>>()

/**
 * After a submit that got no answer: the one task in the account's recent list that is ours, else
 * null (none, or several: then nothing is assumed). A task already claimed by another job, or that
 * another job still waiting for its own answer would recognise too, is not a candidate.
 */
async function reconcile(entry: LedgerEntry, m: JobSpec['match']): Promise<string | null> {
  if (!m) return null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(2_500)
    try {
      const recent = await listRecentTasks(entry.submittedAt - 5_000)
      // read after the list arrives: another job's answer may have come in while it was fetched
      const claimed = new Set(list().map((e) => e.taskId))
      const rivals = [...unanswered].filter(([id]) => id !== entry.jobId).map(([, r]) => r)
      const found = recent.filter(
        (t) =>
          typeof t?.id === 'string' &&
          !claimed.has(t.id) &&
          matches(t, m) &&
          !rivals.some((r) => matches(t, r))
      )
      if (found.length === 1) return found[0].id
      if (found.length > 1) return null
    } catch {
      return null
    }
  }
  return null
}

// ------------------------------------------------------------------ the job runner

export type JobSpec = {
  kind: Ai33Kind
  /** At most 80 characters, for the ledger. */
  summary: string
  requestHash: string
  projectDir: string | null
  submit: (
    signal: AbortSignal
  ) => Promise<{ taskId: string; estimatedCredits?: number; balance?: number | null }>
  /** How long the background poller keeps going. */
  deadlineMs?: number
  /** How long the call waits before answering "still working". */
  waitBudgetMs?: number
  /** For finding the job again after an ambiguous submit. */
  match?: { text?: string; prompt?: string; fileName?: string }
}

export type RunCtx = {
  /** The person pressed Stop: cancel at ai33 too. */
  stop?: AbortSignal
  /** The project closed or the session restarted: stop polling, the job carries on. */
  detach?: AbortSignal
  onProgress?: (p: { pct: number | null; note?: string }) => void
}

export type JobOutcome =
  | {
      state: 'done'
      jobId: string
      taskId: string
      creditCost: number
      balance: number | null
      urls: Ai33Urls
      payload: Ai33Raw
      /** Answered from an identical request already made: nothing was submitted or paid for again. */
      reused?: boolean
    }
  | { state: 'working'; jobId: string; taskId: string }

type Progress = NonNullable<RunCtx['onProgress']>

/** Submit endpoints, by what is being made; a task is always polled at GET /v1/task/:id. */
export const PATHS: Record<Ai33Kind, string> = {
  speech: '/v3/text-to-speech',
  dialogue: '/v3/text-to-speech/dialogue',
  sfx: '/v1/task/sound-effect',
  music: '/v1s/task/music-generation'
}

const SECOND = 1000
const MINUTE = 60 * SECOND

/** How long the background poller keeps going for a job of each kind. */
export const DEADLINES: Record<Ai33Kind, number> = {
  speech: 20 * MINUTE,
  dialogue: 20 * MINUTE,
  music: 20 * MINUTE,
  sfx: 5 * MINUTE
}

/** How long a tool call waits before it answers "still working". */
export const WAIT_BUDGETS: Record<Ai33Kind, number> = {
  speech: 4 * MINUTE,
  dialogue: 4 * MINUTE,
  music: 6 * MINUTE,
  sfx: 90 * SECOND
}

/** Failed polls in a row before the step says it is waiting for the internet. */
const POLL_FAIL_LIMIT = 5
const SLOW_POLL_MS = 15 * SECOND
/** Progress stuck at 0 this long is shown as elapsed time only. */
const STUCK_MS = 8 * SECOND
const SUBMIT_SLOTS = 2
const SUBMIT_GAP_MS = 400

/** Time between polls: 1.5 s for the first 10 s, then 3 s to a minute, then 5 s, each ±20 percent. */
export function pollDelay(elapsedMs: number, rand: () => number = Math.random): number {
  const base = elapsedMs < 10 * SECOND ? 1500 : elapsedMs < MINUTE ? 3000 : 5000
  return jitter(base, rand)
}

// --- submits go two at a time, a little apart

const queue: (() => void)[] = []
let slots = 0
let lastSubmit = 0

/** A place in the submit line, or null when the caller stopped waiting first. */
async function enterSubmit(signal?: AbortSignal): Promise<(() => void) | null> {
  while (slots >= SUBMIT_SLOTS) {
    await new Promise<void>((resolve) => {
      const wake = (): void => {
        signal?.removeEventListener('abort', wake)
        const at = queue.indexOf(wake)
        if (at >= 0) queue.splice(at, 1)
        resolve()
      }
      queue.push(wake)
      signal?.addEventListener('abort', wake, { once: true })
    })
    if (signal?.aborted) return null
  }
  slots++
  const release = (): void => {
    slots--
    queue.shift()?.()
  }
  const gap = Math.max(0, lastSubmit + SUBMIT_GAP_MS * pace - Date.now())
  lastSubmit = Date.now() + gap
  if (gap) await sleepRaw(gap, signal)
  if (signal?.aborted) {
    release()
    return null
  }
  return release
}

// --- polling one task

type PollEnd =
  | { kind: 'done'; task: Ai33Raw }
  | { kind: 'error'; task: Ai33Raw }
  /** ai33 no longer knows the task (asked twice in a row and answered "no such task"). */
  | { kind: 'gone' }
  | { kind: 'budget' }
  | { kind: 'deadline' }
  | { kind: 'stop' }
  | { kind: 'detach' }

const endOf = (stop?: AbortSignal, detach?: AbortSignal): PollEnd | null =>
  stop?.aborted ? { kind: 'stop' } : detach?.aborted ? { kind: 'detach' } : null

const statusOf = (task: Ai33Raw): string =>
  String(task?.status ?? '')
    .trim()
    .toLowerCase()

/** ai33 documents `error`; the others are how a task that has ended badly may be worded. */
const FAILED_STATUSES = new Set(['error', 'failed', 'cancelled', 'canceled'])
const isFailed = (status: string): boolean => FAILED_STATUSES.has(status)

/** Answers in a row that say the task doesn't exist before it is taken as gone. */
const GONE_LIMIT = 2

/**
 * A poll ai33 answered by refusing it, which for a task means it isn't there (404, or a 4xx or
 * success:false about it). A 401 or 403 is about the key, not the task.
 */
const isGone = (err: unknown): boolean =>
  err instanceof Ai33Error && err.kind === 'validation' && err.status !== 401 && err.status !== 403

const fetchTask = (taskId: string, signal?: AbortSignal): Promise<Ai33Raw> =>
  request(`/v1/task/${encodeURIComponent(taskId)}`, { signal, timeoutMs: 10_000 })

/**
 * Poll a task until it is done or errored, the caller stops waiting, or the deadline passes. Any
 * status but done and the failed ones counts as still running; a failed poll is never a reason to
 * cancel the job, only to say so and slow down. A task ai33 says it doesn't have, twice in a row,
 * is gone, not "waiting for the internet".
 */
async function pollTask(
  entry: LedgerEntry,
  o: {
    /** When this caller stops waiting (Infinity in the background). */
    budgetAt: number
    deadlineAt: number
    stop?: AbortSignal
    detach?: AbortSignal
    /** Poll before the first pause (a job taken over after a while). */
    pollNow: boolean
    report: Progress
  }
): Promise<PollEnd> {
  const watch = anySignal(o.stop, o.detach)
  let fails = 0
  let missing = 0
  let lastError: unknown = null
  let noted = false
  let shown: number | null | undefined
  /** The highest progress seen: what is shown never goes back. */
  let peak = 0
  let zeroSince: number | null = null
  let first = o.pollNow
  for (;;) {
    let ended = endOf(o.stop, o.detach)
    if (ended) return ended
    if (!first) {
      const now = Date.now()
      const limit = Math.min(o.budgetAt, o.deadlineAt)
      if (now >= limit)
        return o.budgetAt <= o.deadlineAt ? { kind: 'budget' } : { kind: 'deadline' }
      const gap =
        fails >= POLL_FAIL_LIMIT ? jitter(SLOW_POLL_MS) : pollDelay(now - entry.submittedAt)
      await sleepRaw(Math.min(gap * pace, limit - now), watch)
      ended = endOf(o.stop, o.detach)
      if (ended) return ended
    }
    first = false
    let task: Ai33Raw
    try {
      task = await fetchTask(entry.taskId as string, watch)
    } catch (err) {
      if (endOf(o.stop, o.detach)) continue
      if (isGone(err)) {
        if (++missing >= GONE_LIMIT) return { kind: 'gone' }
        continue
      }
      missing = 0
      fails++
      lastError = err
      if (fails >= POLL_FAIL_LIMIT && !noted) {
        noted = true
        o.report({
          pct: shown ?? null,
          note:
            lastError instanceof Ai33Error && lastError.kind === 'auth'
              ? 'Waiting for your ai33 key…'
              : 'Waiting for the internet…'
        })
      }
      continue
    }
    fails = 0
    missing = 0
    if (noted) {
      noted = false
      o.report({ pct: shown ?? null })
    }
    const status = statusOf(task)
    if (status === 'done') return { kind: 'done', task }
    if (isFailed(status)) return { kind: 'error', task }
    // doing, or a status this version doesn't know: still running
    const raw = toInt(task?.progress)
    let pct = raw === null ? null : Math.min(99, Math.max(0, raw))
    const now = Date.now()
    if (pct === null || pct === 0) zeroSince ??= now
    else zeroSince = null
    if (pct === 0 && zeroSince !== null && now - zeroSince >= STUCK_MS) pct = null
    // ai33's numbers can wander (40, 10, 60, 0): the bar keeps the most it has reached
    if (pct !== null) peak = Math.max(peak, pct)
    if (peak > 0) pct = peak
    if (pct !== shown) {
      shown = pct
      o.report({ pct })
    }
  }
}

// --- how a task ends

const errorText = (task: Ai33Raw): string => {
  const raw = task?.error_message ?? task?.error ?? task?.metadata?.error_message
  return serverWords({ message: typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : '' })
}

/** Whether a voice service ai33 reports on is having trouble, for the kinds that use it. */
async function voiceTrouble(kind: Ai33Kind): Promise<boolean> {
  if (kind === 'music') return false
  const h = await getHealth()
  const bad = (v: Ai33Health): boolean => v === 'degraded' || v === 'overloaded'
  return kind === 'sfx' ? bad(h.elevenlabs) : bad(h.elevenlabs) || bad(h.minimax)
}

/** A done task: what it cost, what is left, where the files are; recorded in the ledger. */
async function concludeDone(
  entry: LedgerEntry,
  task: Ai33Raw
): Promise<{ creditCost: number; balance: number | null; urls: Ai33Urls }> {
  const after = await getCredits({ fresh: true })
  const creditCost =
    toInt(task?.credit_cost) ??
    (entry.balanceBefore !== null && after !== null
      ? Math.max(0, entry.balanceBefore - after)
      : (entry.estimate ?? 0))
  entry.creditCost = creditCost
  entry.state = 'done'
  let urls: Ai33Urls | null = null
  try {
    urls = resultUrls(task)
    if (!urls.audio && !urls.audios?.length) urls = null
  } catch {
    urls = null
  }
  entry.urls = urls
  if (!urls) {
    const thing = THINGS[entry.kind]
    const text = `ai33 sent back a ${thing} Luca couldn’t use, so nothing was added. ${creditCost > 0 ? `It used ${formatCredits(creditCost)} credits and is kept` : 'It is kept'}, so it won’t be paid for twice.`
    entry.error = text
    upsert(entry)
    throw new Ai33Error('unusable', text, { charged: true })
  }
  entry.error = null
  upsert(entry)
  return { creditCost, balance: after, urls }
}

/** A task that ended in error: the words for the person, with whether the credits came back. */
async function concludeError(entry: LedgerEntry, task: Ai33Raw): Promise<Ai33Error> {
  const why = errorText(task)
  const [after, busy] = await Promise.all([getCredits({ fresh: true }), voiceTrouble(entry.kind)])
  const text = [
    `ai33 couldn’t make the ${THINGS[entry.kind]}${why ? `: ${why}` : ''}.`,
    busy ? 'The voice service is having trouble right now.' : '',
    refundLine(entry.balanceBefore, after)
  ]
    .filter(Boolean)
    .join(' ')
  entry.state = 'failed'
  entry.error = text
  upsert(entry)
  return new Ai33Error('task', text, { charged: 'unknown' })
}

/**
 * The person pressed Stop: ask ai33 to drop the task (best effort; whether that stops the work or
 * returns credits is ai33's to say, so only a returned refund is ever mentioned). A task that had
 * already finished is kept for `ai33_status` to collect.
 */
async function cancelRemote(entry: LedgerEntry): Promise<Ai33Error> {
  let refund = 0
  if (entry.taskId) {
    try {
      const res = await request('/v1/task/delete', {
        json: { task_ids: [entry.taskId] },
        timeoutMs: 8_000
      })
      entry.remoteDeleted = res?.success !== false
      refund = toInt(res?.refund_credits) ?? 0
    } catch {
      // ai33 may not have been reachable: the job stays in the ledger as cancelled
    }
    try {
      const task = await fetchTask(entry.taskId, undefined)
      if (statusOf(task) === 'done') {
        const urls = resultUrls(task)
        entry.state = 'done'
        entry.urls = urls
        entry.creditCost = toInt(task?.credit_cost)
        entry.collected = false
        upsert(entry)
        return stoppedError(THINGS[entry.kind], refund)
      }
    } catch {
      // gone, or unreachable: nothing to keep
    }
  }
  entry.state = 'cancelled'
  entry.error = 'Stopped'
  upsert(entry)
  return stoppedError(THINGS[entry.kind], refund)
}

/**
 * A job with a task that will not be collected: it is `lost`, so the same request is priced and
 * asked again instead of joining a job that can never end.
 */
function giveUp(entry: LedgerEntry, text: string): void {
  entry.state = 'lost'
  entry.error = text
  upsert(entry)
}

// --- jobs that outlive their caller

/** Background pollers by job; a caller that takes a job over stops its poller. */
const pollers = new Map<string, AbortController>()
const deadlines = new Map<string, number>()

const deadlineFor = (entry: LedgerEntry): number =>
  deadlines.get(entry.jobId) ?? DEADLINES[entry.kind]

/** Keep polling a job whose caller stopped waiting, and record how it ends. */
function background(entry: LedgerEntry): void {
  if (!entry.taskId || pollers.has(entry.jobId)) return
  const own = new AbortController()
  pollers.set(entry.jobId, own)
  track(entry.jobId)
  void (async () => {
    try {
      const end = await pollTask(entry, {
        budgetAt: Infinity,
        deadlineAt: entry.submittedAt + deadlineFor(entry),
        detach: own.signal,
        pollNow: false,
        report: () => undefined
      })
      // a caller that asked for the same job again is watching it now
      if (pollers.get(entry.jobId) !== own) return
      if (end.kind === 'done') {
        try {
          await concludeDone(entry, end.task)
          emitJobEvent({ type: 'settled', entry: { ...entry }, result: 'done' })
        } catch {
          emitJobEvent({ type: 'settled', entry: { ...entry }, result: 'failed' })
        }
      } else if (end.kind === 'error') {
        await concludeError(entry, end.task)
        emitJobEvent({ type: 'settled', entry: { ...entry }, result: 'failed' })
      } else if (end.kind === 'gone') {
        giveUp(entry, goneText(THINGS[entry.kind]))
        emitJobEvent({ type: 'settled', entry: { ...entry }, result: 'failed' })
      } else if (end.kind === 'deadline') {
        entry.error = deadlineText(THINGS[entry.kind])
        upsert(entry)
        emitJobEvent({ type: 'settled', entry: { ...entry }, result: 'gave-up' })
      }
    } catch (err) {
      console.warn('[ai33] finishing a job in the background failed', plainError(err).userMessage)
    } finally {
      if (pollers.get(entry.jobId) === own) {
        pollers.delete(entry.jobId)
        deadlines.delete(entry.jobId)
        untrack(entry.jobId)
      }
    }
  })()
}

/** Stop a job's background poller because a caller is about to poll it itself. */
function takeOver(jobId: string): void {
  const own = pollers.get(jobId)
  if (!own) return
  pollers.delete(jobId)
  own.abort()
}

/**
 * Where a job stands now (asks ai33 again): its files once done, or still working. The job is not
 * marked collected here: that is for whoever saves the files (`markCollected`), so a download that
 * fails leaves the job waiting to be collected again.
 */
async function outcomeFor(entry: LedgerEntry): Promise<JobOutcome | null> {
  if (!entry.taskId || entry.state === 'lost' || entry.state === 'cancelled') return null
  if (entry.state === 'failed')
    throw new Ai33Error('task', entry.error ?? `ai33 couldn’t make the ${THINGS[entry.kind]}.`, {
      charged: 'unknown'
    })
  let task: Ai33Raw
  try {
    task = await fetchTask(entry.taskId)
  } catch (err) {
    if (entry.state === 'done' && entry.urls) return fromLedger(entry)
    if (isGone(err) && (await stillGone(entry.taskId))) {
      // ai33 doesn't have it any more: nothing will ever be collected, and the request is free to be made again
      takeOver(entry.jobId)
      untrack(entry.jobId)
      giveUp(entry, goneText(THINGS[entry.kind]))
      return null
    }
    throw plainError(err, THINGS[entry.kind])
  }
  const status = statusOf(task)
  if (status === 'done' || isFailed(status)) {
    // it has ended: nothing is left for a background poller to do
    takeOver(entry.jobId)
    untrack(entry.jobId)
  }
  if (status === 'done') {
    const d = await concludeDone(entry, task)
    return {
      state: 'done',
      jobId: entry.jobId,
      taskId: entry.taskId,
      creditCost: d.creditCost,
      balance: d.balance,
      urls: d.urls,
      payload: task
    }
  }
  if (isFailed(status)) throw await concludeError(entry, task)
  if (!pollers.has(entry.jobId)) background(entry)
  return { state: 'working', jobId: entry.jobId, taskId: entry.taskId }
}

/** Asks once more, a moment later, whether ai33 still says a task isn't there (one answer can be a blip). */
async function stillGone(taskId: string): Promise<boolean> {
  await sleep(1_500)
  try {
    await fetchTask(taskId)
    return false
  } catch (err) {
    return isGone(err)
  }
}

/** A finished job from the ledger alone (ai33 couldn't be asked): the same answer, nothing paid again. */
function fromLedger(entry: LedgerEntry): JobOutcome {
  return {
    state: 'done',
    jobId: entry.jobId,
    taskId: entry.taskId as string,
    creditCost: entry.creditCost ?? 0,
    balance: null,
    urls: entry.urls as Ai33Urls,
    payload: {},
    reused: true
  }
}

// --- running a job

/** Thrown between reading the balance and sending the request when the caller has already stopped. */
class NotSent extends Error {}

const NEVER = new AbortController().signal
const sinks = new Map<string, Set<Progress>>()

/**
 * Submit once, poll to the end (or the wait budget), and return where the result files are.
 * An identical request already running is joined, not made again; one already made (and kept at
 * ai33) is answered from the ledger. The ledger entry is written before the request leaves, so a
 * job whose answer never arrives can be found again instead of being paid for twice.
 */
export function runJob(spec: JobSpec, ctx: RunCtx): Promise<JobOutcome> {
  const hash = spec.requestHash
  const running = inflight.get(hash)
  if (running) {
    const mine = sinks.get(hash)
    if (ctx.onProgress) mine?.add(ctx.onProgress)
    return running
      .then((o): JobOutcome => (o.state === 'done' ? { ...o, reused: true } : o))
      .finally(() => {
        if (ctx.onProgress) mine?.delete(ctx.onProgress)
      })
  }
  const listeners = new Set<Progress>()
  if (ctx.onProgress) listeners.add(ctx.onProgress)
  sinks.set(hash, listeners)
  const p: Promise<JobOutcome> = execute(spec, ctx, (pr) => {
    for (const f of listeners) f(pr)
  }).finally(() => {
    if (inflight.get(hash) === p) {
      inflight.delete(hash)
      sinks.delete(hash)
    }
  })
  inflight.set(hash, p)
  return p
}

async function execute(spec: JobSpec, ctx: RunCtx, report: Progress): Promise<JobOutcome> {
  if (endOf(ctx.stop, ctx.detach)) throw stoppedError(THINGS[spec.kind])
  const hit = find(spec.requestHash)
  if (hit?.taskId && (hit.state === 'working' || hit.state === 'done')) {
    const again = await adopt(hit, spec, ctx, report)
    if (again) return again
  }
  return submitNew(spec, ctx, report)
}

/** The job this request already has at ai33: its answer, or null when ai33 no longer knows it. */
async function adopt(
  hit: LedgerEntry,
  spec: JobSpec,
  ctx: RunCtx,
  report: Progress
): Promise<JobOutcome | null> {
  const entry = { ...hit }
  takeOver(entry.jobId)
  track(entry.jobId)
  try {
    if (entry.state === 'done') {
      let task: Ai33Raw
      try {
        task = await fetchTask(entry.taskId as string, anySignal(ctx.stop, ctx.detach))
      } catch (err) {
        const e = plainError(err, THINGS[spec.kind])
        if (e.kind === 'validation') {
          // ai33 has dropped it: this request has to be made again
          entry.state = 'lost'
          entry.error = e.userMessage
          upsert(entry)
          return null
        }
        if (entry.urls) return fromLedger(entry)
        throw e
      }
      if (statusOf(task) === 'done') {
        const d = await concludeDone(entry, task)
        return {
          state: 'done',
          jobId: entry.jobId,
          taskId: entry.taskId as string,
          creditCost: d.creditCost,
          balance: d.balance,
          urls: d.urls,
          payload: task,
          reused: true
        }
      }
      entry.state = 'working'
    }
    deadlines.set(entry.jobId, spec.deadlineMs ?? DEADLINES[spec.kind])
    report({ pct: null })
    return await settle(entry, spec, ctx, report, Date.now(), true)
  } finally {
    if (!pollers.has(entry.jobId)) untrack(entry.jobId)
  }
}

/** A request with no job yet: line up, write the ledger, submit, and follow the task. */
async function submitNew(spec: JobSpec, ctx: RunCtx, report: Progress): Promise<JobOutcome> {
  const thing = THINGS[spec.kind]
  const entry: LedgerEntry = {
    jobId: randomUUID(),
    taskId: null,
    kind: spec.kind,
    requestHash: spec.requestHash,
    summary: clip(spec.summary, 80),
    projectDir: spec.projectDir,
    submittedAt: Date.now(),
    state: 'submitting',
    estimate: null,
    balanceBefore: null,
    creditCost: null,
    urls: null,
    dest: [],
    error: null,
    remoteDeleted: false,
    collected: false
  }
  track(entry.jobId)
  try {
    const release = await enterSubmit(anySignal(ctx.stop, ctx.detach))
    if (!release) throw stoppedError(thing)
    let freed = false
    const free = (): void => {
      if (!freed) release()
      freed = true
    }
    let taskId: string
    if (spec.match) unanswered.set(entry.jobId, spec.match)
    try {
      entry.submittedAt = Date.now()
      entry.balanceBefore = await getCredits()
      upsert(entry)
      // Stop, or the project closing, while the balance was read: nothing has left yet, so nothing is made
      if (endOf(ctx.stop, ctx.detach)) throw new NotSent()
      const sent = await spec.submit(ctx.stop ?? NEVER)
      if (typeof sent?.taskId !== 'string' || !sent.taskId)
        throw new Ai33Error('server', TROUBLE_SUBMIT, { charged: 'unknown' })
      taskId = sent.taskId
      entry.estimate = sent.estimatedCredits ?? null
      if (typeof sent.balance === 'number') noteCredits(sent.balance)
    } catch (err) {
      // the line moves on while ai33 is asked whether the job exists
      free()
      if (err instanceof NotSent) {
        entry.state = 'cancelled'
        entry.error = 'Stopped'
        upsert(entry)
        throw stoppedError(thing)
      }
      taskId = await recover(err, entry, spec, ctx)
    } finally {
      free()
      unanswered.delete(entry.jobId)
    }
    entry.taskId = taskId
    entry.state = 'working'
    deadlines.set(entry.jobId, spec.deadlineMs ?? DEADLINES[spec.kind])
    upsert(entry)
    // binds the chat step to this job right away, so it shows elapsed time from the start
    report({ pct: null })
    return await settle(entry, spec, ctx, report, entry.submittedAt, false)
  } finally {
    if (!pollers.has(entry.jobId)) {
      deadlines.delete(entry.jobId)
      untrack(entry.jobId)
    }
  }
}

/**
 * A submit that threw: a refusal or a full queue means no job exists; anything that may have
 * reached ai33 (the connection dropped, a 5xx, Stop pressed mid-request) is looked for in the
 * account's recent tasks and adopted only when exactly one is ours. Never repeated.
 */
async function recover(
  err: unknown,
  entry: LedgerEntry,
  spec: JobSpec,
  ctx: RunCtx
): Promise<string> {
  const e = plainError(err, THINGS[spec.kind])
  const maybe =
    e.kind === 'server' || e.kind === 'network' || (e.kind === 'stopped' && !!ctx.stop?.aborted)
  if (e.charged === false || !maybe) {
    entry.state = e.kind === 'stopped' ? 'cancelled' : 'failed'
    entry.error = e.userMessage
    upsert(entry)
    throw e.kind === 'stopped' ? stoppedError(THINGS[spec.kind]) : e
  }
  const found = await reconcile(entry, spec.match)
  if (found && e.kind === 'stopped') {
    entry.taskId = found
    entry.state = 'working'
    throw await cancelRemote(entry)
  }
  if (found) return found
  entry.state = e.kind === 'stopped' ? 'cancelled' : 'lost'
  entry.error = e.userMessage
  upsert(entry)
  throw e.kind === 'stopped' ? stoppedError(THINGS[spec.kind]) : e
}

/** Follow a job with a task until this caller's wait ends, and answer for how it ended. */
async function settle(
  entry: LedgerEntry,
  spec: JobSpec,
  ctx: RunCtx,
  report: Progress,
  waitFrom: number,
  reused: boolean
): Promise<JobOutcome> {
  const thing = THINGS[spec.kind]
  const end = await pollTask(entry, {
    budgetAt: waitFrom + (spec.waitBudgetMs ?? WAIT_BUDGETS[spec.kind]),
    deadlineAt: entry.submittedAt + (spec.deadlineMs ?? DEADLINES[spec.kind]),
    stop: ctx.stop,
    detach: ctx.detach,
    pollNow: reused,
    report
  })
  switch (end.kind) {
    case 'done': {
      const d = await concludeDone(entry, end.task)
      return {
        state: 'done',
        jobId: entry.jobId,
        taskId: entry.taskId as string,
        creditCost: d.creditCost,
        balance: d.balance,
        urls: d.urls,
        payload: end.task,
        ...(reused ? { reused: true } : {})
      }
    }
    case 'error':
      throw await concludeError(entry, end.task)
    case 'stop':
      throw await cancelRemote(entry)
    case 'gone': {
      giveUp(entry, goneText(thing))
      throw new Ai33Error('unusable', goneText(thing), { charged: 'unknown' })
    }
    case 'deadline': {
      // no poller keeps this one: left `working` it would be joined by every identical ask for good
      giveUp(entry, pastDeadlineText(thing))
      throw new Ai33Error('deadline', pastDeadlineText(thing), { charged: 'unknown' })
    }
    default:
      // the wait ran out, or the project closed: the job carries on and is followed in the background
      background(entry)
      return { state: 'working', jobId: entry.jobId, taskId: entry.taskId as string }
  }
}
