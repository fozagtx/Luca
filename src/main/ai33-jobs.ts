/**
 * The ledger of every ai33 job (`userData/ai33/jobs.json`): written before a request leaves, so
 * nothing paid for is lost or paid for twice. Pure Node (no Electron). The ledger imports nothing
 * from the client at run time: the client hands over what the ledger needs from it (`attachClient`).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ai33Kind } from '../shared/ai33'
import type { Ai33Urls, JobOutcome } from './ai33-client'

export type LedgerState = 'submitting' | 'working' | 'done' | 'failed' | 'cancelled' | 'lost'

export type LedgerEntry = {
  jobId: string
  /** Null until ai33 has answered the submit. */
  taskId: string | null
  kind: Ai33Kind
  requestHash: string
  /** At most 80 characters; never the script. */
  summary: string
  projectDir: string | null
  submittedAt: number
  state: LedgerState
  estimate: number | null
  balanceBefore: number | null
  creditCost: number | null
  urls: Ai33Urls | null
  /** Project files the result was saved to. */
  dest: string[]
  error: string | null
  remoteDeleted: boolean
  /** The result was put into a project (or handed to Luca); false while it waits to be collected. */
  collected: boolean
}

/** Requests being run right now, by request hash: an identical call joins instead of paying twice. */
export const inflight = new Map<string, Promise<JobOutcome>>()

const MAX_ENTRIES = 200
/** A job whose result was collected is forgotten after this long. */
const KEEP_COLLECTED_MS = 30 * 24 * 60 * 60 * 1000
const LOST_ON_QUIT = 'Luca was closed before ai33 answered, so this job can’t be found again.'

// ------------------------------------------------------------------ what the client provides

export type ClientHooks = {
  /** Keep a job going in the background until it ends. */
  finish: (entry: LedgerEntry) => void
  /** Where a job stands now, asking ai33 again; null when it can't be told. */
  outcome: (entry: LedgerEntry) => Promise<JobOutcome | null>
}

let dir = ''
let hooks: ClientHooks | null = null

/** Called by the client's `configure`: where the ledger lives, and how to carry a job on. */
export function attachClient(folder: string, h: ClientHooks): void {
  if (dir !== folder) entries = null
  dir = folder
  hooks = h
}

// ------------------------------------------------------------------ events

export type JobEvent =
  | { type: 'running'; count: number }
  /** A job that outlived its caller's wait has ended: done, failed, or given up on at its deadline. */
  | { type: 'settled'; entry: LedgerEntry; result: 'done' | 'failed' | 'gave-up' }

const listeners = new Set<(e: JobEvent) => void>()

/** Hears when jobs start and stop, and how the ones that ran in the background ended. */
export function onJobEvent(cb: (e: JobEvent) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function emitJobEvent(e: JobEvent): void {
  for (const cb of listeners) {
    try {
      cb(e)
    } catch (err) {
      console.warn('[ai33] a job listener failed', err instanceof Error ? err.message : err)
    }
  }
}

// ------------------------------------------------------------------ what is running now

/** Jobs this session is polling. A job left over from an earlier session is in the ledger but not here. */
const active = new Set<string>()

export function track(jobId: string): void {
  if (active.has(jobId)) return
  active.add(jobId)
  emitJobEvent({ type: 'running', count: active.size })
}

export function untrack(jobId: string): void {
  if (active.delete(jobId)) emitJobEvent({ type: 'running', count: active.size })
}

/** Jobs running at ai33 right now. */
export function runningCount(): number {
  return active.size
}

// ------------------------------------------------------------------ the file

let entries: LedgerEntry[] | null = null

const isEntry = (v: unknown): v is LedgerEntry =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as LedgerEntry).jobId === 'string' &&
  typeof (v as LedgerEntry).requestHash === 'string' &&
  typeof (v as LedgerEntry).submittedAt === 'number'

function load(): LedgerEntry[] {
  if (entries) return entries
  let raw: unknown = null
  try {
    if (dir) raw = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8'))
  } catch {
    // no ledger yet, or one that can't be read: start empty
  }
  const rows = Array.isArray(raw) ? raw : (raw as { jobs?: unknown } | null)?.jobs
  entries = (Array.isArray(rows) ? rows : []).filter(isEntry).map((e) => ({
    ...e,
    dest: Array.isArray(e.dest) ? e.dest : [],
    // a job being submitted when Luca closed has no task to look for now
    ...(e.state === 'submitting' && !e.taskId
      ? { state: 'lost' as const, error: e.error ?? LOST_ON_QUIT }
      : {})
  }))
  return entries
}

/** Oldest finished entries go first when the ledger is full; a job still running never does. */
function prune(all: LedgerEntry[]): LedgerEntry[] {
  const now = Date.now()
  const kept = all.filter((e) => !(e.collected && now - e.submittedAt > KEEP_COLLECTED_MS))
  if (kept.length <= MAX_ENTRIES) return kept
  const byAge = [...kept].sort((a, b) => a.submittedAt - b.submittedAt)
  const drop = new Set<string>()
  const settled = (e: LedgerEntry): boolean => !active.has(e.jobId) && e.state !== 'working'
  for (const e of byAge) {
    if (kept.length - drop.size <= MAX_ENTRIES) break
    if (settled(e)) drop.add(e.jobId)
  }
  return kept.filter((e) => !drop.has(e.jobId))
}

function save(): void {
  if (!dir || !entries) return
  entries = prune(entries)
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'jobs.json')
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify({ v: 1, jobs: entries }, null, 2) + '\n')
    renameSync(tmp, file)
  } catch (err) {
    // the job carries on in memory; the ledger is a safety net, not a reason to stop
    console.warn('[ai33] saving the job ledger failed', err instanceof Error ? err.message : err)
  }
}

// ------------------------------------------------------------------ the ledger

/** The entry for a request (finished, or being run), or null. */
export function find(requestHash: string): LedgerEntry | null {
  let best: LedgerEntry | null = null
  for (const e of load()) {
    if (e.requestHash !== requestHash) continue
    if (e.state !== 'submitting' && e.state !== 'working' && e.state !== 'done') continue
    if (!best || e.submittedAt > best.submittedAt) best = e
  }
  return best ? { ...best } : null
}

/** One job by its id, or null. */
export function get(jobId: string): LedgerEntry | null {
  const e = load().find((x) => x.jobId === jobId)
  return e ? { ...e } : null
}

/** Every entry, newest first. */
export function list(): LedgerEntry[] {
  return [...load()].sort((a, b) => b.submittedAt - a.submittedAt).map((e) => ({ ...e }))
}

/** Add or replace an entry (by jobId) and save the ledger. */
export function upsert(entry: LedgerEntry): void {
  const all = load()
  const copy: LedgerEntry = { ...entry, dest: [...entry.dest] }
  const at = all.findIndex((e) => e.jobId === entry.jobId)
  if (at >= 0) all[at] = copy
  else all.push(copy)
  save()
}

/** Keep polling a job that outlived its caller's wait, and record how it ends. */
export function finishInBackground(jobId: string): void {
  const entry = get(jobId)
  if (entry && hooks) hooks.finish(entry)
}

/** Where a job stands: its result files once done, or still working. Null for an unknown job. */
export function collect(jobId: string): Promise<JobOutcome | null> {
  const entry = get(jobId)
  return entry && hooks ? hooks.outcome(entry) : Promise.resolve(null)
}
