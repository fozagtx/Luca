/**
 * The spend policy, in code: what a job is expected to cost, when the person is asked first,
 * what no card can override, and the bookkeeping of each turn. Imports only Node, the client,
 * the job list and shared code (the smoke script bundles it), so the refusal texts below repeat the
 * ones in tools/common.ts (which pulls in the app) word for word.
 *
 * `gateSpend` reserves, the tool settles: a paid call is counted against the turn when it is
 * allowed, and `settleSpend` swaps the estimate for what the job really cost.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  formatCredits,
  type Ai33Ask,
  type Ai33Estimate,
  type Ai33EstimateReq,
  type Ai33HealthMap,
  type Ai33Kind,
  type Grant,
  type SpendReq,
  UNNAMED_VOICE
} from '../shared/ai33'
import { Ai33Error, dataDir, getCredits, getHealth } from './ai33-client'
import type { Ai33Turn, SpendCtx, ToolName } from './ai33-ctx'
import { list } from './ai33-jobs'

/** Asked first when a job (or a batch) is estimated at this many credits or more. */
export const ASK_ABOVE = 1500
/** Asked first when one turn's approved spending would pass this. */
export const TURN_CAP = 6000
/** Most a turn may make of each kind (sound effects: effects, not calls) before it must ask the person. */
export const PER_TURN = { speech: 3, music: 1, sfx: 8 }
/** Most paid calls in one turn, whatever they are. */
export const MAX_PAID_PER_TURN = 6
/** The most music may cost and still be made without a card when the start card switched it on. */
export const PREAPPROVE_MAX = 6000
/** How long an ask waits for the person before it counts as No. */
export const ASK_TIMEOUT_MS = 1_800_000
/** What music is assumed to cost until a real price has been seen. */
export const MUSIC_SEED = 3600
/** Below this many credits left, the person is told once. */
export const LOW_BALANCE = 1000

/** Speech longer than this many characters is asked about until a price for its voice has been seen. */
const UNPRICED_SPEECH_CHARS = 1500
/** A job that would use more than this share of what is left is asked about. */
const BIG_SHARE = 0.5
/** ai33 prices a sound effect at 50 credits a second (at least 50), or 200 when it picks the length. */
const SFX_PER_SECOND = 50
const SFX_MIN = 50
const SFX_AUTO = 200
/** The length assumed for an effect nobody priced, the same as the tool's default. */
const SFX_DEFAULT_SECONDS = 2
/** An actual price this far from the estimate is worth a line in the log. */
const DRIFT = 0.25
/** Shorter jobs say too little about what a voice costs to be learned from. */
const MIN_LEARN_CHARS = 20

// ---- the words (repeated from tools/common.ts so this file stays free of the app)

const SPEND_DECLINED =
  'The user chose not to spend credits on this. Say so in one short sentence and do not try again.'

const NOT_ENOUGH = (balance: number, need: number): string =>
  `There aren’t enough ai33 credits for this (${formatCredits(balance)} left, it needs about ${formatCredits(need)}). Tell the user in one short sentence they can add credits with ai33, then ask again. Do not make it another way.`

const OVERLOADED =
  'The voice service is busy right now, so Luca didn’t start it. Nothing was charged. Tell the user in one short sentence to try again in a few minutes or pick a Standard voice. Do not retry.'

const NO_CREDITS =
  'There aren’t enough ai33 credits for this (0 left). Tell the user in one short sentence they can add credits with ai33, then ask again. Do not make it another way.'

const NO_BALANCE =
  'Luca couldn’t check how many ai33 credits are left, so it didn’t start this. Nothing was charged. Tell the user in one short sentence to check their internet connection and try again. Do not make it another way.'

const BUSY_LINE = 'The voice service is busy right now, so this may take longer or fail.'

const LOST_LINE =
  'An earlier try of this got no answer from ai33, so it may already have used credits.'

// ---- results

const refuse = (text: string): { go: false; result: CallToolResult } => ({
  go: false,
  result: { isError: true, content: [{ type: 'text', text }] }
})

/** Not an error: the person said no, so the step reads "stopped", not "didn't work". */
const declined = (): { go: false; result: CallToolResult } => ({
  go: false,
  result: {
    content: [
      { type: 'text', text: JSON.stringify({ ok: false, declined: true, tell: SPEND_DECLINED }) }
    ]
  }
})

// ---- what a job is expected to cost

type Rates = {
  /** Credits per 1,000 characters, by the service behind a voice (the prefix of its id). */
  speech: Record<string, { per1k: number; n: number }>
  /** What the last piece of music really cost. */
  music: number | null
}

const ratesFile = (): string => join(dataDir(), 'rates.json')

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** What earlier jobs cost. Missing, unreadable or half-written means nothing has been learned yet. */
function readRates(): Rates {
  const rates: Rates = { speech: {}, music: null }
  try {
    const raw = JSON.parse(readFileSync(ratesFile(), 'utf8')) as {
      speech?: Record<string, { per1k?: unknown; n?: unknown }>
      music?: { last?: unknown }
    }
    for (const [service, r] of Object.entries(raw.speech ?? {})) {
      if (positive(r?.per1k)) rates.speech[service] = { per1k: r.per1k, n: positive(r.n) ? r.n : 1 }
    }
    if (positive(raw.music?.last)) rates.music = raw.music.last
  } catch {
    // nothing learned yet
  }
  return rates
}

function saveRates(rates: Rates): void {
  try {
    const file = ratesFile()
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    const music = rates.music === null ? {} : { music: { last: rates.music } }
    writeFileSync(tmp, JSON.stringify({ v: 1, speech: rates.speech, ...music }, null, 2) + '\n')
    renameSync(tmp, file)
  } catch {
    // a price that couldn't be remembered is only asked about again; it never fails a job
  }
}

/** The services behind ai33's voices: the prefix of a voice id ("elevenlabs_…"). */
const SERVICES = ['elevenlabs', 'minimax', 'clone', 'edge', 'kokoro', 'vbee', 'fishaudio']

function serviceOf(voiceId: string | null | undefined): string | null {
  const prefix = voiceId?.split('_', 1)[0]?.toLowerCase()
  return prefix && SERVICES.includes(prefix) ? prefix : null
}

const unknown = (): Ai33Estimate => ({ credits: null, exact: false, basis: 'unknown' })

function speechQuote(chars: number, voiceId?: string | null): Ai33Estimate {
  const service = serviceOf(voiceId)
  const rate = service ? readRates().speech[service] : undefined
  if (!rate) return unknown()
  return {
    credits: Math.ceil((Math.max(0, chars) / 1000) * rate.per1k),
    exact: false,
    basis: 'learned'
  }
}

function musicQuote(): Ai33Estimate {
  const last = readRates().music
  return last === null
    ? { credits: MUSIC_SEED, exact: false, basis: 'seed' }
    : { credits: Math.round(last), exact: false, basis: 'learned' }
}

/** Exact for whole seconds (ai33 publishes the formula); a fractional length is only "about". */
function sfxQuote(seconds: number | null, count: number): Ai33Estimate {
  const n = Math.max(1, Math.round(count))
  if (seconds === null) return { credits: SFX_AUTO * n, exact: true, basis: 'formula' }
  const one = Math.max(SFX_MIN, Math.ceil(SFX_PER_SECOND * seconds))
  return { credits: one * n, exact: Number.isInteger(seconds) && seconds >= 1, basis: 'formula' }
}

function quote(req: Ai33EstimateReq): Ai33Estimate {
  switch (req.kind) {
    case 'speech':
      return speechQuote(req.chars, req.voiceId)
    case 'music':
      return musicQuote()
    case 'sfx':
      return sfxQuote(req.seconds, req.count ?? 1)
  }
}

/** What a job is expected to cost, from an exact formula, a price ai33 gave, a learned rate or a seed. */
export function estimate(req: Ai33EstimateReq): Promise<Ai33Estimate> {
  return Promise.resolve(quote(req))
}

/** The estimate for a request whose tool did not price it itself. */
function quoteFor(req: SpendReq): Ai33Estimate {
  switch (req.kind) {
    case 'speech':
    case 'dialogue':
      return speechQuote(req.units, req.voice?.id)
    case 'music':
      return musicQuote()
    case 'sfx':
      // the length was not given, so assume the default one and say "about"
      return { ...sfxQuote(SFX_DEFAULT_SECONDS, req.units), exact: false }
  }
}

// ---- the turn's bookkeeping

type Bucket = keyof typeof PER_TURN

/** Dialogue counts with speech; every kind that has a cap is a bucket. */
const bucketOf = (kind: Ai33Kind): Bucket => (kind === 'dialogue' ? 'speech' : kind)

/** How much of its cap a request uses: effects for sound effects, one call for the rest. */
const capUnits = (req: SpendReq): number => (req.kind === 'sfx' ? Math.max(1, req.units) : 1)

const THINGS: Record<Bucket, [one: string, many: string]> = {
  speech: ['voiceover', 'voiceovers'],
  music: ['piece of music', 'pieces of music'],
  sfx: ['sound effect', 'sound effects']
}

/**
 * Turns started by a person pressing a button (a script start) rather than by the model: the
 * per-turn counts guard against a model that keeps calling, so they don't apply there.
 */
const startTurns = new WeakSet<Ai33Turn>()

/** The refusal when this request would pass a cap of the turn, else null. */
function overCap(turn: Ai33Turn, bucket: Bucket, units: number): string | null {
  if (startTurns.has(turn)) return null
  const { paid, byKind } = turn.spent
  if (paid >= MAX_PAID_PER_TURN)
    return `Luca already made ${paid} things that use ai33 credits this turn. Ask the user before making another. Do not retry.`
  const made = byKind[bucket] ?? 0
  const cap = PER_TURN[bucket]
  if (made + units <= cap) return null
  const [one, many] = THINGS[bucket]
  if (made === 0)
    return `Luca can only make ${cap} ${many} in one turn. Ask the user before making that many. Do not retry.`
  return `Luca already made ${made} ${made === 1 ? one : many} this turn. Ask the user before making another. Do not retry.`
}

type Reservation = {
  kind: Ai33Kind
  bucket: Bucket
  /** What it uses of its cap. */
  capUnits: number
  /** What was asked for: characters of speech, effects, 1 for music. */
  units: number
  /** What was reserved in the turn's credits. */
  reserved: number
  /** The turn's own tally: it is settled where it was reserved, whatever turn is running by then. */
  spent: Ai33Turn['spent']
  service: string | null
  preapproved: boolean
}

/** What is reserved and not yet settled, by grant id. */
const reservations = new Map<string, Reservation>()

// ---- preapproval (music only)

/**
 * What the Music start chip allows, by project. Kept here and never read back from the project:
 * the model can write files in the project, so a file can't say what the person agreed to. `turn`
 * is the first turn that reached the gate; the agent ends the preapproval when the project's
 * first turn ends, whether or not that turn spent anything.
 */
const preapprovals = new Map<string, { turn: Ai33Turn | null }>()

/** The preapproval is over: used, or the turn it was for has ended. */
export function endPreapproval(projectDir: string): void {
  preapprovals.delete(resolve(projectDir))
}

/**
 * Whether the project's Music start chip still covers music in this turn: it was switched on, no
 * music was made on it yet, and this is the first turn to spend in the project. A turn is told
 * apart by the object, not its number: numbers start again with every agent.
 */
function preapprovalHolds(dir: string | null, turn: Ai33Turn): boolean {
  const held = dir ? preapprovals.get(resolve(dir)) : undefined
  if (!dir || !held) return false
  held.turn ??= turn
  if (held.turn === turn) return true
  endPreapproval(dir)
  return false
}

/** Let the first turn make these without asking (in practice only 'music'), for this project. */
export function grantPreapproval(projectDir: string, kinds: Ai33Kind[]): void {
  if (!kinds.includes('music')) return
  preapprovals.set(resolve(projectDir), { turn: null })
}

// ---- the card

/**
 * The card's words (3.2 of the spec): the title says what it is, the detail what it takes, and
 * the worries (a guessed price, a big share of what is left, a busy service) go under it as a warning.
 */
function askFor(
  req: SpendReq,
  est: Ai33Estimate,
  balance: number,
  o: { start: boolean; busy: boolean; again: boolean }
): Ai33Ask {
  const speech = req.kind === 'speech' || req.kind === 'dialogue'
  const left = formatCredits(balance)
  const credits = est.credits
  const detail: string[] = []
  const warn: string[] = []
  let title: string

  if (o.start && speech) {
    // no chat yet: the busy card asks about the rest of the recording
    title = 'Record the whole voiceover?'
    if (credits === null) {
      detail.push(`You have ${left} credits.`)
      warn.push(
        'The full voiceover may use a lot of credits, and ai33 hasn’t given a price for this yet.'
      )
    } else
      detail.push(
        `The full voiceover will use about ${formatCredits(credits)} credits. You have ${left}.`
      )
  } else {
    if (req.kind === 'music') title = 'Make music for the video?'
    else if (req.kind === 'sfx')
      title = `Make ${req.thing ?? (req.units === 1 ? 'a sound effect' : `${req.units} sound effects`)}?`
    else {
      const what = req.thing ?? (req.kind === 'dialogue' ? 'the conversation' : 'the voiceover')
      title = `Record ${what}${req.voice ? inVoiceOf(req.voice.name) : ''}?`
    }
    if (credits === null) {
      detail.push(`You have ${left} credits.`)
      warn.push(
        'ai33 hasn’t given a price for this yet, and a long text can use a lot of credits. Luca will tell you what it used.'
      )
    } else {
      detail.push(`${est.exact ? '' : 'About '}${formatCredits(credits)} of your ${left} credits.`)
      if (est.basis === 'seed')
        warn.push(
          'ai33 hasn’t given a price for this yet, so this is a guess. Luca will tell you what it used.'
        )
    }
    if (req.kind === 'music') detail.push('It takes a minute or two.')
  }
  if (credits !== null && credits > balance * BIG_SHARE)
    warn.push('That’s more than half of what’s left.')
  if (o.busy) warn.push(BUSY_LINE)
  if (o.again) warn.push(LOST_LINE)

  return {
    kind: 'spend',
    title,
    detail: detail.join(' '),
    credits,
    exact: est.exact,
    balance,
    voice: speech && req.voice ? { ...req.voice, name: voiceLabel(req.voice.name) } : null,
    ...(warn.length ? { warn: warn.join(' ') } : {}),
    ...(o.start && speech ? { labels: { allow: 'Go ahead', deny: 'Stop' } } : {})
  }
}

// ---- the gate

/** Only ElevenLabs and MiniMax report health; sound effects come from the first. */
function serviceFor(req: SpendReq): keyof Ai33HealthMap | null {
  if (req.kind === 'sfx') return 'elevenlabs'
  const service = serviceOf(req.voice?.id)
  return service === 'elevenlabs' || service === 'minimax' ? service : null
}

async function healthOf(service: keyof Ai33HealthMap | null): Promise<string> {
  if (!service) return 'unknown'
  try {
    return (await getHealth())[service]
  } catch {
    return 'unknown'
  }
}

async function balanceNow(): Promise<number | null> {
  try {
    return await getCredits({ fresh: true })
  } catch {
    return null
  }
}

type Screened = {
  go: true
  turn: Ai33Turn
  bucket: Bucket
  units: number
  health: string
  balance: number
  est: Ai33Estimate
}

/**
 * What is refused without a card: a cap, a busy service, an unreadable balance, too few credits.
 * Stop is checked after each read, so a card is never raised for a turn that was stopped meanwhile.
 */
async function screen(
  ctx: SpendCtx,
  req: SpendReq
): Promise<Screened | { go: false; result: CallToolResult }> {
  const turn = ctx.turn()
  const bucket = bucketOf(req.kind)
  const units = capUnits(req)

  const capped = overCap(turn, bucket, units)
  if (capped) return refuse(capped)

  const health = await healthOf(serviceFor(req))
  if (turn.stop.aborted) return declined()
  if (health === 'overloaded') return refuse(OVERLOADED)

  const balance = await balanceNow()
  if (turn.stop.aborted) return declined()
  if (balance === null) return refuse(NO_BALANCE)

  const est = req.estimate ?? quoteFor(req)
  const credits = est.credits
  if (credits === null ? balance <= 0 : credits > balance)
    return refuse(credits === null ? NO_CREDITS : NOT_ENOUGH(balance, credits))
  return { go: true, turn, bucket, units, health, balance, est }
}

/**
 * The refusals of `gateSpend` without a card or a reservation, for a step that is paid for before
 * its price can be asked about (the first part of a long voiceover).
 */
export async function precheckSpend(
  ctx: SpendCtx,
  req: SpendReq
): Promise<{ go: true } | { go: false; result: CallToolResult }> {
  const s = await screen(ctx, req)
  return s.go ? { go: true } : s
}

/**
 * Before a paid call: a Grant that reserves the estimate (the tool settles it after the job), or
 * the result to return instead. Refused without a card: caps, an unreadable balance, not enough
 * credits, an overloaded voice service. Asked first (an awaited card): 1,500 credits or more, a
 * guessed price on music or a long text, a batch of effects, a turn that would pass 6,000, more
 * than half of what is left. Only music may be preapproved (the Music start chip).
 */
export function gateSpend(
  ctx: SpendCtx,
  req: SpendReq,
  tool?: ToolName
): Promise<{ go: true; grant: Grant } | { go: false; result: CallToolResult }> {
  return gateSpendWith(ctx, req, { tool })
}

/**
 * `gateSpend`; `again` asks first whatever the price (an identical request that may already have
 * been charged); `tool` is the tool the card is for, so the chat puts it on that tool's step (two
 * tools running at once must not swap cards).
 */
export async function gateSpendWith(
  ctx: SpendCtx,
  req: SpendReq,
  o: { again?: boolean; tool?: ToolName }
): Promise<{ go: true; grant: Grant } | { go: false; result: CallToolResult }> {
  const preapprovable = preapprovalHolds(ctx.projectDir, ctx.turn()) && req.kind === 'music'

  const s = await screen(ctx, req)
  if (!s.go) return s
  const { turn, bucket, units, health, balance, est } = s
  const credits = est.credits

  const overTurn = turn.spent.credits + (credits ?? 0) > TURN_CAP
  const guessed =
    est.basis === 'seed' ||
    (est.basis === 'unknown' &&
      (req.kind === 'music' ||
        ((req.kind === 'speech' || req.kind === 'dialogue') && req.units > UNPRICED_SPEECH_CHARS)))
  const mustAsk =
    (credits !== null && credits >= ASK_ABOVE) ||
    guessed ||
    (req.kind === 'sfx' && (req.batch ?? req.units) > 3) ||
    overTurn ||
    (credits !== null && credits > balance * BIG_SHARE)

  // The chip covers music whose price it can bound (a seed or a learned price, within what it
  // allows), but never a turn that would spend past its cap, nor a repeat of a try that may
  // already have been charged.
  const covered =
    preapprovable &&
    o.again !== true &&
    credits !== null &&
    credits <= PREAPPROVE_MAX &&
    balance >= credits &&
    !overTurn
  if ((mustAsk || o.again === true) && !covered) {
    const answer = await ctx.ask(
      askFor(req, est, balance, {
        start: startTurns.has(turn),
        busy: health === 'degraded',
        again: o.again === true
      }),
      o.tool
    )
    if (answer !== 'allow' || turn.stop.aborted) return declined()
  }
  return reserve(turn, req, est, bucket, units, covered)
}

/**
 * Count the call against the turn. Done in one step, after the awaits, so two calls made at the
 * same time cannot both pass a cap.
 */
function reserve(
  turn: Ai33Turn,
  req: SpendReq,
  est: Ai33Estimate,
  bucket: Bucket,
  units: number,
  preapproved: boolean
): { go: true; grant: Grant } | { go: false; result: CallToolResult } {
  const capped = overCap(turn, bucket, units)
  if (capped) return refuse(capped)
  const reserved = est.credits ?? 0
  turn.spent.paid += 1
  turn.spent.byKind[bucket] = (turn.spent.byKind[bucket] ?? 0) + units
  turn.spent.credits += reserved
  const grant: Grant = { id: randomUUID(), kind: req.kind, reserved, preapproved }
  reservations.set(grant.id, {
    kind: req.kind,
    bucket,
    capUnits: units,
    units: req.units,
    reserved,
    spent: turn.spent,
    service: serviceOf(req.voice?.id),
    preapproved
  })
  return { go: true, grant }
}

// ---- after the job

function learn(r: Reservation, actual: number): void {
  const rates = readRates()
  if (r.kind === 'music') rates.music = actual
  else if (
    (r.kind === 'speech' || r.kind === 'dialogue') &&
    r.service &&
    r.units >= MIN_LEARN_CHARS
  ) {
    const seen = (actual / r.units) * 1000
    const old = rates.speech[r.service]
    rates.speech[r.service] = { per1k: old ? (old.per1k + seen) / 2 : seen, n: (old?.n ?? 0) + 1 }
  } else return
  saveRates(rates)
}

/**
 * After the job: replace the reservation with what it really cost (0 when it failed or was
 * cancelled, which also gives back its place in the turn's caps), remember the price, and use up
 * a preapproval. `actualCredits` is what the units that were gated cost. A job whose cost isn't
 * known (still running when the tool stopped waiting, or a failure that may have been charged) is
 * not settled at all: `holdSpend` keeps its estimate and its place. A grant settles once;
 * settling it again does nothing.
 */
export function settleSpend(ctx: SpendCtx, grant: Grant, actualCredits: number): void {
  const r = reservations.get(grant.id)
  if (!r) return
  reservations.delete(grant.id)
  const actual = Number.isFinite(actualCredits) ? Math.max(0, Math.round(actualCredits)) : 0

  r.spent.credits = Math.max(0, r.spent.credits - r.reserved + actual)
  if (actual === 0) {
    r.spent.paid = Math.max(0, r.spent.paid - 1)
    const left = (r.spent.byKind[r.bucket] ?? 0) - r.capUnits
    if (left > 0) r.spent.byKind[r.bucket] = left
    else delete r.spent.byKind[r.bucket]
  } else {
    learn(r, actual)
    if (r.reserved > 0 && Math.abs(actual - r.reserved) > r.reserved * DRIFT)
      console.warn(`[ai33] ${r.kind} cost ${actual} credits, estimated ${r.reserved}`)
  }
  if (r.preapproved && ctx.projectDir) endPreapproval(ctx.projectDir)
}

/**
 * After a job whose cost isn't known yet (still running at ai33, or a submit that may have been
 * charged): its estimate and its place in the turn's caps stay as they are, nothing is learned
 * from it, and a preapproval is used up. Never frees a cap slot, which settling at 0 would.
 */
export function holdSpend(ctx: SpendCtx, grant: Grant): void {
  const r = reservations.get(grant.id)
  if (!r) return
  reservations.delete(grant.id)
  if (r.preapproved && ctx.projectDir) endPreapproval(ctx.projectDir)
}

/**
 * Count what a call used that could not be gated before it was paid for: the first part of a long
 * voiceover is recorded before the person is asked about the rest. Its credits are added to the
 * turn's total; `call` also counts the call itself (a paid call, and its place in the caps), which
 * is all that is left of it when the rest is not recorded. `credits` may be 0 for a call that may
 * have been charged: its place is held, as `holdSpend` does. Nothing is learned from it.
 */
export function countSpent(
  ctx: SpendCtx,
  req: SpendReq,
  credits: number,
  o: { call: boolean }
): void {
  const { spent } = ctx.turn()
  if (o.call) {
    spent.paid += 1
    const bucket = bucketOf(req.kind)
    spent.byKind[bucket] = (spent.byKind[bucket] ?? 0) + capUnits(req)
  }
  if (Number.isFinite(credits) && credits > 0) spent.credits += Math.round(credits)
}

/** How long after a submit that got no answer the same request is asked about again. */
const LOST_ASK_MS = 10 * 60_000

/**
 * A submit of this request got no answer a moment ago, so ai33 may have charged it: asking again
 * raises the cost card instead of paying quietly a second time.
 */
export function lostRecently(requestHash: string): boolean {
  const now = Date.now()
  return list().some(
    (e) => e.requestHash === requestHash && e.state === 'lost' && now - e.submittedAt < LOST_ASK_MS
  )
}

/**
 * A failure that may have cost credits nobody counted: the job may exist at ai33 (a submit that
 * got no answer, a finished job whose file was no good). Not a stop, a failed task or a refusal.
 */
export function mayHaveBeenCharged(err: unknown): boolean {
  return (
    err instanceof Ai33Error &&
    err.kind !== 'stopped' &&
    err.kind !== 'task' &&
    err.charged !== false
  )
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g

/** A voice's name as a card or the brief shows it: one line, no control characters, at most 40 characters. */
export function voiceLabel(name: string): string {
  const flat = name.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > 40 ? `${flat.slice(0, 39).trimEnd()}…` : flat
}

/** " in Sam’s voice", or " in the voice you picked" when the voice has no name to say. */
export function inVoiceOf(name: string): string {
  const label = voiceLabel(name)
  return label === UNNAMED_VOICE ? ` in ${UNNAMED_VOICE}` : ` in ${label}’s voice`
}

/** A spend context for work that starts before any project or chat exists (a script start). */
export function makeStartCtx(ask: SpendCtx['ask'], signal: AbortSignal): SpendCtx {
  const turn: Ai33Turn = {
    id: 0,
    stop: signal,
    detach: signal,
    spent: { credits: 0, paid: 0, byKind: {} }
  }
  startTurns.add(turn)
  return {
    projectDir: null,
    turn: () => turn,
    ask: (a) => (signal.aborted ? Promise.resolve('deny') : ask(a))
  }
}
