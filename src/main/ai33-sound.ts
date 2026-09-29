/**
 * Music and sound effects: make them at ai33, save them in the project and (unless told not to)
 * put them on the timeline. Whether to spend is decided by the tool before it calls these.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  formatCredits,
  type Ai33Raw,
  type Grant,
  type MusicReq,
  type MusicResult,
  type Placed,
  type SfxReq,
  type SfxResult
} from '../shared/ai33'
import type { Project } from '../shared/types'
import {
  Ai33Error,
  DEADLINES,
  PATHS,
  WAIT_BUDGETS,
  downloadTo,
  getCredits,
  plainError,
  request,
  runJob,
  toInt,
  type Ai33ErrorKind
} from './ai33-client'
import type { MakeCtx, ProgressFn, SpendCtx } from './ai33-ctx'
import { find, inflight, markCollected } from './ai33-jobs'
import { holdSpend, lostRecently, mayHaveBeenCharged, settleSpend } from './ai33-spend'
import { findTags } from './html'
import {
  findSaved,
  fitAudio,
  importGenerated,
  measureLevel,
  MUSIC_FADE_IN,
  MUSIC_FADE_OUT,
  placeAudio,
  probeAudio,
  SFX_VOLUME
} from './place'

/** A take this much shorter than the video is joined with the other one; less is left as it is. */
export const BED_FIT_SLACK = 3
/** An effect starts this early, so its first hit lands on the moment it was made for. */
export const SFX_LEAD = 0.1
/** Effects made at once. */
export const CONCURRENCY = 2

/** Used only if the level can't be measured (measureLevel normally handles a missing voice). */
const FALLBACK_VOLUME = 0.15
/** The longest effect ai33 makes in one go; anything longer is tiled from it. */
const SFX_LONGEST = 30
const SFX_DEFAULT_SECONDS = 2
/** The least a bed of music may run for. */
const MIN_BED = 1
/** A take within this of the wanted length counts as the right length. */
const FIT_EPSILON = 0.5
/** ai33 returns two takes; more than that are not kept. */
const MAX_TAKES = 2
const MAX_AUDIO_BYTES = 300 * 1024 * 1024
/** An error that would repeat for every effect: no point trying the rest. */
const HALTING: Ai33ErrorKind[] = ['auth', 'credits', 'rate']

// ------------------------------------------------------------------ small helpers

const hashOf = (...parts: unknown[]): string =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex')

const r1 = (n: number): number => Math.round(n * 10) / 10
/** 4.25 → "4.3 s": a time as Luca is told it. */
export const secs = (n: number): string => `${r1(n)} s`

/** A file-name-safe slug of the first words of `text`. */
function slugOf(text: string, fallback: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '')
  return s || fallback
}

/** Words that end a clip's name: "whoosh as the title lands" is just "Whoosh". */
const CONNECTORS =
  /\s+(?:as|when|while|with|on|for|over|under|that|of|and|in|into|to|from|at|by)\b/i

/** A short name for a clip on the timeline, from the words it was made from. */
function titleOf(text: string, words: number, fallback: string): string {
  const head = (text.split(/[,;:.!?()\n]/)[0] ?? '').split(CONNECTORS)[0] ?? ''
  const title = head
    .trim()
    .replace(/^(?:an?|the|some)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words)
    .join(' ')
  return title ? title[0].toUpperCase() + title.slice(1) : fallback
}

const stopped = (c: MakeCtx): boolean => c.signal.aborted || c.stop?.aborted === true

/** The credits left: what the runner read when the job finished, else what ai33 says now. */
async function creditsLeft(known: number | null): Promise<number | null> {
  if (known !== null) return known
  try {
    return await getCredits()
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ errors

/**
 * A failure after credits were spent (a finished job whose file was no good, or a stop after
 * some effects were done): the tool settles the spend with `credits`.
 */
export class SoundError extends Ai33Error {
  readonly credits: number

  constructor(
    kind: Ai33ErrorKind,
    userMessage: string,
    credits: number,
    o: { status?: number; charged?: boolean | 'unknown'; cause?: unknown } = {}
  ) {
    super(kind, userMessage, { ...o, charged: credits > 0 ? true : o.charged })
    this.name = 'SoundError'
    this.credits = credits
  }
}

/** What went wrong in plain words: ai33's own message, or the plain sentence a local check gave. */
const reasonOf = (err: unknown): string =>
  err instanceof Ai33Error ? err.userMessage : err instanceof Error ? err.message : String(err)

/** Any error, with the credits already spent on it. */
function carry(err: unknown, credits: number, thing?: string): SoundError {
  const e = err instanceof Ai33Error ? err : plainError(err, thing)
  return new SoundError(e.kind, e.userMessage, credits, {
    status: e.status,
    charged: e.charged,
    cause: err
  })
}

/** `spend` hands back a Grant, or the result to return instead (declined, too dear, over a cap). */
export const isGrant = (r: Grant | CallToolResult): r is Grant => 'reserved' in r

/**
 * What a failed call cost, to settle its spend with: what the error itself counted, nothing when
 * the job never started or ai33 refunds it (a failed task, a stop), and the estimate when it may
 * have been charged (a submit that got no answer). A SoundError is looked through: it only wraps
 * the failure, so it must not hand back the place a possibly-charged call took in the turn's caps.
 */
export function spentOnFailure(err: unknown, grant: Grant): number {
  if (err instanceof SoundError && err.credits > 0) return err.credits
  return mayHaveBeenCharged(err) ? grant.reserved : 0
}

/** Settle a failed call's spend: what it cost, or held as it is when that can't be known. */
export function settleFailure(ctx: SpendCtx, grant: Grant, err: unknown): void {
  const spent = spentOnFailure(err, grant)
  if (spent === 0 && mayHaveBeenCharged(err)) holdSpend(ctx, grant)
  else settleSpend(ctx, grant, spent)
}

/** What Luca is told to say about the cost of a job (credits, never dollars), as a clause. */
export function costClause(credits: number, left: number | null, reused: boolean): string {
  return reused
    ? 'that it was already made, so it used no credits'
    : `that it used ${formatCredits(credits)} credits${left === null ? '' : ` (${formatCredits(left)} left)`}`
}

/** Said to Luca when the balance is getting low, so it mentions it once. */
export const lowNote = (left: number | null): string =>
  left !== null && left < 1000 ? ' Credits are running low: mention that once.' : ''

/** ai33 finished, but its file could not be saved. `thing` reads "music" or "a sound effect". */
function unusable(thing: string, credits: number): SoundError {
  const kept =
    credits > 0
      ? ` It used ${formatCredits(credits)} credits and is kept, so it won’t be paid for twice.`
      : ''
  return new SoundError(
    'unusable',
    `ai33 sent back ${thing} Luca couldn’t use, so nothing was added.${kept}`,
    credits
  )
}

/**
 * Something went wrong after ai33 finished, so the credits are spent. Stop and a download that
 * failed keep their own words; a file that came back but couldn't be used says so.
 */
function failedAfterDone(
  err: unknown,
  thing: string,
  credits: number,
  wasStopped: boolean
): SoundError {
  return wasStopped || err instanceof Ai33Error
    ? carry(err, credits, thing)
    : unusable(thing, credits)
}

/** What ai33 answers a submit with: the task, and how many credits are left after paying. */
function submitted(r: Ai33Raw, thing: string): { taskId: string; balance: number | null } {
  const id: unknown = r?.task_id
  if (typeof id !== 'string' && typeof id !== 'number')
    throw new Ai33Error('server', `ai33 didn’t start the ${thing}.`, { charged: 'unknown' })
  return { taskId: String(id), balance: toInt(r.ec_remain_credits) }
}

// ------------------------------------------------------------------ the video, and jobs already known

/** How long the video is (the root composition's length), 0 when unreadable. */
export function videoLength(dir: string): number {
  try {
    const root = findTags(readFileSync(join(dir, 'index.html'), 'utf8')).find(
      (t) => t.attrs['data-composition-id'] !== undefined
    )
    return Number(root?.attrs['data-duration'] ?? 0) || 0
  } catch {
    return 0
  }
}

/**
 * Where music goes: from a time to the end of the video (never past it), or why there is
 * no room for it. Nothing here spends anything, so callers can check before asking to spend.
 */
export function musicRange(
  dir: string,
  from: number,
  to?: number
): { from: number; to: number } | string {
  const end = videoLength(dir)
  if (!(end > 0)) return 'This video has no length yet, so there is nothing to put music under.'
  const start = Math.max(0, Number.isFinite(from) ? from : 0)
  const stop = Math.min(to !== undefined && Number.isFinite(to) ? to : end, end)
  if (start > end - MIN_BED)
    return `The video is ${secs(end)} long, so there is no room for music from ${secs(start)}.`
  if (stop - start < MIN_BED)
    return `Music has to run for at least ${secs(MIN_BED)}, and this asks for ${secs(start)} to ${secs(stop)}.`
  return { from: start, to: stop }
}

/**
 * ai33 already has this request (a finished job, or one being made), so the runner answers from
 * it and submits nothing: asking again costs nothing.
 */
function jobKnown(hash: string): boolean {
  if (inflight.has(hash)) return true
  const e = find(hash)
  return e !== null && e.taskId !== null && (e.state === 'working' || e.state === 'done')
}

/**
 * The runner found nothing to answer from (ai33 dropped the job) and would submit a new one:
 * that spends credits nobody agreed to, so it does not. Asking again goes through the price check.
 */
const notAsked = (thing: string): Ai33Error =>
  new Ai33Error(
    'validation',
    `ai33 no longer has that ${thing}, so Luca didn’t make it again without asking. Ask for it again and the price will be checked first.`,
    { charged: false }
  )

type Saved = { rel: string; abs: string }
type Take = Saved & { seconds: number }

const extOf = (url: string): string => {
  try {
    return /\.(?:mp3|m4a|wav|ogg|opus|aac|flac)$/i.exec(new URL(url).pathname)?.[0] ?? '.mp3'
  } catch {
    return '.mp3'
  }
}

/** Download a result file, check it and save it in the project; the temporary file never stays. */
async function saveFile(
  c: MakeCtx,
  url: string,
  kind: 'music' | 'sfx',
  o: { slug: string; hash: string; prompt: string }
): Promise<Saved & { seconds?: number }> {
  const dir = join(c.project.dir, '.luca', 'cache', 'ai33', 'incoming')
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `${o.hash}${extOf(url)}`)
  try {
    await downloadTo(url, tmp, { signal: c.signal, maxBytes: MAX_AUDIO_BYTES })
    // importGenerated checks the file and writes its line in CREDITS.txt
    return await importGenerated(c.project, kind, tmp, o)
  } finally {
    rmSync(tmp, { force: true })
    rmSync(`${tmp}.part`, { force: true })
  }
}

// ------------------------------------------------------------------ music

const cleanMood = (mood: string): string => mood.replace(/\s+/g, ' ').trim().slice(0, 500)
const musicHash = (mood: string, instrumental: boolean): string =>
  hashOf('music', 'simple', mood, instrumental)
/**
 * What names a take's file: the request's hash for the first, the hash and the take's number for
 * the next, so the takes of one request never share a file (the same names a job that finished
 * in the background is saved under, and place.ts keeps a dash and what follows it).
 */
const takeHash = (hash: string, n: number): string =>
  n === 1 ? hash.slice(0, 10) : `${hash.slice(0, 10)}-${n}`

/** The takes already saved in this project for a request that are still readable, first take first. */
async function savedTakes(p: Project, hash: string): Promise<Take[]> {
  const head = hash.slice(0, 10)
  const first = new RegExp(`-${head}\\.[a-z0-9]+$`)
  const found = findSaved(p.dir, 'music', head)
    .sort((a, b) => Number(!first.test(a)) - Number(!first.test(b)))
    .slice(0, MAX_TAKES)
  const out: Take[] = []
  for (const rel of found) {
    const abs = join(p.dir, rel)
    try {
      out.push({ rel, abs, seconds: (await probeAudio(abs)).seconds })
    } catch {
      // a saved file that can't be read counts as not saved
    }
  }
  return out
}

/** The ids of other music on the timeline that plays at the same time as `placed`. */
export function musicAlongside(dir: string, placed: Placed): string[] {
  try {
    return findTags(readFileSync(join(dir, 'index.html'), 'utf8'), 'audio')
      .filter((t) => t.attrs['data-luca-role'] === 'music' && t.attrs.id !== placed.id)
      .filter((t) => {
        const start = Number(t.attrs['data-start']) || 0
        return start < placed.end && start + (Number(t.attrs['data-duration']) || 0) > placed.start
      })
      .map((t) => t.attrs.id ?? '')
      .filter(Boolean)
  } catch {
    return []
  }
}

/** This music was asked for a moment ago and ai33 never answered: asking again is asked about first. */
export const musicLostRecently = (req: MusicReq): boolean =>
  lostRecently(musicHash(cleanMood(req.mood), req.instrumental))

/** Asking for this music again costs nothing: it is saved here, or ai33 already has the job. */
export async function musicIsFree(req: MusicReq, p: Project): Promise<boolean> {
  const hash = musicHash(cleanMood(req.mood), req.instrumental)
  return (await savedTakes(p, hash)).length > 0 || jobKnown(hash)
}

/**
 * Instrumental music: both takes saved, the first under the video (unless `place` is false).
 * A new job is only submitted when `approved` says the spend was agreed to (or is covered);
 * without it the request is answered from what is saved or what ai33 already has, or refused.
 */
export async function makeMusic(
  req: MusicReq,
  c: MakeCtx,
  o: { approved?: boolean } = {}
): Promise<MusicResult> {
  const p = c.project
  const mood = cleanMood(req.mood)
  const range = req.place ? musicRange(p.dir, req.from, req.to) : null
  if (typeof range === 'string') throw new Ai33Error('validation', range, { charged: false })

  const hash = musicHash(mood, req.instrumental)
  const slug = slugOf(titleOf(mood, 4, 'music'), 'music')
  let takes = await savedTakes(p, hash)
  let reused = takes.length > 0
  let credits = 0
  let balance: number | null = null

  if (!reused) {
    const out = await runJob(
      {
        kind: 'music',
        summary: `Music: ${mood}`.slice(0, 80),
        requestHash: hash,
        projectDir: p.dir,
        submit: async (signal) => {
          if (!o.approved) throw notAsked('music')
          return submitted(
            await request(PATHS.music, {
              method: 'POST',
              json: {
                create_mode: 'simple',
                gpt_description_prompt: mood,
                make_instrumental: req.instrumental
              },
              signal
            }),
            'music'
          )
        },
        deadlineMs: DEADLINES.music,
        waitBudgetMs: WAIT_BUDGETS.music,
        match: { text: mood, prompt: mood }
      },
      { stop: c.stop, detach: c.signal, onProgress: c.onProgress }
    )
    if (out.state === 'working')
      return {
        files: [],
        seconds: [],
        credits: 0,
        left: await creditsLeft(null),
        reused: false,
        fitted: 'exact',
        placed: null,
        working: { jobId: out.jobId }
      }
    reused = out.reused === true
    credits = reused ? 0 : out.creditCost
    balance = out.balance
    c.onProgress?.({ pct: null, note: 'Saving it to your project' })

    // both takes are kept; one that can't be saved doesn't lose the other
    const urls = [
      ...new Set([...(out.urls.audios ?? []), ...(out.urls.audio ? [out.urls.audio] : [])])
    ].slice(0, MAX_TAKES)
    takes = []
    let firstError: unknown
    for (const [i, url] of urls.entries()) {
      try {
        const saved = await saveFile(c, url, 'music', {
          slug: i ? `${slug}-${i + 1}` : slug,
          hash: takeHash(hash, i + 1),
          prompt: mood
        })
        takes.push({ ...saved, seconds: saved.seconds ?? (await probeAudio(saved.abs)).seconds })
      } catch (e) {
        if (stopped(c)) throw carry(e, credits, 'music')
        firstError ??= e
      }
    }
    if (!takes.length) throw failedAfterDone(firstError, 'music', credits, false)
    // the files are saved, so the ledger no longer needs to hand this job out
    markCollected(
      out.jobId,
      takes.map((t) => t.rel)
    )
  }

  const left = await creditsLeft(balance)
  const files = takes.map((t) => t.rel)
  const seconds = takes.map((t) => r1(t.seconds))
  if (!range) return { files, seconds, credits, left, reused, fitted: 'exact', placed: null }

  // the bed runs from `from` to the end of the video and never past it
  const want = range.to - range.from
  let bed: Take = takes[0]
  let fitted: MusicResult['fitted'] = 'exact'
  if (bed.seconds < want - BED_FIT_SLACK) {
    try {
      const rel = await fitAudio({
        project: p,
        kind: 'music',
        files,
        seconds: want,
        slug,
        hash: hashOf(hash, 'fit', r1(want)).slice(0, 10)
      })
      const abs = join(p.dir, rel)
      bed = { rel, abs, seconds: (await probeAudio(abs)).seconds }
      fitted = 'joined'
    } catch (e) {
      // the take as it is (a little short of the video) still beats no music
      if (stopped(c)) throw carry(e, credits, 'music')
    }
  } else if (bed.seconds > want + FIT_EPSILON) fitted = 'trimmed'

  let volume = FALLBACK_VOLUME
  try {
    const measured = await measureLevel(p, bed.rel, req.level)
    if (Number.isFinite(measured) && measured > 0) volume = measured
  } catch {
    // no measurement (an odd file, no ffmpeg): the standard quiet level
  }

  const length = Math.min(want, bed.seconds)
  let placed: Placed
  try {
    placed = await placeAudio(p, {
      file: bed.rel,
      role: 'music',
      start: range.from,
      until: range.from + length,
      volume,
      fadeIn: MUSIC_FADE_IN,
      fadeOut: MUSIC_FADE_OUT,
      mediaStart: 0,
      title: titleOf(mood, 3, 'Music'),
      extendRoot: false
    })
  } catch (e) {
    if (stopped(c)) throw carry(e, credits, 'music')
    const why = reasonOf(e).replace(/[.\s]+$/, '')
    const spent = credits > 0 ? ` It used ${formatCredits(credits)} credits.` : ''
    throw new SoundError(
      'unusable',
      `The music is saved (${files.join(', ')}), but Luca couldn’t put it on the timeline: ${why}.${spent} Put it on with audio_place instead of making it again.`,
      credits
    )
  }
  return { files, seconds, credits, left, reused, fitted, placed }
}

// ------------------------------------------------------------------ sound effects

/** The exact price of one effect: 50 credits a second, at least 50 (whole seconds only). */
export const sfxCredits = (seconds: number): number => Math.max(50, 50 * Math.round(seconds))

/** One effect to place: where, how long, how loud, and which generation it comes from. */
export type SfxItem = {
  what: string
  at: number
  /** How long it plays on the timeline, in whole seconds. */
  length: number
  level: number
  /** The generation it comes from (`SfxJob.key`). */
  job: string
}

/** One effect to make at ai33. Effects that ask for the same sound share a job. */
export type SfxJob = {
  key: string
  what: string
  /** Whole seconds asked of ai33 (at most 30, the price is 50 a second). */
  seconds: number
  loop: boolean
  requestHash: string
  /** What names the saved file. */
  hash: string
  /** Saved here already, or ai33 already has it: nothing to pay. */
  reuse: boolean
}

/** What a sound-effect request comes to: the effects, the distinct jobs behind them, and what is free. */
export function planSfx(req: SfxReq, p: Project): { items: SfxItem[]; jobs: SfxJob[] } {
  const jobs = new Map<string, SfxJob>()
  const items: SfxItem[] = []
  for (const e of req.effects) {
    const what = e.what.replace(/\s+/g, ' ').trim().slice(0, 450)
    if (!what) continue
    const asked = Number.isFinite(e.seconds) ? e.seconds : SFX_DEFAULT_SECONDS
    const length = Math.max(1, Math.round(asked))
    const seconds = Math.min(length, SFX_LONGEST)
    const loop = e.loop === true
    const key = `${what}|${seconds}|${loop}`
    if (!jobs.has(key)) {
      const requestHash = hashOf('sfx', what, seconds, loop)
      const hash = requestHash.slice(0, 10)
      jobs.set(key, {
        key,
        what,
        seconds,
        loop,
        requestHash,
        hash,
        reuse: findSaved(p.dir, 'sfx', hash).length > 0 || jobKnown(requestHash)
      })
    }
    items.push({
      what,
      at: Number.isFinite(e.at) ? Math.max(0, e.at) : 0,
      length,
      level: Number.isFinite(e.level) ? Math.min(1, Math.max(0, e.level)) : SFX_VOLUME,
      job: key
    })
  }
  return { items, jobs: [...jobs.values()] }
}

/** One of these effects was asked for a moment ago and ai33 never answered: asking again is asked about first. */
export const sfxLostRecently = (jobs: SfxJob[]): boolean =>
  jobs.some((j) => !j.reuse && lostRecently(j.requestHash))

type Made = {
  file?: Saved
  /** What the job really cost (0 when reused or refunded, or when it failed). */
  credits: number
  balance?: number | null
  /** Still being made at ai33 when the wait ran out. */
  working?: string
  err?: Ai33Error
}

/** One effect: from the project if it is saved, else made at ai33, downloaded and saved. Never throws. */
async function makeOne(
  job: SfxJob,
  c: MakeCtx,
  onProgress: ProgressFn,
  approved: boolean
): Promise<Made> {
  const dir = c.project.dir
  const onHand = findSaved(dir, 'sfx', job.hash)[0]
  if (onHand) return { file: { rel: onHand, abs: join(dir, onHand) }, credits: 0 }
  try {
    const out = await runJob(
      {
        kind: 'sfx',
        summary: `Sound effect: ${job.what}`.slice(0, 80),
        requestHash: job.requestHash,
        projectDir: dir,
        submit: async (signal) => {
          // effects that were free (saved, or ai33 had them) were never priced or asked about
          if (job.reuse || !approved) throw notAsked('sound effect')
          return submitted(
            await request(PATHS.sfx, {
              method: 'POST',
              json: {
                text: job.what,
                duration_seconds: job.seconds,
                ...(job.loop ? { loop: true } : {})
              },
              signal
            }),
            'sound effect'
          )
        },
        deadlineMs: DEADLINES.sfx,
        waitBudgetMs: WAIT_BUDGETS.sfx,
        match: { text: job.what, prompt: job.what }
      },
      { stop: c.stop, detach: c.signal, onProgress }
    )
    if (out.state === 'working') return { credits: 0, working: out.jobId }

    // from here the job is done, and paid for unless it was one ai33 already had
    const credits = out.reused ? 0 : out.creditCost
    const url = out.urls.audio ?? out.urls.audios?.[0]
    try {
      if (!url) throw new Error('ai33 sent no file')
      const file = await saveFile(c, url, 'sfx', {
        slug: slugOf(titleOf(job.what, 3, 'sound'), 'sound'),
        hash: job.hash,
        prompt: job.what
      })
      markCollected(out.jobId, [file.rel])
      return { file, credits, balance: out.balance }
    } catch (e) {
      throw failedAfterDone(e, 'a sound effect', credits, stopped(c))
    }
  } catch (e) {
    return {
      credits: e instanceof SoundError ? e.credits : 0,
      err: e instanceof Ai33Error ? e : plainError(e, 'sound effect')
    }
  }
}

/** Runs `work` on each item, `n` at a time, starting no new one once `quit()` says so. `work` never throws. */
async function inParallel<T>(
  items: T[],
  n: number,
  quit: () => boolean,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length && !quit()) await work(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane))
}

/** The result of a sound-effect request, with what did not come out. */
export type SfxOutcome = SfxResult & {
  /** Effects that could not be made or put on the timeline (nothing is placed for them). */
  failed?: { what: string; at: number; reason: string }[]
  /** Effects still being made at ai33 when the wait ran out: they carry on in the background. */
  working?: { what: string; at: number; seconds: number; jobId: string }[]
}

/**
 * Short sound effects, two at a time, each put at its moment (unless `place` is false). Like
 * makeMusic, it only submits new jobs when `approved` says the spend was agreed to.
 */
export async function makeSfx(
  req: SfxReq,
  c: MakeCtx,
  o: { approved?: boolean } = {}
): Promise<SfxOutcome> {
  const p = c.project
  const { items, jobs } = planSfx(req, p)
  if (!items.length)
    throw new Ai33Error('validation', 'There are no sound effects to make.', { charged: false })

  // one number for the step (how far along all the effects are together), and "2 of 3"
  const level = new Map<string, number | null>(jobs.map((j) => [j.key, j.reuse ? 100 : null]))
  const report = (key: string, pct: number | null, note?: string): void => {
    level.set(key, pct)
    const all = [...level.values()]
    const done = all.filter((v) => v === 100).length
    c.onProgress?.({
      pct: all.every((v) => v === null)
        ? null
        : Math.round(all.reduce((sum: number, v) => sum + (v ?? 0), 0) / all.length),
      note: note ?? (all.length > 1 ? `${done} of ${all.length}` : undefined)
    })
  }

  const made = new Map<string, Made>()
  let halted: Ai33Error | null = null
  await inParallel(
    jobs,
    CONCURRENCY,
    () => stopped(c) || halted !== null,
    async (job) => {
      const m = await makeOne(job, c, (pr) => report(job.key, pr.pct, pr.note), o.approved === true)
      made.set(job.key, m)
      report(job.key, 100)
      if (m.err && HALTING.includes(m.err.kind)) halted = m.err
    }
  )

  const credits = [...made.values()].reduce((n, m) => n + m.credits, 0)
  if (stopped(c)) {
    const err = [...made.values()].find((m) => m.err)?.err
    throw carry(
      err ?? new Ai33Error('stopped', 'Stopped before the sound effect was ready.'),
      credits,
      'sound effect'
    )
  }

  const failed: NonNullable<SfxOutcome['failed']> = []
  const working: NonNullable<SfxOutcome['working']> = []
  const files: string[] = []
  const reasonFor = (m: Made | undefined): string =>
    m?.err?.userMessage ?? halted?.userMessage ?? 'ai33 didn’t make it.'
  for (const job of jobs) {
    const m = made.get(job.key)
    if (m?.file) files.push(m.file.rel)
  }

  const placedAll: SfxResult['placed'] = []
  for (const item of [...items].sort((a, b) => a.at - b.at)) {
    const job = jobs.find((j) => j.key === item.job)
    const m = made.get(item.job)
    if (!job || !m?.file) {
      if (m?.working && job)
        working.push({ what: item.what, at: item.at, seconds: job.seconds, jobId: m.working })
      else failed.push({ what: item.what, at: item.at, reason: reasonFor(m) })
      continue
    }
    if (!req.place) continue
    try {
      // longer than ai33 makes in one go: tiled from the one effect (never the loop attribute,
      // which the export ignores)
      const file =
        item.length > job.seconds
          ? await fitAudio({
              project: p,
              kind: 'sfx',
              files: [m.file.rel],
              seconds: item.length,
              slug: slugOf(titleOf(item.what, 3, 'sound'), 'sound'),
              hash: hashOf(job.hash, 'tile', item.length).slice(0, 10)
            })
          : m.file.rel
      const start = Math.max(0, item.at - SFX_LEAD)
      const placed = await placeAudio(p, {
        file,
        role: 'sfx',
        start,
        until: start + item.length,
        volume: item.level,
        title: titleOf(item.what, 3, 'Sound effect')
      })
      placedAll.push({ ...placed, file, what: item.what })
    } catch (e) {
      failed.push({
        what: item.what,
        at: item.at,
        reason: reasonOf(e)
      })
    }
  }

  // nothing came of it at all: say why, with whatever it cost (an effect that may have been
  // charged is the one that speaks, so the tool keeps its place in the caps)
  const errors = [...made.values()].flatMap((m) => (m.err ? [m.err] : []))
  const first = errors.find(mayHaveBeenCharged) ?? errors[0]
  if (!files.length && !working.length && first) throw carry(first, credits, 'sound effect')

  const known = [...made.values()].reduce<number | null>(
    (least, m) => (typeof m.balance === 'number' ? Math.min(least ?? m.balance, m.balance) : least),
    null
  )
  return {
    placed: placedAll,
    files,
    credits,
    left: await creditsLeft(known),
    ...(failed.length ? { failed } : {}),
    ...(working.length ? { working } : {})
  }
}
