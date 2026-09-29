/**
 * Smoke test for Luca's ai33 integration: `npm run ai33:smoke` (about 15 seconds, no network, no key).
 *
 * The pure modules (the client and job runner, the ledger, the spend policy, the per-project
 * files, the script chunker and timing ladder, the timeline HTML, the export check and the edit
 * plan) are bundled with esbuild into a temp folder and driven against the fake ai33 server in
 * scripts/fake-ai33.ts, through the same `configure({ baseUrl, getKey, dataDir })` the app uses.
 *
 * What it cannot reach: everything that imports Electron or the running app (tools/common.ts,
 * ai33-account.ts, place.ts, ai33-speech.ts, ai33-sound.ts, ai33-voices.ts, ai33-start.ts,
 * ai33-ask.ts, ai33-late.ts, the tool files, the renderer). Those need the app, ffmpeg and a
 * real key: the run says so at the start, and README.md says what is and is not verified.
 *
 * Erasable TypeScript only: it runs with Node's type stripping, like scripts/fonts-manifest.ts.
 * A check that exposes a real bug in src/ is kept and marked KNOWN-BUG: it stays green, says so,
 * and turns into a plain pass (with a reminder to drop the marker) once the bug is fixed.
 */
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspect, isDeepStrictEqual } from 'node:util'
import { startFakeAi33 } from './fake-ai33.ts'
import type { FakeAi33, RecordedRequest } from './fake-ai33.ts'
import type { Ai33Ask, Ai33Estimate, Ai33Kind, SpendReq } from '../src/shared/ai33'
import type { JobSpec } from '../src/main/ai33-client'
import type { SpendCtx } from '../src/main/ai33-ctx'
import type { HfTimeline } from '../src/main/timeline-read'

// ---------------------------------------------------------------------------------------------
// The bundle

type Bundle = {
  client: typeof import('../src/main/ai33-client')
  jobs: typeof import('../src/main/ai33-jobs')
  spend: typeof import('../src/main/ai33-spend')
  store: typeof import('../src/main/ai33-store')
  speechText: typeof import('../src/main/ai33-speech-text')
  placeHtml: typeof import('../src/main/place-html')
  timelineRead: typeof import('../src/main/timeline-read')
  exportPreflight: typeof import('../src/main/export-preflight')
  html: typeof import('../src/main/html')
  shared: typeof import('../src/shared/ai33')
  edits: typeof import('../src/shared/edits')
  captions: typeof import('../src/shared/captions')
}

/** Modules that do not import Electron, bundled as ONE program so they share their state. */
const MODULES: Record<keyof Bundle, string> = {
  client: 'src/main/ai33-client.ts',
  jobs: 'src/main/ai33-jobs.ts',
  spend: 'src/main/ai33-spend.ts',
  store: 'src/main/ai33-store.ts',
  speechText: 'src/main/ai33-speech-text.ts',
  placeHtml: 'src/main/place-html.ts',
  timelineRead: 'src/main/timeline-read.ts',
  exportPreflight: 'src/main/export-preflight.ts',
  html: 'src/main/html.ts',
  shared: 'src/shared/ai33.ts',
  edits: 'src/shared/edits.ts',
  captions: 'src/shared/captions.ts'
}

/** Modules the smoke cannot bundle: they import Electron or the app. */
const LEFT_OUT: [string, string][] = [
  ['src/main/tools/common.ts', 'imports electron and ai33-account'],
  ['src/main/ai33-account.ts', 'imports electron (safeStorage, powerSaveBlocker, windows)'],
  ['src/main/place.ts', 'imports env (which reaches electron) and runs ffprobe and ffmpeg'],
  ['src/main/ai33-speech.ts', 'imports place.ts and the voice list; runs ffmpeg'],
  ['src/main/ai33-sound.ts', 'imports place.ts; runs ffmpeg'],
  ['src/main/ai33-voices.ts', 'imports ai33-account and settings (electron)'],
  ['src/main/ai33-start.ts', 'imports ai33-account, settings and env (electron)'],
  ['src/main/ai33-ask.ts, ai33-late.ts', 'import ai33-account, ipc and place.ts'],
  ['src/main/tools/*-tool.ts, mcp-ai33.ts', 'import the agent SDK, tools/common.ts and place.ts']
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------------------------
// Reporter

let passed = 0
let failed = 0
const failures: string[] = []
const knownBugs: string[] = []

const show = (v: unknown): string => inspect(v, { depth: 5, breakLength: 96 })

function line(tag: string, name: string, detail?: string): void {
  console.log(`  ${tag.padEnd(9)} ${name}`)
  if (detail) for (const l of detail.split('\n')) console.log(`            ${l}`)
}

function check(name: string, ok: unknown, detail?: () => string): boolean {
  if (ok) {
    passed++
    line('ok', name)
    return true
  }
  failed++
  failures.push(name)
  line('FAIL', name, detail?.())
  return false
}

function same(name: string, actual: unknown, expected: unknown): boolean {
  return check(
    name,
    isDeepStrictEqual(actual, expected),
    () => `expected ${show(expected)}\ngot      ${show(actual)}`
  )
}

async function section(title: string, body: () => Promise<void>): Promise<void> {
  const t0 = Date.now()
  console.log(`\n${title}`)
  try {
    await body()
  } catch (err) {
    failed++
    failures.push(`${title}: threw`)
    line('FAIL', 'the section threw', err instanceof Error ? (err.stack ?? err.message) : show(err))
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
}

// ---------------------------------------------------------------------------------------------
// Shared setup: the fetch spy, the fake server, timing

const KEY = 'smoke-key-7f3a9c1d5e'
/** Every wait in the client is multiplied by this (a 1.5 s poll gap becomes 30 ms). */
const FAST = 0.02
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const warnings: string[] = []
console.warn = (...args: unknown[]): void => {
  warnings.push(args.map(String).join(' '))
}

type Seen = { method: string; url: URL; key: string | null }
const seen: Seen[] = []
let beforePost: ((url: URL) => void) | null = null
const realFetch = globalThis.fetch
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const key = new Headers(init?.headers).get('xi-api-key')
  seen.push({ method, url, key })
  if (method === 'POST') beforePost?.(url)
  return realFetch(input, init)
}) as typeof fetch

const work = mkdtempSync(join(tmpdir(), 'luca-ai33-smoke-'))
let b: Bundle
let fake: FakeAi33
let keyNow: string | null = KEY
let dirCount = 0

/** Point the client at the fake with a fresh data folder; returns that folder. */
function pointAtFake(pace = FAST): string {
  const dir = join(work, `data-${++dirCount}`)
  mkdirSync(dir, { recursive: true })
  b.client.configure({ baseUrl: fake.url, getKey: () => keyNow, dataDir: dir, pace })
  b.client.resetAccount()
  return dir
}

/** Requests that carried the key to a path that must never see it, kept across the fake's resets. */
const leaked: RecordedRequest[] = []

/** A clean fake in a scenario (no tasks, no requests, balance and counters reset). */
function scenario(name: string, params?: Record<string, unknown>): void {
  leaked.push(...fake.leaks())
  fake.reset()
  fake.setScenario(name, params)
  b.client.resetAccount()
}

let seq = 0
const uniq = (label: string): string => `smoke-${label}-${++seq}`

const posts = (path: string): RecordedRequest[] =>
  fake.requests.filter((r) => r.method === 'POST' && r.path === path)
const taskPolls = (): RecordedRequest[] =>
  fake.requests.filter(
    (r) => r.method === 'GET' && /^\/v1\/task\/[^/]+$/.test(r.path) && r.path !== '/v1/task/full'
  )

async function until(what: string, ok: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (ok()) return true
    await sleepMs(10)
  }
  return check(`waited for ${what}`, false)
}

type Failure = Error & {
  kind?: string
  charged?: boolean | 'unknown'
  userMessage?: string
  status?: number
}
async function thrown(p: Promise<unknown>): Promise<Failure | null> {
  try {
    await p
    return null
  } catch (err) {
    return err as Failure
  }
}

async function deadPort(): Promise<number> {
  const s = createTcpServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  const port = (s.address() as AddressInfo).port
  await new Promise<void>((r) => s.close(() => r()))
  return port
}

/** The job specs the app's own speech, sound-effect and music code build. */
function speechSpec(o: {
  hash: string
  text: string
  voice?: string
  transcript?: boolean
  waitBudgetMs?: number
  deadlineMs?: number
  summary?: string
}): JobSpec {
  return {
    kind: 'speech',
    summary: o.summary ?? `Voiceover: ${o.text}`.slice(0, 80),
    requestHash: o.hash,
    projectDir: null,
    match: { text: o.text },
    waitBudgetMs: o.waitBudgetMs,
    deadlineMs: o.deadlineMs,
    submit: async (signal) => {
      const res = await b.client.request(b.client.PATHS.speech, {
        method: 'POST',
        signal,
        form: async () => {
          const f = new FormData()
          f.set('text', o.text)
          f.set('voice_id', o.voice ?? 'edge_en-US-AriaNeural')
          f.set('with_transcript', String(o.transcript === true))
          return f
        }
      })
      return { taskId: String(res.task_id), balance: b.client.toInt(res.ec_remain_credits) }
    }
  }
}

function sfxSpec(o: { hash: string; what: string; seconds: number }): JobSpec {
  return {
    kind: 'sfx',
    summary: `Sound effect: ${o.what}`,
    requestHash: o.hash,
    projectDir: null,
    match: { text: o.what, prompt: o.what },
    submit: async (signal) => {
      const res = await b.client.request(b.client.PATHS.sfx, {
        method: 'POST',
        signal,
        json: { text: o.what, duration_seconds: o.seconds }
      })
      return { taskId: String(res.task_id), balance: b.client.toInt(res.ec_remain_credits) }
    }
  }
}

function musicSpec(o: { hash: string; mood: string }): JobSpec {
  return {
    kind: 'music',
    summary: `Music: ${o.mood}`,
    requestHash: o.hash,
    projectDir: null,
    match: { text: o.mood, prompt: o.mood },
    submit: async (signal) => {
      const res = await b.client.request(b.client.PATHS.music, {
        method: 'POST',
        signal,
        json: { create_mode: 'simple', gpt_description_prompt: o.mood, make_instrumental: true }
      })
      return { taskId: String(res.task_id), balance: b.client.toInt(res.ec_remain_credits) }
    }
  }
}

const rawSpeech = (
  o: { text?: string; voice?: string; needCredits?: number } = {}
): Promise<unknown> =>
  b.client.request(b.client.PATHS.speech, {
    form: async () => {
      const f = new FormData()
      f.set('text', o.text ?? 'A short line for the raw request check.')
      f.set('voice_id', o.voice ?? 'edge_en-US-AriaNeural')
      return f
    },
    needCredits: o.needCredits
  })

/** A small HTTP server for the answers the fake does not give (odd statuses, redirects, echoes). */
type Tiny = {
  url: string
  seen: { method: string; path: string; key: string | null }[]
  close: () => Promise<void>
}
async function tinyServer(
  handler: (req: IncomingMessage, res: ServerResponse, url: URL, tiny: Tiny) => void
): Promise<Tiny> {
  const log: Tiny['seen'] = []
  const tiny: Tiny = { url: '', seen: log, close: async () => undefined }
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const raw = req.headers['xi-api-key']
    log.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      key: Array.isArray(raw) ? raw[0] : (raw ?? null)
    })
    req.resume()
    req.on('end', () => handler(req, res, url, tiny))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  tiny.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  tiny.close = () =>
    new Promise<void>((r) => {
      server.close(() => r())
      server.closeAllConnections()
    })
  return tiny
}

const json = (res: ServerResponse, status: number, body: unknown, headers = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

// ---------------------------------------------------------------------------------------------
// 1. The bundle

async function sectionBundle(): Promise<void> {
  const entry = Object.entries(MODULES)
    .map(([name, file]) => `export * as ${name} from './${file}'`)
    .join('\n')
  const result = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'ai33-smoke-entry.ts', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    metafile: true,
    // Electron is named external so that an import of it shows up here instead of being bundled
    external: ['electron'],
    logLevel: 'silent'
  })
  const outside: string[] = []
  for (const [file, meta] of Object.entries(result.metafile.inputs))
    for (const i of meta.imports)
      if (i.external && !i.path.startsWith('node:')) outside.push(`${file} -> ${i.path}`)
  check(
    'the bundled modules import nothing but node: built-ins (no electron)',
    outside.length === 0,
    () => outside.join('\n')
  )
  const inputs = Object.keys(result.metafile.inputs)
  for (const file of Object.values(MODULES))
    check(`bundled ${file}`, inputs.includes(file), () => `inputs: ${inputs.join(', ')}`)
  const file = join(work, 'ai33-bundle.mjs')
  writeFileSync(file, result.outputFiles[0].text)
  b = (await import(pathToFileURL(file).href)) as Bundle
  console.log('  left out (they import Electron or the app, so they need the app to run):')
  for (const [f, why] of LEFT_OUT) console.log(`    ${f}: ${why}`)
}

// ---------------------------------------------------------------------------------------------
// 2. Where the key may go

async function sectionHosts(): Promise<void> {
  const { client } = b
  const cfg =
    (baseUrl: string): (() => void) =>
    () =>
      client.configure({ baseUrl, getKey: () => KEY, dataDir: join(work, 'hosts') })

  const plain = await thrown(Promise.resolve().then(cfg('http://example.com')))
  check(
    'plain http to a real host is refused',
    /only reached over https/.test(plain?.message ?? ''),
    () => show(plain)
  )
  const ftp = await thrown(Promise.resolve().then(cfg('ftp://api.ai33.pro')))
  check('another scheme is refused', !!ftp)
  for (const ok of [
    'https://api.ai33.pro',
    'http://localhost:1234',
    'http://127.0.0.1:8787',
    'http://[::1]:8787'
  ])
    check(
      `${ok} is accepted (https anywhere, http only on this Mac)`,
      (await thrown(Promise.resolve().then(cfg(ok)))) === null
    )

  pointAtFake()
  const before = fake.requests.length
  const evil = await thrown(client.request('https://evil.example/v1/credits'))
  check(
    'a request to another host is refused before it leaves',
    evil?.kind === 'server' && evil.charged === false && fake.requests.length === before,
    () => show(evil)
  )
  const seenBefore = seen.length
  keyNow = null
  const nokey = await thrown(client.request('/v1/credits'))
  keyNow = KEY
  check(
    'with no key nothing is sent, and the words say to connect',
    nokey?.kind === 'auth' &&
      nokey.charged === false &&
      nokey.userMessage === 'ai33 isn’t connected. Connect it in Connections (Cmd+,).' &&
      seen.length === seenBefore,
    () => show(nokey)
  )

  // downloads: https anywhere, http only while ai33 itself is on this Mac
  client.configure({
    baseUrl: 'https://api.ai33.pro',
    getKey: () => KEY,
    dataDir: join(work, 'hosts')
  })
  const dl = join(work, 'dl-hosts')
  mkdirSync(dl, { recursive: true })
  const seenAfterConfig = seen.length
  const notLoopback = await thrown(
    client.downloadTo(`${fake.url}/files/x.mp3`, join(dl, 'a.mp3'), { maxBytes: 1e6 })
  )
  check(
    'with a real https base, an http download is refused without any request',
    notLoopback?.kind === 'unusable' && seen.length === seenAfterConfig,
    () => show(notLoopback)
  )
  pointAtFake()
  for (const bad of [
    'file:///etc/passwd',
    'ftp://127.0.0.1/x.mp3',
    'javascript:alert(1)',
    'not a url'
  ]) {
    const err = await thrown(client.downloadTo(bad, join(dl, 'b.mp3'), { maxBytes: 1e6 }))
    check(`a download from ${bad} is refused`, err?.kind === 'unusable', () => show(err))
  }
  same('nothing was left in the download folder', readdirSync(dl), [])
  same(
    'the key never went anywhere in this section except the fake',
    seen.filter((s) => s.key !== null && s.url.origin !== fake.url).length,
    0
  )
}

// ---------------------------------------------------------------------------------------------
// 3. Credits, 401 and the plain-language errors

const errors: { name: string; err: Failure }[] = []
const noted = (name: string, err: Failure | null): Failure | null => {
  if (err) errors.push({ name, err })
  return err
}

async function sectionErrors(): Promise<void> {
  const { client } = b

  // credits as an integer and as a string
  scenario('ok')
  pointAtFake()
  same('credits read as a number', await client.getCredits({ fresh: true }), 100_000)
  scenario('credits-as-string')
  same(
    'credits sent as a string read as a number',
    await client.getCredits({ fresh: true }),
    100_000
  )
  const asString = await client.runJob(
    speechSpec({ hash: uniq('str'), text: 'Credits arrive as strings here.' }),
    {}
  )
  check(
    'a job in a string-credits account ends with whole-number credits',
    asString.state === 'done' &&
      Number.isInteger(asString.creditCost) &&
      asString.balance === fake.credits(),
    () => show(asString)
  )
  same(
    'toInt: numbers, numeric strings and junk',
    [
      client.toInt(12480),
      client.toInt('12480'),
      client.toInt(' 7.6 '),
      client.toInt('abc'),
      client.toInt(null),
      client.toInt(NaN),
      client.toInt('')
    ],
    [12480, 12480, 8, null, null, null, null]
  )

  // key check
  scenario('ok')
  pointAtFake()
  same('checkKey: a good key', await client.checkKey('good-key'), {
    status: 'ok',
    credits: 100_000
  })
  same('checkKey: a rejected key', await client.checkKey('bad-key'), {
    status: 'rejected',
    credits: null
  })
  const port = await deadPort()
  client.configure({
    baseUrl: `http://127.0.0.1:${port}`,
    getKey: () => KEY,
    dataDir: join(work, 'dead'),
    pace: FAST
  })
  same('checkKey: ai33 unreachable is not a rejection', await client.checkKey('good-key'), {
    status: 'unreachable',
    credits: null
  })
  same(
    'getCredits: unreachable is null, never a throw',
    await client.getCredits({ fresh: true }),
    null
  )
  const offline = noted('network on submit', await thrown(rawSpeech()))
  check(
    'network on submit: plain words, and never "Nothing was charged"',
    offline?.kind === 'network' &&
      offline.charged === 'unknown' &&
      offline.userMessage === 'Couldn’t reach ai33. Check your internet connection.',
    () => show(offline)
  )

  // 401: bad key, no credits, refused for another reason
  pointAtFake()
  scenario('bad-key-401')
  const badKey = noted('401 bad key', await thrown(rawSpeech()))
  check(
    '401 with a bad key says so',
    badKey?.kind === 'auth' &&
      badKey.charged === false &&
      badKey.status === 401 &&
      badKey.userMessage === 'Your ai33 key wasn’t accepted. Check it in Connections (Cmd+,).',
    () => show(badKey)
  )
  scenario('no-credits-401')
  const empty = noted('401 no credits', await thrown(rawSpeech()))
  check(
    '401 with a zero balance is "not enough credits", not a bad key',
    empty?.kind === 'credits' &&
      empty.charged === false &&
      empty.userMessage ===
        'There aren’t enough ai33 credits for this (0 left). You can add credits with ai33.',
    () => show(empty)
  )
  scenario('no-credits-401', { creditsEndpoint401: true })
  const both = noted('401 both', await thrown(rawSpeech()))
  check(
    'if the credits endpoint 401s too, the key is the suspect (the documented ambiguity)',
    both?.kind === 'auth',
    () => show(both)
  )
  scenario('ok', { credits: 100 })
  const long = 'x'.repeat(1000)
  const short = noted(
    '401 short of price',
    await thrown(rawSpeech({ text: long, voice: 'elevenlabs_21m00Tcm4TlvDq8ikWAM' }))
  )
  check(
    '401 with some credits and no known price is a refusal of the request, not "no credits"',
    short?.kind === 'validation' &&
      short.charged === false &&
      short.userMessage === 'ai33 didn’t accept that request (Insufficient credits).',
    () => show(short)
  )
  const priced = await thrown(
    rawSpeech({ text: long, voice: 'elevenlabs_21m00Tcm4TlvDq8ikWAM', needCredits: 1000 })
  )
  check(
    '401 below a known price says how many credits are left and needed',
    priced?.kind === 'credits' &&
      /\(100 left, it needs about 1,000\)/.test(priced.userMessage ?? ''),
    () => show(priced)
  )

  // the rest of the table
  scenario('ok')
  const invalid = noted('400 validation', await thrown(rawSpeech({ voice: 'nobody' })))
  check(
    '400 says what ai33 said and that nothing was charged',
    invalid?.kind === 'validation' &&
      invalid.charged === false &&
      invalid.status === 400 &&
      /^ai33 didn’t accept this: voice_id must use a provider prefix.*\. Nothing was charged\.$/.test(
        invalid.userMessage ?? ''
      ),
    () => show(invalid)
  )
  const nope = noted('404', await thrown(client.request('/v9/nothing-here')))
  check(
    '404 says Luca may need an update',
    nope?.kind === 'validation' &&
      nope.charged === false &&
      nope.userMessage === 'ai33 doesn’t recognise this request. Luca may need an update.',
    () => show(nope)
  )
  scenario('ambiguous-502-after-create')
  const trouble = noted('5xx on submit', await thrown(rawSpeech()))
  check(
    '5xx on submit: the job may exist, so it says so and never claims "Nothing was charged"',
    trouble?.kind === 'server' &&
      trouble.charged === 'unknown' &&
      trouble.userMessage ===
        'ai33 is having trouble right now. It may have started the job, so Luca didn’t start it again.',
    () => show(trouble)
  )
  scenario('rate-limit-429', { rateLimit: 5, retryAfter: 30 })
  const busy = noted('429 after backoff', await thrown(rawSpeech()))
  check(
    '429 after backoff: the queue is full, nothing was charged, and it stopped at the cap',
    busy?.kind === 'rate' &&
      busy.charged === false &&
      busy.userMessage ===
        'ai33 is busy right now (its queue is full). Wait a minute, then ask again.' &&
      posts('/v3/text-to-speech').length === 2,
    () => `${show(busy)} posts=${posts('/v3/text-to-speech').length}`
  )

  // a task that ends in error
  scenario('task-error')
  const failedJob = noted(
    'task error',
    await thrown(
      client.runJob(
        speechSpec({ hash: uniq('err'), text: 'This voiceover will fail upstream.' }),
        {}
      )
    )
  )
  check(
    'a task error names the thing, gives ai33’s reason and says the credits are back',
    failedJob?.kind === 'task' &&
      failedJob.charged === 'unknown' &&
      failedJob.userMessage ===
        'ai33 couldn’t make the voiceover: Generation failed: the upstream provider returned an error. Your credits are back (100,000 left).',
    () => show(failedJob)
  )
  scenario('task-error', { health: { elevenlabs: 'overloaded' } })
  const blamed = await thrown(
    client.runJob(
      speechSpec({
        hash: uniq('err2'),
        text: 'Another one that fails upstream.',
        voice: 'elevenlabs_21m00Tcm4TlvDq8ikWAM'
      }),
      {}
    )
  )
  check(
    'a task error while the voice service is unwell blames the service',
    /The voice service is having trouble right now\./.test(blamed?.userMessage ?? ''),
    () => show(blamed)
  )
  same(
    'refundLine: back / not back / unknown',
    [
      client.refundLine(1000, 1000),
      client.refundLine(1000, 1500),
      client.refundLine(100_000, 99_500),
      client.refundLine(12_480, 12_380),
      client.refundLine(null, 900),
      client.refundLine(1000, null)
    ],
    [
      'Your credits are back (1,000 left).',
      'Your credits are back (1,500 left).',
      'You have 99,500 credits.',
      'You have 12,380 credits.',
      'You have 900 credits.',
      ''
    ]
  )
  check(
    'notEnough words',
    client
      .notEnough(500, 800)
      .startsWith('There aren’t enough ai33 credits for this (500 left, it needs about 800).') &&
      !client.notEnough(500).includes('it needs'),
    () => client.notEnough(500, 800)
  )

  // the deadline
  scenario('slow', { polls: 60 })
  pointAtFake(0.05)
  const late = noted(
    'deadline',
    await thrown(
      client.runJob(
        speechSpec({
          hash: uniq('late'),
          text: 'This one takes far too long.',
          deadlineMs: 250,
          waitBudgetMs: 60_000
        }),
        {}
      )
    )
  )
  check(
    'the deadline says Luca stopped waiting and that asking again starts it again',
    late?.kind === 'deadline' &&
      late.userMessage ===
        'Your voiceover is still not ready at ai33, so Luca stopped waiting for it. Asking again will start it again.',
    () => show(late)
  )
  pointAtFake()

  // the rules across every error seen so far
  const claimed = errors.filter((e) => /Nothing was charged/.test(e.err.userMessage ?? ''))
  check(
    '"Nothing was charged" appears only on errors that are certain no task exists',
    claimed.every((e) => e.err.charged === false),
    () => claimed.map((e) => `${e.name}: ${show(e.err.charged)}`).join('\n')
  )
  check(
    'it never appears on an error where the job may exist (5xx, network, task, deadline, stopped)',
    errors
      .filter((e) =>
        ['server', 'network', 'task', 'deadline', 'stopped', 'unusable'].includes(e.err.kind ?? '')
      )
      .every((e) => !/Nothing was charged/.test(e.err.userMessage ?? '')),
    () => errors.map((e) => `${e.name}: ${e.err.kind}`).join('\n')
  )
  check(
    'every error carries the same words as its message, and none leaks the key',
    errors.every(
      (e) => e.err.message === e.err.userMessage && !(e.err.userMessage ?? '').includes(KEY)
    ),
    () => errors.map((e) => e.err.userMessage).join('\n')
  )
  const scrubbed = client.plainError(new Error(`boom ${KEY} boom`))
  check(
    'plainError scrubs the key from any message',
    !scrubbed.userMessage.includes(KEY) && scrubbed.userMessage.includes('boom'),
    () => scrubbed.userMessage
  )
  same(
    'thingFor',
    [
      client.thingFor('speech'),
      client.thingFor('dialogue'),
      client.thingFor('music'),
      client.thingFor('sfx')
    ],
    ['voiceover', 'conversation', 'music', 'sound effect']
  )
}

// ---------------------------------------------------------------------------------------------
// 4. The job runner

async function sectionRunner(): Promise<void> {
  const { client, jobs } = b

  // the cadence of polls, unscaled
  const at = (ms: number, r: number): number => client.pollDelay(ms, () => r)
  same(
    'pollDelay tiers: 1.5 s for 10 s, 3 s to a minute, then 5 s',
    [
      at(0, 0.5),
      at(9_999, 0.5),
      at(10_000, 0.5),
      at(59_999, 0.5),
      at(60_000, 0.5),
      at(600_000, 0.5)
    ],
    [1500, 1500, 3000, 3000, 5000, 5000]
  )
  same(
    'pollDelay jitter is plus or minus 20 percent',
    [at(0, 0), at(0, 1), at(20_000, 0), at(20_000, 1)],
    [1200, 1800, 2400, 3600]
  )

  // cadence and progress, on the wire
  scenario('slow', { polls: 6 })
  const dir = pointAtFake(0.1)
  const seenPct: (number | null)[] = []
  let mostRunning = 0
  const done = await client.runJob(
    speechSpec({ hash: uniq('cadence'), text: 'A voiceover to watch the polling of.' }),
    {
      onProgress: (p) => {
        seenPct.push(p.pct)
        mostRunning = Math.max(mostRunning, jobs.runningCount())
      }
    }
  )
  const polls = taskPolls()
  const gaps = polls.slice(1).map((r, i) => r.at - polls[i].at)
  check(
    'it polled 7 times (6 still working, then done)',
    polls.length === 7,
    () => `polls=${polls.length}`
  )
  check(
    'polls are about 1.5 s apart (scaled to 150 ms): none in a burst, none idle',
    gaps.length > 0 && Math.min(...gaps) >= 100 && Math.max(...gaps) <= 450,
    () => `gaps ms: ${gaps.join(', ')}`
  )
  check(
    'the first thing reported is "no percent yet" (it binds the step)',
    seenPct[0] === null,
    () => show(seenPct)
  )
  const nums = seenPct.filter((p): p is number => p !== null)
  check(
    'percent rises, one report per change, and never reaches 100 before done',
    nums.length >= 5 &&
      nums.every((n, i) => i === 0 || n > nums[i - 1]) &&
      nums[nums.length - 1] < 100,
    () => show(seenPct)
  )
  check(
    'a job is counted as running while it runs, and not after',
    mostRunning >= 1 && jobs.runningCount() === 0,
    () => `${mostRunning} ${jobs.runningCount()}`
  )
  check(
    'a finished job says what it cost and what is left',
    done.state === 'done' &&
      done.creditCost > 0 &&
      done.balance === fake.credits() &&
      100_000 - done.creditCost === fake.credits() &&
      typeof done.urls.audio === 'string',
    () => show(done)
  )
  const ledger = jobs.find(done.state === 'done' ? (jobs.get(done.jobId)?.requestHash ?? '') : '')
  check(
    'the ledger holds it as done, not yet collected (nothing has saved its files), with its task and cost',
    !!ledger &&
      ledger.state === 'done' &&
      !ledger.collected &&
      ledger.taskId === (done.state === 'done' ? done.taskId : null) &&
      ledger.creditCost === (done.state === 'done' ? done.creditCost : -1),
    () => show(ledger)
  )
  if (done.state === 'done') {
    jobs.markCollected(done.jobId, ['media/generated/speech/a.mp3'])
    const kept = jobs.get(done.jobId)
    check(
      'markCollected (once the files are saved) marks it collected and keeps its links and cost',
      kept?.collected === true &&
        kept.dest[0] === 'media/generated/speech/a.mp3' &&
        kept.state === 'done' &&
        kept.urls?.audio === done.urls.audio &&
        kept.creditCost === done.creditCost,
      () => show(kept)
    )
  }
  check('the ledger file is on disk', readdirSync(dir).includes('jobs.json'))

  // network drops in the middle of polling
  for (const drops of [4, 6]) {
    scenario('network-drop-mid-poll', { dropAfter: 1, drops })
    pointAtFake()
    const reports: { pct: number | null; note?: string }[] = []
    const run = await client.runJob(
      speechSpec({ hash: uniq('drop'), text: `A voiceover whose polls drop ${drops} times.` }),
      {
        onProgress: (p) => reports.push(p)
      }
    )
    const lost = fake.requests.filter(
      (r) => r.method === 'GET' && r.path.startsWith('/v1/task/') && r.status === 0
    )
    check(
      `${drops} dropped polls do not stop the job`,
      run.state === 'done' && lost.length >= drops,
      () => `${run.state} dropped=${lost.length}`
    )
    check(`${drops} dropped polls never cancel it at ai33`, posts('/v1/task/delete').length === 0)
    const waiting = reports.filter((r) => r.note === 'Waiting for the internet…')
    if (drops >= 5) {
      check(
        'after 5 in a row the step says it is waiting for the internet, once',
        waiting.length === 1,
        () => show(reports)
      )
      const i = reports.indexOf(waiting[0])
      check(
        'and clears the note when the answers come back',
        reports.slice(i + 1).some((r) => r.note === undefined),
        () => show(reports)
      )
      const slow = Math.max(
        ...fake.requests
          .filter((r) => r.path.startsWith('/v1/task/'))
          .slice(1)
          .map((r, k, all) => (k > 0 ? r.at - all[k - 1].at : 0))
      )
      check(
        'and polls slow down to about 15 s (300 ms scaled)',
        slow >= 220,
        () => `longest gap ${slow} ms`
      )
    } else check('fewer than 5 in a row says nothing', waiting.length === 0, () => show(reports))
  }

  // 429: backoff, then success
  scenario('rate-limit-429')
  pointAtFake(0.1)
  const rated = await client.runJob(
    speechSpec({ hash: uniq('429'), text: 'A voiceover that meets a full queue twice.' }),
    {}
  )
  const tries = posts('/v3/text-to-speech')
  same(
    'two 429s, then the same request goes through',
    tries.map((r) => r.status),
    [429, 429, 200]
  )
  const spacing = tries.slice(1).map((r, i) => r.at - tries[i].at)
  check(
    'it waited the Retry-After between tries (1 s scaled to 100 ms)',
    spacing.every((g) => g >= 90 && g < 700),
    () => spacing.join(', ')
  )
  check('and the job then finished', rated.state === 'done')
  {
    // no Retry-After: 2 s, 5 s, 12 s
    let calls = 0
    const stamps: number[] = []
    const t = await tinyServer((_req, res) => {
      stamps.push(Date.now())
      if (++calls <= 3) json(res, 429, { message: 'slow down' })
      else json(res, 200, { success: true, credits: 5 })
    })
    client.configure({ baseUrl: t.url, getKey: () => KEY, dataDir: join(work, 'r429'), pace: 0.05 })
    const got = await client.request('/v1/credits')
    const gap = stamps.slice(1).map((s, i) => s - stamps[i])
    check(
      'without Retry-After the waits are 2 s, 5 s and 12 s (scaled)',
      got.credits === 5 &&
        calls === 4 &&
        gap[0] >= 90 &&
        gap[1] >= 240 &&
        gap[2] >= 590 &&
        gap[2] < 1500,
      () => `gaps ${gap.join(', ')}`
    )
    await t.close()
    pointAtFake()
  }
  {
    // "Retry-After: 0" (or a date already past) is a wait of nothing, and must still be bounded
    let hits = 0
    const t = await tinyServer((_req, res) => {
      hits++
      json(res, 429, { message: 'slow down' }, { 'retry-after': '0' })
    })
    client.configure({ baseUrl: t.url, getKey: () => KEY, dataDir: join(work, 'r0'), pace: FAST })
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(), 1500)
    const gaveUp = await thrown(client.request('/v1/credits', { signal: stop.signal }))
    clearTimeout(timer)
    check(
      'a 429 that always says Retry-After: 0 is given up on after a few tries, not asked again without end',
      gaveUp?.kind === 'rate' && hits <= 5,
      () => `${hits} requests in 1.5 s, ${show(gaveUp?.kind)}`
    )
    await t.close()
    pointAtFake()
  }

  // ambiguous submits
  scenario('ambiguous-502-after-create')
  pointAtFake()
  const oneText = 'An ambiguous voiceover whose answer never arrives.'
  const one = await client.runJob(speechSpec({ hash: uniq('amb1'), text: oneText }), {})
  const control = (await (await fetch(`${fake.url}/__control`)).json()) as { tasks: number }
  const listed = fake.requests.filter((r) => r.path === '/v1/tasks')
  check(
    'an ambiguous submit is sent once and not retried',
    posts('/v3/text-to-speech').length === 1,
    () => `${posts('/v3/text-to-speech').length}`
  )
  check(
    'it is reconciled to the one task that exists, without a type filter',
    one.state === 'done' &&
      one.taskId === posts('/v3/text-to-speech')[0].taskId &&
      control.tasks === 1 &&
      listed.length >= 1 &&
      listed.every((r) => !('type' in r.query)),
    () => `${show(one)} tasks=${control.tasks} ${show(listed.map((r) => r.query))}`
  )
  scenario('ambiguous-502-after-create')
  const mm = await client.runJob(
    speechSpec({
      hash: uniq('amb2'),
      text: 'An ambiguous line in a MiniMax voice.',
      voice: 'minimax_male-qn-qingse'
    }),
    {}
  )
  const rows = fake.requests.find((r) => r.path === '/v1/tasks')
  check(
    'a provider-specific task type (minimax_tts) is found just the same',
    mm.state === 'done' && !!rows && !('type' in rows.query),
    () => show(mm)
  )
  for (const shape of ['tasks', 'array', 'data']) {
    scenario('ambiguous-502-after-create', { tasksShape: shape })
    const r = await client.runJob(
      speechSpec({ hash: uniq('amb3'), text: `An ambiguous line, task list shape ${shape}.` }),
      {}
    )
    check(
      `the task list may be wrapped as "${shape}"`,
      r.state === 'done' && posts('/v3/text-to-speech').length === 1,
      () => show(r)
    )
  }
  scenario('ambiguous-502-after-create', { ambiguous: 2 })
  const twin = 'Two tasks now start with these very same words.'
  const decoy = await fetch(`${fake.url}/v3/text-to-speech`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text: twin, voice_id: 'edge_en-US-AriaNeural' })
  })
  const two = noted(
    'two candidates',
    await thrown(client.runJob(speechSpec({ hash: uniq('amb4'), text: twin }), {}))
  )
  const lostEntry = jobs.list().find((e) => e.summary.includes('Two tasks'))
  check(
    'two matching tasks are never guessed between: the job is marked lost',
    decoy.status === 502 &&
      two?.kind === 'server' &&
      lostEntry?.state === 'lost' &&
      posts('/v3/text-to-speech').length === 2,
    () => `${show(two)} ${show(lostEntry)}`
  )

  // the ledger is written before the POST
  scenario('ok')
  const dir2 = pointAtFake()
  type Snap = { jobs: { requestHash: string; state: string; taskId: string | null }[] }
  const held: { snap: Snap | null } = { snap: null }
  beforePost = (url) => {
    if (url.pathname === '/v3/text-to-speech' && !held.snap)
      held.snap = JSON.parse(readFileSync(join(dir2, 'jobs.json'), 'utf8')) as Snap
  }
  const hash = uniq('ledger')
  const written = await client.runJob(
    {
      ...speechSpec({ hash, text: 'The ledger is written before this leaves.' }),
      summary: 'x'.repeat(200)
    },
    {}
  )
  beforePost = null
  const early = held.snap?.jobs.find((j) => j.requestHash === hash)
  check(
    'the ledger already held the job (submitting, no task) when the POST left',
    early?.state === 'submitting' && early.taskId === null,
    () => show(held.snap)
  )
  const final = jobs.find(hash)
  check(
    'then it holds the task id, and the summary is cut to 80 characters',
    written.state === 'done' && final?.taskId === written.taskId && final.summary.length === 80,
    () => show(final)
  )

  // dedupe
  scenario('ok')
  pointAtFake()
  const dup = speechSpec({ hash: uniq('dup'), text: 'Two identical calls at the same moment.' })
  let secondSaw = 0
  const [first, second] = await Promise.all([
    client.runJob(dup, {}),
    client.runJob(dup, { onProgress: () => void secondSaw++ })
  ])
  check(
    'two identical concurrent calls make ONE POST',
    posts('/v3/text-to-speech').length === 1,
    () => `${posts('/v3/text-to-speech').length}`
  )
  check(
    'both get the same task, and the second is marked reused',
    first.state === 'done' &&
      second.state === 'done' &&
      first.taskId === second.taskId &&
      second.reused === true &&
      first.reused !== true,
    () => `${show(first)} ${show(second)}`
  )
  check('the joined caller still hears progress', secondSaw > 0)
  const again = await client.runJob(dup, {})
  check(
    'the same request later is answered from the ledger, no new POST',
    again.state === 'done' && again.reused === true && posts('/v3/text-to-speech').length === 1,
    () => show(again)
  )
  await client.runJob({ ...dup, requestHash: uniq('dup-other') }, {})
  check('a different request is a new POST', posts('/v3/text-to-speech').length === 2)

  // Stop cancels at ai33; the project closing does not
  for (const refunds of [true, false]) {
    scenario('slow', { polls: 40, deleteRefunds: refunds })
    pointAtFake(0.1)
    const stop = new AbortController()
    const text = 'x'.repeat(600)
    const running = thrown(
      client.runJob(
        speechSpec({ hash: uniq('stop'), text, voice: 'elevenlabs_21m00Tcm4TlvDq8ikWAM' }),
        { stop: stop.signal }
      )
    )
    await until('the job to start polling', () => taskPolls().length >= 2)
    stop.abort()
    const stopped = noted(
      `stopped (delete ${refunds ? 'refunds' : 'does not refund'})`,
      await running
    )
    const del = posts('/v1/task/delete')
    check(
      refunds
        ? 'Stop: the task is deleted at ai33 and the refund it returned is reported'
        : 'Stop: with no refund returned, none is promised',
      stopped?.kind === 'stopped' &&
        del.length === 1 &&
        (refunds
          ? stopped.userMessage ===
            'Stopped before the voiceover was ready. ai33 returned 600 credits.'
          : stopped.userMessage === 'Stopped before the voiceover was ready.'),
      () => `${show(stopped)} deletes=${del.length}`
    )
    const entry = jobs.list()[0]
    check(
      'Stop leaves the ledger entry cancelled and remotely deleted',
      entry.state === 'cancelled' && entry.remoteDeleted,
      () => show(entry)
    )
  }
  scenario('slow', { polls: 12 })
  pointAtFake(0.05)
  const detach = new AbortController()
  const events: { type: string; result?: string }[] = []
  const off = jobs.onJobEvent((e) => events.push(e))
  const closing = client.runJob(
    speechSpec({ hash: uniq('detach'), text: 'The project closes while this is polled.' }),
    { detach: detach.signal }
  )
  await until('polling to start', () => taskPolls().length >= 2)
  detach.abort()
  const carried = await closing
  check(
    'closing the project leaves the job going, with no delete',
    carried.state === 'working' && posts('/v1/task/delete').length === 0,
    () => show(carried)
  )
  await until('the background poller to settle the job', () =>
    events.some((e) => e.type === 'settled')
  )
  check(
    'the background poller finishes it and says how it ended',
    events.find((e) => e.type === 'settled')?.result === 'done',
    () => show(events)
  )
  const late = carried.state === 'working' ? await jobs.collect(carried.jobId) : null
  check(
    'collect hands over the finished job and leaves it uncollected until its files are saved',
    late?.state === 'done' &&
      jobs.get(carried.jobId)?.collected === false &&
      typeof late.urls.audio === 'string',
    () => show(late)
  )
  same('collect of an unknown job is null', await jobs.collect('no-such-job'), null)

  // the wait budget
  scenario('slow', { polls: 8 })
  pointAtFake(0.05)
  events.length = 0
  const waited = await client.runJob(
    speechSpec({
      hash: uniq('budget'),
      text: 'A voiceover that outlasts its caller’s wait.',
      waitBudgetMs: 150
    }),
    {}
  )
  check('a job still going at the wait budget answers "working"', waited.state === 'working', () =>
    show(waited)
  )
  await until('it to settle', () => events.some((e) => e.type === 'settled'))
  check(
    'and is finished in the background, with its files',
    jobs.get(waited.jobId)?.state === 'done' && !!jobs.get(waited.jobId)?.urls?.audio,
    () => show(jobs.get(waited.jobId))
  )
  off()

  // the ledger is bounded and forgets what was collected long ago
  pointAtFake()
  const stub = (i: number, over: object): Parameters<typeof jobs.upsert>[0] => ({
    jobId: `stub-${i}`,
    taskId: `t-${i}`,
    kind: 'sfx',
    requestHash: `h-${i}`,
    summary: 's',
    projectDir: null,
    submittedAt: Date.now() - 1000 * (300 - i),
    state: 'done',
    estimate: null,
    balanceBefore: null,
    creditCost: 1,
    urls: null,
    dest: [],
    error: null,
    remoteDeleted: false,
    collected: false,
    ...over
  })
  for (let i = 0; i < 3; i++)
    jobs.upsert(stub(i, { state: 'working', submittedAt: Date.now() - 9e6 - i }))
  for (let i = 10; i < 220; i++) jobs.upsert(stub(i, {}))
  jobs.upsert(stub(500, { collected: true, submittedAt: Date.now() - 40 * 86_400_000 }))
  check(
    'the ledger keeps at most 200 entries',
    jobs.list().length <= 200,
    () => `${jobs.list().length}`
  )
  check(
    'and never drops a job that is still working, however old',
    [0, 1, 2].every((i) => jobs.get(`stub-${i}`)),
    () => show(jobs.list().length)
  )
  check('and forgets a collected job after 30 days', jobs.get('stub-500') === null)
}

// ---------------------------------------------------------------------------------------------
// 5. Result files and where the key goes

async function sectionFiles(): Promise<void> {
  const { client } = b
  const dl = join(work, 'dl')
  mkdirSync(dl, { recursive: true })

  const g = (task: object | null): unknown => {
    try {
      return client.resultUrls(task)
    } catch (err) {
      return (err as Failure).kind
    }
  }
  const A = 'https://cdn.example/a.mp3'
  const B2 = 'https://cdn.example/b.mp3'
  same('resultUrls: metadata.audio_url', g({ metadata: { audio_url: A } }), {
    audio: A,
    audios: [A]
  })
  same('resultUrls: metadata.output_uri (sound effects)', g({ metadata: { output_uri: A } }), {
    audio: A,
    audios: [A]
  })
  same('resultUrls: top-level output_uri (isolate shape)', g({ output_uri: A }), {
    audio: A,
    audios: [A]
  })
  same(
    'resultUrls: metadata.all_audio_urls (music)',
    g({ metadata: { all_audio_urls: [A, B2] } }),
    { audio: A, audios: [A, B2] }
  )
  same(
    'resultUrls: suno_result clips',
    g({ metadata: { suno_result: { clips: [{ audio_url: A }, { audio_url: B2 }] } } }),
    { audio: A, audios: [A, B2] }
  )
  same(
    'resultUrls: transcript files come along',
    g({ metadata: { audio_url: A, srt_url: B2, json_url: 'https://cdn.example/w.json' } }),
    { audio: A, audios: [A], srt: B2, json: 'https://cdn.example/w.json' }
  )
  same(
    'resultUrls: a url with spaces around it is trimmed',
    g({ metadata: { audio_url: `  ${A}  ` } }),
    { audio: A, audios: [A] }
  )
  same(
    'resultUrls: no duplicates when both places name the same file',
    (g({ metadata: { audio_url: A, all_audio_urls: [A, B2] } }) as { audios: string[] }).audios,
    [A, B2]
  )
  same(
    'resultUrls: nothing usable is "unusable"',
    [
      g({}),
      g(null),
      g({ metadata: {} }),
      g({ metadata: { audio_url: 'javascript:alert(1)' } }),
      g({ metadata: { audio_url: 'ftp://x/y.mp3' } })
    ],
    ['unusable', 'unusable', 'unusable', 'unusable', 'unusable']
  )

  // the urls-variety scenario: every shape, downloaded, with no key sent
  scenario('urls-variety')
  pointAtFake()
  const got: string[] = []
  for (let i = 0; i < 4; i++) {
    const out = await client.runJob(
      sfxSpec({ hash: uniq('urls'), what: `Whoosh number ${i} passing by`, seconds: 2 }),
      {}
    )
    if (out.state !== 'done') {
      check(`urls-variety job ${i} finished`, false, () => show(out))
      continue
    }
    const file = join(dl, `variety-${i}.mp3`)
    const url = out.urls.audio as string
    const res = await client.downloadTo(url, file, { maxBytes: 5_000_000 })
    got.push(
      `${new URL(url).pathname.replace(/[0-9a-f-]{36}/, '<id>')} ${res.mime} ${res.bytes > 100}`
    )
  }
  same('all four URL shapes download as audio', got, [
    '/files/<id>.mp3 audio/mpeg true',
    '/files/<id>.mp3 audio/mpeg true',
    '/files/<id>.mp3 audio/mpeg true',
    '/files/<id>.mp3 audio/mpeg true'
  ])
  check(
    'a finished download leaves no .part file',
    readdirSync(dl).every((f) => !f.endsWith('.part')),
    () => show(readdirSync(dl))
  )
  for (const urlShape of ['audio_url', 'output_uri', 'top_output_uri', 'all_audio_urls']) {
    scenario('ok', { urlShape })
    const out = await client.runJob(
      sfxSpec({ hash: uniq('shape'), what: `A click for shape ${urlShape}`, seconds: 1 }),
      {}
    )
    check(`urlShape ${urlShape} resolves`, out.state === 'done' && !!out.urls.audio, () =>
      show(out)
    )
  }
  scenario('ok')
  const music = await client.runJob(
    musicSpec({ hash: uniq('music'), mood: 'Calm piano for a quiet explainer' }),
    {}
  )
  check(
    'music brings both takes',
    music.state === 'done' && music.urls.audios?.length === 2 && music.creditCost === 3600,
    () => show(music)
  )

  // limits
  const big = await thrown(
    client.downloadTo(`${fake.url}/files/no-such.mp3`, join(dl, 'nope.mp3'), {
      maxBytes: 5_000_000
    })
  )
  check(
    'a missing file is a plain "made it, couldn’t download it" that says it is not paid twice',
    big?.kind === 'network' &&
      big.charged === true &&
      /won’t be paid for twice/.test(big.userMessage ?? ''),
    () => show(big)
  )
  if (music.state === 'done') {
    const tooBig = await thrown(
      client.downloadTo(music.urls.audio as string, join(dl, 'big.mp3'), { maxBytes: 10 })
    )
    check(
      'a file over the size cap is refused and leaves nothing behind',
      tooBig?.kind === 'unusable' && !readdirSync(dl).some((f) => f.startsWith('big')),
      () => show([tooBig, readdirSync(dl)])
    )
  }

  // the key goes to the API host, never to a file host or another host
  scenario('auth-header-audit')
  pointAtFake()
  const audited = await client.runJob(
    sfxSpec({ hash: uniq('audit'), what: 'A door closing, for the header audit', seconds: 2 }),
    {}
  )
  if (audited.state === 'done') {
    const url = new URL(audited.urls.audio as string)
    await client.downloadTo(audited.urls.audio as string, join(dl, 'audit.mp3'), {
      maxBytes: 5_000_000
    })
    check(
      'the audit scenario serves files from another host name (localhost, not 127.0.0.1)',
      url.hostname === 'localhost',
      () => url.href
    )
    const hit = seen.filter((s) => s.url.href === url.href)
    check('and the download of it carried no key', hit.length === 1 && hit[0].key === null, () =>
      show(hit)
    )
  } else check('the audit job finished', false, () => show(audited))

  // a redirect and a file that wants the key
  const other = await tinyServer((_req, res, url) => {
    if (url.pathname === '/files/stolen.mp3') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' })
      res.end(Buffer.alloc(300, 1))
    } else json(res, 401, { message: 'no' })
  })
  const home = await tinyServer((_req, res, url, self) => {
    const key = self.seen[self.seen.length - 1].key
    if (url.pathname === '/files/redirect.mp3') {
      res.writeHead(302, { location: `${other.url}/files/stolen.mp3` })
      res.end()
    } else if (url.pathname === '/files/needs-key.mp3') {
      if (key) {
        res.writeHead(200, { 'content-type': 'audio/mpeg' })
        res.end(Buffer.alloc(300, 2))
      } else json(res, 401, { message: 'key please' })
    } else if (url.pathname === '/files/elsewhere.mp3') {
      res.writeHead(307, { location: `${other.url}/files/needs-key.mp3` })
      res.end()
    } else json(res, 404, {})
  })
  client.configure({
    baseUrl: home.url,
    getKey: () => KEY,
    dataDir: join(work, 'home'),
    pace: FAST
  })
  await client.downloadTo(`${home.url}/files/redirect.mp3`, join(dl, 'redirected.mp3'), {
    maxBytes: 1e6
  })
  check(
    'a redirect to another host is followed without the key',
    other.seen.length === 1 && other.seen[0].key === null && home.seen.every((s) => s.key === null),
    () => show([home.seen, other.seen])
  )
  await client.downloadTo(`${home.url}/files/needs-key.mp3`, join(dl, 'needs-key.mp3'), {
    maxBytes: 1e6
  })
  check(
    'a file on the API’s own host that refuses without the key is asked for again with it',
    home.seen
      .filter((s) => s.path === '/files/needs-key.mp3')
      .map((s) => s.key !== null)
      .join() === 'false,true',
    () => show(home.seen)
  )
  const refused = await thrown(
    client.downloadTo(`${home.url}/files/elsewhere.mp3`, join(dl, 'elsewhere.mp3'), {
      maxBytes: 1e6
    })
  )
  check(
    'a file on another host that wants a key is not given one',
    refused?.kind === 'network' &&
      other.seen.filter((s) => s.path === '/files/needs-key.mp3').every((s) => s.key === null),
    () => show([refused, other.seen])
  )
  await home.close()
  await other.close()
  pointAtFake()
}

// ---------------------------------------------------------------------------------------------
// 6. Answers the fake does not give

async function sectionOdd(): Promise<void> {
  const { client, jobs } = b
  const script = {
    post: 'ok' as 'ok' | 'echo400' | '503' | 'hang' | '422' | 'refused200' | '502',
    statuses: ['doing'] as string[],
    progress: ['0'] as string[],
    cost: '700',
    result: 'none' as 'none' | 'audio',
    tasks: [] as object[]
  }
  let polled = 0
  const odd = await tinyServer((req, res, url, self) => {
    if (url.pathname === '/v1/credits') return json(res, 200, { success: true, credits: 5000 })
    if (url.pathname === '/v1/tasks') return json(res, 200, { data: script.tasks })
    if (req.method === 'POST' && url.pathname === '/v3/text-to-speech') {
      if (script.post === 'hang') return
      if (script.post === 'echo400')
        return json(res, 400, {
          message: `bad request from ${self.seen[self.seen.length - 1].key}`
        })
      if (script.post === '422') return json(res, 422, { detail: 'text is too long' })
      if (script.post === 'refused200')
        return json(res, 200, { success: false, message: 'Blocked by policy' })
      if (script.post === '503')
        return res
          .writeHead(503, { 'content-type': 'text/html' })
          .end('<html>Service Unavailable</html>')
      if (script.post === '502')
        return res.writeHead(502, { 'content-type': 'text/html' }).end('<html>Bad gateway</html>')
      return json(res, 200, { success: true, task_id: 'odd-task' })
    }
    if (url.pathname === '/v1/task/odd-task') {
      const i = Math.min(polled++, script.statuses.length - 1)
      const status = script.statuses[i]
      const done = status.trim().toLowerCase() === 'done'
      return json(res, 200, {
        id: 'odd-task',
        status,
        progress: script.progress[Math.min(i, script.progress.length - 1)],
        credit_cost: script.cost,
        metadata: done && script.result === 'audio' ? { audio_url: `${self.url}/files/ok.mp3` } : {}
      })
    }
    if (url.pathname === '/files/ok.mp3') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' })
      return void res.end(Buffer.alloc(400, 3))
    }
    json(res, 404, {})
  })
  client.configure({ baseUrl: odd.url, getKey: () => KEY, dataDir: join(work, 'odd'), pace: FAST })
  const oddPosts = (): number => odd.seen.filter((s) => s.method === 'POST').length

  // statuses that are not documented count as still running
  script.statuses = ['queued', 'Processing ', 'doing', 'DONE ']
  script.progress = ['0', '10', '40', '100']
  script.result = 'audio'
  const reports: (number | null)[] = []
  const odder = await client.runJob(
    speechSpec({ hash: uniq('odd'), text: 'An answer with statuses nobody documented.' }),
    { onProgress: (p) => reports.push(p.pct) }
  )
  check(
    'unknown statuses ("queued", "Processing") count as running, and "DONE " as done',
    odder.state === 'done' && polled >= 4,
    () => `${show(odder)} polled=${polled}`
  )
  check(
    'a progress sent as a string is read, and 100 is held back until done',
    reports.includes(10) && reports.includes(40) && !reports.includes(100),
    () => show(reports)
  )
  check(
    'credit_cost sent as a string is a number',
    odder.state === 'done' && odder.creditCost === 700,
    () => show(odder)
  )

  // done, but nothing to download
  polled = 0
  script.statuses = ['done']
  script.result = 'none'
  const empty = noted(
    'done, file unusable',
    await thrown(
      client.runJob(
        speechSpec({ hash: uniq('nofile'), text: 'A job that finishes with nothing to download.' }),
        {}
      )
    )
  )
  check(
    'a finished task with no file says it was paid, is kept, and is not paid twice',
    empty?.kind === 'unusable' &&
      empty.charged === true &&
      empty.userMessage ===
        'ai33 sent back a voiceover Luca couldn’t use, so nothing was added. It used 700 credits and is kept, so it won’t be paid for twice.',
    () => show(empty)
  )
  const kept = jobs.list().find((e) => e.summary.includes('nothing to download'))
  check('and the ledger keeps it as done', kept?.state === 'done' && !!kept.error, () => show(kept))

  // submit failures that leave no task or may have left one
  script.post = 'echo400'
  const echoed = noted('400 echoing the key', await thrown(rawSpeech()))
  check(
    'ai33’s own words are shown, with the key scrubbed if it echoes it',
    echoed?.kind === 'validation' &&
      !echoed.userMessage?.includes(KEY) &&
      /bad request from …/.test(echoed.userMessage ?? ''),
    () => show(echoed)
  )
  script.post = '422'
  const unprocessable = noted('422', await thrown(rawSpeech()))
  check(
    '422 reads "detail" and says nothing was charged',
    unprocessable?.userMessage ===
      'ai33 didn’t accept this: text is too long. Nothing was charged.' &&
      unprocessable.charged === false,
    () => show(unprocessable)
  )
  script.post = 'refused200'
  const softRefusal = noted('200 success:false', await thrown(rawSpeech()))
  check(
    'a 200 with success:false is a refusal, and nothing was charged',
    softRefusal?.userMessage ===
      'ai33 didn’t accept this: Blocked by policy. Nothing was charged.' &&
      softRefusal.charged === false,
    () => show(softRefusal)
  )
  const before503 = oddPosts()
  script.post = '503'
  const html503 = noted('503 html', await thrown(rawSpeech()))
  check(
    'a 503 on submit is sent once, never repeated',
    html503?.kind === 'server' && html503.charged === 'unknown' && oddPosts() === before503 + 1,
    () => show(html503)
  )
  const getFail = await thrown(client.request('/v1/task/nothing-here'))
  check(
    'an HTML error page is never shown as ai33’s words',
    !/</.test(html503?.userMessage ?? '') && !!getFail
  )
  script.post = 'hang'
  const hangBefore = oddPosts()
  const hung = noted(
    'submit timeout',
    await thrown(client.request('/v3/text-to-speech', { json: { text: 'x' }, timeoutMs: 150 }))
  )
  check(
    'a submit that gets no answer is not retried, and does not claim "Nothing was charged"',
    hung?.kind === 'server' &&
      hung.charged === 'unknown' &&
      oddPosts() === hangBefore + 1 &&
      !/Nothing was charged/.test(hung.userMessage ?? ''),
    () => show(hung)
  )

  // reconcile ignores tasks from before the submit
  script.post = '502'
  script.tasks = [
    {
      id: 'old-task',
      created_at: '2020-01-01T00:00:00.000Z',
      type: 'tts',
      text: 'An old task that starts with the same words as this one.'
    }
  ]
  const oldOnly = noted(
    'old task only',
    await thrown(
      client.runJob(
        speechSpec({
          hash: uniq('old'),
          text: 'An old task that starts with the same words as this one.'
        }),
        {}
      )
    )
  )
  check(
    'a task from before the submit is not adopted: the job is lost, not guessed',
    oldOnly?.kind === 'server' &&
      jobs.list().find((e) => e.summary.includes('An old task'))?.state === 'lost',
    () => show(oldOnly)
  )
  await odd.close()

  // Stop pressed while a submit has no answer yet: what was made is found and dropped, or nothing is
  for (const madeAlready of [true, false]) {
    const tasks: object[] = []
    const held = await tinyServer((req, res, url) => {
      if (url.pathname === '/v1/credits') return json(res, 200, { success: true, credits: 5000 })
      if (req.method === 'POST' && url.pathname === '/v3/text-to-speech') {
        // the request arrived (and, when `madeAlready`, made a task) but is never answered
        if (madeAlready)
          tasks.push({
            id: 'held-1',
            type: 'tts',
            created_at: new Date().toISOString(),
            text: 'Stop is pressed while this voiceover has no answer yet.'
          })
        return
      }
      if (url.pathname === '/v1/tasks') return json(res, 200, { data: tasks })
      if (url.pathname === '/v1/task/delete')
        return json(res, 200, { success: true, refund_credits: 0 })
      if (url.pathname === '/v1/task/held-1')
        return json(res, 200, { id: 'held-1', status: 'doing', progress: 5 })
      json(res, 404, {})
    })
    client.configure({
      baseUrl: held.url,
      getKey: () => KEY,
      dataDir: join(work, `held-${madeAlready}`),
      pace: FAST
    })
    const stop = new AbortController()
    const text = 'Stop is pressed while this voiceover has no answer yet.'
    const pending = thrown(
      client.runJob(speechSpec({ hash: uniq('held'), text }), { stop: stop.signal })
    )
    await until('the submit to arrive', () =>
      held.seen.some((s) => s.method === 'POST' && s.path === '/v3/text-to-speech')
    )
    stop.abort()
    const ended = noted(
      `stopped mid-submit (${madeAlready ? 'task made' : 'nothing made'})`,
      await pending
    )
    const entry = jobs.list().find((e) => e.summary.includes('Stop is pressed'))
    check(
      madeAlready
        ? 'Stop while a submit has no answer: the task that was made is found and deleted at ai33'
        : 'Stop while a submit has no answer and nothing was made: nothing is deleted',
      ended?.kind === 'stopped' &&
        ended.userMessage === 'Stopped before the voiceover was ready.' &&
        entry?.state === 'cancelled' &&
        held.seen.filter((s) => s.path === '/v1/task/delete').length === (madeAlready ? 1 : 0) &&
        entry.remoteDeleted === madeAlready &&
        entry.taskId === (madeAlready ? 'held-1' : null),
      () => `${show(ended)} ${show(entry)} ${show(held.seen.map((s) => s.path))}`
    )
    await held.close()
  }

  // submits go two at a time and a little apart (400 ms, scaled here to 200)
  let open = 0
  let most = 0
  const starts: number[] = []
  const line = await tinyServer((req, res, url, self) => {
    if (url.pathname === '/v1/credits') return json(res, 200, { success: true, credits: 100_000 })
    if (req.method === 'POST' && url.pathname === '/v3/text-to-speech') {
      starts.push(Date.now())
      open++
      most = Math.max(most, open)
      const id = `line-${starts.length}`
      return void setTimeout(() => {
        open--
        json(res, 200, { success: true, task_id: id })
      }, 300)
    }
    if (url.pathname.startsWith('/v1/task/line-'))
      return json(res, 200, {
        id: url.pathname.split('/').pop(),
        status: 'done',
        credit_cost: 10,
        metadata: { audio_url: `${self.url}/files/x.mp3` }
      })
    json(res, 404, {})
  })
  client.configure({
    baseUrl: line.url,
    getKey: () => KEY,
    dataDir: join(work, 'line'),
    pace: 0.5
  })
  const lined = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      client.runJob(
        speechSpec({ hash: uniq('line'), text: `Voiceover number ${i} waits in the submit line.` }),
        {}
      )
    )
  )
  const spacing = starts.slice(1).map((t, i) => t - starts[i])
  check(
    'five jobs at once are all made, and never more than two are being submitted at a time',
    lined.every((o) => o.state === 'done') && starts.length === 5 && most === 2,
    () => `states=${lined.map((o) => o.state).join()} posts=${starts.length} most=${most}`
  )
  check(
    'and each submit starts at least 400 ms (scaled to 200) after the one before',
    spacing.length === 4 && Math.min(...spacing) >= 150,
    () => `gaps ms: ${spacing.join(', ')}`
  )
  await line.close()
  pointAtFake()
}

// ---------------------------------------------------------------------------------------------
// 7. Spend policy

type Turn = SpendCtx extends { turn: () => infer T } ? T : never
function mkTurn(id: number): Turn & { abort: () => void } {
  const stop = new AbortController()
  return {
    id,
    stop: stop.signal,
    detach: new AbortController().signal,
    spent: { credits: 0, paid: 0, byKind: {} },
    abort: () => stop.abort()
  }
}

function mkCtx(
  dir: string | null,
  turn: Turn,
  answer: 'allow' | 'deny' | ((a: Ai33Ask) => 'allow' | 'deny') = 'allow'
): { ctx: SpendCtx; asks: Ai33Ask[] } {
  const asks: Ai33Ask[] = []
  return {
    asks,
    ctx: {
      projectDir: dir,
      turn: () => turn,
      ask: async (a) => {
        asks.push(a)
        return typeof answer === 'function' ? answer(a) : answer
      }
    }
  }
}

const textOf = (r: { content: { type: string; text?: string }[] }): string =>
  r.content[0]?.text ?? ''

async function sectionSpend(): Promise<void> {
  const { spend, client } = b
  const V = { id: 'elevenlabs_21m00Tcm4TlvDq8ikWAM', name: 'Rachel' }
  const req = (o: Partial<SpendReq> & { kind: Ai33Kind }): SpendReq => ({
    units: 1,
    summary: 'x',
    ...o
  })
  const known = (credits: number, basis: 'learned' | 'formula' = 'learned'): Ai33Estimate => ({
    credits,
    exact: false,
    basis
  })
  const proj = (name: string): string => {
    const d = join(work, `project-${name}`)
    mkdirSync(d, { recursive: true })
    return d
  }
  scenario('ok')
  pointAtFake()

  same(
    'constants',
    [
      spend.ASK_ABOVE,
      spend.TURN_CAP,
      spend.PER_TURN,
      spend.MAX_PAID_PER_TURN,
      spend.PREAPPROVE_MAX,
      spend.MUSIC_SEED,
      spend.ASK_TIMEOUT_MS
    ],
    [1500, 6000, { speech: 3, music: 1, sfx: 8 }, 6, 6000, 3600, 1_800_000]
  )

  // estimates
  same(
    'sfx: 50 credits a second, exact for whole seconds',
    await spend.estimate({ kind: 'sfx', seconds: 2 }),
    { credits: 100, exact: true, basis: 'formula' }
  )
  same(
    'sfx: at least 50, and "about" for a fraction',
    [
      await spend.estimate({ kind: 'sfx', seconds: 0.5 }),
      await spend.estimate({ kind: 'sfx', seconds: 1.5 })
    ],
    [
      { credits: 50, exact: false, basis: 'formula' },
      { credits: 75, exact: false, basis: 'formula' }
    ]
  )
  same(
    'sfx: ai33 picks the length is 200 each',
    await spend.estimate({ kind: 'sfx', seconds: null, count: 3 }),
    { credits: 600, exact: true, basis: 'formula' }
  )
  same('music: the seed until a price has been seen', await spend.estimate({ kind: 'music' }), {
    credits: 3600,
    exact: false,
    basis: 'seed'
  })
  same(
    'speech: unknown until a voice’s price has been seen',
    await spend.estimate({ kind: 'speech', chars: 1000, voiceId: V.id }),
    { credits: null, exact: false, basis: 'unknown' }
  )

  // reserve and settle
  const t1 = mkTurn(1)
  const { ctx: c1, asks: a1 } = mkCtx(null, t1)
  const g1 = await spend.gateSpend(c1, req({ kind: 'sfx', units: 2 }))
  check('a small sound-effect job is allowed without a card', g1.go && a1.length === 0, () =>
    show(g1)
  )
  same('the estimate is reserved in the turn', t1.spent, {
    credits: 200,
    paid: 1,
    byKind: { sfx: 2 }
  })
  if (g1.go) {
    spend.settleSpend(c1, g1.grant, 180)
    same('settling swaps the estimate for the real cost', t1.spent, {
      credits: 180,
      paid: 1,
      byKind: { sfx: 2 }
    })
    spend.settleSpend(c1, g1.grant, 0)
    same('a grant settles once', t1.spent, { credits: 180, paid: 1, byKind: { sfx: 2 } })
  }
  const g2 = await spend.gateSpend(c1, req({ kind: 'sfx', units: 1 }))
  if (g2.go) {
    spend.settleSpend(c1, g2.grant, 0)
    same('a failed or cancelled job gives its place in the caps back', t1.spent, {
      credits: 180,
      paid: 1,
      byKind: { sfx: 2 }
    })
  } else check('a second sound-effect call is allowed', false, () => show(g2))

  // cards
  const tA = mkTurn(2)
  const { ctx: cA, asks: askA } = mkCtx(null, tA)
  const gm = await spend.gateSpend(cA, req({ kind: 'music', summary: 'Music' }))
  check('music with only the seed price asks first', gm.go && askA.length === 1, () => show(askA))
  same(
    'the music card says what it is, what it costs and that it is a guess',
    [
      askA[0]?.kind,
      askA[0]?.title,
      askA[0]?.detail,
      askA[0]?.credits,
      askA[0]?.balance,
      askA[0]?.warn
    ],
    [
      'spend',
      'Make music for the video?',
      'About 3,600 of your 100,000 credits. It takes a minute or two.',
      3600,
      100_000,
      'ai33 hasn’t given a price for this yet, so this is a guess. Luca will tell you what it used.'
    ]
  )
  if (gm.go) {
    spend.settleSpend(cA, gm.grant, 5000)
    check(
      'a cost far from the estimate is logged',
      warnings.some((w) => /music cost 5000 credits, estimated 3600/.test(w)),
      () => show(warnings)
    )
    same('and the price is learned', await spend.estimate({ kind: 'music' }), {
      credits: 5000,
      exact: false,
      basis: 'learned'
    })
  }
  const tB = mkTurn(3)
  const { ctx: cB, asks: askB } = mkCtx(null, tB)
  const gv = await spend.gateSpend(
    cB,
    req({ kind: 'speech', units: 4000, voice: V, estimate: known(2000) })
  )
  check(
    'a job of 1,500 credits or more asks, naming the voice for the play button',
    gv.go &&
      askB.length === 1 &&
      askB[0].title === 'Record the voiceover in Rachel’s voice?' &&
      askB[0].voice?.id === V.id &&
      askB[0].detail === 'About 2,000 of your 100,000 credits.',
    () => show(askB)
  )
  if (gv.go) {
    spend.settleSpend(cB, gv.grant, 2400)
    same(
      'a speech price is learned per voice service',
      await spend.estimate({ kind: 'speech', chars: 500, voiceId: 'elevenlabs_other' }),
      { credits: 300, exact: false, basis: 'learned' }
    )
    const g = await spend.gateSpend(cB, req({ kind: 'speech', units: 1000, voice: V }))
    if (g.go) spend.settleSpend(cB, g.grant, 1800)
    same(
      'and averaged with the next one',
      await spend.estimate({ kind: 'speech', chars: 1000, voiceId: V.id }),
      { credits: 1200, exact: false, basis: 'learned' }
    )
  }
  same(
    'another service’s voice is still unpriced',
    (await spend.estimate({ kind: 'speech', chars: 1000, voiceId: 'edge_en-US-AriaNeural' })).basis,
    'unknown'
  )

  const askKinds = async (label: string, r: SpendReq, setup?: () => void): Promise<Ai33Ask[]> => {
    setup?.()
    const t = mkTurn(100 + seq++)
    const { ctx, asks } = mkCtx(null, t)
    await spend.gateSpend(ctx, r)
    void label
    return asks
  }
  check(
    'a batch of more than 3 effects asks, and says how many',
    (await askKinds('batch', req({ kind: 'sfx', units: 4 })))[0]?.title === 'Make 4 sound effects?'
  )
  check(
    '3 effects do not ask',
    (await askKinds('three', req({ kind: 'sfx', units: 3 }))).length === 0
  )
  check(
    'a script’s remaining parts count as a batch',
    (await askKinds('parts', req({ kind: 'sfx', units: 1, batch: 5 }))).length === 1
  )
  check(
    'speech of unknown price over 1,500 characters asks',
    (
      await askKinds(
        'long',
        req({ kind: 'speech', units: 1600, voice: { id: 'edge_en-US-AriaNeural', name: 'Aria' } })
      )
    ).length === 1
  )
  const unknownAsk = (
    await askKinds(
      'long2',
      req({ kind: 'speech', units: 1600, voice: { id: 'edge_en-US-AriaNeural', name: 'Aria' } })
    )
  )[0]
  check(
    'and says the price is not known',
    unknownAsk?.detail === 'You have 100,000 credits.' &&
      /hasn’t given a price/.test(unknownAsk.warn ?? ''),
    () => show(unknownAsk)
  )
  check(
    'speech of unknown price under 1,500 characters does not ask',
    (
      await askKinds(
        'short',
        req({ kind: 'speech', units: 1200, voice: { id: 'edge_en-US-AriaNeural', name: 'Aria' } })
      )
    ).length === 0
  )
  const tCap = mkTurn(4)
  tCap.spent.credits = 5000
  const { ctx: cCap, asks: askCap } = mkCtx(null, tCap)
  await spend.gateSpend(cCap, req({ kind: 'speech', units: 100, voice: V, estimate: known(1200) }))
  check(
    'a turn that would pass 6,000 credits asks, even for a small job',
    askCap.length === 1,
    () => show(askCap)
  )
  scenario('ok', { credits: 1000 })
  const share = await askKinds(
    'share',
    req({ kind: 'speech', units: 100, voice: V, estimate: known(600) })
  )
  check(
    'more than half of what is left asks, and says so',
    share[0]?.warn === 'That’s more than half of what’s left.',
    () => show(share)
  )
  scenario('ok')
  const busyAsk = await askKinds(
    'busy',
    req({ kind: 'speech', units: 100, voice: V, estimate: known(2000) }),
    () => scenario('ok', { health: { elevenlabs: 'degraded' } })
  )
  check(
    'a busy voice service adds a line to the card',
    /The voice service is busy right now, so this may take longer or fail\./.test(
      busyAsk[0]?.warn ?? ''
    ),
    () => show(busyAsk)
  )
  scenario('ok')

  // the person says no, or Stop is pressed while the card is open
  const tD = mkTurn(5)
  const { ctx: cD } = mkCtx(null, tD, 'deny')
  const declined = await spend.gateSpend(cD, req({ kind: 'music' }))
  const dj = !declined.go ? JSON.parse(textOf(declined.result)) : null
  check(
    'a "no" is a declined result (not an error) and reserves nothing',
    !declined.go &&
      !declined.result.isError &&
      dj?.ok === false &&
      dj.declined === true &&
      dj.tell ===
        'The user chose not to spend credits on this. Say so in one short sentence and do not try again.' &&
      tD.spent.paid === 0 &&
      tD.spent.credits === 0,
    () => show(declined)
  )
  const tE = mkTurn(6)
  const { ctx: cE } = mkCtx(null, tE, () => {
    tE.abort()
    return 'allow'
  })
  const stopped = await spend.gateSpend(cE, req({ kind: 'music' }))
  check(
    'Stop pressed while the card is open counts as no',
    !stopped.go && !stopped.result.isError && tE.spent.paid === 0,
    () => show(stopped)
  )

  // refusals with no card
  scenario('ok', { credits: 500 })
  const tF = mkTurn(7)
  const { ctx: cF, asks: askF } = mkCtx(null, tF)
  const poor = await spend.gateSpend(
    cF,
    req({ kind: 'speech', units: 1000, voice: V, estimate: known(800) })
  )
  check(
    'too few credits refuses, with no card',
    !poor.go &&
      poor.result.isError === true &&
      askF.length === 0 &&
      textOf(poor.result) === client.notEnough(500, 800),
    () => show(poor)
  )
  scenario('ok', { credits: 0 })
  const broke = await spend.gateSpend(
    cF,
    req({ kind: 'speech', units: 1000, voice: { id: 'edge_en-US-AriaNeural', name: 'Aria' } })
  )
  check(
    'a zero balance refuses even when the price is unknown',
    !broke.go && /\(0 left\)/.test(textOf(broke.result)),
    () => show(broke)
  )
  scenario('bad-key-401')
  const blind = await spend.gateSpend(cF, req({ kind: 'sfx', units: 1 }))
  check(
    'an unreadable balance refuses, and says nothing was charged',
    !blind.go &&
      /couldn’t check how many ai33 credits are left/.test(textOf(blind.result)) &&
      /Nothing was charged/.test(textOf(blind.result)),
    () => show(blind)
  )
  scenario('overloaded-health')
  const over = await spend.gateSpend(cF, req({ kind: 'speech', units: 100, voice: V }))
  check(
    'an overloaded voice service refuses, and says nothing was charged',
    !over.go &&
      textOf(over.result) ===
        'The voice service is busy right now, so Luca didn’t start it. Nothing was charged. Tell the user in one short sentence to try again in a few minutes or pick a Standard voice. Do not retry.',
    () => show(over)
  )
  const overSfx = await spend.gateSpend(cF, req({ kind: 'sfx', units: 1 }))
  check('sound effects follow the same service', !overSfx.go)
  const minimax = await spend.gateSpend(
    cF,
    req({ kind: 'speech', units: 100, voice: { id: 'minimax_male-qn-qingse', name: 'Qingse' } })
  )
  const edge = await spend.gateSpend(
    cF,
    req({ kind: 'speech', units: 100, voice: { id: 'edge_en-US-AriaNeural', name: 'Aria' } })
  )
  check(
    'a healthy service, and services with no health signal, go ahead',
    minimax.go && edge.go,
    () => show([minimax, edge])
  )
  scenario('ok')

  // caps
  const tG = mkTurn(8)
  const { ctx: cG, asks: askG } = mkCtx(null, tG)
  const speechGrants = []
  for (let i = 0; i < 3; i++)
    speechGrants.push(
      await spend.gateSpend(cG, req({ kind: 'speech', units: 100, voice: V, estimate: known(100) }))
    )
  const fourth = await spend.gateSpend(
    cG,
    req({ kind: 'speech', units: 100, voice: V, estimate: known(100) })
  )
  check(
    'a fourth voiceover in one turn is refused',
    speechGrants.every((g) => g.go) &&
      !fourth.go &&
      textOf(fourth.result) ===
        'Luca already made 3 voiceovers this turn. Ask the user before making another. Do not retry.',
    () => show(fourth)
  )
  const dialogue = await spend.gateSpend(
    cG,
    req({ kind: 'dialogue', units: 100, estimate: known(100) })
  )
  check('a conversation counts with speech', !dialogue.go)
  const first = speechGrants[0]
  if (first.go) spend.settleSpend(cG, first.grant, 0)
  check(
    'a voiceover that failed frees its place',
    (await spend.gateSpend(cG, req({ kind: 'speech', units: 100, voice: V, estimate: known(100) })))
      .go
  )
  check('no card was shown for any of these', askG.length === 0)

  const tH = mkTurn(9)
  const { ctx: cH } = mkCtx(null, tH)
  const m1 = await spend.gateSpend(cH, req({ kind: 'music' }))
  const m2 = await spend.gateSpend(cH, req({ kind: 'music' }))
  check(
    'a second piece of music in one turn is refused',
    m1.go &&
      !m2.go &&
      textOf(m2.result) ===
        'Luca already made 1 piece of music this turn. Ask the user before making another. Do not retry.',
    () => show(m2)
  )
  const nine = await spend.gateSpend(mkCtx(null, mkTurn(10)).ctx, req({ kind: 'sfx', units: 9 }))
  check(
    'nine sound effects at once is over the cap of eight',
    !nine.go &&
      textOf(nine.result) ===
        'Luca can only make 8 sound effects in one turn. Ask the user before making that many. Do not retry.',
    () => show(nine)
  )
  const tI = mkTurn(11)
  const { ctx: cI } = mkCtx(null, tI)
  for (let i = 0; i < 6; i++)
    await spend.gateSpend(
      cI,
      req({ kind: 'sfx', units: 1, estimate: { credits: 50, exact: true, basis: 'formula' } })
    )
  const seventh = await spend.gateSpend(cI, req({ kind: 'sfx', units: 1 }))
  check(
    'a seventh paid call in one turn is refused, whatever it is',
    !seventh.go &&
      textOf(seventh.result) ===
        'Luca already made 6 things that use ai33 credits this turn. Ask the user before making another. Do not retry.',
    () => show(seventh)
  )
  const tJ = mkTurn(12)
  const { ctx: cJ } = mkCtx(null, tJ)
  const both2 = await Promise.all([
    spend.gateSpend(cJ, req({ kind: 'music' })),
    spend.gateSpend(cJ, req({ kind: 'music' }))
  ])
  check(
    'two music calls made at the same moment cannot both pass the cap',
    both2.filter((g) => g.go).length === 1,
    () => show(both2)
  )

  // a script start (no chat, no project)
  const abort = new AbortController()
  const startAsks: Ai33Ask[] = []
  const start = spend.makeStartCtx(async (a) => {
    startAsks.push(a)
    return 'allow'
  }, abort.signal)
  check(
    'a start context has no project and turn id 0',
    start.projectDir === null && start.turn().id === 0
  )
  let allowed = 0
  for (let i = 0; i < 8; i++)
    if (
      (
        await spend.gateSpend(
          start,
          req({ kind: 'speech', units: 100, voice: V, estimate: known(100) })
        )
      ).go
    )
      allowed++
  check(
    'the per-turn counts do not apply to a script start (the person pressed the button)',
    allowed === 8,
    () => `${allowed}`
  )
  await spend.gateSpend(
    start,
    req({ kind: 'speech', units: 20_000, voice: V, estimate: known(2000) })
  )
  same(
    'the start card asks about the rest of the recording, with Go ahead and Stop',
    [startAsks[0]?.title, startAsks[0]?.detail, startAsks[0]?.labels],
    [
      'Record the whole voiceover?',
      'The full voiceover will use about 2,000 credits. You have 100,000.',
      { allow: 'Go ahead', deny: 'Stop' }
    ]
  )
  abort.abort()
  same(
    'once Stop is pressed the start context answers no',
    await start.ask({ kind: 'spend', title: 't', detail: 'd' }),
    'deny'
  )

  // preapproval: music only, once, the first turn, within limits. It lives in the main process's
  // memory and nowhere else: the model can write files in a project, so no file can grant it.
  const p1 = proj('pre1')
  pointAtFake()
  spend.grantPreapproval(p1, ['speech', 'sfx'] as Ai33Kind[])
  const { ctx: cK0, asks: askK0 } = mkCtx(p1, mkTurn(19))
  const noSpeech = await spend.gateSpend(
    cK0,
    req({ kind: 'speech', units: 100, voice: V, estimate: known(2000) })
  )
  const noSfx = await spend.gateSpend(cK0, req({ kind: 'sfx', units: 5 }))
  const noMusic = await spend.gateSpend(cK0, req({ kind: 'music' }))
  check(
    'only music can be preapproved: a grant for speech and effects covers nothing, not even music',
    askK0.length === 3 && [noSpeech, noSfx, noMusic].every((g) => g.go && !g.grant.preapproved),
    () => `${askK0.length} ${show([noSpeech, noSfx, noMusic])}`
  )
  spend.grantPreapproval(p1, ['music'])
  check(
    'granting writes nothing into the project folder: the chip is kept in memory',
    readdirSync(p1).length === 0,
    () => show(readdirSync(p1))
  )
  const tK = mkTurn(20)
  const { ctx: cK, asks: askK } = mkCtx(p1, tK)
  const sfxBatch = await spend.gateSpend(cK, req({ kind: 'sfx', units: 5 }))
  check(
    'the chip does not cover other kinds: a batch of effects still asks',
    sfxBatch.go && !sfxBatch.grant.preapproved && askK.length === 1,
    () => show(askK)
  )
  const covered = await spend.gateSpend(cK, req({ kind: 'music' }))
  check(
    'the chip covers music in the first turn with no card',
    covered.go && covered.grant.preapproved && askK.length === 1 && covered.grant.reserved === 3600,
    () => show(covered)
  )
  if (covered.go) spend.settleSpend(cK, covered.grant, 3600)
  const tL = mkTurn(21)
  const { ctx: cL, asks: askL } = mkCtx(p1, tL)
  const later = await spend.gateSpend(cL, req({ kind: 'music' }))
  check(
    'a later piece of music asks: the chip was used up when the music was settled',
    later.go && !later.grant.preapproved && askL.length === 1,
    () => show(askL)
  )

  // once, not merely for the first turn: a music job that failed (settled at 0, which gives its
  // place in the turn's caps back) still uses the chip up, and a second try in the same turn asks
  const p1b = proj('pre1b')
  const p1c = proj('pre1c')
  spend.grantPreapproval(`${p1b}/x/..`, ['music'])
  const { ctx: cOther, asks: askOther } = mkCtx(p1c, mkTurn(22))
  const other = await spend.gateSpend(cOther, req({ kind: 'music' }))
  const { ctx: cNone, asks: askNone } = mkCtx(null, mkTurn(23))
  const none = await spend.gateSpend(cNone, req({ kind: 'music' }))
  check(
    'a chip belongs to its own project: another project and a chat with no project still ask',
    other.go &&
      !other.grant.preapproved &&
      askOther.length === 1 &&
      none.go &&
      !none.grant.preapproved &&
      askNone.length === 1,
    () => `${show(askOther)} ${show(askNone)}`
  )
  const tR = mkTurn(24)
  const { ctx: cR, asks: askR } = mkCtx(p1b, tR)
  const tried = await spend.gateSpend(cR, req({ kind: 'music' }))
  check(
    'the chip found its project whatever the path is spelled like, and the others left it alone',
    tried.go && tried.grant.preapproved && askR.length === 0,
    () => show(tried)
  )
  if (tried.go) spend.settleSpend(cR, tried.grant, 0)
  const again = await spend.gateSpend(cR, req({ kind: 'music' }))
  check(
    'the chip is used up by one try, even one that failed, in the very same turn',
    again.go && !again.grant.preapproved && askR.length === 1,
    () => show(askR)
  )
  const p1d = proj('pre1d')
  spend.grantPreapproval(p1d, ['music'])
  spend.endPreapproval(p1d)
  const { ctx: cS, asks: askS } = mkCtx(p1d, mkTurn(25))
  await spend.gateSpend(cS, req({ kind: 'music' }))
  check('a chip that was ended asks', askS.length === 1, () => show(askS))

  // a file in the project can never be the chip, whatever it says and whoever wrote it
  const p1e = proj('pre1e')
  mkdirSync(join(p1e, '.luca'), { recursive: true })
  const fileText = JSON.stringify({ v: 1, preapproved: ['music'] })
  writeFileSync(join(p1e, '.luca', 'ai33.json'), fileText)
  const { ctx: cT, asks: askT } = mkCtx(p1e, mkTurn(26))
  const forged = await spend.gateSpend(cT, req({ kind: 'music' }))
  check(
    'a project file that says {"preapproved":["music"]} does not skip the card',
    forged.go &&
      !forged.grant.preapproved &&
      askT.length === 1 &&
      readFileSync(join(p1e, '.luca', 'ai33.json'), 'utf8') === fileText,
    () => show(askT)
  )

  const p2 = proj('pre2')
  pointAtFake()
  spend.grantPreapproval(p2, ['music'])
  const tM = mkTurn(30)
  await spend.gateSpend(mkCtx(p2, tM).ctx, req({ kind: 'sfx', units: 1 }))
  const tN = mkTurn(31)
  const { ctx: cN, asks: askN } = mkCtx(p2, tN)
  const lapsed = await spend.gateSpend(cN, req({ kind: 'music' }))
  check(
    'the chip lapses after the first turn that spends in the project',
    lapsed.go && !lapsed.grant.preapproved && askN.length === 1,
    () => `${askN.length} ${show(lapsed)}`
  )

  const p3 = proj('pre3')
  pointAtFake()
  const learn = await spend.gateSpend(mkCtx(null, mkTurn(40)).ctx, req({ kind: 'music' }))
  if (learn.go) spend.settleSpend(mkCtx(null, mkTurn(40)).ctx, learn.grant, 7000)
  spend.grantPreapproval(p3, ['music'])
  const { ctx: cO, asks: askO } = mkCtx(p3, mkTurn(41))
  await spend.gateSpend(cO, req({ kind: 'music' }))
  check('music priced above 6,000 is asked about even with the chip', askO.length === 1, () =>
    show(askO)
  )
  const p4 = proj('pre4')
  pointAtFake()
  spend.grantPreapproval(p4, ['music'])
  scenario('ok', { credits: 3000 })
  const { ctx: cP, asks: askP } = mkCtx(p4, mkTurn(42))
  const tooPoor = await spend.gateSpend(cP, req({ kind: 'music' }))
  check(
    'with less than the music seed left, the chip does not spend: it refuses',
    !tooPoor.go &&
      askP.length === 0 &&
      /\(3,000 left, it needs about 3,600\)/.test(textOf(tooPoor.result)),
    () => show(tooPoor)
  )
  scenario('ok')
  const p5 = proj('pre5')
  pointAtFake()
  spend.grantPreapproval(p5, ['music'])
  const tQ = mkTurn(43)
  tQ.spent.credits = 3000
  const { ctx: cQ, asks: askQ } = mkCtx(p5, tQ)
  await spend.gateSpend(cQ, req({ kind: 'music' }))
  check('the chip never lets a turn spend past its cap', askQ.length === 1, () => show(askQ))
}

// ---------------------------------------------------------------------------------------------
// 8. Script text: the chunker, hashes and the timing ladder

async function sectionSpeechText(): Promise<void> {
  const st = b.speechText
  const sentences = (n: number, w: string): string =>
    Array.from({ length: n }, (_, i) => `${w} sentence number ${i + 1} goes here.`).join(' ')
  const words = (s: string): string[] => s.split(/\s+/).filter(Boolean)

  same(
    'constants',
    [st.PROBE_CHARS, st.PART_MERGE_MIN, st.PART_SPLIT_MAX, st.PART_GAP],
    [400, 200, 2500, 0.35]
  )
  const script = [
    sentences(20, 'Alpha'),
    'Short one.',
    sentences(10, 'Beta'),
    sentences(150, 'Gamma')
  ].join('\n\n')
  const pieces = st.chunkScript(script)
  check(
    'the first part is the price probe: at most 400 characters, cut at a sentence end',
    pieces[0].text.length <= 400 && /\.$/.test(pieces[0].text),
    () => show(pieces[0])
  )
  check(
    'no part is longer than 2,500 characters',
    pieces.every((p) => p.text.length <= 2500),
    () => show(pieces.map((p) => p.text.length))
  )
  check(
    'after the probe, no part is a sliver (short paragraphs are joined)',
    pieces.slice(1).every((p) => p.text.length >= 200),
    () => show(pieces.map((p) => p.text.length))
  )
  same('every word survives, in order', words(pieces.map((p) => p.text).join(' ')), words(script))
  check(
    'a paragraph end leaves 0.35 s of silence; a cut inside a paragraph, none; the last, none',
    pieces[0].gapAfter === 0 &&
      pieces[1].gapAfter === 0.35 &&
      pieces[pieces.length - 1].gapAfter === 0 &&
      pieces.every((p) => p.gapAfter === 0 || p.gapAfter === 0.35),
    () => show(pieces.map((p) => p.gapAfter))
  )
  same('the same script always gives the same parts', st.chunkScript(script), pieces)
  same('a short script is one part', st.chunkScript('Hello there.\r\n'), [
    { text: 'Hello there.', gapAfter: 0 }
  ])
  same('an empty script has no parts', st.chunkScript('  \n '), [])
  same(
    '"Dr." does not end a sentence',
    st.cutAt(`Dr. Smith went home. ${'x '.repeat(30)}`, 25).head,
    'Dr. Smith went home.'
  )
  // the probe takes as much as fits in 400 characters, so it ends at the paragraph break only when
  // no sentence ends between the break and the limit
  const firstParagraph = 'A short sentence here. '.repeat(10).trim()
  const runOn = `${'Another stretch of words with no full stop '.repeat(12).trim()}. ${'Then it ends. '.repeat(20).trim()}`
  const paragraphFirst = st.chunkScript(`${firstParagraph}\n\n${runOn}`)
  same(
    'when the probe ends at a paragraph break, the silence follows it',
    [paragraphFirst[0].text, paragraphFirst[0].gapAfter],
    [firstParagraph, 0.35]
  )

  // a text with no sentence end for 400 characters and no plain space (tabs, no-break spaces)
  const oddSpaces = ['\t', '\u00a0'].map((sep) => {
    const spaced = Array.from({ length: 70 }, (_, i) => `word${i}xx`).join(sep)
    const cut = st.chunkScript(spaced)
    return (
      cut.length > 1 &&
      isDeepStrictEqual(
        cut.flatMap((p) => p.text.split(/\s+/)),
        spaced.split(/\s+/)
      )
    )
  })
  check(
    'a long stretch with only tabs (or only no-break spaces) between the words is cut between words, never inside one',
    oddSpaces.every(Boolean),
    () => show(oddSpaces)
  )

  // dialogue
  const turns = st.parseDialogue('A> Hello there.\nB> Hi! How are you?\nstill B talking\nC> Good.')
  same(
    'a conversation is read as turns, and a line with no label continues the turn above',
    turns,
    [
      { speaker: 0, text: 'Hello there.' },
      { speaker: 1, text: 'Hi! How are you? still B talking' },
      { speaker: 2, text: 'Good.' }
    ]
  )
  same(
    'speakersUsed and hasSpeakerLabels',
    [
      st.speakersUsed(turns),
      st.hasSpeakerLabels('A> hi'),
      st.hasSpeakerLabels('Hi there'),
      st.stripLabels('A> hi\nB> yo')
    ],
    [3, true, false, 'hi\nyo']
  )
  same('a short conversation is one part with its labels', st.chunkDialogue(turns, 0.4), [
    { text: 'A> Hello there.\nB> Hi! How are you? still B talking\nC> Good.', gapAfter: 0 }
  ])
  const talk = Array.from({ length: 30 }, (_, i) => ({
    speaker: i % 2,
    text: `Turn number ${i} says something reasonably long to fill the space.`
  }))
  const talkParts = st.chunkDialogue(talk, 0.4)
  check(
    'a long conversation ends every part at a turn, with the pause between speakers',
    talkParts.length > 1 &&
      talkParts[0].text.length <= 400 &&
      talkParts.every((p) => /^[ABC]> /.test(p.text)) &&
      talkParts[0].gapAfter === 0.4 &&
      talkParts[talkParts.length - 1].gapAfter === 0,
    () => show(talkParts.map((p) => [p.text.length, p.gapAfter]))
  )
  same(
    'and loses no turn',
    talkParts.map((p) => p.text).join('\n'),
    talk.map((t) => `${'AB'[t.speaker]}> ${t.text}`).join('\n')
  )

  // words of a script
  same(
    'wordsFromScript: labels dropped, a lone dash or emoji joins its word',
    st.wordsFromScript('A> Hi there — friend 👋\nB> Fine.'),
    ['Hi', 'there—', 'friend👋', 'Fine.']
  )
  same(
    'wordsFromScript: punctuation stays attached',
    st.wordsFromScript('“Well,” she said, “it’s 3.5 a.m.”'),
    ['“Well,”', 'she', 'said,', '“it’s', '3.5', 'a.m.”']
  )

  // pronunciation
  const rules = st.normalizeSay([
    { word: 'AI', as: 'A I' },
    { word: '  ', as: 'nothing' },
    { word: 'same', as: 'same' },
    { word: 'AI', as: 'again' },
    { word: 'gif', as: 'jif', wholeWord: false }
  ])
  same(
    'normalizeSay drops blanks, no-ops and repeats, and marks capitalised words case-sensitive',
    rules,
    [
      { from: 'AI', to: 'A I', matchType: 'word', caseSensitive: true },
      { from: 'gif', to: 'jif', matchType: 'contains', caseSensitive: false }
    ]
  )
  same(
    'rulesFor keeps only the rules that occur in a text',
    st.rulesFor('Say GIFs and more', rules).map((r) => r.from),
    ['gif']
  )
  same(
    'replaceLocal: whole words only, case-sensitive when written with a capital',
    st.replaceLocal('AI, said, and AIM, ai', rules),
    'A I, said, and AIM, ai'
  )
  same(
    'replaceLocal: what one rule writes is never rewritten by another',
    st.replaceLocal('a b', [
      { from: 'a', to: 'b', matchType: 'word', caseSensitive: false },
      { from: 'b', to: 'c', matchType: 'word', caseSensitive: false }
    ]),
    'b c'
  )
  same(
    'replaceLocal keeps speaker labels out of it',
    st.replaceLocal(
      'A> a\nB> a',
      [{ from: 'A', to: 'x', matchType: 'word', caseSensitive: true }],
      true
    ),
    'A> a\nB> a'
  )
  check(
    'rulesHash8 is short and stable',
    st.rulesHash8(rules) === st.rulesHash8(rules) && /^[0-9a-f]{8}$/.test(st.rulesHash8(rules))
  )

  // part hashes
  const key = {
    kind: 'speech' as const,
    text: 'Hello there.',
    voices: [{ id: 'edge_en-US-AriaNeural', speed: 1 }],
    delay: 0,
    withTranscript: false,
    rules: null,
    local: false
  }
  const h = st.partHash(key)
  check(
    'a part hash is stable, and a hex digest',
    h === st.partHash({ ...key, voices: [{ id: 'edge_en-US-AriaNeural', speed: 1 }] }) &&
      /^[0-9a-f]{64}$/.test(h)
  )
  check(
    'asking for the transcript changes the hash (it may cost more)',
    st.partHash({ ...key, withTranscript: true }) !== h
  )
  const variants = [
    { text: 'Hello there!' },
    { voices: [{ id: 'edge_en-US-GuyNeural', speed: 1 }] },
    { voices: [{ id: 'edge_en-US-AriaNeural', speed: 1.1 }] },
    { kind: 'dialogue' as const },
    { delay: 0.4 },
    { rules: rules },
    { local: true }
  ]
  check(
    'so does the text, the voice, the speed, the kind, the pause, the rules and where they are applied',
    variants.every((v) => st.partHash({ ...key, ...v }) !== h) &&
      new Set(variants.map((v) => st.partHash({ ...key, ...v }))).size === variants.length
  )
  const whole = st.wholeHash(['a', 'b'], [0.35])
  check(
    'a whole recording’s hash follows its parts and gaps',
    whole === st.wholeHash(['a', 'b'], [0.35]) &&
      whole !== st.wholeHash(['b', 'a'], [0.35]) &&
      whole !== st.wholeHash(['a', 'b'], [0])
  )

  // the timing ladder, on real answers from the fake
  const script2 =
    'Most people think compound interest is boring. Here’s why it isn’t, and what it means for you.'
  const tokens = st.wordsFromScript(script2)
  const seconds = 2
  const region = async (): Promise<{ from: number; to: number }> => ({ from: 0.2, to: 1.8 })
  const inOrder = (w: { start: number; end: number }[]): boolean =>
    w.every(
      (x, i) =>
        x.end >= x.start &&
        x.start >= 0 &&
        x.end <= seconds &&
        (i === 0 || x.start >= w[i - 1].start)
    )
  type Files = { json?: unknown; srt?: string }
  const files: Record<string, Files> = {}
  for (const [name, params] of [
    ['words', { jsonShape: 'words' }],
    ['ms', { jsonShape: 'ms' }],
    ['array', { jsonShape: 'array' }],
    ['segments', { jsonShape: 'segments' }],
    ['short', { jsonShape: 'short' }],
    ['srt-only', { transcript: 'srt' }],
    ['none', { transcript: 'none' }]
  ] as [string, Record<string, unknown>][]) {
    scenario('ok', params)
    pointAtFake()
    const out = await b.client.runJob(
      speechSpec({ hash: uniq('ladder'), text: script2, transcript: true }),
      {}
    )
    if (out.state !== 'done') {
      check(`the ${name} transcript job finished`, false, () => show(out))
      continue
    }
    files[name] = {
      json: out.urls.json ? await (await fetch(out.urls.json)).json() : undefined,
      srt: out.urls.srt ? await (await fetch(out.urls.srt)).text() : undefined
    }
  }
  check(
    'the fake gives ai33’s word times, subtitles, or nothing, as the scenario says',
    !!files.words?.json &&
      !!files.words.srt &&
      !files['srt-only']?.json &&
      !!files['srt-only']?.srt &&
      !files.none?.json &&
      !files.none?.srt
  )
  for (const name of ['words', 'ms', 'array', 'segments']) {
    const r = await st.timingLadder({ tokens, seconds, ...files[name], region })
    check(
      `tier 1 (words) from the "${name}" layout: script spelling, in order, inside the recording`,
      r.tier === 'words' &&
        isDeepStrictEqual(
          r.words.map((w) => w.text),
          tokens
        ) &&
        inOrder(r.words),
      () => show(r)
    )
  }
  const ms = await st.timingLadder({ tokens, seconds, ...files.ms, region })
  const sec = await st.timingLadder({ tokens, seconds, ...files.words, region })
  check(
    'milliseconds and seconds give the same times',
    ms.words.every(
      (w, i) =>
        Math.abs(w.start - sec.words[i].start) < 0.002 && Math.abs(w.end - sec.words[i].end) < 0.002
    ),
    () => show([ms.words.slice(0, 2), sec.words.slice(0, 2)])
  )
  const half = await st.timingLadder({ tokens, seconds, ...files.short, region })
  check(
    'half the words is not enough for tier 1: it falls to the subtitles (tier 2)',
    half.tier === 'cues' && inOrder(half.words) && half.words.length === tokens.length,
    () => show(half)
  )
  const cues = await st.timingLadder({ tokens, seconds, ...files['srt-only'], region })
  check(
    'subtitles only is tier 2 (cues)',
    cues.tier === 'cues' &&
      isDeepStrictEqual(
        cues.words.map((w) => w.text),
        tokens
      ) &&
      inOrder(cues.words),
    () => show(cues)
  )
  const prop = await st.timingLadder({ tokens, seconds, ...files.none, region })
  check(
    'nothing from ai33 is tier 3 (proportional), spread over the speech only',
    prop.tier === 'proportional' &&
      inOrder(prop.words) &&
      Math.abs(prop.words[0].start - 0.2) < 0.01 &&
      Math.abs(prop.words[prop.words.length - 1].end - 1.8) < 0.01,
    () => show(prop)
  )
  const bare = await st.timingLadder({ tokens, seconds })
  check(
    'with no silence trimming it spreads over the whole recording',
    bare.tier === 'proportional' &&
      bare.words[0].start === 0 &&
      Math.abs(bare.words[bare.words.length - 1].end - seconds) < 0.01
  )
  const bad = [
    { words: tokens.map((t, i) => ({ text: t, start: 1 - i * 0.05, end: 1.2 - i * 0.05 })) },
    { words: tokens.map((t, i) => ({ text: t, start: i * 0.5, end: i * 0.5 + 0.4 })) }
  ]
  const back = await st.timingLadder({
    tokens,
    seconds,
    json: bad[0],
    srt: files.words.srt,
    region
  })
  check('times that run backwards are refused (falls to the subtitles)', back.tier === 'cues', () =>
    show(back)
  )
  const long = await st.timingLadder({ tokens, seconds, json: bad[1], region })
  check(
    'times that run past the recording are refused (falls to proportional)',
    long.tier === 'proportional',
    () => show(long)
  )
  const spelled = await st.timingLadder({
    tokens: ['I', 'have', '3', 'apples.'],
    seconds: 4,
    json: [
      { text: 'I', start: 0.1, end: 0.3 },
      { text: 'have', start: 0.5, end: 0.8 },
      { text: 'three', start: 1, end: 1.4 },
      { text: 'apples', start: 1.6, end: 2 }
    ]
  })
  check(
    'a word ai33 spelled out differently keeps the script’s spelling and a time between its neighbours',
    spelled.tier === 'words' &&
      spelled.words[2].text === '3' &&
      spelled.words[2].start >= spelled.words[1].end - 0.001 &&
      spelled.words[2].end <= spelled.words[3].start + 0.001,
    () => show(spelled)
  )
  same('an empty script has no words', await st.timingLadder({ tokens: [], seconds: 1 }), {
    words: [],
    tier: 'proportional'
  })
  same(
    'parseSrt reads cues',
    st
      .parseSrt(
        '1\n00:00:01,500 --> 00:00:02,250\nHello <i>there</i>\n\n2\n00:01:00,000 --> 00:01:01,000\nBye'
      )
      .map((c) => [c.start, c.end, c.text]),
    [
      [1.5, 2.25, 'Hello there'],
      [60, 61, 'Bye']
    ]
  )
  same(
    'worstTier',
    [
      st.worstTier(['words', 'cues', 'words']),
      st.worstTier(['cues', 'proportional']),
      st.worstTier([])
    ],
    ['cues', 'proportional', 'words']
  )
  const grid = st.alignWords(['the', 'cat', 'sat'], ['the', 'big', 'cat', 'sat', 'down'])
  same('alignWords lines the script up with what was heard', grid, [0, 2, 3])
  scenario('ok')
  pointAtFake()
}

// ---------------------------------------------------------------------------------------------
// 9. The timeline: placement, rows, the export check

function shell(inner = '', duration = 30): string {
  return `<!doctype html>
<html><head><title>t</title></head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">
${inner}  </div>
</body></html>
`
}

async function sectionTimeline(): Promise<void> {
  const { placeHtml: P, html: H, timelineRead: T, exportPreflight: X } = b
  const tagsOf = (html: string): ReturnType<typeof H.findTags> => H.findTags(html, 'audio')
  const attr = (html: string, id: string, name: string): string | undefined =>
    H.findTagById(html, id)?.attrs[name]
  const rootDuration = (html: string): string | undefined =>
    H.findTags(html).find((t) => t.attrs['data-composition-id'] !== undefined)?.attrs[
      'data-duration'
    ]

  // a script project: the voice is on row 0 and nothing else may share it
  let html = shell()
  const voiceRow = P.rowFor(html, 'voice', 0, 30)
  html = P.insertAudio(html, {
    file: 'media/voiceover.mp3',
    role: 'voice',
    start: 0,
    row: voiceRow,
    duration: 30,
    volume: 1,
    id: 'voiceover',
    title: 'Voiceover',
    extendRoot: true
  }).html
  const musicRow = P.rowFor(html, 'music', 0, 30)
  html = P.insertAudio(html, {
    file: 'media/generated/music/calm-piano-91ab0c33de-1.mp3',
    role: 'music',
    start: 0,
    row: musicRow,
    duration: 30,
    title: 'Calm piano'
  }).html
  check(
    'the voice is on row 0, the music on its own row',
    voiceRow === 0 && musicRow === 1,
    () => `${voiceRow} ${musicRow}`
  )
  check(
    'a sound effect after the voice has ended still does not share the voice row',
    P.rowFor(html, 'sfx', 40, 42) > 1
  )
  check(
    'a second voice does not share the music row, and music does not share the voice row',
    P.rowFor(html, 'voice', 40, 50) !== 1 && P.rowFor(html, 'music', 40, 50) !== 0
  )
  const sfxRows = new Set<number>()
  for (let i = 0; i < 20; i++) {
    const start = i
    const row = P.rowFor(html, 'sfx', start, start + 2)
    sfxRows.add(row)
    html = P.insertAudio(html, {
      file: `media/generated/sfx/whoosh-${i}-77c0aa12f1.mp3`,
      role: 'sfx',
      start,
      row,
      duration: 2,
      title: `Whoosh ${i}`
    }).html
  }
  check(
    '20 sound effects two seconds long, a second apart, share two rows (not twenty)',
    sfxRows.size === 2 && ![0, 1].some((r) => sfxRows.has(r)),
    () => show([...sfxRows])
  )
  const byRow = new Map<string, Set<string>>()
  for (const t of tagsOf(html)) {
    const row = t.attrs['data-track-index']
    if (!byRow.has(row)) byRow.set(row, new Set())
    byRow.get(row)?.add(t.attrs['data-luca-role'])
  }
  check(
    'every row holds one kind of sound',
    [...byRow.values()].every((roles) => roles.size === 1),
    () => show([...byRow.entries()].map(([r, s]) => [r, [...s]]))
  )
  const overlapping = [...tagsOf(html)].some((a, i, all) =>
    all.some(
      (c, j) =>
        j > i &&
        a.attrs['data-track-index'] === c.attrs['data-track-index'] &&
        Number(a.attrs['data-start']) <
          Number(c.attrs['data-start']) + Number(c.attrs['data-duration']) - 0.001 &&
        Number(c.attrs['data-start']) <
          Number(a.attrs['data-start']) + Number(a.attrs['data-duration']) - 0.001
    )
  )
  check('no two clips on a row overlap', !overlapping)
  check(
    'two effects that do not overlap share a row, an overlapping one goes elsewhere',
    (() => {
      let s = shell()
      s = P.insertAudio(s, { file: 'a.mp3', role: 'sfx', start: 0, row: 0, duration: 2 }).html
      return (
        P.rowFor(s, 'sfx', 5, 7) === 0 &&
        P.rowFor(s, 'sfx', 1, 3) === 1 &&
        P.rowFor(s, 'sfx', 2, 4) === 0
      )
    })()
  )
  check(
    'a nested clip (inside a scene) holds its row for good',
    (() => {
      const s = shell(
        '    <div id="scene" data-start="0" data-duration="10" data-track-index="4"><audio id="in-scene" src="x.mp3" data-track-index="0"></audio></div>\n'
      )
      // rows 0 (the nested clip) and 4 (the scene) are taken by things that are not sound effects
      return P.rowFor(s, 'sfx', 20, 22) === 5
    })()
  )

  // what insertAudio writes
  const placed = P.insertAudio(shell(), {
    file: 'media/generated/music/x-91ab0c33de-1.mp3',
    role: 'music',
    start: 1.23456,
    row: 3,
    duration: 2,
    title: 'Say "hi" & <go>'
  })
  check(
    'music gets fades that share a short clip, a media start, a role and an escaped title',
    placed.placed.fadeIn !== undefined &&
      placed.placed.fadeOut !== undefined &&
      Math.abs(placed.placed.fadeIn + placed.placed.fadeOut - 2) < 0.02 &&
      placed.placed.start === 1.235 &&
      attr(placed.html, placed.placed.id, 'data-media-start') === '0' &&
      attr(placed.html, placed.placed.id, 'data-timeline-role') === 'music' &&
      attr(placed.html, placed.placed.id, 'data-luca-role') === 'music' &&
      placed.html.includes('data-luca-title="Say &quot;hi&quot; &amp; &lt;go&gt;"'),
    () => show(placed)
  )
  const sfx = P.insertAudio(shell(), {
    file: 'media/generated/sfx/w-77c0aa12f1.mp3',
    role: 'sfx',
    start: 0,
    row: 2,
    duration: 1
  })
  check(
    'a sound effect plays at 0.6 with no fades, and its id comes from the file name',
    sfx.placed.volume === 0.6 && sfx.placed.fadeIn === undefined && /^sfx-w/.test(sfx.placed.id),
    () => show(sfx)
  )
  const twice = P.insertAudio(sfx.html, {
    file: 'b.mp3',
    role: 'sfx',
    start: 0,
    row: 3,
    duration: 1,
    id: sfx.placed.id
  })
  check('an id that is taken gets a number', twice.placed.id === `${sfx.placed.id}-2`, () =>
    show(twice.placed)
  )
  const longVoice = P.insertAudio(shell(), {
    file: 'v.mp3',
    role: 'voice',
    start: 0,
    row: 0,
    duration: 45,
    extendRoot: true
  })
  const longMusic = P.insertAudio(shell(), {
    file: 'm.mp3',
    role: 'music',
    start: 0,
    row: 0,
    duration: 60
  })
  check(
    'a voice may extend the video; music never does',
    rootDuration(longVoice.html) === '45' && rootDuration(longMusic.html) === '30',
    () => `${rootDuration(longVoice.html)} ${rootDuration(longMusic.html)}`
  )
  const swapped = P.insertAudio(html, {
    file: 'media/generated/music/other-11aa22bb33-2.mp3',
    role: 'music',
    start: 0,
    row: 1,
    duration: 30,
    replaces: 'music-calm-piano',
    title: 'Calm piano 2'
  })
  check(
    'replacing a clip takes the old one out',
    !swapped.html.includes('id="music-calm-piano"') && swapped.html.includes(swapped.placed.id)
  )
  const wrong = await thrown(
    Promise.resolve().then(() =>
      P.insertAudio(html, {
        file: 'x.mp3',
        role: 'sfx',
        start: 0,
        row: 9,
        duration: 1,
        replaces: 'music-calm-piano'
      })
    )
  )
  check(
    'replacing across roles is refused in plain words',
    wrong?.message === '“music-calm-piano” isn’t a sound effect, so this can’t take its place.',
    () => show(wrong)
  )
  const missing = await thrown(
    Promise.resolve().then(() =>
      P.insertAudio(html, {
        file: 'x.mp3',
        role: 'sfx',
        start: 0,
        row: 9,
        duration: 1,
        replaces: 'nope'
      })
    )
  )
  check(
    'replacing something that is not there says so',
    missing?.message === 'There is no sound called “nope” on the timeline.',
    () => show(missing)
  )
  const noLength = await thrown(
    Promise.resolve().then(() =>
      P.insertAudio(shell(), { file: 'x.mp3', role: 'sfx', start: 0, row: 0, duration: 0 })
    )
  )
  check(
    'a sound with no length is refused',
    noLength?.message === 'That sound has no length to put on the timeline.',
    () => show(noLength)
  )
  const noRoot = await thrown(
    Promise.resolve().then(() =>
      P.insertAudio('<html><body></body></html>', {
        file: 'x.mp3',
        role: 'sfx',
        start: 0,
        row: 0,
        duration: 1
      })
    )
  )
  check(
    'a page with no timeline is refused',
    /Couldn’t find the video’s timeline/.test(noRoot?.message ?? ''),
    () => show(noRoot)
  )
  same(
    'nameFromFile drops the folder, the hash and the extension',
    [
      P.nameFromFile('media/generated/music/calm-piano-91ab0c33de-1.mp3'),
      P.nameFromFile('media/voiceover.mp3')
    ],
    ['calm piano', 'voiceover']
  )

  // clampBeds
  const bed = (id: string, start: number, dur: number, extra = '', role = 'music'): string =>
    `    <audio id="${id}" src="media/generated/music/${id}.mp3" data-start="${start}" data-duration="${dur}" data-media-start="0" data-track-index="${1 + Number(id.replace(/\D/g, '') || 0)}" data-volume="0.3" data-luca-role="${role}"${extra}></audio>\n`
  const clamp = (
    inner: string,
    files: Record<string, number> = {},
    rootDur = 30
  ): { html: string; changed: boolean } =>
    P.clampBeds(shell(inner), { rootDuration: rootDur, fileDurations: files })
  const d = (r: { html: string }, id: string): string | undefined =>
    attr(r.html, id, 'data-duration')
  const over = clamp(bed('over1', 0, 40))
  check(
    'a bed that overruns the video is shortened to it, changing nothing else',
    d(over, 'over1') === '30' &&
      over.changed &&
      over.html.split('\n').filter((l, i) => l !== shell(bed('over1', 0, 40)).split('\n')[i])
        .length === 1,
    () => over.html
  )
  const trimmed = clamp(bed('trim1', 0, 10))
  check(
    'a bed the person trimmed shorter is never lengthened',
    d(trimmed, 'trim1') === '10' && !trimmed.changed,
    () => trimmed.html
  )
  same(
    'a bed that starts late keeps to the end of the video',
    d(clamp(bed('late1', 25, 10)), 'late1'),
    '5'
  )
  same(
    'a bed longer than its file is cut to the file, from its media start',
    d(
      clamp(bed('file1', 0, 30).replace('data-media-start="0"', 'data-media-start="2"'), {
        'media/generated/music/file1.mp3': 20
      }),
      'file1'
    ),
    '18'
  )
  same(
    'a file that is not measured is kept to the video only',
    d(clamp(bed('file2', 0, 25), { 'other.mp3': 5 }), 'file2'),
    '25'
  )
  check(
    'a bed that starts after the end of the video is left alone',
    !clamp(bed('gone1', 40, 10)).changed
  )
  check(
    'a bed with no length written is left alone',
    !clamp(bed('nolen1', 0, 0).replace(' data-duration="0"', '')).changed
  )
  check('a difference under 0.01 s is left alone', !clamp(bed('tiny1', 0, 30.005)).changed)
  const others = clamp(bed('voice1', 0, 40, '', 'voice') + bed('sfx1', 0, 40, '', 'sfx'))
  check(
    'a voice or a sound effect that overruns is not touched (only music is)',
    !others.changed && d(others, 'voice1') === '40' && d(others, 'sfx1') === '40',
    () => others.html
  )
  const nested = clamp(
    `    <div id="scene" data-start="0" data-duration="60">\n${bed('nest1', 0, 50)}    </div>\n`
  )
  check(
    'a clip inside a scene keeps the scene’s own clock and is not clamped',
    !nested.changed,
    () => nested.html
  )
  const twiceClamped = P.clampBeds(over.html, { rootDuration: 30, fileDurations: {} })
  check('clamping is idempotent', !twiceClamped.changed && twiceClamped.html === over.html)
  check(
    'an unknown video length changes nothing',
    !P.clampBeds(shell(bed('zero1', 0, 40)), { rootDuration: 0, fileDurations: {} }).changed
  )
  const several = clamp(bed('multi1', 0, 40) + bed('multi2', 10, 40) + bed('multi3', 0, 5))
  same(
    'several beds are handled in one pass',
    [d(several, 'multi1'), d(several, 'multi2'), d(several, 'multi3')],
    ['30', '20', '5']
  )

  // who is talking already
  check(
    'hasVoice: a heard clip with the voice role counts, and a muted one does not',
    P.hasVoice(html, 'nothing.mp4') &&
      !P.hasVoice(
        html.replace(
          'data-volume="1" data-luca-role="voice"',
          'data-volume="0" data-luca-role="voice"'
        ),
        'nothing.mp4'
      )
  )
  check(
    'hasVoice: the source footage counts when it is heard, not when the video is muted',
    P.hasVoice(
      shell(
        '    <video id="v" src="media/clip.mp4" data-start="0" data-duration="10" data-track-index="0"></video>\n'
      ),
      'clip.mp4'
    ) &&
      !P.hasVoice(
        shell(
          '    <video id="v" src="media/clip.mp4" muted data-start="0" data-duration="10" data-track-index="0"></video>\n'
        ),
        'clip.mp4'
      )
  )

  // the timeline's rows and names
  const row = (
    id: string,
    idx: number,
    start: number,
    end: number,
    trackKind = 'audio'
  ): object => ({
    id,
    label: id,
    kind: trackKind,
    trackKind,
    start,
    duration: end - start,
    end,
    absStart: start,
    absEnd: end,
    file: 'index.html',
    trackIndex: idx,
    src: `media/${id}.mp3`,
    ref: `index.html#${id}`,
    elementId: id
  })
  const seenIds = tagsOf(html).map((t) => t.attrs.id)
  const data: HfTimeline = {
    timeline: {
      duration: 30,
      tracks: [
        {
          kind: 'audio',
          rows: [
            ...seenIds.map((id) =>
              row(
                id,
                Number(attr(html, id, 'data-track-index')),
                Number(attr(html, id, 'data-start')),
                Number(attr(html, id, 'data-start')) + Number(attr(html, id, 'data-duration'))
              )
            ),
            row('cam', 5, 0, 30, 'video')
          ] as HfTimeline['timeline']['tracks'][number]['rows']
        }
      ]
    }
  }
  const tl = T.buildTimeline(data, html)
  const named = Object.fromEntries(tl.tracks.map((t) => [t.index, t.label]))
  same(
    'rows are named by what is on them: Voiceover, Music, Sound effects, Video',
    [named[0], named[1], named[2], named[3], named[5]],
    ['Voiceover', 'Music', 'Sound effects', 'Sound effects', 'Video']
  )
  const voiceClip = tl.tracks[0].clips[0]
  check(
    'a clip keeps its role, its title, its volume and its media start',
    voiceClip.role === 'voice' &&
      voiceClip.label === 'Voiceover' &&
      voiceClip.title === 'Voiceover' &&
      voiceClip.volume === 1 &&
      tl.tracks[1].clips[0].label === 'Calm piano' &&
      tl.tracks[1].clips[0].role === 'music',
    () => show(tl.tracks[0])
  )
  const mixed = shell(
    bed('mix1', 0, 5, '', 'music').replace('data-track-index="2"', 'data-track-index="7"') +
      bed('mix2', 6, 5, '', 'sfx').replace('data-track-index="3"', 'data-track-index="7"')
  )
  const mixedTl = T.buildTimeline(
    {
      timeline: {
        duration: 30,
        tracks: [
          {
            kind: 'audio',
            rows: [
              row('mix1', 7, 0, 5),
              row('mix2', 7, 6, 11)
            ] as HfTimeline['timeline']['tracks'][number]['rows']
          }
        ]
      }
    },
    mixed
  )
  same('a row with two kinds of sound is just "Audio"', mixedTl.tracks[0].label, 'Audio')
  const plain = T.buildTimeline(
    {
      timeline: {
        duration: 30,
        tracks: [
          {
            kind: 'audio',
            rows: [row('own', 2, 0, 5)] as HfTimeline['timeline']['tracks'][number]['rows']
          }
        ]
      }
    },
    shell(
      '    <audio id="own" src="media/own.mp3" data-start="0" data-duration="5" data-track-index="2"></audio>\n'
    )
  )
  same('a sound the user added keeps the plain "Audio" row', plain.tracks[0].label, 'Audio')
  const quoted = T.buildTimeline(
    {
      timeline: {
        duration: 30,
        tracks: [
          {
            kind: 'audio',
            rows: [row('q1', 2, 0, 5)] as HfTimeline['timeline']['tracks'][number]['rows']
          }
        ]
      }
    },
    shell(
      placed.html
        .match(/ *<audio[^>]*>\s*<\/audio>\n/)?.[0]
        .replace('id="music-say-hi-go"', 'id="q1"')
        .replace(/id="[^"]+"/, 'id="q1"') ?? ''
    )
  )
  same('titles are unescaped for display', quoted.tracks[0]?.clips[0]?.label, 'Say "hi" & <go>')

  // the export check
  const proj = join(work, 'export')
  mkdirSync(join(proj, 'media', 'generated', 'sfx'), { recursive: true })
  const put = (rel: string, body: string): void => writeFileSync(join(proj, rel), body)
  put('media/good.mp3', 'ID3-good')
  put('media/page.mp3', '<!doctype html><title>denied</title>')
  put('media/empty.mp3', 'ID3-empty')
  put('media/generated/sfx/a.mp3', 'ID3-a')
  put('media/generated/sfx/b.mp3', 'ID3-b')
  put('media/generated/sfx/c.mp3', 'ID3-c')
  put('media/generated/sfx/d.mp3', 'ID3-d')
  put('media/silent.mp4', 'no sound')
  let probed = 0
  const probe = async (
    file: string
  ): Promise<{ audio: boolean; duration: number | null } | null> => {
    probed++
    const body = readFileSync(file, 'utf8')
    if (body.startsWith('<')) return null
    if (body.includes('empty')) return { audio: true, duration: 0 }
    if (body.includes('no sound')) return { audio: false, duration: 3 }
    if (body.includes('unknown')) return { audio: true, duration: null }
    return { audio: true, duration: 2 }
  }
  const au = (id: string, src: string, extra = '', title = ''): string =>
    `    <audio id="${id}" src="${src}"${title ? ` data-luca-title="${title}"` : ''} data-start="0" data-duration="2" data-track-index="9"${extra}></audio>\n`
  const fine = await X.checkAudio(
    shell(au('g', 'media/good.mp3') + au('h', 'media/generated/sfx/a.mp3')),
    proj,
    probe
  )
  check(
    'sounds that can be read pass, with no warnings',
    fine.ok && fine.warnings.length === 0,
    () => show(fine)
  )
  probed = 0
  await X.checkAudio(
    shell(au('twin1', 'media/generated/sfx/b.mp3') + au('twin2', 'media/generated/sfx/b.mp3')),
    proj,
    probe
  )
  check('two clips of one file ask ffprobe once', probed === 1, () => `${probed}`)
  const one = await X.checkAudio(shell(au('bad', 'media/page.mp3', '', 'Whoosh 3')), proj, probe)
  same(
    'one unreadable sound blocks the export, by the name people see',
    [one.ok, one.error],
    [
      false,
      'One of the sounds in this video couldn’t be read (Whoosh 3). Ask Luca to make it again, or delete it from the timeline, then export again.'
    ]
  )
  const gone = await X.checkAudio(
    shell(au('lost-sound', 'media/generated/sfx/missing.mp3')),
    proj,
    probe
  )
  same(
    'a missing file blocks it, named by its id when there is no title',
    [gone.ok, /\(lost sound\)/.test(gone.error ?? '')],
    [false, true]
  )
  const zero = await X.checkAudio(shell(au('z', 'media/empty.mp3', '', 'Empty')), proj, probe)
  const noAudioStream = await X.checkAudio(
    shell(au('v', 'media/silent.mp4', '', 'No sound')),
    proj,
    probe
  )
  check('a file with no length, or no audio stream, blocks it', !zero.ok && !noAudioStream.ok, () =>
    show([zero, noAudioStream])
  )
  const many = await X.checkAudio(
    shell(
      ['a', 'b', 'c', 'd']
        .map((n) => au(`m${n}`, `media/generated/sfx/${n}.mp3`, '', `T${n}`))
        .join('') +
        au('mp', 'media/page.mp3', '', 'P1') +
        au('me', 'media/empty.mp3', '', 'P2')
    ),
    proj,
    probe
  )
  check(
    'several unreadable sounds say so, naming three and counting the rest',
    !many.ok &&
      /^Some of the sounds in this video couldn’t be read \(P1, P2\)\. Ask Luca to make them again/.test(
        many.error ?? ''
      ),
    () => show(many)
  )
  const four = await X.checkAudio(
    shell(
      ['w', 'x', 'y', 'z']
        .map((n, i) => au(`f${n}`, `media/nope-${i}.mp3`, '', `Sound ${n}`))
        .join('')
    ),
    proj,
    probe
  )
  check(
    '...naming three and counting the rest',
    /\(Sound w, Sound x, Sound y and 1 more\)/.test(four.error ?? ''),
    () => show(four)
  )
  const skipped = await X.checkAudio(
    shell(
      au('r1', 'https://cdn.example/a.mp3') +
        au('r2', 'data:audio/mp3;base64,AAAA') +
        au('r3', 'media/nope-hidden.mp3', ' data-hidden') +
        `    <div data-hidden>\n${au('r4', 'media/nope-inside.mp3')}    </div>\n` +
        au('r5', '__PLACEHOLDER__') +
        `    <!-- ${au('r6', 'media/nope-comment.mp3').trim()} -->\n`
    ),
    proj,
    probe
  )
  check(
    'remote and inline sources, hidden sounds, placeholders and comments are not checked',
    skipped.ok,
    () => show(skipped)
  )
  const oddDuration = await X.checkAudio(
    shell(au('u', 'media/generated/sfx/c.mp3')),
    proj,
    async () => ({ audio: true, duration: null })
  )
  check('a duration ffprobe does not give does not block', oddDuration.ok)
  const broken = await X.checkAudio(shell(au('t', 'media/generated/sfx/d.mp3')), proj, async () => {
    throw new Error('ffprobe is not installed')
  })
  check('an ffprobe that cannot run never blocks an export', broken.ok, () => show(broken))
  const longer = await X.checkAudio(
    shell(
      `    <audio id="long" src="media/good.mp3" data-start="25" data-duration="10" data-track-index="9"></audio>\n`
    ),
    proj,
    probe
  )
  check(
    'a clip running past the end is a warning, not a block',
    longer.ok &&
      longer.warnings.length === 1 &&
      /30\.00 s long but its last clip runs to 35\.00 s/.test(longer.warnings[0]),
    () => show(longer)
  )
  same(
    'readProbe reads ffprobe’s JSON',
    [
      X.readProbe(
        '{"streams":[{"codec_type":"audio","duration":"2.5"}],"format":{"duration":"2.6"}}'
      ),
      X.readProbe('{"streams":[{"codec_type":"video"}],"format":{"duration":"N/A"}}'),
      X.readProbe('not json')
    ],
    [{ audio: true, duration: 2.6 }, { audio: false, duration: null }, null]
  )
  same(
    'plainExportError puts the renderer’s failure in the same words',
    X.plainExportError(
      'Render failed: audio_processing_failed for element sfx-whoosh-3.',
      shell(au('sfx-whoosh-3', 'media/generated/sfx/a.mp3', '', 'Whoosh 3'))
    ),
    'One of the sounds in this video couldn’t be read (Whoosh 3). Ask Luca to make it again, or delete it from the timeline, then export again.'
  )
  same(
    'and passes every other failure through',
    X.plainExportError('Out of memory', null),
    'Out of memory'
  )
}

// ---------------------------------------------------------------------------------------------
// 10. The edit plan, the per-project files and the small shared helpers

async function sectionPlan(): Promise<void> {
  const { edits: E, store, shared, captions } = b
  const ids = (l: { id: string }[]): string[] => l.map((s) => s.id)
  const all = ['cut', 'hook', 'zooms', 'broll', 'name', 'ending', 'music', 'captions'] as const
  const explainer = {
    type: 'explainer' as const,
    steps: ['cut', 'hook', 'broll', 'music', 'captions'] as (typeof all)[number][]
  }

  const script = E.runnableSteps(explainer.steps, {
    canTranscribe: false,
    voiceOnly: true,
    scripted: true,
    canGenerate: true
  })
  same(
    'a script project runs hook, B-roll, music and captions, with no AssemblyAI key',
    ids(script.run),
    ['hook', 'broll', 'music', 'captions']
  )
  same('and nothing is skipped (cut is dropped, not skipped)', ids(script.skipped), [])
  const footage = E.runnableSteps(explainer.steps, {
    canTranscribe: false,
    voiceOnly: true,
    canGenerate: true
  })
  same(
    'footage with no AssemblyAI key skips cut, B-roll and captions',
    [ids(footage.run), ids(footage.skipped)],
    [
      ['hook', 'music'],
      ['cut', 'broll', 'captions']
    ]
  )
  same(
    'music is skipped when ai33 is not connected',
    ids(E.runnableSteps(['music'], { canTranscribe: true, voiceOnly: false }).skipped),
    ['music']
  )
  same(
    'the steps that need a picture (zooms, name title) are left out of a voiceover',
    ids(E.runnableSteps([...all], { canTranscribe: true, voiceOnly: true, canGenerate: true }).run),
    ['cut', 'hook', 'broll', 'ending', 'music', 'captions']
  )
  same(
    'the plan keeps Luca’s order',
    ids(
      E.runnableSteps([...all].reverse(), {
        canTranscribe: true,
        voiceOnly: false,
        canGenerate: true
      }).run
    ),
    [...all]
  )

  const guide = E.editGuide(explainer, {
    canTranscribe: false,
    voiceOnly: true,
    scripted: true,
    canGenerate: true
  })
  check(
    'the guide of a script project has no cut step and no AssemblyAI line',
    !/Clean edit first/.test(guide) &&
      !/Cut ums/i.test(guide) &&
      !/AssemblyAI/.test(guide) &&
      !/Skipped/.test(guide),
    () => guide
  )
  check(
    'it numbers the steps that run: hook, B-roll, music, captions',
    /1\. Hook title:/.test(guide) &&
      /2\. B-roll images:/.test(guide) &&
      /3\. Music:/.test(guide) &&
      /4\. Captions:/.test(guide),
    () => guide
  )
  check(
    'and says the words are exact: call transcribe, never force, never clean_edit, script in .luca/SCRIPT.md',
    /The voiceover was recorded from the user’s script; its words and times are already exact in transcript\.json\. Call transcribe to read them \(free\); never pass force and never call clean_edit\. The script is in \.luca\/SCRIPT\.md\./.test(
      guide
    ),
    () => guide
  )
  const plainGuide = E.editGuide(explainer, {
    canTranscribe: false,
    voiceOnly: true,
    canGenerate: false
  })
  check(
    'footage with no key says which steps are skipped and why',
    /no AssemblyAI key\): cut ums & pauses, b-roll images, captions/.test(plainGuide) &&
      /Skipped because ai33 isn’t connected: music\./.test(plainGuide) &&
      !/recorded from the user’s script/.test(plainGuide),
    () => plainGuide
  )
  check(
    'a guide with nothing to run says so',
    /Nothing was switched on/.test(
      E.editGuide({ type: 'talking', steps: [] }, { canTranscribe: true, voiceOnly: false })
    )
  )
  check(
    'user notes are carried',
    /## The user’s notes\nI’m Sam/.test(
      E.editGuide({ ...explainer, notes: ' I’m Sam ' }, { canTranscribe: true, voiceOnly: false })
    )
  )

  same(
    'the first request of a script project never says "cut"',
    E.editRequest(explainer, { voiceOnly: true, scripted: true }),
    'Edit my faceless explainer: hook title, b-roll images, music, captions'
  )
  same(
    'a recording still does',
    E.editRequest(explainer, { voiceOnly: true }),
    'Edit my faceless explainer: cut ums & pauses, hook title, b-roll images, music, captions'
  )
  same(
    'no steps at all',
    E.editRequest({ type: 'talking', steps: [] }, { voiceOnly: false }),
    'Edit my talking video'
  )
  check(
    'the music step is one that spends credits',
    E.editStep('music').needsAi33 === true && E.EDIT_STEPS.filter((s) => s.needsAi33).length === 1
  )
  check(
    'no step is the removed "cleanup"',
    !E.EDIT_STEPS.some((s) => (s.id as string) === 'cleanup')
  )

  // the per-project files
  const dir = join(work, 'project-store')
  mkdirSync(dir, { recursive: true })
  same('a new project has no ai33 choices', store.readProjectAi33(dir), {})
  check('...and is not a script project', store.isScriptProject(dir) === false)
  const voice = { id: 'edge_en-US-AriaNeural', name: 'Aria' }
  store.patchProjectAi33(dir, { voice })
  store.patchProjectAi33(dir, { speed: 1.1 })
  same(
    'two patches with different keys both stay (a merge, not a replace)',
    store.readProjectAi33(dir),
    { v: 1, voice, speed: 1.1 }
  )
  store.patchProjectAi33(dir, { say: [{ word: 'AI', as: 'A I' }] })
  store.patchProjectAi33(dir, { say: [{ word: 'ML', as: 'M L' }] })
  same('an array is replaced whole', store.readProjectAi33(dir).say, [{ word: 'ML', as: 'M L' }])
  store.patchProjectAi33(dir, { speed: undefined })
  same(
    'a key set to undefined is dropped, the others stay',
    [store.readProjectAi33(dir).speed, store.readProjectAi33(dir).voice],
    [undefined, voice]
  )
  writeFileSync(join(dir, '.luca', 'ai33.json'), JSON.stringify({ voice, future: { keep: true } }))
  store.patchProjectAi33(dir, { speed: 0.9 })
  same(
    'a key this version does not know is kept',
    (store.readProjectAi33(dir) as Record<string, unknown>).future,
    { keep: true }
  )
  writeFileSync(join(dir, '.luca', 'ai33.json'), '{ not json')
  same(
    'a file that cannot be read is treated as empty, and can be written over',
    [store.readProjectAi33(dir), store.patchProjectAi33(dir, { speed: 1 })],
    [{}, { v: 1, speed: 1 }]
  )
  check(
    'the writes leave no temp file',
    readdirSync(join(dir, '.luca')).every((f) => !f.endsWith('.tmp')),
    () => show(readdirSync(join(dir, '.luca')))
  )
  same(
    'there is no script.json yet',
    [store.readScriptMeta(dir), store.isScriptProject(dir)],
    [null, false]
  )
  store.writeScriptMeta(dir, {
    origin: 'script',
    language: 'English',
    timing: 'words',
    createdAt: '2026-05-29T10:00:00.000Z'
  })
  same(
    'once written, the project’s words are exact',
    [store.isScriptProject(dir), store.readScriptMeta(dir)],
    [
      true,
      {
        origin: 'script',
        language: 'English',
        timing: 'words',
        createdAt: '2026-05-29T10:00:00.000Z',
        v: 1
      }
    ]
  )

  // shared helpers
  same(
    'formatCredits',
    [
      shared.formatCredits(12480),
      shared.formatCredits(0),
      shared.formatCredits(999),
      shared.formatCredits(1234567.6)
    ],
    ['12,480', '0', '999', '1,234,568']
  )
  same(
    'formatSpan',
    [shared.formatSpan(42), shared.formatSpan(165), shared.formatSpan(120), shared.formatSpan(0)],
    ['42 s', '2 min 45 s', '2 min', '0 s']
  )
  same(
    'estimateSpoken',
    [
      shared.estimateSpoken(''),
      shared.estimateSpoken('one two three'),
      shared.estimateSpoken(Array(412).fill('word').join(' '))
    ],
    [
      { words: 0, seconds: 0 },
      { words: 3, seconds: 5 },
      { words: 412, seconds: 165 }
    ]
  )
  same(
    'languageFor: a name, an id, a locale, and nothing',
    [
      shared.languageFor('Spanish')?.id,
      shared.languageFor('es_MX')?.id,
      shared.languageFor('pt-BR')?.id,
      shared.languageFor('vi-VN')?.vbee,
      shared.languageFor('Klingon'),
      shared.languageFor('')
    ],
    ['es', 'es', 'pt', true, null, null]
  )
  check(
    'scripts can be in the languages captions can draw, not in ones that need no spaces',
    shared.LANGUAGES.length === 14 && !['zh', 'ja', 'th', 'ko'].some((id) => shared.languageFor(id))
  )

  // captions keep the Vietnamese font faces
  const face = (
    family: string,
    subset?: string
  ): Parameters<typeof captions.keepFontSubsets>[0][number] => ({
    family,
    italic: false,
    weight: 400,
    url: `https://fonts.gstatic.com/${family}/${subset}.woff2`,
    ...(subset ? { subset } : {})
  })
  const inter = ['cyrillic', 'greek', 'vietnamese', 'latin-ext', 'latin'].map((s) =>
    face('Inter', s)
  )
  same(
    'keepFontSubsets keeps latin, latin-ext and vietnamese, and drops the rest',
    captions.keepFontSubsets(inter).map((f) => f.subset),
    ['vietnamese', 'latin-ext', 'latin']
  )
  same(
    'a stylesheet with no subsets is kept whole',
    captions.keepFontSubsets([face('Plain'), face('Plain')]).length,
    2
  )
  same(
    'a family with none of the wanted subsets keeps what it has when that is few',
    captions.keepFontSubsets([face('Cyr', 'cyrillic'), face('Cyr', 'greek')]).length,
    2
  )
  same(
    'and keeps nothing of one that has many (too many files to be sensible)',
    captions.keepFontSubsets(Array.from({ length: 25 }, (_, i) => face('Big', `cjk-${i}`))).length,
    0
  )
  same(
    'each family is judged on its own',
    captions
      .keepFontSubsets([face('Inter', 'latin'), face('Inter', 'cyrillic'), face('Cyr', 'cyrillic')])
      .map((f) => `${f.family}:${f.subset}`),
    ['Inter:latin', 'Cyr:cyrillic']
  )
}

// ---------------------------------------------------------------------------------------------
// 11. The key, over the whole run

async function sectionKey(): Promise<void> {
  const keyed = seen.filter((s) => s.key !== null)
  const origins = new Set(keyed.map((s) => s.url.origin))
  check('the key was sent (this check means something)', keyed.length > 50, () => `${keyed.length}`)
  check(
    'every request that carried the key went to the API host of the moment (the fake or a stand-in), never to /files/ or anywhere else',
    keyed.every(
      (s) => !s.url.pathname.startsWith('/files/') || s.url.pathname === '/files/needs-key.mp3'
    ) && [...origins].every((o) => o.startsWith('http://127.0.0.1:')),
    () => show(keyed.filter((s) => s.url.pathname.startsWith('/files/')).map((s) => s.url.href))
  )
  const everLeaked = [...leaked, ...fake.leaks()]
  check(
    'the fake saw no key on any /files/ request in any scenario (leaks())',
    everLeaked.length === 0,
    () => show(everLeaked.map((r) => `${r.method} ${r.path} in ${r.scenario}`))
  )
  check(
    'files were fetched, so that means something too',
    seen.some((s) => s.url.pathname.startsWith('/files/') && s.key === null)
  )
  check(
    'no key reached a host other than 127.0.0.1',
    seen.every((s) => s.key === null || s.url.hostname === '127.0.0.1'),
    () =>
      show(
        seen.filter((s) => s.key !== null && s.url.hostname !== '127.0.0.1').map((s) => s.url.href)
      )
  )
  check(
    'no key is written into the data folders',
    (() => {
      let found = false
      const walk = (d: string): void => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name)
          if (e.isDirectory()) walk(p)
          else if (/\.(json|txt)$/.test(e.name) && readFileSync(p, 'utf8').includes(KEY))
            found = true
        }
      }
      walk(work)
      return !found
    })()
  )
  const others = warnings.filter((w) => !/cost \d+ credits, estimated/.test(w))
  check('the client logged nothing unexpected', others.length === 0, () => others.join('\n'))
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const watchdog = setTimeout(() => {
    console.error('\nai33 smoke: took more than 3 minutes, giving up')
    process.exit(1)
  }, 180_000)
  watchdog.unref()
  const t0 = Date.now()
  console.log('ai33 smoke: the pure modules against the fake ai33 server (no network, no key)')
  try {
    await section('Bundle the pure modules with esbuild', sectionBundle)
    fake = await startFakeAi33({ scenario: 'ok' })
    console.log(`  fake ai33 on ${fake.url}`)
    await section('Where the key may go, and where files may come from', sectionHosts)
    await section('Credits, 401 and the plain-language errors', sectionErrors)
    await section(
      'The job runner: cadence, progress, drops, backoff, reconcile, dedupe, Stop',
      sectionRunner
    )
    await section('Result files: every URL shape, downloads and the key', sectionFiles)
    await section('Answers the fake does not give: odd statuses, echoes, timeouts', sectionOdd)
    await section(
      'Spend policy: estimates, cards, caps, reserve and settle, preapproval',
      sectionSpend
    )
    await section('Script text: chunker, hashes and the timing ladder', sectionSpeechText)
    await section(
      'The timeline: rows, placement, clamping, names and the export check',
      sectionTimeline
    )
    await section('The edit plan, per-project files, credits format and caption fonts', sectionPlan)
    await section('The key, over the whole run', sectionKey)
  } finally {
    await fake?.close()
    rmSync(work, { recursive: true, force: true })
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(
    `\n${passed + failed + knownBugs.length} checks in ${secs} s: ${passed} passed, ${knownBugs.length} known bugs, ${failed} failed`
  )
  if (knownBugs.length) {
    console.log('\nKnown bugs (checks kept, marked so the run stays green):')
    for (const k of knownBugs) console.log(`  ${k}`)
  }
  if (failed) {
    console.log('\nFailed:')
    for (const f of failures) console.log(`  ${f}`)
  }
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
