/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * The ai33 HTTP client and the one job runner every capability goes through: submit, poll,
 * download, ledger, cancel, failure copy. Pure Node (no Electron: the smoke script bundles it);
 * the key and the data folder are given to it by `configure`.
 */
import type { Ai33HealthMap, Ai33Kind, Ai33Raw } from '../shared/ai33'

export function configure(_c: {
  baseUrl: string
  getKey: () => string | null
  dataDir: string
}): void {
  throw new Error('not implemented')
}

/** Where ai33 keeps this app's files (jobs.json, rates.json, cache/), from `configure`. */
export function dataDir(): string {
  throw new Error('not implemented')
}

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

/** Any error as an Ai33Error, in words for the person; `thing` names what was being made. */
export function plainError(_err: unknown, _thing?: string): Ai33Error {
  throw new Error('not implemented')
}

/** One request to ai33 (JSON or multipart form) with the key; the answer parsed, or an Ai33Error. */
export function request(
  _path: string,
  _o?: {
    method?: string
    json?: unknown
    form?: () => Promise<FormData>
    signal?: AbortSignal
    timeoutMs?: number
  }
): Promise<Ai33Raw> {
  throw new Error('not implemented')
}

/** Credits left, or null when unreadable; cached briefly unless `fresh`. */
export function getCredits(_o?: { fresh?: boolean }): Promise<number | null> {
  throw new Error('not implemented')
}

/** How busy the voice services are (cached for a minute). */
export function getHealth(): Promise<Ai33HealthMap> {
  throw new Error('not implemented')
}

/** A whole number from a number or numeric string (ai33 sends both), else null. */
export function toInt(_v: unknown): number | null {
  throw new Error('not implemented')
}

/** Where a finished task's files are. */
export type Ai33Urls = {
  audio?: string
  audios?: string[]
  srt?: string
  json?: string
}

/** The result files of a finished task, wherever its type puts them; an Ai33Error('unusable') if none. */
export function resultUrls(_task: Ai33Raw): Ai33Urls {
  throw new Error('not implemented')
}

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
    }
  | { state: 'working'; jobId: string; taskId: string }

/** Submit once, poll to the end (or the wait budget), and return where the result files are. */
export function runJob(_spec: JobSpec, _ctx: RunCtx): Promise<JobOutcome> {
  throw new Error('not implemented')
}

/** Download a result file (https only, the key never sent to another host). */
export function downloadTo(
  _url: string,
  _dest: string,
  _o: { signal?: AbortSignal; maxBytes: number }
): Promise<{ bytes: number; mime: string }> {
  throw new Error('not implemented')
}

/** The account's recent tasks (any type), to find a job whose submit got no answer. */
export function listRecentTasks(_sinceMs: number): Promise<Ai33Raw[]> {
  throw new Error('not implemented')
}

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
