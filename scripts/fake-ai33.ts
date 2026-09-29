/**
 * Fake ai33 server: runs Luca's ai33 integration end to end with no network and no real key.
 * Binds 127.0.0.1 only, plain http, Node built-ins only.
 *
 *   node scripts/fake-ai33.ts          (npm run ai33:fake)
 *     FAKE_AI33_PORT      port, default 8787
 *     FAKE_AI33_SCENARIO  starting scenario, default ok
 *     FAKE_AI33_PARAMS    JSON object of param overrides, e.g. '{"polls":1}'
 *     FAKE_AI33_KEY       accept only this xi-api-key (default: any key not starting with
 *                         bad-, wrong- or invalid-)
 *   In the app: AI33_BASE_URL=http://127.0.0.1:8787 AI33_API_KEY=fake npm run dev
 *
 * From code: `const fake = await startFakeAi33({ scenario: 'ok' })` (ephemeral port by default),
 * `fake.setScenario('rate-limit-429', { rateLimit: 3 })` (resets balance and counters),
 * `fake.requests` (every request in arrival order), `fake.close()`.
 * Over http: `POST /__control {"scenario": "task-error", "params": {...}, "reset": true}`,
 * `GET /__control` shows the scenario, params, balance and counts.
 *
 * A scenario is a named preset of Params (SCENARIOS); any param can be overridden on top of it.
 * Only what ai33's contract states is faithful. What it leaves open (task list wrapper and rows,
 * dictionary list wrapper, prices, words JSON, 5xx bodies) is invented, and the params that vary
 * those choices exist so a client can be checked against more than one of them.
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------------------------
// Public types

export type RecordedBody = {
  kind: 'json' | 'multipart' | 'urlencoded' | 'text' | 'empty' | 'invalid'
  size: number
  /** JSON keys, or multipart/urlencoded fields (strings; long ones cut at 4,000 characters). */
  fields: Record<string, unknown>
  files: { field: string; name: string; type: string; size: number }[]
}

export type RecordedRequest = {
  at: number // epoch ms on arrival: assert poll cadence and Retry-After spacing with it
  method: string
  path: string
  query: Record<string, string>
  /** Lowercase names; xi-api-key, authorization and cookie values become `<redacted:LENGTH>`. */
  headers: Record<string, string>
  body: RecordedBody
  scenario: string
  status: number // 0 while unanswered, and when the socket was destroyed on purpose
  keyLeaked: boolean // an xi-api-key header reached /files/*, where it must never go
  taskId: string | null // the task created (submit) or read (poll, full)
}

export type FakeAi33 = {
  url: string
  requests: RecordedRequest[]
  setScenario(name: string, params?: Record<string, unknown>): void
  /** Forget tasks, files, dictionaries and requests; re-apply the current scenario. */
  reset(): void
  /** Requests that carried the key to a path that must never see it. */
  leaks(): RecordedRequest[]
  credits(): number
  close(): Promise<void>
}

export type StartOptions = {
  port?: number
  scenario?: string
  params?: Record<string, unknown>
  key?: string
}

// ---------------------------------------------------------------------------------------------
// Scenarios and params

type Rec = Record<string, unknown>
type Health = 'good' | 'degraded' | 'overloaded'
type UrlShape =
  'default' | 'cycle' | 'audio_url' | 'output_uri' | 'top_output_uri' | 'all_audio_urls'

const DEFAULTS = {
  credits: 100_000, // balance set when the scenario is applied
  polls: 3, // `doing` responses per task before its final state
  taskError: false, // tasks end in `error`; the refund lands on the poll that reveals it
  errorMessage: 'Generation failed: the upstream provider returned an error',
  authFail: false, // every API route answers 401 whatever the key
  creditsEndpoint401: false, // GET /v1/credits also 401s at a zero balance (A1's other variant)
  creditsAsString: false, // credits, credit_cost and ec_remain_credits as numeric strings
  ecRemain: 'auto' as 'auto' | 'always' | 'never', // submit returns ec_remain_credits; auto = per contract
  rateLimit: 0, // the first N submits answer 429
  retryAfter: 1, // seconds, sent with each 429
  ambiguous: 0, // the first N submits create the task, then answer 502
  dropAfter: 0, // polls of a task answered before its socket starts being destroyed
  drops: 0, // consecutive polls per task answered by destroying the socket
  html: false, // audio result URLs serve HTML with an audio content type
  urlShape: 'default' as UrlShape, // where result URLs sit; cycle rotates them per created task
  transcript: 'words' as 'words' | 'srt' | 'none', // what with_transcript=true returns
  jsonShape: 'words' as 'words' | 'ms' | 'array' | 'segments' | 'short', // words JSON layout
  health: { elevenlabs: 'good', minimax: 'good' } as Record<'elevenlabs' | 'minimax', Health>,
  aliasHost: false, // result and preview URLs use localhost instead of 127.0.0.1
  audioSeconds: 2, // length of generated audio
  cost: 0, // fixed credit cost for every task; 0 = natural prices
  tasksShape: 'data' as 'data' | 'tasks' | 'array', // GET /v1/tasks wrapper
  dictShape: 'dictionaries' as 'dictionaries' | 'data' | 'array', // GET /v3/dictionaries wrapper
  languageMatch: 'both' as 'both' | 'name' | 'code', // which voice `language` values match (A14)
  deleteRefunds: true // deleting a task that is still `doing` refunds its cost
}
type Params = typeof DEFAULTS

const SCENARIOS: Record<string, Partial<Params>> = {
  ok: {},
  slow: { polls: 20 },
  'task-error': { polls: 1, taskError: true },
  'bad-key-401': { authFail: true },
  'no-credits-401': { credits: 0 },
  'credits-as-string': { creditsAsString: true },
  'rate-limit-429': { rateLimit: 2 },
  'ambiguous-502-after-create': { ambiguous: 1 },
  'network-drop-mid-poll': { dropAfter: 1, drops: 2 },
  'done-but-html': { html: true },
  'urls-variety': { urlShape: 'cycle' },
  'tts-words': { transcript: 'words' },
  'tts-srt-only': { transcript: 'srt' },
  'tts-no-transcript': { transcript: 'none' },
  'overloaded-health': { health: { elevenlabs: 'overloaded', minimax: 'good' } },
  'auth-header-audit': { aliasHost: true }
}

const HEALTHS: readonly string[] = ['good', 'degraded', 'overloaded']
const ENUMS: Record<string, readonly string[]> = {
  ecRemain: ['auto', 'always', 'never'],
  urlShape: ['default', 'cycle', 'audio_url', 'output_uri', 'top_output_uri', 'all_audio_urls'],
  transcript: ['words', 'srt', 'none'],
  jsonShape: ['words', 'ms', 'array', 'segments', 'short'],
  tasksShape: ['data', 'tasks', 'array'],
  dictShape: ['dictionaries', 'data', 'array'],
  languageMatch: ['both', 'name', 'code']
}

// ---------------------------------------------------------------------------------------------
// State

type Kind = 'tts' | 'sfx' | 'music'

/** What a validated submit hands to createTask. */
type Spec = {
  kind: Kind
  type: string
  cost: number
  seconds: number
  text: string | null // the text preview on task rows (tts text, sfx text, music prompt)
  ident: Rec // metadata present in every state: what reconciliation matches on
  meta: Rec // metadata present once done, besides the URLs
  spoken: string // text behind the words JSON and the SRT
  transcript: boolean
  extra: Rec // bits that are never emitted as they are (clip title and tags)
}

type Task = Spec & {
  id: string
  createdAt: string
  doingPolls: number
  final: 'done' | 'error'
  errorMessage: string
  polls: number
  dropped: number
  refunded: boolean
  deleted: boolean
  shape: UrlShape
  audio: string[] // published file names of the audio outputs, in order
  json: string | null
  srt: string | null
  cover: string | null
}

type FileEntry =
  | { kind: 'audio'; seconds: number; type: string }
  | { kind: 'bytes'; bytes: Buffer; type: string }
  | { kind: 'html'; type: string }
  | { kind: 'words'; text: string; seconds: number; shape: Params['jsonShape'] }
  | { kind: 'srt'; text: string; seconds: number }

type Rule = { from: string; to: string; matchType: 'word' | 'contains'; caseSensitive: boolean }
type Dictionary = { id: number; name: string; rules: Rule[]; deleted: boolean }

type State = {
  scenario: string
  overrides: Rec
  params: Params
  apiKey: string | null
  balance: number
  counters: { rateLimited: number; ambiguous: number; created: number }
  tasks: Task[]
  files: Map<string, FileEntry>
  dictionaries: Dictionary[]
  nextDictionary: number
  audio: { make(seconds: number): Buffer }
  requests: RecordedRequest[]
}

/** An HTTP-level failure a handler or validator throws; `handle` turns it into the JSON reply. */
class Problem extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function bad(message: string): never {
  throw new Problem(400, message)
}

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

function withOverrides(base: Params, overrides: Rec): Params {
  const next: Rec = structuredClone(base)
  const defaults: Rec = DEFAULTS
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in defaults))
      bad(`Unknown param "${key}". Known: ${Object.keys(defaults).join(', ')}`)
    if (key === 'health') {
      const levels = isRec(value) ? Object.entries(value) : []
      if (
        !isRec(value) ||
        !levels.every(([k, v]) => k in DEFAULTS.health && HEALTHS.includes(String(v)))
      ) {
        bad('health must map elevenlabs and minimax to good, degraded or overloaded')
      }
      next.health = { ...(next.health as Rec), ...value }
    } else if (typeof value !== typeof defaults[key]) {
      bad(`Param "${key}" must be a ${typeof defaults[key]}`)
    } else if (ENUMS[key] && !ENUMS[key].includes(String(value))) {
      bad(`Param "${key}" must be one of: ${ENUMS[key].join(', ')}`)
    } else {
      next[key] = value
    }
  }
  return next as Params
}

function applyScenario(s: State, name: string, overrides: Rec = {}): void {
  const preset = SCENARIOS[name]
  if (!preset) bad(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`)
  s.params = withOverrides({ ...structuredClone(DEFAULTS), ...structuredClone(preset) }, overrides)
  s.scenario = name
  s.overrides = overrides
  s.balance = s.params.credits
  s.counters = { rateLimited: 0, ambiguous: 0, created: 0 }
}

function resetState(s: State): void {
  Object.assign(s, { tasks: [], files: new Map(), dictionaries: [] })
  s.nextDictionary = 1
  s.requests.length = 0
  applyScenario(s, s.scenario, s.overrides)
}

// ---------------------------------------------------------------------------------------------
// Audio, words and subtitles

const SAMPLE_RATE = 16_000
const HTML_PAGE =
  '<!doctype html><html><head><title>Access denied</title></head><body>403</body></html>'
// A 1x1 transparent PNG, for cover art.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

/** 16-bit mono WAV: a 440 Hz tone with 0.2 s of silence at both ends, so silence trimming has work. */
function wavBytes(seconds: number): Buffer {
  const total = Math.max(1, Math.round(seconds * SAMPLE_RATE))
  const lead = Math.round(Math.min(0.2, seconds / 4) * SAMPLE_RATE)
  const data = Buffer.alloc(total * 2)
  for (let i = lead; i < total - lead; i++) {
    const fade = Math.min(1, (i - lead) / 320, (total - lead - i) / 320)
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 9800 * fade),
      i * 2
    )
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/**
 * mp3 bytes come from ffmpeg when `ffmpeg -version` works (probed once per server); otherwise the
 * WAV bytes are served under the audio/mpeg content type, which ffprobe and ffmpeg sniff through.
 */
function createAudio(): State['audio'] {
  let ffmpeg = true
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 })
  } catch {
    ffmpeg = false
  }
  const cache = new Map<number, Buffer>()
  return {
    make(seconds) {
      const length = Math.min(Math.max(seconds, 0.1), 600)
      let bytes = cache.get(length) ?? wavBytes(length)
      if (ffmpeg && !cache.has(length)) {
        try {
          const args = [
            '-v',
            'error',
            '-f',
            'wav',
            '-i',
            'pipe:0',
            '-b:a',
            '64k',
            '-f',
            'mp3',
            'pipe:1'
          ]
          const stdio: ('pipe' | 'ignore')[] = ['pipe', 'pipe', 'ignore']
          bytes = execFileSync('ffmpeg', args, {
            input: bytes,
            stdio,
            maxBuffer: 1 << 28,
            timeout: 30_000
          })
        } catch {
          ffmpeg = false
        }
      }
      cache.set(length, bytes)
      return bytes
    }
  }
}

type Word = { text: string; start: number; end: number }

/** Spreads the words of `text` over the tone (after the 0.2 s lead-in), weighted by length. */
function wordTimings(text: string, seconds: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) tokens.push('...')
  const lead = Math.min(0.2, seconds / 4)
  const weights = tokens.map((t) => Array.from(t).length + 1)
  const scale = (seconds - 2 * lead) / weights.reduce((a, b) => a + b, 0)
  const round = (n: number): number => Math.round(n * 10_000) / 10_000
  let at = lead
  return tokens.map((token, i) => {
    const start = at
    at += weights[i] * scale
    return { text: token, start: round(start), end: round(at - scale * 0.5) }
  })
}

function wordsJson(text: string, seconds: number, shape: Params['jsonShape']): unknown {
  const words = wordTimings(text, seconds)
  const plain = (w: Word): Rec => ({ word: w.text, start: w.start, end: w.end })
  if (shape === 'ms') {
    return {
      words: words.map((w) => ({
        text: w.text,
        start: Math.round(w.start * 1000),
        end: Math.round(w.end * 1000)
      }))
    }
  }
  if (shape === 'array') return words.map(plain)
  if (shape === 'segments') {
    const groups = Array.from({ length: Math.ceil(words.length / 7) }, (_, i) =>
      words.slice(i * 7, i * 7 + 7)
    )
    const segment = (g: Word[]): Rec => ({
      text: g.map((w) => w.text).join(' '),
      start: g[0].start,
      end: g[g.length - 1].end,
      words: g.map(plain)
    })
    return { segments: groups.map(segment) }
  }
  return { words: shape === 'short' ? words.slice(0, Math.ceil(words.length / 2)) : words }
}

function srtText(text: string, seconds: number): string {
  const words = wordTimings(text, seconds)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  const stamp = (sec: number): string => {
    const ms = Math.round(sec * 1000)
    const clock = [
      Math.floor(ms / 3_600_000),
      Math.floor(ms / 60_000) % 60,
      Math.floor(ms / 1000) % 60
    ]
    return `${clock.map((n) => pad(n)).join(':')},${pad(ms % 1000, 3)}`
  }
  const cues: string[] = []
  for (let i = 0; i < words.length; i += 7) {
    const group = words.slice(i, i + 7)
    const span = `${stamp(group[0].start)} --> ${stamp(group[group.length - 1].end)}`
    cues.push(`${cues.length + 1}\n${span}\n${group.map((w) => w.text).join(' ')}\n`)
  }
  return cues.join('\n')
}

// ---------------------------------------------------------------------------------------------
// Voices

type Seed = { voice: Rec; meta: Record<string, string> } // meta is filter-only, never emitted

const PROVIDERS = 'elevenlabs minimax clone edge kokoro vbee fishaudio'.split(' ')
const VBEE_OWNERSHIP: readonly string[] = ['community', 'vbee', 'all']
const FISH_SORTS: readonly string[] = ['score', 'task_count', 'created_at', 'trending']
const VOICE_FILTERS =
  'tags tag language locale gender age accent category use_case descriptive'.split(' ')

/** Credits per 1,000 characters by provider (invented: the contract gives no prices). */
const RATES: Record<string, number> = {
  elevenlabs: 1000,
  minimax: 600,
  edge: 100,
  kokoro: 100,
  vbee: 300,
  fishaudio: 400
}

// Voice tables, one pipe-separated row each. Columns are named where they are read below.
const EDGE = `
vi-VN|Vietnamese|HoaiMy|NamMinh
en-US|English|Aria|Guy
en-GB|English|Sonia|Ryan
es-ES|Spanish|Elvira|Alvaro
fr-FR|French|Denise|Henri
de-DE|German|Katja|Conrad
ja-JP|Japanese|Nanami|Keita
pt-BR|Portuguese|Francisca|Antonio
it-IT|Italian|Elsa|Diego
ko-KR|Korean|SunHi|InJoon
zh-CN|Chinese|Xiaoxiao|Yunxi
hi-IN|Hindi|Swara|Madhur
ar-EG|Arabic|Salma|Shakir
ru-RU|Russian|Svetlana|Dmitry
nl-NL|Dutch|Colette|Maarten
tr-TR|Turkish|Emel|Ahmet`
const ELEVEN = `
21m00Tcm4TlvDq8ikWAM|Rachel|Female|young|american|premade|narration|calm
pNInz6obpgDQGcFmaJgB|Adam|Male|middle_aged|american|premade|narration|deep
TX3LPaxmHKxFdv7VOQHJ|Liam|Male|young|american|premade|social_media|articulate
hpp4J3VqNfWAUOO0d1Us|Bella|Female|middle_aged|american|premade|narration|professional
EXAVITQu4vr4xnSDxMaL|Sarah|Female|young|american|premade|news|soft
JBFqnCBsd6RMkjVDRZzb|George|Male|middle_aged|british|premade|narration|warm
XB0fDUnXU5powFXDhCwa|Charlotte|Female|young|swedish|premade|characters|seductive
onwK4e9ZLuTAKqWW03F9|Daniel|Male|middle_aged|british|premade|news|authoritative`
const MINIMAX = `
male-qn-qingse|Qingse|Male|Chinese|zh-CN
female-shaonv|Shaonv|Female|Chinese|zh-CN
female-yujie|Yujie|Female|Chinese|zh-CN
male-qn-jingying|Jingying|Male|Chinese|zh-CN
English_expressive_narrator|Expressive Narrator|Male|English|en-US
English_Graceful_Lady|Graceful Lady|Female|English|en-US`
const KOKORO = `
af_heart|Heart|Female|en-US
af_bella|Bella|Female|en-US
am_adam|Adam|Male|en-US
am_michael|Michael|Male|en-US
bf_emma|Emma|Female|en-GB
bm_george|George|Male|en-GB`
const VBEE = `
hn_female_ngochuyen_full_48k-fhg|Ngọc Huyền|Female|northern|news|vbee
hn_male_manhdung_news_48k-fhg|Mạnh Dũng|Male|northern|news|vbee
sg_female_thaotrinh_full_48k-fhg|Thảo Trinh|Female|southern|story|vbee
sg_male_minhhoang_full_48k-fhg|Minh Hoàng|Male|southern|advertise|vbee
hue_female_huonggiang_full_48k-fhg|Hương Giang|Female|central|book|vbee
hue_male_duyphuong_full_48k-fhg|Duy Phương|Male|central|education|vbee
hn_female_thuytrang_child_48k-fhg|Thùy Trang|Female|northern|children|community
sg_male_tuananh_review_48k-fhg|Tuấn Anh|Male|southern|review|community`
const FISH = `
Anchor|Male|en|news|9.1|5400|20|3
Storyteller|Female|en|story|9.4|8200|30|9
Mandarin Host|Female|zh|podcast|8.8|3100|10|7
Tokyo Guide|Male|ja|guide|8.5|2500|25|1
Seoul Narrator|Female|ko|narration|8.9|2900|15|5
Berlin Voice|Male|de|news|8.2|1800|5|2
Paris Reader|Female|fr|audiobook|9.0|3600|35|8
Madrid Host|Male|es|podcast|8.4|2200|40|4`
const LANGUAGES: Record<string, string> = {
  en: 'English',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  fr: 'French',
  es: 'Spanish'
}

const rows = (table: string): string[][] =>
  table
    .trim()
    .split('\n')
    .map((row) => row.split('|'))

function seed(
  id: string,
  name: string,
  language: string,
  gender: string,
  tags: string[],
  meta: Rec
): Seed {
  return { voice: { voice_id: id, name, language, gender, tags }, meta: meta as Seed['meta'] }
}

function buildCatalog(): Record<string, Seed[]> {
  const edge = rows(EDGE).flatMap(([locale, langName, female, male]) =>
    [
      ['Female', female],
      ['Male', male]
    ].map(([gender, who]) =>
      seed(
        `edge_${locale}-${who}Neural`,
        `${locale}-${who}Neural`,
        locale,
        gender,
        [locale, gender, 'standard'],
        { langName }
      )
    )
  )
  return {
    edge,
    elevenlabs: rows(ELEVEN).map(
      ([id, name, gender, age, accent, category, use_case, descriptive]) =>
        seed(`elevenlabs_${id}`, name, 'en-US', gender, [gender, accent, use_case], {
          langName: 'English',
          age,
          accent,
          category,
          use_case,
          descriptive
        })
    ),
    minimax: rows(MINIMAX).map(([id, name, gender, langName, code]) =>
      seed(`minimax_${id}`, name, code, gender, [code, gender, 'premium'], { langName })
    ),
    kokoro: rows(KOKORO).map(([id, name, gender, code]) =>
      seed(`kokoro_${id}`, name, code, gender, [code, gender, 'open'], { langName: 'English' })
    ),
    vbee: rows(VBEE).map(([id, name, gender, dialect, category, ownership]) =>
      seed(`vbee_${id}`, name, 'vi-VN', gender, ['vi-VN', gender, dialect], {
        langName: 'Vietnamese',
        locale: dialect,
        category,
        ownership
      })
    ),
    fishaudio: rows(FISH).map(
      ([name, gender, code, tag, score, task_count, created_at, trending]) => {
        const id = `fishaudio_${createHash('md5').update(name).digest('hex')}`
        return seed(id, name, code, gender, [tag], {
          langName: LANGUAGES[code],
          tag,
          score,
          task_count,
          created_at,
          trending
        })
      }
    )
  }
}

const CATALOG = buildCatalog()

function voiceMatches(
  row: Seed,
  key: string,
  wanted: string[],
  mode: Params['languageMatch']
): boolean {
  const { voice, meta } = row
  const language = String(voice.language).toLowerCase()
  const has = (v: string | undefined): boolean =>
    v !== undefined && wanted.includes(v.toLowerCase())
  if (key === 'tags' || key === 'tag') return (voice.tags as string[]).some(has)
  if (key === 'gender') return has(String(voice.gender))
  if (key === 'locale') return has(meta.locale ?? language)
  if (key === 'language') {
    const code = wanted.some((w) => language === w || language.startsWith(`${w}-`))
    return mode === 'code'
      ? code
      : mode === 'name'
        ? has(meta.langName)
        : code || has(meta.langName)
  }
  return has(meta[key])
}

function page(raw: string | null, fallback: number, max: number): number {
  const n = raw === null || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(n)) bad('page, page_size and limit must be integers')
  return Math.min(Math.max(n, 1), max)
}

// ---------------------------------------------------------------------------------------------
// Pronunciation dictionaries

function normaliseRules(input: unknown): Rule[] {
  if (!Array.isArray(input)) bad('rules must be an array')
  return input.map((raw: unknown, i) => {
    const rule = isRec(raw) ? raw : {}
    const matchType = rule.matchType ?? 'word'
    if (typeof rule.from !== 'string' || rule.from === '') bad(`rules[${i}].from is required`)
    if (typeof rule.to !== 'string') bad(`rules[${i}].to is required`)
    if (matchType !== 'word' && matchType !== 'contains')
      bad(`rules[${i}].matchType must be word or contains`)
    if (rule.caseSensitive !== undefined && typeof rule.caseSensitive !== 'boolean')
      bad(`rules[${i}].caseSensitive must be a boolean`)
    return { from: rule.from, to: rule.to, matchType, caseSensitive: rule.caseSensitive === true }
  })
}

function applyRules(text: string, rules: Rule[]): string {
  return rules.reduce((out, rule) => {
    const source = rule.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const body =
      rule.matchType === 'word' ? `(?<![\\p{L}\\p{N}_])${source}(?![\\p{L}\\p{N}_])` : source
    return out.replace(new RegExp(body, rule.caseSensitive ? 'gu' : 'giu'), () => rule.to)
  }, text)
}

const dictionaryOut = (d: Dictionary): Rec => ({ id: d.id, name: d.name, rules: d.rules })

// ---------------------------------------------------------------------------------------------
// Request plumbing

type UploadedFile = { field: string; name: string; type: string; size: number }
type ParsedBody = { kind: RecordedBody['kind']; size: number; fields: Rec; files: UploadedFile[] }

type Ctx = {
  s: State
  query: URLSearchParams
  params: Record<string, string>
  body: ParsedBody
  host: string
  record: RecordedRequest
}

type Reply = {
  status: number
  json?: unknown
  raw?: Buffer
  type?: string
  headers?: Record<string, string>
  drop?: boolean // destroy the socket instead of answering
}

type Handler = (c: Ctx) => Reply | Promise<Reply>
type Route = { method: string; re: RegExp; area: 'api' | 'files' | 'control'; handler: Handler }

const MAX_BODY = 64 * 1024 * 1024
const SECRET_HEADERS = new Set(['xi-api-key', 'authorization', 'cookie'])

const ok = (json: unknown): Reply => ({ status: 200, json })
const fail = (status: number, message: string, headers?: Record<string, string>): Reply => ({
  status,
  json: { success: false, message },
  headers
})

const asString = (v: unknown): string | undefined =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : undefined

function reqString(f: Rec, key: string, max = Infinity): string {
  const v = asString(f[key])
  if (v === undefined || v.trim() === '') bad(`${key} is required`)
  if (v.length > max) bad(`${key} must be at most ${max} characters`)
  return v
}

function optNumber(f: Rec, key: string, min: number, max: number): number | undefined {
  const raw = f[key]
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n < min || n > max)
    bad(`${key} must be a number between ${min} and ${max}`)
  return n
}

function optBool(f: Rec, key: string): boolean | undefined {
  const raw = f[key]
  if (raw === undefined || raw === null || raw === '') return undefined
  if (raw === true || raw === 'true' || raw === '1') return true
  if (raw === false || raw === 'false' || raw === '0') return false
  bad(`${key} must be true or false`)
}

const money = (s: State, n: number): number | string => (s.params.creditsAsString ? String(n) : n)
const price = (s: State, natural: number): number => (s.params.cost > 0 ? s.params.cost : natural)

async function readBody(req: IncomingMessage, url: URL): Promise<ParsedBody> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size <= MAX_BODY) chunks.push(chunk)
  }
  const body = (
    kind: ParsedBody['kind'],
    fields: Rec = {},
    files: UploadedFile[] = []
  ): ParsedBody => ({
    kind,
    size,
    fields,
    files
  })
  if (size === 0) return body('empty')
  if (size > MAX_BODY) return body('invalid')
  const buf = Buffer.concat(chunks)
  const type = String(req.headers['content-type'] ?? '')
  try {
    if (/^application\/json/i.test(type)) {
      const json: unknown = JSON.parse(buf.toString('utf8'))
      return isRec(json) ? body('json', json) : body('invalid')
    }
    const multipart = /^multipart\/form-data/i.test(type)
    if (multipart || /^application\/x-www-form-urlencoded/i.test(type)) {
      // Node's undici parses the client's multipart here: a bad body from the client fails loudly.
      const request = new Request(url.href, {
        method: 'POST',
        headers: { 'content-type': type },
        body: buf
      })
      const fields: Rec = {}
      const files: UploadedFile[] = []
      for (const [field, value] of (await request.formData()).entries()) {
        if (typeof value !== 'string') {
          files.push({ field, name: value.name, type: value.type, size: value.size })
        } else {
          const seen = fields[field]
          fields[field] =
            seen === undefined ? value : Array.isArray(seen) ? [...seen, value] : [seen, value]
        }
      }
      return body(multipart ? 'multipart' : 'urlencoded', fields, files)
    }
  } catch {
    return body('invalid')
  }
  return body('text')
}

function summarise(body: ParsedBody): RecordedBody {
  const fields: Rec = {}
  for (const [key, value] of Object.entries(body.fields)) {
    const long = typeof value === 'string' && value.length > 4000
    fields[key] = long ? `${value.slice(0, 4000)}...[${value.length} chars]` : value
  }
  const files = body.files.map(({ field, name, type, size }) => ({ field, name, type, size }))
  return { kind: body.kind, size: body.size, fields, files }
}

function redact(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const text = Array.isArray(value) ? value.join(', ') : String(value)
    out[name] = SECRET_HEADERS.has(name) ? `<redacted:${text.length}>` : text
  }
  return out
}

function authorize(s: State, headers: IncomingHttpHeaders): void {
  const raw = headers['xi-api-key']
  const key = Array.isArray(raw) ? raw[0] : raw
  if (!key) throw new Problem(401, 'Missing API key')
  const accepted = s.apiKey !== null ? key === s.apiKey : !/^(bad|wrong|invalid)([-_]|$)/i.test(key)
  if (s.params.authFail || !accepted) throw new Problem(401, 'Invalid API key')
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  reply: Reply,
  record: RecordedRequest
): void {
  if (reply.drop) {
    req.socket.destroy()
    return
  }
  const payload = reply.raw ?? Buffer.from(JSON.stringify(reply.json ?? {}))
  const type = reply.type ?? 'application/json; charset=utf-8'
  res.writeHead(reply.status, {
    'content-type': type,
    'content-length': payload.length,
    ...reply.headers
  })
  res.end(req.method === 'HEAD' ? undefined : payload)
  record.status = reply.status
}

// ---------------------------------------------------------------------------------------------
// Tasks

const NATURAL: Record<Kind, UrlShape> = {
  tts: 'audio_url',
  sfx: 'output_uri',
  music: 'audio_url'
}
const SHAPE_CYCLE: UrlShape[] = ['audio_url', 'output_uri', 'top_output_uri', 'all_audio_urls']
const CLIP_DURATIONS = [187.96, 176.4] // what clips[].duration claims; the files are shorter

const taskStatus = (t: Task): 'doing' | 'done' | 'error' =>
  t.polls <= t.doingPolls ? 'doing' : t.final
const findTask = (s: State, id: string): Task | undefined =>
  s.tasks.find((t) => t.id === id && !t.deleted)

function createTask(s: State, spec: Spec): Task {
  const p = s.params
  const id = randomUUID()
  const shape =
    p.urlShape === 'cycle' ? SHAPE_CYCLE[s.counters.created++ % SHAPE_CYCLE.length] : p.urlShape
  const task: Task = {
    ...spec,
    id,
    createdAt: new Date().toISOString(),
    doingPolls: p.polls,
    final: p.taskError ? 'error' : 'done',
    errorMessage: p.errorMessage,
    polls: 0,
    dropped: 0,
    refunded: false,
    deleted: false,
    shape,
    audio: [],
    json: null,
    srt: null,
    cover: null
  }
  const audio = (name: string, seconds: number, type: string): void => {
    s.files.set(name, p.html ? { kind: 'html', type } : { kind: 'audio', seconds, type })
    task.audio.push(name)
  }
  const srt = (text: string): void => {
    task.srt = `${id}.srt`
    s.files.set(task.srt, { kind: 'srt', text, seconds: spec.seconds })
  }
  if (spec.kind === 'tts') {
    audio(`${id}.mp3`, spec.seconds, 'audio/mpeg')
    if (spec.transcript && p.transcript !== 'none') {
      if (p.transcript === 'words') {
        task.json = `${id}.json`
        const words: FileEntry = {
          kind: 'words',
          text: spec.spoken,
          seconds: spec.seconds,
          shape: p.jsonShape
        }
        s.files.set(task.json, words)
      }
      srt(spec.spoken)
    }
  } else if (spec.kind === 'sfx') {
    audio(`${id}.mp3`, spec.seconds, 'audio/mpeg')
  } else if (spec.kind === 'music') {
    audio(`${id}-1.mp3`, spec.seconds, 'audio/mpeg')
    audio(`${id}-2.mp3`, spec.seconds + 1, 'audio/mpeg')
    task.cover = `${id}-cover.png`
    s.files.set(task.cover, { kind: 'bytes', bytes: PNG, type: 'image/png' })
    s.files.set(`${id}-stream.mp3`, { kind: 'audio', seconds: spec.seconds, type: 'audio/mpeg' })
  }
  s.balance -= spec.cost
  s.tasks.push(task)
  return task
}

/** Result URLs, placed where `shape` says (default: where the contract puts them for this kind). */
function resultFor(t: Task, u: (name: string) => string): { metadata: Rec; top: Rec } {
  const urls = t.audio.map(u)
  const metadata: Rec = { ...t.meta }
  const top: Rec = {}
  const shape = t.shape === 'default' ? NATURAL[t.kind] : t.shape
  if (shape === 'audio_url') metadata.audio_url = urls[0]
  else if (shape === 'output_uri') metadata.output_uri = urls[0]
  else if (shape === 'top_output_uri') top.output_uri = urls[0]
  else metadata.all_audio_urls = urls
  if (t.kind === 'music' && t.shape === 'default' && t.cover) {
    const cover = u(t.cover)
    const clip = (url: string, i: number): Rec => ({
      id: `${t.id.slice(0, 8)}-clip-${i + 1}`,
      title: t.extra.title,
      audio_url: url,
      image_url: cover,
      duration: CLIP_DURATIONS[i],
      tags: t.extra.tags
    })
    Object.assign(metadata, {
      all_audio_urls: urls,
      image_url: cover,
      suno_result: { clips: urls.map(clip) }
    })
  }
  if (t.json) metadata.json_url = u(t.json)
  if (t.srt) metadata.srt_url = u(t.srt)
  return { metadata, top }
}

function taskPayload(s: State, t: Task, u: (name: string) => string): Rec {
  const status = taskStatus(t)
  const doing = Math.floor(
    ((status === 'doing' ? t.polls : t.doingPolls) * 100) / (t.doingPolls + 1)
  )
  const out: Rec = {
    id: t.id,
    created_at: t.createdAt,
    status,
    error_message: status === 'error' ? t.errorMessage : null,
    credit_cost: money(s, t.cost),
    progress: status === 'done' ? 100 : doing,
    type: t.type
  }
  if (t.text !== null) {
    const chars = Array.from(t.text)
    Object.assign(out, {
      text: chars.slice(0, 1000).join(''),
      text_length: chars.length,
      text_truncated: chars.length > 1000
    })
  }
  if (status === 'done') {
    const { metadata, top } = resultFor(t, u)
    Object.assign(out, top, { metadata: { ...t.ident, ...metadata } })
  } else if (status === 'doing' && t.kind === 'music') {
    const stream = u(`${t.id}-stream.mp3`)
    out.metadata = {
      ...t.ident,
      stream_url: stream,
      suno_stream_result: { clips: [{ stream_url: stream }] }
    }
  } else {
    out.metadata = { ...t.ident }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Submit validation: each returns the Spec of a valid request, or throws a Problem

const spec = (o: Partial<Spec> & Pick<Spec, 'kind' | 'type' | 'cost' | 'seconds'>): Spec => ({
  text: null,
  ident: {},
  meta: {},
  spoken: '',
  transcript: false,
  extra: {},
  ...o
})

function checkVoice(voiceId: unknown, label: string): string {
  const id = asString(voiceId)
  const provider = PROVIDERS.find((p) => id?.startsWith(`${p}_`) && id.length > p.length + 1)
  if (!id || !provider) {
    bad(`${label} must use a provider prefix: ${PROVIDERS.map((p) => `${p}_`).join(', ')}`)
  }
  // Luca never clones a voice, so the account has none of its own to speak with
  if (provider === 'clone') bad(`Voice not found: ${id}`)
  return provider
}

function validateSpeech(c: Ctx, dialogue: boolean): Spec {
  const { s } = c
  const f = c.body.fields
  const text = reqString(f, 'text', 1_000_000)
  const transcript = optBool(f, 'with_transcript') ?? false
  const dictionary = optNumber(f, 'pronunciation_dictionary_id', 1, Number.MAX_SAFE_INTEGER)
  if (dictionary !== undefined && !s.dictionaries.some((d) => d.id === dictionary && !d.deleted))
    bad('Pronunciation dictionary not found')
  let providers: string[]
  let spoken = text
  if (dialogue) {
    let speakers: unknown = f.speakers
    try {
      if (typeof speakers === 'string') speakers = JSON.parse(speakers)
    } catch {
      bad('speakers must be a JSON array')
    }
    if (!Array.isArray(speakers) || speakers.length < 2)
      bad('speakers must be an array of at least 2 speakers')
    providers = speakers.map((speaker: unknown, i) => {
      if (!isRec(speaker)) bad(`speakers[${i}] must be an object`)
      if ('with_transcript' in speaker) bad('with_transcript is top-level only')
      optNumber(speaker, 'speed', 0.5, 1.5)
      return checkVoice(speaker.voice_id, `speakers[${i}].voice_id`)
    })
    optNumber(f, 'delay', 0, 5)
    const lines: string[] = []
    for (const line of text.split(/\r?\n/).filter((l) => l.trim() !== '')) {
      const labelled = /^([A-Z])>\s*(.*)$/.exec(line)
      if (!labelled) bad('Every line must start with a label such as "A>"')
      if (labelled[1].charCodeAt(0) - 65 >= providers.length)
        bad(`Label ${labelled[1]}> has no matching speaker`)
      lines.push(labelled[2])
    }
    spoken = lines.join('\n')
  } else {
    optNumber(f, 'speed', 0.5, 1.5)
    providers = [checkVoice(f.voice_id, 'voice_id')]
  }
  const rate = providers.reduce((sum, p) => sum + RATES[p], 0) / providers.length
  const fileName = asString(f.file_name)
  return spec({
    kind: 'tts',
    type: providers.every((p) => p === 'minimax') ? 'minimax_tts' : 'tts',
    cost: price(s, Math.max(1, Math.ceil((Array.from(spoken).length * rate) / 1000))),
    seconds: s.params.audioSeconds,
    text,
    ident: fileName ? { file_name: fileName } : {},
    spoken,
    transcript
  })
}

function validateSfx(c: Ctx): Spec {
  const f = c.body.fields
  const text = reqString(f, 'text', 450)
  const duration = optNumber(f, 'duration_seconds', 0.5, 30)
  optNumber(f, 'prompt_influence', 0, 1)
  optBool(f, 'loop')
  const cost = price(c.s, duration === undefined ? 200 : Math.max(50, Math.ceil(50 * duration)))
  return spec({
    kind: 'sfx',
    type: 'sound_effect',
    cost,
    seconds: duration ?? c.s.params.audioSeconds,
    text,
    ident: { prompt: text },
    meta: { character_cost: cost, duration_seconds: duration ?? null }
  })
}

function validateMusic(c: Ctx): Spec {
  const f = c.body.fields
  const mode = asString(f.create_mode) ?? 'simple'
  if (mode !== 'simple' && mode !== 'custom') bad('create_mode must be simple or custom')
  optBool(f, 'make_instrumental')
  const title = asString(f.title) ?? 'Fake Song'
  if (title.length > 80) bad('title must be at most 80 characters')
  const lyrics = asString(f.lyrics)
  const tags = asString(f.tags)
  let prompt: string
  if (mode === 'simple') {
    prompt = reqString(f, 'gpt_description_prompt', 500)
  } else {
    const gender = asString(f.vocal_gender)
    if (gender !== undefined && gender !== 'f' && gender !== 'm') bad('vocal_gender must be f or m')
    if (!lyrics && !tags) bad('lyrics or tags is required in custom mode')
    if ((lyrics ?? '').length > 5000) bad('lyrics must be at most 5000 characters')
    if ((tags ?? '').length > 1000) bad('tags must be at most 1000 characters')
    prompt = lyrics || tags || ''
  }
  return spec({
    kind: 'music',
    type: 'suno_music',
    cost: price(c.s, 3600),
    seconds: c.s.params.audioSeconds,
    text: prompt,
    ident: { prompt },
    meta: {
      create_mode: mode,
      major_model_version: 'v4.5-all',
      title,
      lyrics: lyrics ?? '[Verse 1]\nla la la'
    },
    extra: { title, tags: tags ?? 'pop' }
  })
}

/** The shared submit path: 429, body and field checks, credit check, create, optional 502. */
const submit =
  (validate: (c: Ctx) => Spec | Promise<Spec>): Handler =>
  async (c) => {
    const { s } = c
    if (s.counters.rateLimited < s.params.rateLimit) {
      s.counters.rateLimited++
      return fail(429, 'Too many requests, the queue is full', {
        'retry-after': String(s.params.retryAfter)
      })
    }
    if (c.body.kind === 'invalid') bad('Could not parse the request body')
    const validated = await validate(c)
    if (s.balance < validated.cost) throw new Problem(401, 'Insufficient credits')
    const task = createTask(s, validated)
    c.record.taskId = task.id
    if (s.counters.ambiguous < s.params.ambiguous) {
      s.counters.ambiguous++
      throw new Problem(502, 'Bad gateway')
    }
    const balance =
      s.params.ecRemain === 'always' || (s.params.ecRemain === 'auto' && task.kind !== 'tts')
    return ok({
      success: true,
      task_id: task.id,
      ...(balance ? { ec_remain_credits: money(s, s.balance) } : {})
    })
  }

// ---------------------------------------------------------------------------------------------
// Handlers

function fileUrls(c: Ctx): (name: string) => string {
  const host = c.host
  const alias = host.startsWith('localhost')
    ? host.replace('localhost', '127.0.0.1')
    : host.replace('127.0.0.1', 'localhost')
  return (name) => `http://${c.s.params.aliasHost ? alias : host}/files/${name}`
}

function getCredits(c: Ctx): Reply {
  if (c.s.params.creditsEndpoint401 && c.s.balance <= 0)
    throw new Problem(401, 'Insufficient credits')
  return ok({ success: true, credits: money(c.s, c.s.balance) })
}

function listVoices(c: Ctx): Reply {
  const { s, query: q } = c
  const provider = q.get('provider')?.toLowerCase()
  if (!provider) bad('provider is required')
  if (!PROVIDERS.includes(provider)) bad(`provider must be one of: ${PROVIDERS.join(', ')}`)
  const ownership = q.get('voice_ownership')
  if (provider === 'vbee' && ownership && !VBEE_OWNERSHIP.includes(ownership))
    bad('voice_ownership must be community, vbee or all')
  const sort = q.get('sort')
  if (provider === 'fishaudio' && sort && !FISH_SORTS.includes(sort))
    bad(`sort must be one of: ${FISH_SORTS.join(', ')}`)
  let list = CATALOG[provider] ?? [] // the account has no voice of its own (provider=clone)
  const term = (q.get('search') ?? q.get('q'))?.trim().toLowerCase()
  if (term) {
    const haystack = ({ voice, meta }: Seed): string =>
      [...Object.values(voice), meta.langName].join(' ').toLowerCase()
    list = list.filter((row) => haystack(row).includes(term))
  }
  for (const key of VOICE_FILTERS) {
    const wanted = (q.get(key) ?? '')
      .toLowerCase()
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
    if (wanted.length > 0)
      list = list.filter((row) => voiceMatches(row, key, wanted, s.params.languageMatch))
  }
  if (provider === 'vbee' && ownership && ownership !== 'all')
    list = list.filter((row) => row.meta.ownership === ownership)
  if (provider === 'fishaudio' && sort)
    list = [...list].sort((a, b) => Number(b.meta[sort]) - Number(a.meta[sort]))
  const pageNo = page(q.get('page'), 1, 1_000_000)
  const size = page(q.get('page_size') ?? q.get('limit'), 30, 100)
  const u = fileUrls(c)
  const data = list.slice((pageNo - 1) * size, pageNo * size).map(({ voice }) => {
    const slug = String(voice.voice_id).replace(/[^\w.-]/g, '_')
    return { ...voice, preview_url: u(`preview-${slug}.mp3`) }
  })
  const pagination = {
    page: pageNo,
    page_size: size,
    total: list.length,
    has_more: pageNo * size < list.length
  }
  return ok({ success: true, format_version: '2026-05-29', data, pagination })
}

function findDictionary(c: Ctx): Dictionary {
  const found = c.s.dictionaries.find((d) => String(d.id) === c.params.id && !d.deleted)
  if (!found) throw new Problem(404, 'Dictionary not found')
  return found
}

function listDictionaries(c: Ctx): Reply {
  const list = c.s.dictionaries.filter((d) => !d.deleted).map(dictionaryOut)
  const shape = c.s.params.dictShape
  return shape === 'array' ? { status: 200, json: list } : ok({ success: true, [shape]: list })
}

function createDictionary(c: Ctx): Reply {
  const name = reqString(c.body.fields, 'name')
  const dictionary: Dictionary = {
    id: c.s.nextDictionary++,
    name,
    rules: normaliseRules(c.body.fields.rules),
    deleted: false
  }
  c.s.dictionaries.push(dictionary)
  return ok({ success: true, dictionary: dictionaryOut(dictionary) })
}

function updateDictionary(c: Ctx): Reply {
  const dictionary = findDictionary(c)
  const f = c.body.fields
  if (f.name !== undefined) dictionary.name = reqString(f, 'name')
  if (f.rules !== undefined) dictionary.rules = normaliseRules(f.rules)
  return ok({ success: true, dictionary: dictionaryOut(dictionary) })
}

function deleteDictionary(c: Ctx): Reply {
  findDictionary(c).deleted = true // soft delete, as the contract says
  return ok({ success: true })
}

function previewDictionary(c: Ctx): Reply {
  const text = asString(c.body.fields.text)
  if (text === undefined) bad('text is required')
  return ok({
    success: true,
    input: text,
    output: applyRules(text, normaliseRules(c.body.fields.rules))
  })
}

function pollTask(c: Ctx): Reply {
  const { s } = c
  c.record.taskId = c.params.id
  const task = findTask(s, c.params.id)
  if (!task) throw new Problem(404, 'Task not found')
  if (task.polls >= s.params.dropAfter && task.dropped < s.params.drops) {
    task.dropped++
    return { status: 0, drop: true }
  }
  if (task.polls <= task.doingPolls) task.polls++
  if (taskStatus(task) === 'error' && !task.refunded) {
    task.refunded = true
    s.balance += task.cost
  }
  return ok(taskPayload(s, task, fileUrls(c)))
}

function taskFull(c: Ctx): Reply {
  c.record.taskId = c.params.id
  const task = findTask(c.s, c.params.id)
  if (!task) throw new Problem(404, 'Task not found')
  const text = task.text ?? ''
  return ok({ id: task.id, text, text_length: Array.from(text).length, text_truncated: false })
}

function listTasks(c: Ctx): Reply {
  const { s, query: q } = c
  const pageNo = page(q.get('page'), 1, 1_000_000)
  const limit = page(q.get('limit') ?? q.get('page_size'), 20, 100)
  const type = q.get('type') // optional: without it every task type is listed
  const matching = s.tasks.filter((t) => !t.deleted && (!type || t.type === type)).reverse()
  const u = fileUrls(c)
  const data = matching.slice((pageNo - 1) * limit, pageNo * limit).map((t) => taskPayload(s, t, u))
  if (s.params.tasksShape === 'array') return { status: 200, json: data }
  const pagination = {
    page: pageNo,
    page_size: limit,
    limit,
    total: matching.length,
    has_more: pageNo * limit < matching.length
  }
  return ok({ success: true, [s.params.tasksShape]: data, pagination })
}

function deleteTasks(c: Ctx): Reply {
  const { s } = c
  const ids = c.body.fields.task_ids
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string'))
    bad('task_ids must be a non-empty array of task ids')
  let refund = 0
  for (const task of ids.map((id) => findTask(s, id))) {
    if (!task) continue
    task.deleted = true
    if (s.params.deleteRefunds && taskStatus(task) === 'doing' && !task.refunded) {
      task.refunded = true
      s.balance += task.cost
      refund += task.cost
    }
  }
  return ok({ success: true, refund_credits: refund })
}

function serveFile(c: Ctx): Reply {
  const name = c.params.name
  const preview: FileEntry | undefined = /^preview-[\w.-]+\.mp3$/.test(name)
    ? { kind: 'audio', seconds: 2, type: 'audio/mpeg' }
    : undefined
  const entry = c.s.files.get(name) ?? preview
  if (!entry) throw new Problem(404, 'File not found')
  switch (entry.kind) {
    case 'audio':
      return {
        status: 200,
        raw: c.s.audio.make(entry.seconds),
        type: entry.type
      }
    case 'bytes':
      return { status: 200, raw: entry.bytes, type: entry.type }
    case 'html':
      return { status: 200, raw: Buffer.from(HTML_PAGE), type: entry.type }
    case 'words': {
      const json = JSON.stringify(wordsJson(entry.text, entry.seconds, entry.shape))
      return { status: 200, raw: Buffer.from(json), type: 'application/json' }
    }
    case 'srt':
      return {
        status: 200,
        raw: Buffer.from(srtText(entry.text, entry.seconds)),
        type: 'application/x-subrip'
      }
  }
}

function controlState(c: Ctx): Reply {
  const { s } = c
  const leaks = s.requests.filter((r) => r.keyLeaked).length
  const counts = { tasks: s.tasks.length, requests: s.requests.length, leaks }
  return ok({
    success: true,
    scenario: s.scenario,
    params: s.params,
    credits: s.balance,
    ...counts,
    scenarios: Object.keys(SCENARIOS)
  })
}

function controlSet(c: Ctx): Reply {
  const f = c.body.fields
  if (f.params !== undefined && !isRec(f.params)) bad('params must be an object')
  if (f.scenario !== undefined && typeof f.scenario !== 'string') bad('scenario must be a string')
  if (f.reset === true) resetState(c.s)
  applyScenario(
    c.s,
    (f.scenario as string | undefined) ?? c.s.scenario,
    (f.params as Rec | undefined) ?? {}
  )
  return controlState(c)
}

// ---------------------------------------------------------------------------------------------
// Routing and server

function route(
  method: string,
  pattern: string,
  handler: Handler,
  area: Route['area'] = 'api'
): Route {
  return {
    method,
    re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
    area,
    handler
  }
}

const ROUTES: Route[] = [
  route('GET', '/v1/credits', getCredits),
  route('GET', '/v1/health-check', (c) => ok({ success: true, data: c.s.params.health })),
  route('GET', '/v3/voices', listVoices),
  route(
    'POST',
    '/v3/text-to-speech',
    submit((c) => validateSpeech(c, false))
  ),
  route(
    'POST',
    '/v3/text-to-speech/dialogue',
    submit((c) => validateSpeech(c, true))
  ),
  route('GET', '/v3/dictionaries', listDictionaries),
  route('POST', '/v3/dictionaries', createDictionary),
  route('POST', '/v3/dictionaries/preview', previewDictionary),
  route('GET', '/v3/dictionaries/:id', (c) =>
    ok({ success: true, dictionary: dictionaryOut(findDictionary(c)) })
  ),
  route('PUT', '/v3/dictionaries/:id', updateDictionary),
  route('DELETE', '/v3/dictionaries/:id', deleteDictionary),
  route('POST', '/v1/task/sound-effect', submit(validateSfx)),
  route('POST', '/v1s/task/music-generation', submit(validateMusic)),
  route('GET', '/v1/tasks', listTasks),
  route('POST', '/v1/task/delete', deleteTasks),
  route('GET', '/v1/task/:id/full', taskFull),
  route('GET', '/v1/task/:id', pollTask),
  route('GET', '/files/:name', serveFile, 'files'),
  route('GET', '/__control', controlState, 'control'),
  route('POST', '/__control', controlSet, 'control')
]

function matchRoute(
  method: string,
  path: string
): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    const m = route.method === method ? route.re.exec(path) : null
    if (m) return { route, params: { ...m.groups } }
  }
  return null
}

async function handle(s: State, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const method = req.method ?? 'GET'
  const body = await readBody(req, url)
  const found = matchRoute(method === 'HEAD' ? 'GET' : method, url.pathname)
  const record: RecordedRequest = {
    at: Date.now(),
    method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: redact(req.headers),
    body: summarise(body),
    scenario: s.scenario,
    status: 0,
    keyLeaked: req.headers['xi-api-key'] !== undefined && found?.route.area === 'files',
    taskId: null
  }
  s.requests.push(record)
  let reply: Reply
  try {
    if (!found) throw new Problem(404, `Not found: ${method} ${url.pathname}`)
    if (found.route.area === 'api') authorize(s, req.headers)
    const host = req.headers.host ?? '127.0.0.1'
    reply = await found.route.handler({
      s,
      query: url.searchParams,
      params: found.params,
      body,
      host,
      record
    })
  } catch (err) {
    reply =
      err instanceof Problem
        ? fail(err.status, err.message)
        : fail(500, `Fake server error: ${String(err)}`)
  }
  send(req, res, reply, record)
}

function envParams(): Rec {
  const raw = process.env.FAKE_AI33_PARAMS
  const parsed: unknown = raw ? JSON.parse(raw) : {}
  if (!isRec(parsed)) throw new Error('FAKE_AI33_PARAMS must be a JSON object')
  return parsed
}

export async function startFakeAi33(opts: StartOptions = {}): Promise<FakeAi33> {
  const s: State = {
    scenario: 'ok',
    overrides: {},
    params: structuredClone(DEFAULTS),
    apiKey: opts.key ?? process.env.FAKE_AI33_KEY ?? null,
    balance: 0,
    counters: { rateLimited: 0, ambiguous: 0, created: 0 },
    tasks: [],
    files: new Map(),
    dictionaries: [],
    nextDictionary: 1,
    audio: createAudio(),
    requests: []
  }
  const scenario = opts.scenario ?? process.env.FAKE_AI33_SCENARIO ?? 'ok'
  applyScenario(s, scenario, opts.params ?? (opts.scenario === undefined ? envParams() : {}))
  const server = createServer((req, res) => {
    handle(s, req, res).catch((err) =>
      res.destroy(err instanceof Error ? err : new Error(String(err)))
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests: s.requests,
    setScenario: (name, params) => applyScenario(s, name, params ?? {}),
    reset: () => resetState(s),
    leaks: () => s.requests.filter((r) => r.keyLeaked),
    credits: () => s.balance,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}

function isMain(): boolean {
  try {
    return (
      process.argv[1] !== undefined &&
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    )
  } catch {
    return false
  }
}

if (isMain()) {
  startFakeAi33({ port: Number(process.env.FAKE_AI33_PORT ?? 8787) }).then(
    (fake) => {
      console.log(`fake ai33 listening on ${fake.url}`)
      console.log(
        `scenario ${process.env.FAKE_AI33_SCENARIO ?? 'ok'}; switch with POST ${fake.url}/__control`
      )
      const stop = (): void => void fake.close().then(() => process.exit(0))
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
    },
    (err) => {
      console.error(
        `fake ai33 failed to start: ${err instanceof Error ? err.message : String(err)}`
      )
      process.exit(1)
    }
  )
}
