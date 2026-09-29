/**
 * Speech: choosing and listing voices, and recording words as one voiceover (in parts, cached
 * by request, joined into one file) for both the speech_generate tool and the script start.
 */
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  Ai33Raw,
  Say,
  SpeechPart,
  SpeechReq,
  SpeechResult,
  SpeechTiming,
  TimedWord,
  VoiceRef
} from '../shared/ai33'
import {
  Ai33Error,
  dataDir,
  downloadTo,
  getCredits,
  getHealth,
  PATHS,
  plainError,
  request,
  runJob,
  toInt,
  WAIT_BUDGETS,
  type JobSpec
} from './ai33-client'
import type { ProgressFn, SpendCtx } from './ai33-ctx'
import {
  chunkDialogue,
  chunkScript,
  normalizeSay,
  parseDialogue,
  partHash,
  replaceLocal,
  rulesFor,
  rulesHash8,
  speakersUsed,
  stripLabels,
  timingLadder,
  wholeHash,
  worstTier,
  wordsFromScript,
  type Piece,
  type Region,
  type Rule
} from './ai33-speech-text'
import { patchProjectAi33, readProjectAi33 } from './ai33-store'
import { pickVoice, providerOf, rememberVoice } from './ai33-voices'
import { childEnv, run, which } from './env'
import { probeAudio } from './place'

export { listVoices, pickVoice, resolveVoice, voicePreview } from './ai33-voices'
export type { PickVoiceOpts } from './ai33-voices'
export { timingLadder, wordsFromScript }

/** A recorded part is ai33's audio, whole: the biggest a download may be. */
const AUDIO_MAX_BYTES = 300 * 1024 * 1024
/** The transcript and subtitle files that come with a recorded part are small. */
const TEXT_MAX_BYTES = 20 * 1024 * 1024
/** How long the background poller keeps going for one part. */
const PART_DEADLINE_MS = 10 * 60_000
/** Parts recorded at the same time. */
const CONCURRENCY = 2

const round2 = (n: number): number => Math.round(n * 100) / 100
const r3 = (n: number): number => Math.round(n * 1000) / 1000
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

// ------------------------------------------------------------------------------ what can go wrong

const BUSY =
  'The voice service is busy right now, so Luca didn’t start it. Try again in a few minutes, or pick a Standard voice.'

/** The person (or the start card) chose not to record the rest; what is recorded stays saved. */
export class SpeechDeclined extends Error {
  /** Credits the parts recorded so far used. */
  readonly credits: number
  constructor(credits: number) {
    super(
      'Stopped before the voiceover was recorded. The first part is saved, so it won’t be paid for twice.'
    )
    this.name = 'SpeechDeclined'
    this.credits = credits
  }
}

/** A part was still being recorded when the wait ran out: it carries on at ai33. */
export class SpeechStillWorking extends Error {
  readonly jobId: string
  /** Credits the parts recorded so far used. */
  readonly credits: number
  constructor(jobId: string, credits: number) {
    super('ai33 is still recording this. It may take a few more minutes.')
    this.name = 'SpeechStillWorking'
    this.jobId = jobId
    this.credits = credits
  }
}

/**
 * One part failed after the ones before it were saved: they are kept, so trying again only pays
 * for the rest.
 */
export class SpeechPartError extends Ai33Error {
  /** The part that failed (from 1), how many parts there are, and every part that is saved (from 1). */
  readonly part: number
  readonly parts: number
  readonly saved: number[]
  /** Credits the parts recorded so far used. */
  readonly credits: number
  constructor(
    cause: Ai33Error,
    o: { part: number; parts: number; saved: number[]; credits: number }
  ) {
    const before = o.part - 1
    super(
      cause.kind,
      `${cause.userMessage} Part ${o.part} of ${o.parts} didn’t record. ${before === 1 ? 'Part 1 is' : `Parts 1 to ${before} are`} saved, so trying again only pays for the rest.`,
      { status: cause.status, charged: true, cause }
    )
    this.name = 'SpeechPartError'
    this.part = o.part
    this.parts = o.parts
    this.saved = o.saved
    this.credits = o.credits
  }
}

const stopped = (): Ai33Error =>
  new Ai33Error('stopped', 'Stopped before the voiceover was ready.', { charged: false })

// ------------------------------------------------------------------------------ dictionary

/** Dictionaries seen this session by name (null: it doesn't do what it should), so a script's parts share one lookup. */
const dictionaries = new Map<string, { id: number | null; at: number }>()
const lookups = new Map<string, Promise<number | null>>()
const DICTIONARY_MEMO_MS = 30 * 60_000

function dictionariesOf(res: Ai33Raw): Ai33Raw[] {
  for (const list of [res, res?.dictionaries, res?.data, res?.items, res?.results])
    if (Array.isArray(list)) return list
  return []
}

/** A rule as ai33 stores it, in a form that compares. */
const ruleKey = (r: Ai33Raw): string =>
  JSON.stringify([
    String(r?.from ?? ''),
    String(r?.to ?? ''),
    r?.matchType === 'contains' ? 'contains' : 'word',
    r?.caseSensitive === true
  ])

const sameRules = (stored: Ai33Raw[], rules: Rule[]): boolean =>
  stored.length === rules.length &&
  stored.map(ruleKey).sort().join('|') === rules.map(ruleKey).sort().join('|')

async function findOrMake(name: string, rules: Rule[]): Promise<number | null> {
  const found = dictionariesOf(await request('/v3/dictionaries', { method: 'GET' })).find(
    (d) => d?.name === name
  )
  if (found) {
    const id = toInt(found.id)
    // the name is the rules' own hash, so they differ only if the dictionary was edited since
    if (id !== null && Array.isArray(found.rules) && !sameRules(found.rules, rules))
      await request(`/v3/dictionaries/${id}`, { method: 'PUT', json: { rules } })
    return id
  }
  const made = await request('/v3/dictionaries', { method: 'POST', json: { name, rules } })
  return toInt(made?.dictionary?.id ?? made?.data?.id ?? made?.id)
}

/**
 * Whether ai33's dictionary sounds the words as asked: its own preview of the rules' words must
 * read the same as doing the replacements here (a script in another alphabet may not). If ai33
 * can't preview, the dictionary is trusted.
 */
async function behaves(rules: Rule[]): Promise<boolean> {
  const sample = rules.map((r) => r.from).join(' ')
  try {
    const res = await request('/v3/dictionaries/preview', {
      method: 'POST',
      json: { text: sample, rules }
    })
    const out = res?.output ?? res?.data?.output ?? res?.result?.output
    if (typeof out !== 'string') return true
    const flat = (t: string): string => t.replace(/\s+/g, ' ').trim().toLowerCase()
    return flat(out) === flat(replaceLocal(sample, rules))
  } catch {
    return true
  }
}

/**
 * The pronunciation dictionary for these words on the person's ai33 account (one per unique set,
 * reused by name), or null when there are none or it can't be made (the caller then applies the
 * replacements to the text itself).
 */
export async function ensureDictionary(
  projectDir: string | null,
  say: Say[]
): Promise<number | null> {
  const rules = normalizeSay(say)
  if (!rules.length) return null
  const hash = rulesHash8(rules)
  // one account dictionary per unique set of rules, named after it, so projects share it
  const name = `luca-${hash}`
  const memo = dictionaries.get(name)
  if (memo && Date.now() - memo.at < DICTIONARY_MEMO_MS) return memo.id
  const pending = lookups.get(name)
  if (pending) return pending
  const lookup = (async (): Promise<number | null> => {
    try {
      const found = await findOrMake(name, rules)
      const id = found !== null && (await behaves(rules)) ? found : null
      dictionaries.set(name, { id, at: Date.now() })
      if (id === null) return null
      if (projectDir) {
        const mine = readProjectAi33(projectDir)
        if (mine.dictionaryId !== id || mine.dictionaryHash !== hash)
          patchProjectAi33(projectDir, { dictionaryId: id, dictionaryHash: hash })
      }
      return id
    } catch (err) {
      // offline: the id this project already used for these very words is most likely still good
      const mine = projectDir ? readProjectAi33(projectDir) : {}
      const kind = err instanceof Ai33Error ? err.kind : 'network'
      const offline = kind === 'network' || kind === 'server'
      return offline && mine.dictionaryHash === hash ? (mine.dictionaryId ?? null) : null
    } finally {
      lookups.delete(name)
    }
  })()
  lookups.set(name, lookup)
  return lookup
}

// ------------------------------------------------------------------------------ the plan

type Voices = {
  kind: 'speech' | 'dialogue'
  main: VoiceRef
  speed: number
  speakers: { voice: VoiceRef; speed: number }[] | null
}

/** How a part is recorded: as it is, with the pronunciation dictionary, or with the words replaced here. */
type Key = { via: 'plain' | 'dict' | 'text'; hash: string; sent: string }
type PlanPart = { text: string; chars: number; gapAfter: number; rules: Rule[]; keys: Key[] }
type Plan = { voices: Voices; pause: number; parts: PlanPart[] }

async function voicesOf(req: SpeechReq): Promise<Voices> {
  const speed = round2(clamp(req.speed, 0.5, 1.5))
  if (req.speakers?.length) {
    if (req.speakers.length < 2 || req.speakers.length > 3)
      throw new Ai33Error('validation', 'A conversation needs two or three voices.', {
        charged: false
      })
    return {
      kind: 'dialogue',
      main: req.speakers[0].voice,
      speed,
      speakers: req.speakers.map((s) => ({
        voice: s.voice,
        speed: round2(clamp(s.speed ?? req.speed, 0.5, 1.5))
      }))
    }
  }
  const main =
    req.voice ??
    (await pickVoice({ projectDir: req.projectDir, language: req.language, style: req.style }))
  return { kind: 'speech', main, speed, speakers: null }
}

function planOf(req: SpeechReq, voices: Voices): Plan {
  const pause = round2(clamp(req.pause, 0, 5))
  const dialogue = voices.kind === 'dialogue'
  let pieces: Piece[]
  if (dialogue) {
    const turns = parseDialogue(req.text)
    if (speakersUsed(turns) > (voices.speakers?.length ?? 0))
      throw new Ai33Error(
        'validation',
        'The conversation uses more speakers than voices were given.',
        { charged: false }
      )
    pieces = chunkDialogue(turns, pause)
  } else pieces = chunkScript(req.text)
  if (req.firstPartOnly) pieces = pieces.slice(0, 1).map((p) => ({ ...p, gapAfter: 0 }))
  const rules = normalizeSay(req.say)
  const base = {
    kind: voices.kind,
    voices: voices.speakers
      ? voices.speakers.map((s) => ({ id: s.voice.id, speed: s.speed }))
      : [{ id: voices.main.id, speed: voices.speed }],
    delay: dialogue ? pause : 0,
    withTranscript: req.withTranscript
  }
  const parts = pieces.map((p): PlanPart => {
    const own = rulesFor(dialogue ? stripLabels(p.text) : p.text, rules)
    const keys: Key[] = []
    if (own.length) {
      keys.push({
        via: 'dict',
        sent: p.text,
        hash: partHash({ ...base, text: p.text, rules: own, local: false })
      })
      const sent = replaceLocal(p.text, own, dialogue)
      keys.push({
        via: 'text',
        sent,
        hash: partHash({ ...base, text: sent, rules: null, local: true })
      })
    } else
      keys.push({
        via: 'plain',
        sent: p.text,
        hash: partHash({ ...base, text: p.text, rules: null, local: false })
      })
    return { text: p.text, chars: p.text.length, gapAfter: p.gapAfter, rules: own, keys }
  })
  return { voices, pause, parts }
}

// ------------------------------------------------------------------------------ the cache

/** Recorded parts, by request, shared by every project and every start: recording twice costs once. */
const cacheDir = (): string => join(dataDir(), 'cache', 'tts')
const partFile = (hash: string): string => join(cacheDir(), `${hash}.mp3`)
const metaFile = (hash: string): string => join(cacheDir(), `${hash}.json`)

/** What is kept beside a recorded part: its length, what it cost and ai33's word timing. */
type PartMeta = { seconds: number; credits: number; chars: number; json?: Ai33Raw; srt?: string }

function readMeta(hash: string): PartMeta | null {
  if (!existsSync(partFile(hash))) return null
  try {
    const m = JSON.parse(readFileSync(metaFile(hash), 'utf8')) as PartMeta
    return typeof m.seconds === 'number' && m.seconds > 0 ? m : null
  } catch {
    return null
  }
}

const cachedKey = (part: PlanPart): Key | undefined => part.keys.find((k) => readMeta(k.hash))

/** A recording nobody asked for in this long is dropped (its price is long paid; the joined copies are easy to make again). */
const PART_KEEP_MS = 90 * 24 * 3600_000
const JOINED_KEEP_MS = 3 * 24 * 3600_000
let pruned = false

/** Once a session: forget old recordings, so the cache doesn't grow for ever. */
function pruneCache(): void {
  if (pruned) return
  pruned = true
  const now = Date.now()
  for (const [dir, keep] of [
    [cacheDir(), PART_KEEP_MS],
    [join(cacheDir(), 'joined'), JOINED_KEEP_MS]
  ] as const) {
    try {
      for (const f of readdirSync(dir)) {
        const file = join(dir, f)
        const st = statSync(file)
        if (st.isFile() && now - st.mtimeMs > keep) rmSync(file, { force: true })
      }
    } catch {
      // no cache yet, or a file that went away meanwhile
    }
  }
}

/** A recording used again stays fresh, so only what is never used goes. */
function touch(...files: string[]): void {
  const now = new Date()
  for (const f of files) {
    try {
      utimesSync(f, now, now)
    } catch {
      // gone, or not ours to touch: it will be recorded again if it comes to that
    }
  }
}

export type SpeechPreview = {
  parts: number
  cachedParts: number
  chars: number
  /** What still has to be recorded (and paid for). */
  uncachedParts: number
  uncachedChars: number
  /** What the whole recording's hash would be (with and without a dictionary), to find a saved file. */
  hashes: string[]
}

/** What recording this would take, without recording: how many parts, and how many are already saved. */
export async function previewSpeech(req: SpeechReq): Promise<SpeechPreview> {
  const plan = planOf(req, await voicesOf(req))
  const uncached = plan.parts.filter((p) => !cachedKey(p))
  const gaps = plan.parts.map((p) => p.gapAfter)
  const withDictionary = plan.parts.map((p) => p.keys[0].hash)
  const withText = plan.parts.map((p) => p.keys[p.keys.length - 1].hash)
  return {
    parts: plan.parts.length,
    cachedParts: plan.parts.length - uncached.length,
    chars: plan.parts.reduce((n, p) => n + p.chars, 0),
    uncachedParts: uncached.length,
    uncachedChars: uncached.reduce((n, p) => n + p.chars, 0),
    hashes: [...new Set([wholeHash(withDictionary, gaps), wholeHash(withText, gaps)])]
  }
}

// ------------------------------------------------------------------------------ health

/**
 * How busy the service behind these voices is. Only ElevenLabs and MiniMax report it; every
 * other voice counts as good.
 */
export async function voiceHealth(voiceIds: string[]): Promise<'good' | 'degraded' | 'overloaded'> {
  const services = new Set(
    voiceIds
      .map(providerOf)
      .filter((p): p is 'elevenlabs' | 'minimax' => p === 'elevenlabs' || p === 'minimax')
  )
  if (!services.size) return 'good'
  const health = await getHealth().catch(() => null)
  const states = [...services].map((s) => health?.[s])
  return states.includes('overloaded')
    ? 'overloaded'
    : states.includes('degraded')
      ? 'degraded'
      : 'good'
}

// ------------------------------------------------------------------------------ ffmpeg

/** Where speech starts and ends in a part: its leading and trailing silence trimmed. */
async function speechRegion(
  file: string,
  seconds: number,
  signal: AbortSignal
): Promise<Region | null> {
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const r = await run(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      'silencedetect=noise=-35dB:d=0.12',
      '-f',
      'null',
      '-'
    ],
    { env: await childEnv(), timeoutMs: 60_000, signal }
  )
  if (r.code !== 0) return null
  const starts = [...r.stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...r.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]))
  let from = 0
  let to = seconds
  if (starts.length && starts[0] <= 0.05 && ends.length) from = ends[0]
  // a silence that never ends (or ends with the file) runs to the end of it
  if (starts.length && (ends.length < starts.length || ends[ends.length - 1] >= seconds - 0.1))
    to = Math.min(to, starts[starts.length - 1])
  return to > from ? { from, to } : null
}

/** The parts as one mp3 (48 kHz stereo), with `gaps[i]` seconds of silence after part i. */
async function joinParts(
  files: string[],
  gaps: number[],
  out: string,
  signal: AbortSignal
): Promise<void> {
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const one = files.length === 1
  const chains = files.map((_, i) => {
    const pad = !one && i < files.length - 1 && gaps[i] > 0 ? `,apad=pad_dur=${gaps[i]}` : ''
    return `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${pad}[${one ? 'out' : `a${i}`}]`
  })
  const graph = one
    ? chains[0]
    : `${chains.join(';')};${files.map((_, i) => `[a${i}]`).join('')}concat=n=${files.length}:v=0:a=1[out]`
  const part = `${out}.part`
  mkdirSync(dirname(out), { recursive: true })
  const r = await run(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      ...files.flatMap((f) => ['-i', f]),
      '-filter_complex',
      graph,
      '-map',
      '[out]',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '2',
      '-f',
      'mp3',
      part
    ],
    { env: await childEnv(), timeoutMs: 600_000, signal }
  )
  if (signal.aborted) {
    rmSync(part, { force: true })
    throw stopped()
  }
  if (r.code !== 0 || !existsSync(part)) {
    rmSync(part, { force: true })
    const why = r.stderr.trim().split('\n').pop()?.slice(0, 200) ?? ''
    throw new Ai33Error(
      'unusable',
      `Luca couldn’t join the recorded parts into one voiceover${why ? ` (${why})` : ''}. The parts are saved, so trying again doesn’t pay for them twice.`,
      { charged: true }
    )
  }
  renameSync(part, out)
}

// ------------------------------------------------------------------------------ recording

export type SpeechCtx = {
  signal: AbortSignal
  /** Aborted only by Stop: cancel the jobs at ai33 too. */
  stop?: AbortSignal
  onProgress?: ProgressFn
  /**
   * After the first part (a price probe) is recorded: whether to go on with the rest, which
   * needs the person's OK when it is a lot (the chat's gate, or the start card's confirm).
   * Answering false ends the recording with a SpeechDeclined; what is recorded stays saved.
   */
  confirmRest?: (o: {
    credits: number | null
    chars: number
    parts: number
    /** What the parts recorded so far used, so what the rest costs can be told from it. */
    paid: number
  }) => Promise<boolean>
  ask?: SpendCtx['ask']
  projectDir: string | null
}

type Done = {
  key: Key
  file: string
  seconds: number
  /** What this part cost now (0 when it was already saved). */
  credits: number
  cached: boolean
  meta: PartMeta
}

/** One of ai33's transcript or subtitle files as text, or null when it can't be fetched. */
async function fetchText(url: string, signal: AbortSignal, tmp: string): Promise<string | null> {
  try {
    await downloadTo(url, tmp, { signal, maxBytes: TEXT_MAX_BYTES })
    return readFileSync(tmp, 'utf8')
  } catch {
    return null
  } finally {
    rmSync(tmp, { force: true })
  }
}

/**
 * Record `req.text` as one file: parts of a sentence-aligned size, two at a time, each cached by
 * its request; joined with a short gap after a paragraph. With `withTranscript`, the words come
 * back timed (from ai33's own timing when it gives some).
 */
export async function makeSpeech(req: SpeechReq, c: SpeechCtx): Promise<SpeechResult> {
  pruneCache()
  const projectDir = req.projectDir ?? c.projectDir
  const voices = await voicesOf(req)
  const plan = planOf(req, voices)
  const total = plan.parts.length
  if (!total) throw new Ai33Error('validation', 'There are no words to record.', { charged: false })
  const kind = voices.kind

  const cached = plan.parts.map(cachedKey)
  let degraded = false
  if (cached.some((k) => !k)) {
    const health = await voiceHealth(
      voices.speakers ? voices.speakers.map((s) => s.voice.id) : [voices.main.id]
    )
    if (health === 'overloaded') throw new Ai33Error('server', BUSY, { charged: false })
    degraded = health === 'degraded'
  }

  let lookup: Promise<number | null> | null = null
  const dictionary = (): Promise<number | null> =>
    (lookup ??= ensureDictionary(projectDir, req.say))
  let dictionaryId: number | null = null

  const done: (Done | undefined)[] = new Array(total).fill(undefined)
  const fraction = cached.map((k): number => (k ? 1 : 0))
  const notes = new Array<string | undefined>(total).fill(undefined)
  const inCall = new Map<string, Promise<Done>>()
  const paid = (): number => done.reduce((n, d) => n + (d && !d.cached ? d.credits : 0), 0)

  const report = (): void => {
    const sum = fraction.reduce((n, f) => n + f, 0)
    const finished = fraction.filter((f) => f >= 1).length
    c.onProgress?.({
      pct: total === 1 && sum === 0 ? null : Math.round((sum / total) * 100),
      note:
        notes.find(Boolean) ??
        (total > 1 ? `Part ${Math.min(finished + 1, total)} of ${total}` : undefined)
    })
  }

  /** Records one part at ai33, downloads it and keeps it. */
  const recordOne = async (i: number, key: Key, dictId: number | null): Promise<Done> => {
    if (c.signal.aborted) throw stopped()
    mkdirSync(cacheDir(), { recursive: true })
    const spec: JobSpec = {
      kind,
      summary: total > 1 ? `Voiceover part ${i + 1} of ${total}` : 'Voiceover',
      requestHash: key.hash,
      projectDir,
      deadlineMs: PART_DEADLINE_MS,
      waitBudgetMs: WAIT_BUDGETS[kind] * (degraded ? 2 : 1),
      match: { text: key.sent },
      submit: async (signal) => {
        const res = await request(PATHS[kind], {
          method: 'POST',
          signal,
          form: async () => {
            const f = new FormData()
            f.set('text', key.sent)
            if (voices.speakers) {
              f.set(
                'speakers',
                JSON.stringify(
                  voices.speakers.map((s) => ({ voice_id: s.voice.id, speed: s.speed }))
                )
              )
              f.set('delay', String(plan.pause))
            } else {
              f.set('voice_id', voices.main.id)
              f.set('speed', String(voices.speed))
            }
            f.set('with_transcript', String(req.withTranscript))
            if (dictId !== null) f.set('pronunciation_dictionary_id', String(dictId))
            return f
          }
        })
        const taskId = res?.task_id ?? res?.data?.task_id
        if (taskId === undefined || taskId === null || String(taskId) === '')
          throw new Ai33Error(
            'unusable',
            'ai33 didn’t say which job it started, so Luca can’t follow it.',
            { charged: 'unknown' }
          )
        return {
          taskId: String(taskId),
          estimatedCredits: toInt(res?.estimated_credits) ?? undefined,
          balance: toInt(res?.ec_remain_credits)
        }
      }
    }
    const outcome = await runJob(spec, {
      stop: c.stop,
      detach: c.signal,
      onProgress: (p) => {
        if (p.pct !== null) fraction[i] = Math.min(0.99, Math.max(0, p.pct / 100))
        notes[i] = p.note
        report()
      }
    })
    if (outcome.state === 'working') throw new SpeechStillWorking(outcome.jobId, 0)

    const url = outcome.urls.audio ?? outcome.urls.audios?.[0]
    if (!url)
      throw new Ai33Error('unusable', 'ai33 finished but sent no voiceover file.', {
        charged: true
      })
    const tmp = join(cacheDir(), `${key.hash}.${randomUUID().slice(0, 8)}.dl`)
    try {
      await downloadTo(url, tmp, { signal: c.signal, maxBytes: AUDIO_MAX_BYTES })
      let seconds: number
      try {
        seconds = (await probeAudio(tmp)).seconds
      } catch {
        throw new Ai33Error(
          'unusable',
          `ai33 sent back a voiceover Luca couldn’t use, so nothing was added. It used ${outcome.creditCost} credits and is kept, so it won’t be paid for twice.`,
          { charged: true }
        )
      }
      const meta: PartMeta = {
        seconds,
        credits: outcome.creditCost,
        chars: plan.parts[i].chars
      }
      if (req.withTranscript) {
        const raw = outcome.urls.json
          ? await fetchText(outcome.urls.json, c.signal, `${tmp}.json`)
          : null
        if (raw) {
          try {
            meta.json = JSON.parse(raw)
          } catch {
            // not JSON: the subtitles, or the even spread, still time the words
          }
        }
        if (outcome.urls.srt)
          meta.srt = (await fetchText(outcome.urls.srt, c.signal, `${tmp}.srt`)) ?? undefined
      }
      // the mp3 is renamed last, so a part that exists is a part that is complete
      writeFileSync(metaFile(key.hash), JSON.stringify(meta))
      renameSync(tmp, partFile(key.hash))
      // an identical job made before (kept in the ledger) is not paid for again
      return {
        key,
        file: partFile(key.hash),
        seconds,
        credits: outcome.reused ? 0 : outcome.creditCost,
        cached: outcome.reused === true,
        meta
      }
    } finally {
      rmSync(tmp, { force: true })
    }
  }

  /** Part `i`, recorded or found saved. */
  const record = async (i: number): Promise<void> => {
    const part = plan.parts[i]
    let key = cached[i]
    let dictId: number | null = null
    if (!key) {
      if (part.rules.length) {
        dictId = await dictionary()
        if (dictId !== null) dictionaryId = dictId
        key = part.keys.find((k) => k.via === (dictId !== null ? 'dict' : 'text'))
      } else key = part.keys[0]
    }
    if (!key)
      throw new Ai33Error('unusable', 'Luca couldn’t prepare the words to record.', {
        charged: false
      })
    const saved = readMeta(key.hash)
    if (saved) {
      touch(partFile(key.hash), metaFile(key.hash))
      done[i] = {
        key,
        file: partFile(key.hash),
        seconds: saved.seconds,
        credits: 0,
        cached: true,
        meta: saved
      }
    } else {
      // two parts with the same words and voice are one job
      const same = inCall.get(key.hash)
      const job = same ?? recordOne(i, key, dictId)
      if (!same) inCall.set(key.hash, job)
      const d = await job
      done[i] = same ? { ...d, credits: 0, cached: true } : d
    }
    fraction[i] = 1
    notes[i] = undefined
    report()
  }

  report()
  try {
    await record(0)
  } catch (err) {
    throw endOf([{ i: 0, err }], done, total)
  }
  const rest = [...Array(total).keys()].slice(1)
  const toRecord = rest.filter((i) => !cached[i])
  if (toRecord.length && c.confirmRest && !req.firstPartOnly) {
    const first = done[0]?.meta
    const rate = first && first.credits > 0 && first.chars > 0 ? first.credits / first.chars : null
    const chars = toRecord.reduce((n, i) => n + plan.parts[i].chars, 0)
    const go = await c.confirmRest({
      credits: rate === null ? null : Math.ceil(chars * rate),
      chars,
      parts: toRecord.length,
      paid: paid()
    })
    if (!go) throw new SpeechDeclined(paid())
  }

  // two at a time; once one fails nothing new starts, and what is in flight is kept
  const failed: { i: number; err: unknown }[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (!failed.length && next < rest.length) {
      const i = rest[next++]
      try {
        await record(i)
      } catch (err) {
        failed.push({ i, err })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rest.length) }, worker))
  if (failed.length) throw endOf(failed, done, total)

  const parts = done as Done[]
  const keys = parts.map((d) => d.key)
  const gaps = plan.parts.map((p) => p.gapAfter)
  const hash = wholeHash(
    keys.map((k) => k.hash),
    gaps
  )
  const joined = join(cacheDir(), 'joined', `${hash.slice(0, 20)}.mp3`)
  if (!existsSync(joined))
    await joinParts(
      parts.map((d) => d.file),
      gaps,
      joined,
      c.signal
    )
  const seconds = (await probeAudio(joined)).seconds

  const starts: number[] = []
  let at = 0
  for (let i = 0; i < total; i++) {
    starts.push(at)
    at += parts[i].seconds + (i < total - 1 ? gaps[i] : 0)
  }

  let words: TimedWord[] | null = null
  let timing: SpeechTiming | null = null
  if (req.withTranscript) {
    const timed: TimedWord[] = []
    const tiers: SpeechTiming[] = []
    for (let i = 0; i < total; i++) {
      const d = parts[i]
      const r = await timingLadder({
        tokens: wordsFromScript(plan.parts[i].text, req.language ?? ''),
        seconds: d.seconds,
        json: d.meta.json,
        srt: d.meta.srt,
        region: () => speechRegion(d.file, d.seconds, c.signal)
      })
      tiers.push(r.tier)
      for (const w of r.words)
        timed.push({
          id: `w${timed.length + 1}`,
          text: w.text,
          start: r3(w.start + starts[i]),
          end: r3(w.end + starts[i])
        })
    }
    words = timed
    timing = worstTier(tiers)
  }

  const credits = paid()
  const left = await getCredits({ fresh: credits > 0 }).catch(() => null)
  if (voices.kind === 'speech') rememberVoice(req.language, voices.main)
  const speechParts: SpeechPart[] = parts.map((d, i) => ({
    hash: d.key.hash,
    file: d.file,
    seconds: d.seconds,
    chars: plan.parts[i].chars,
    start: r3(starts[i]),
    end: r3(starts[i] + d.seconds),
    cached: d.cached
  }))
  return {
    file: joined,
    seconds,
    parts: speechParts,
    words,
    timing,
    voice: voices.main,
    dictionaryId: keys.some((k) => k.via === 'dict') ? dictionaryId : null,
    credits,
    left,
    reused: parts.every((d) => d.cached),
    hash
  }
}

/** The error to throw when parts failed: the first one (lowest), with what is saved said plainly. */
function endOf(
  failures: { i: number; err: unknown }[],
  done: (Done | undefined)[],
  total: number
): unknown {
  const lowest = failures.reduce((a, b) => (b.i < a.i ? b : a))
  const credits = done.reduce((n, d) => n + (d && !d.cached ? d.credits : 0), 0)
  const err = lowest.err
  if (err instanceof SpeechStillWorking) return new SpeechStillWorking(err.jobId, credits)
  const cause = err instanceof Ai33Error ? err : plainError(err, 'voiceover')
  const saved = done.flatMap((d, i) => (d ? [i + 1] : []))
  // a job stopped by the person is just that; the parts note is for a job that got going
  if (cause.kind === 'stopped' || !saved.length) return Object.assign(cause, { credits })
  return new SpeechPartError(cause, { part: lowest.i + 1, parts: total, saved, credits })
}
