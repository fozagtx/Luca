import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, mkdirSync, rmSync, rmdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  formatCredits,
  type Ai33HealthMap,
  type Ai33Kind,
  type SavedAsset
} from '../../shared/ai33'
import type { Project } from '../../shared/types'
import { downloadTo, getCredits, getHealth, plainError, takeUrls, thingFor } from '../ai33-client'
import { collect, list, markCollected, runningCount, type LedgerEntry } from '../ai33-jobs'
import type { Ai33Ctx, Ai33Tool } from '../ai33-ctx'
import { LOW_BALANCE } from '../ai33-spend'
import { findSaved, importGenerated, savedAssets } from '../place'
import { readProject } from '../projects'
import { fail, guarded, okJson, STILL_WORKING } from './common'

/** The most saved files listed in one answer, so the first line stays a line. */
const SAVED_LIMIT = 40
/** The biggest audio file taken from ai33, the same cap as a download made while waiting. */
const AUDIO_MAX_BYTES = 300 * 1024 * 1024

/** The longest prompt shown for a saved file: it comes from a file in the project and reaches the model. */
const PROMPT_MAX = 80

const NO_PROJECT = 'No project is open.'

/** A line of text from a file or from ai33, safe to hand to the model: one line, no control characters, short. */
const oneLine = (text: unknown, max: number): string => {
  const flat = String(text ?? '')
    .replace(/\p{Cf}+/gu, '')
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max
    ? `${Array.from(flat)
        .slice(0, max - 1)
        .join('')}…`
    : flat
}

const PLACE =
  'The files are saved in the project but not on the timeline. To put one there, call audio_place with its file and a role (voice, music or sfx); it costs no credits. Report what was saved, never how it sounds.'

const health = async (): Promise<Ai33HealthMap> => {
  try {
    return await getHealth()
  } catch {
    return { elevenlabs: 'unknown', minimax: 'unknown' }
  }
}

const balance = async (fresh: boolean): Promise<number | null> => {
  try {
    return await getCredits({ fresh })
  } catch {
    return null
  }
}

/** What ai33 is called for a person: credits, the account. Never the companies behind the voices. */
async function credits(): Promise<CallToolResult> {
  const [left, busy] = await Promise.all([getCredits({ fresh: true }), health()])
  const strained = Object.values(busy).some((h) => h === 'degraded' || h === 'overloaded')
  const tell =
    left === null
      ? 'ai33 didn’t answer, so the credits couldn’t be checked. Say so in one short sentence and do not guess a number.'
      : [
          `The user has ${formatCredits(left)} credits left. Say credits, never dollars.`,
          left < LOW_BALANCE
            ? 'That is low: mention it once, and that they can add credits with ai33.'
            : '',
          strained
            ? 'The voice service is busy right now, so voices, sound effects and music may be slow or fail. Never name the companies behind them.'
            : ''
        ]
          .filter(Boolean)
          .join(' ')
  return okJson({
    ok: true,
    kind: 'status',
    credits: left,
    health: busy,
    running: runningCount(),
    tell
  })
}

/** What is saved in this project: local files only, so it works with no key and no internet. */
function saved(projectDir: string): CallToolResult {
  try {
    const p = readProject(projectDir)
    if (!p) return fail(NO_PROJECT)
    const all = savedAssets(p)
    const listed = all.slice(0, SAVED_LIMIT).map((a) => ({
      file: a.file,
      kind: a.kind,
      prompt: oneLine(a.prompt, PROMPT_MAX),
      seconds: a.seconds,
      placedId: a.placedId
    }))
    const tell = all.length
      ? [
          `${all.length} generated ${all.length === 1 ? 'file is' : 'files are'} saved in this project.`,
          'To put one back on the timeline (after an undo, or to swap a take), call audio_place with its file; it costs no credits, so use it before making anything again.',
          'One with a placedId is already on the timeline.',
          all.length > listed.length ? `Only the first ${listed.length} are listed.` : ''
        ]
          .filter(Boolean)
          .join(' ')
      : 'Nothing generated is saved in this project yet.'
    return okJson({ ok: true, kind: 'status', running: runningCount(), saved: listed, tell })
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

const savedKind = (kind: Ai33Kind): SavedAsset['kind'] => (kind === 'dialogue' ? 'speech' : kind)

const slugOf = (text: string, fallback: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback

/**
 * A finished job's files as project files. Files the background poller (or an earlier collect)
 * already saved are used as they are; otherwise they are downloaded now and checked before they
 * are kept. Only as many links as the job makes are followed, whatever ai33 lists.
 */
async function bringIn(
  p: Project,
  entry: LedgerEntry,
  urls: { audio?: string; audios?: string[] },
  signal: AbortSignal
): Promise<string[]> {
  const inProject = (file: string): string => relative(p.dir, resolve(p.dir, file))
  if (entry.dest.length && entry.dest.every((f) => existsSync(resolve(p.dir, f))))
    return entry.dest.map(inProject)
  const from = takeUrls(entry.kind, urls)
  if (!from.length) return []
  const kind = savedKind(entry.kind)
  const have = findSaved(p.dir, kind, entry.requestHash)
  if (have.length >= from.length) return have

  const incoming = join(p.dir, 'media', 'generated', '.incoming')
  mkdirSync(incoming, { recursive: true })
  const files: string[] = []
  try {
    for (const [i, url] of from.entries()) {
      const tmp = join(incoming, `${entry.jobId}-${i + 1}`)
      try {
        await downloadTo(url, tmp, { signal, maxBytes: AUDIO_MAX_BYTES })
        // each take is its own file, so each needs its own hash
        const one = await importGenerated(p, kind, tmp, {
          slug: slugOf(entry.summary, entry.kind),
          hash: i === 0 ? entry.requestHash : `${entry.requestHash}-${i + 1}`,
          prompt: entry.summary
        })
        files.push(one.rel)
      } finally {
        rmSync(tmp, { force: true })
      }
    }
  } finally {
    try {
      rmdirSync(incoming)
    } catch {
      // other files are still arriving, or it is already gone
    }
  }
  return files
}

/** Bring in jobs that finished after the tool stopped waiting: the one named, else every one waiting. */
async function collectJobs(
  projectDir: string,
  job: string | undefined,
  signal: AbortSignal
): Promise<CallToolResult> {
  const p = readProject(projectDir)
  if (!p) return fail(NO_PROJECT)

  const mine = list().filter((e) => e.projectDir === p.dir)
  const wanted = job
    ? mine.filter((e) => e.jobId === job)
    : mine.filter((e) => !e.collected && ['submitting', 'working', 'done'].includes(e.state))
  if (job && !wanted.length)
    return fail(
      'Luca can’t find that job in this project. Call ai33_status with what set to saved to see what is already saved.'
    )
  if (!wanted.length)
    return okJson({
      ok: true,
      kind: 'status',
      running: runningCount(),
      tell: 'Nothing is waiting to be collected. Call ai33_status with what set to saved to see what is already saved in this project.'
    })

  const files: string[] = []
  let cost = 0
  let still: string | null = null
  const failed: string[] = []
  // a job whose files couldn't be saved is left waiting: collecting again costs nothing
  let kept = false
  for (const entry of wanted) {
    if (entry.state === 'failed' || entry.state === 'cancelled' || entry.state === 'lost') {
      failed.push(entry.error ?? 'ai33 couldn’t finish it')
      continue
    }
    let outcome: Awaited<ReturnType<typeof collect>>
    try {
      outcome = await collect(entry.jobId)
    } catch (err) {
      const e = plainError(err, thingFor(entry.kind))
      if (e.kind === 'stopped') throw e
      failed.push(e.userMessage)
      // ai33 couldn't be reached: the job is still there; a task that ended badly is not
      if (['network', 'server', 'rate', 'auth'].includes(e.kind)) kept = true
      continue
    }
    if (!outcome) {
      failed.push('ai33 has no record of it')
    } else if (outcome.state === 'working') {
      still ??= entry.jobId
    } else {
      try {
        const got = await bringIn(p, entry, outcome.urls, signal)
        if (!got.length) {
          failed.push('ai33 sent nothing to save')
          continue
        }
        files.push(...got)
        cost += outcome.creditCost
        // only now is it collected; the row keeps its files at ai33 and its cost as they were
        markCollected(entry.jobId, got)
      } catch (err) {
        const e = plainError(err, thingFor(entry.kind))
        if (e.kind === 'stopped') throw e
        // it is made and paid for, and stays waiting to be collected again
        failed.push(e.userMessage)
        kept = true
      }
    }
  }

  const running = runningCount()
  if (!files.length && still)
    return okJson({
      ok: true,
      kind: 'status',
      working: true,
      task: still,
      running,
      tell: `${STILL_WORKING} Do not start it again; ask ai33_status to collect it later.`
    })
  if (!files.length) {
    const why = (failed[0] ?? 'ai33 couldn’t finish it').replace(/[.\s]+$/, '')
    return fail(
      kept
        ? `${why}. Nothing was added. Say so in one short sentence, and that it is kept, so collecting it again later costs nothing.`
        : `${why}. Nothing was added. Say so in one short sentence and do not try again.`
    )
  }

  const left = await balance(false)
  return okJson({
    ok: true,
    kind: 'status',
    credits: left,
    running,
    collected: { files, credits: cost },
    place: PLACE,
    tell: [
      `Saved ${files.length} ${files.length === 1 ? 'file' : 'files'} (${formatCredits(cost)} credits).`,
      still ? 'Another job is still being made; it can be collected later.' : '',
      failed.length
        ? kept
          ? 'Another job couldn’t be saved; it is kept and can be collected again later. Say so once.'
          : 'Another job did not finish; say so once.'
        : ''
    ]
      .filter(Boolean)
      .join(' ')
  })
}

/** ai33_status, for the ai33 MCP server (mcp-ai33.ts). */
export function statusTools(ctx: Ai33Ctx, projectDir: string): Ai33Tool[] {
  return [
    tool(
      'ai33_status',
      'Credits, what is saved in this project, or collect a job that finished after you stopped waiting. Free.',
      {
        what: z
          .enum(['credits', 'saved', 'collect'])
          .default('credits')
          .describe(
            'credits: what is left and whether the voice services are busy. saved: the sound files already made for this project, to put back with audio_place after an undo. collect: bring in a job that finished after you stopped waiting'
          ),
        job: z
          .string()
          .optional()
          .describe(
            'collect only: the task a "still working" result gave you; leave out to collect every finished job'
          )
      },
      async ({ what, job }, extra) => {
        // what is saved is local, so it needs no key and never shows the connect card
        if (what === 'saved') return saved(projectDir)
        return guarded(ctx, 'ai33_status', extra, (g) =>
          what === 'collect' ? collectJobs(projectDir, job, g.signal) : credits()
        )
      },
      {
        searchHint:
          'ai33 credits left balance, saved generated audio, collect a finished voiceover music or sound effect'
      }
    )
  ]
}
