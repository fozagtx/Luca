/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * The ledger of every ai33 job (`userData/ai33/jobs.json`): written before a request leaves, so
 * nothing paid for is lost or paid for twice. Pure Node (no Electron).
 */
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

/** The entry for a request (finished, or being run), or null. */
export function find(_requestHash: string): LedgerEntry | null {
  throw new Error('not implemented')
}

/** Every entry, newest first. */
export function list(): LedgerEntry[] {
  throw new Error('not implemented')
}

/** Add or replace an entry (by jobId) and save the ledger. */
export function upsert(_entry: LedgerEntry): void {
  throw new Error('not implemented')
}

/** Jobs running at ai33 right now. */
export function runningCount(): number {
  throw new Error('not implemented')
}

/** Keep polling a job that outlived its caller's wait, and download it into its project when done. */
export function finishInBackground(_jobId: string): void {
  throw new Error('not implemented')
}

/** Where a job stands: its result files once done, or still working. Null for an unknown job. */
export function collect(_jobId: string): Promise<JobOutcome | null> {
  throw new Error('not implemented')
}
