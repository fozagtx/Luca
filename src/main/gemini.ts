import { FileState, GoogleGenAI, type Interactions } from '@google/genai'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Aspect } from '../shared/types'
import { childEnv, run, which } from './env'
import { needsPreparing, prepareVideo, probeVideo, type VideoProbe } from './footage'
import { safeJoin, SIZE } from './projects'
import { getSecret, setSecret } from './secrets'

/**
 * Gemini Omni Flash makes video (with sound) from words, pictures and clips, edits a clip
 * ("make it anime", "add snow") and continues one. Everything goes through the Interactions API
 * with the person's own Gemini API key; results land in the project's media/generated.
 */
export const VIDEO_MODEL = 'gemini-omni-1.1-flash'

export type VideoAspect = '16:9' | '9:16'
export type VideoResolution = '360p' | '720p' | '1080p' | '4k'

/** Omni's frames at 16:9 (swap for 9:16). */
const FRAME: Record<VideoResolution, [number, number]> = {
  '360p': [640, 360],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '4k': [3840, 2160]
}
export const RESOLUTIONS = Object.keys(FRAME) as VideoResolution[]

/** Length of one generation, and how much of a clip Omni reads to edit or continue it. */
export const MIN_SECONDS = 3
export const MAX_SECONDS = 10
/** Omni continues a clip 10 s at a time, up to this long in all. */
export const MAX_EXTENDED_SECONDS = 40

const API = 'https://generativelanguage.googleapis.com/v1beta'

// ------------------------------------------------------------------------------ key

/** The key: one saved in Luca, else GEMINI_API_KEY from the environment. */
export function geminiKey(): string | null {
  return getSecret('gemini') || process.env.GEMINI_API_KEY?.trim() || null
}

export function hasGeminiKey(): boolean {
  return !!geminiKey()
}

/**
 * Save a Gemini API key after checking it with Google (an empty key removes it). A key Google
 * refuses is not saved; one that can't be checked (offline) is kept.
 */
export async function saveGeminiKey(key: string): Promise<boolean> {
  const k = key.trim()
  if (k) {
    const res = await fetch(`${API}/models?pageSize=1`, {
      headers: { 'x-goog-api-key': k },
      signal: AbortSignal.timeout(10_000)
    }).catch(() => null)
    if (res && [400, 401, 403].includes(res.status)) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      const why = body?.error?.message?.trim()
      throw new Error(
        `Google didn’t accept this key${why ? `: ${why}` : '.'} Check that you copied all of it.`
      )
    }
  }
  setSecret('gemini', k)
  if (!k) cached = null
  return hasGeminiKey()
}

let cached: { key: string; ai: GoogleGenAI } | null = null

function client(): GoogleGenAI {
  const key = geminiKey()
  if (!key) throw new Error(NO_KEY)
  if (cached?.key !== key) {
    // files uploaded with another key belong to another project
    uploads.clear()
    cached = { key, ai: new GoogleGenAI({ apiKey: key }) }
  }
  return cached.ai
}

export const NO_KEY = 'Gemini isn’t connected. Click Gemini in the toolbar and paste your API key.'

// ------------------------------------------------------------------------------ errors

class Stopped extends Error {
  constructor() {
    super('Stopped before the video was ready.')
  }
}

const isAbort = (err: unknown): boolean =>
  err instanceof Stopped || (err instanceof Error && /Abort/.test(err.name))

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; statusCode?: unknown; code?: unknown } | null
  for (const v of [e?.status, e?.statusCode, e?.code]) if (typeof v === 'number') return v
  return undefined
}

/** Google's own words from an error, without the JSON around them. */
function detailOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // the Interactions client keeps Google's answer in `body`, the Files client in the message
  const body = (err as { body?: unknown } | null)?.body
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(
    `${typeof body === 'string' ? body : ''} ${raw}`
  )
  const text = m
    ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim()
    : raw
        .replace(/^\d{3}\s+/, '')
        .replace(/^API error occurred:.*$/s, '')
        .trim()
  return text.length > 400 ? `${text.slice(0, 399)}…` : text
}

/** An error as the person (and Luca) should read it. */
function plainError(err: unknown): Error {
  if (isAbort(err)) return new Stopped()
  const status = statusOf(err)
  const detail = detailOf(err)
  if (status === 401 || /API.?key.*(invalid|not valid)|API_KEY_INVALID/i.test(detail))
    return new Error(
      `Google didn’t accept the Gemini key (${detail}). Check it under Gemini in the toolbar.`
    )
  if (status === 403) return new Error(`Google refused this for the Gemini key: ${detail}`)
  if (status === 429)
    return new Error(
      `Gemini’s limit for this key was reached (${detail}). Wait a minute, or check the billing and quota of the key’s Google Cloud project.`
    )
  if (status !== undefined && status >= 500)
    return new Error(`Gemini is having trouble right now (${status}). Try again in a little while.`)
  if (/fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT|network|connection error/i.test(detail))
    return new Error('Couldn’t reach Gemini. Check your internet connection.')
  return new Error(detail ? `Gemini: ${detail}` : 'Gemini didn’t make the video.')
}

// ------------------------------------------------------------------------------ media in

type Part = Interactions.Content

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm'])

/** Uploaded files, reused while Google keeps them (48 hours). */
const uploads = new Map<string, { uri: string; mimeType: string; expires: number }>()

/** The form Google's own tools send a Files API URI in (no version, no query). */
function fileUri(uri: string): string {
  const id = /files\/([a-zA-Z0-9]+)/.exec(uri)?.[1]
  return id ? `https://generativelanguage.googleapis.com/files/${id}` : uri.split('?')[0]
}

async function waitActive(
  ai: GoogleGenAI,
  name: string,
  signal: AbortSignal | undefined,
  what: string
): Promise<{ uri?: string; mimeType?: string }> {
  const until = Date.now() + 10 * 60_000
  for (;;) {
    const f = await ai.files.get({ name })
    if (f.state === FileState.FAILED) throw new Error(`Gemini couldn’t read ${what}.`)
    if (f.state !== FileState.PROCESSING) return { uri: f.uri, mimeType: f.mimeType }
    if (Date.now() > until) throw new Error(`Gemini took too long to read ${what}.`)
    await delay(2_000, undefined, { signal })
  }
}

async function upload(
  ai: GoogleGenAI,
  file: string,
  mimeType: string,
  signal: AbortSignal | undefined
): Promise<{ uri: string; mimeType: string }> {
  const st = statSync(file)
  const key = `${file}|${st.size}|${st.mtimeMs}`
  const hit = uploads.get(key)
  if (hit && hit.expires > Date.now()) return hit
  const what = basename(file)
  const f = await ai.files.upload({
    file,
    config: { mimeType, displayName: what, abortSignal: signal }
  })
  const ready =
    f.state === FileState.PROCESSING && f.name
      ? await waitActive(ai, f.name, signal, what)
      : { uri: f.uri, mimeType: f.mimeType }
  if (f.state === FileState.FAILED || !ready.uri) throw new Error(`Gemini couldn’t read ${what}.`)
  const out = { uri: fileUri(ready.uri), mimeType: ready.mimeType ?? mimeType }
  uploads.set(key, { ...out, expires: Date.now() + 47 * 3_600_000 })
  return out
}

/** A picture in the project, uploaded, as an input part. */
async function imagePart(
  ai: GoogleGenAI,
  dir: string,
  rel: string,
  signal: AbortSignal | undefined
): Promise<Part> {
  const file = projectFile(dir, rel)
  const mime = IMAGE_MIME[extname(file).toLowerCase()]
  if (!mime) throw new Error(`${rel} isn’t a picture Gemini reads (use a PNG, JPEG or WebP).`)
  const u = await upload(ai, file, mime, signal)
  return { type: 'image', uri: u.uri, mime_type: u.mimeType }
}

function projectFile(dir: string, rel: string): string {
  const file = safeJoin(dir, rel.trim().replace(/^\.?\//, ''))
  if (!existsSync(file)) throw new Error(`There is no ${rel} in this project.`)
  return file
}

const cacheDir = (dir: string): string => {
  const d = join(dir, '.luca', 'cache', 'gemini')
  mkdirSync(d, { recursive: true })
  return d
}

/**
 * A part of a clip as Omni reads it best: at most MAX_SECONDS from `start`, no bigger than 720p,
 * H.264. Without sound when Omni should make new sound instead of keeping the old.
 */
async function clipPart(
  dir: string,
  src: string,
  probe: VideoProbe,
  start: number,
  seconds: number,
  sound: boolean
): Promise<string> {
  const [w, h] = probe.height > probe.width ? [720, 1280] : [1280, 720]
  // named after the whole path: two folders can hold clips of the same name
  const id = createHash('sha1').update(src).digest('hex').slice(0, 10)
  const out = join(
    cacheDir(dir),
    `${id}-${start.toFixed(2)}-${seconds.toFixed(2)}${sound ? '' : '-silent'}.mp4`
  )
  if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) return out
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const r = await run(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-ss',
      start.toFixed(3),
      '-i',
      src,
      '-t',
      seconds.toFixed(3),
      '-map',
      '0:v:0',
      ...(sound ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
      '-vf',
      `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out
    ],
    { env: await childEnv(), timeoutMs: 600_000 }
  )
  if (r.code !== 0 || !existsSync(out)) {
    rmSync(out, { force: true })
    throw new Error(`Couldn’t get ${basename(src)} ready for Gemini.`)
  }
  return out
}

// ------------------------------------------------------------------------------ what Luca made

type Made = {
  interaction: string
  prompt: string
  aspect: VideoAspect
  resolution: VideoResolution
  at: string
}

/** Videos made here and the interaction behind each, so a later edit can build on it. */
const madeFile = (dir: string): string => join(cacheDir(dir), 'made.json')

function madeAll(dir: string): Record<string, Made> {
  try {
    return JSON.parse(readFileSync(madeFile(dir), 'utf8')) as Record<string, Made>
  } catch {
    return {}
  }
}

function remember(dir: string, rel: string, made: Made): void {
  writeFileSync(madeFile(dir), JSON.stringify({ ...madeAll(dir), [rel]: made }, null, 2))
}

// ------------------------------------------------------------------------------ sizes

/** 16:9 or 9:16, the one nearer the shape asked for. */
const aspectFor = (w: number, h: number): VideoAspect => (w >= h ? '16:9' : '9:16')

const frameOf = (res: VideoResolution, aspect: VideoAspect): [number, number] => {
  const [w, h] = FRAME[res]
  return aspect === '16:9' ? [w, h] : [h, w]
}

/** The smallest resolution whose frame covers w×h without enlarging (4k when none does). */
function resolutionFor(w: number, h: number, aspect: VideoAspect): VideoResolution {
  return (
    RESOLUTIONS.find((r) => {
      const [fw, fh] = frameOf(r, aspect)
      return fw >= w && fh >= h
    }) ?? '4k'
  )
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** The biggest box of ratio `ratio` (w/h) inside fw×fh, in even pixels. */
function fitRatio(fw: number, fh: number, ratio: number): [number, number] {
  return fw / fh > ratio ? [even(fh * ratio), fh] : [fw, even(fw / ratio)]
}

// ------------------------------------------------------------------------------ making

export type VideoRequest = {
  /** What to make or change, in plain words. */
  prompt: string
  /** A clip in the project to change (project-relative). */
  video?: string
  /** A clip in the project to continue. */
  extend?: string
  /** Where in `video` / `extend` the part Omni reads begins (s). */
  start?: number
  /** Pictures the video starts and ends on. */
  firstFrame?: string
  lastFrame?: string
  /** Pictures of people, things or a look to use (<IMAGE_REF_0>, …). */
  images?: string[]
  /** Clips of people, things or motion to use (<VIDEO_REF_0>, …). */
  videoRefs?: string[]
  seconds?: number
  aspect?: VideoAspect
  resolution?: VideoResolution
  /** The exact frame to deliver; Luca crops and scales Omni's frame to it. */
  width?: number
  height?: number
  /** For `video` / `extend`: keep the clip's sound, or have Omni make all-new sound. */
  sound?: 'keep' | 'new'
}

export type MadeVideo = {
  /** Project-relative, in media/generated. */
  file: string
  width: number
  height: number
  seconds: number
  hasSound: boolean
  aspect: VideoAspect
  resolution: VideoResolution
  /** Omni's frame was cropped or scaled to the size asked for. */
  reframed: boolean
  /** The clip this one edits or continues, and the part of it Omni read. */
  from?: {
    mode: 'edit' | 'extend'
    file: string
    start: number
    seconds: number
    /** For a continuation: the new clip starts with the part it continues (then the new part). */
    includesSource?: boolean
  }
  /** Frames from the start, middle and end (JPEG, base64), for Luca to look at. */
  frames: string[]
}

/** Words for a file name: the start of the prompt, without Omni's tags. */
function slug(prompt: string): string {
  const words = prompt
    .replace(/\[#[^\]]*\]|<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 6)
  return words.join('-').slice(0, 48) || 'video'
}

function freeName(folder: string, stem: string): string {
  let name = `${stem}.mp4`
  for (let n = 2; existsSync(join(folder, name)); n++) name = `${stem}-${n}.mp4`
  return name
}

const running = (s: string): boolean => s === 'in_progress' || s === 'queued'

/** Start the interaction in the background and wait for it; stop it too when `signal` stops. */
async function interact(
  ai: GoogleGenAI,
  params: Interactions.CreateModelInteractionParamsNonStreaming,
  resolution: VideoResolution,
  signal: AbortSignal | undefined
): Promise<Interactions.Interaction> {
  const limit = (resolution === '4k' ? 30 : 20) * 60_000
  let it: Interactions.Interaction
  try {
    it = await ai.interactions.create({ ...params, stream: false, background: true }, { signal })
  } catch (err) {
    // a model that can't run in the background answers the plain way
    if (statusOf(err) !== 400 || !/background/i.test(detailOf(err))) throw err
    return ai.interactions.create({ ...params, stream: false }, { signal, timeout_ms: limit })
  }
  const until = Date.now() + limit
  try {
    while (running(it.status)) {
      if (Date.now() > until) throw new Error('Gemini took too long to make the video.')
      await delay(5_000, undefined, { signal })
      it = await ai.interactions.get(it.id, undefined, { signal })
    }
  } catch (err) {
    if (running(it.status)) void ai.interactions.cancel(it.id).catch(() => undefined)
    throw err
  }
  return it
}

function videoOut(it: Interactions.Interaction): Interactions.VideoContent | undefined {
  if (it.output_video) return it.output_video
  for (const step of [...(it.steps ?? [])].reverse()) {
    if (step.type !== 'model_output') continue
    const v = step.content?.find((c): c is Interactions.VideoContent => c.type === 'video')
    if (v) return v
  }
  return undefined
}

function failure(it: Interactions.Interaction, uploadedVideo: boolean): Error {
  const said = [it.errors?.map((e) => e.message).join(' '), it.output_text]
    .filter((s) => s?.trim())
    .join(' ')
    .trim()
  if (it.status === 'completed' && uploadedVideo && !said)
    return new Error(
      'Gemini finished without a video. Editing or continuing your own clips isn’t offered in the EEA, Switzerland, the UK and some US states; making new videos still works there.'
    )
  if (it.status === 'budget_exceeded')
    return new Error('The Gemini key’s spending limit was reached. Check its Google Cloud billing.')
  return new Error(
    said ? `Gemini didn’t make the video: ${said}` : `Gemini didn’t make the video (${it.status}).`
  )
}

/** Save the video Omni made at `out`: from its file on Google, or from the answer itself. */
async function download(
  ai: GoogleGenAI,
  v: Interactions.VideoContent,
  out: string,
  signal: AbortSignal | undefined
): Promise<void> {
  if (v.data) {
    writeFileSync(out, Buffer.from(v.data, 'base64'))
    return
  }
  if (!v.uri) throw new Error('Gemini made the video but didn’t say where it is.')
  const id = /files\/([a-zA-Z0-9]+)/.exec(v.uri)?.[1]
  // a new file may still be getting ready when the answer comes back
  if (id) await waitActive(ai, `files/${id}`, signal, 'the new video').catch(() => undefined)
  await ai.files.download({ file: v.uri, downloadPath: out })
  if (!existsSync(out) || statSync(out).size === 0)
    throw new Error('Couldn’t download the video Gemini made.')
}

/** Omni's video as the project wants it: cropped and scaled to w×h, playable in the preview. */
async function finish(
  src: string,
  out: string,
  probe: VideoProbe,
  size: [number, number] | null
): Promise<boolean> {
  const reframe = !!size && (probe.width !== size[0] || probe.height !== size[1])
  if (!reframe) {
    const ready = needsPreparing(probe) ? await prepareVideo(src, out, () => {}, probe) : src
    if (ready === src) renameSync(src, out)
    return false
  }
  const [w, h] = size
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const r = await run(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-i',
      src,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '17',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      out
    ],
    { env: await childEnv(), timeoutMs: 1_800_000 }
  )
  if (r.code !== 0 || !existsSync(out)) {
    rmSync(out, { force: true })
    throw new Error('Couldn’t fit the new video to the size asked for.')
  }
  return true
}

/** Small frames from the start, middle and end of a video, as base64 JPEGs. */
async function framesOf(dir: string, file: string, seconds: number): Promise<string[]> {
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const env = await childEnv()
  const out: string[] = []
  for (const at of [0.1, 0.5, 0.9]) {
    const f = join(cacheDir(dir), `${basename(file, '.mp4')}-${at}.jpg`)
    const r = await run(
      ffmpeg,
      [
        '-y',
        '-v',
        'error',
        '-ss',
        (seconds * at).toFixed(2),
        '-i',
        file,
        '-frames:v',
        '1',
        '-vf',
        "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease",
        '-q:v',
        '4',
        f
      ],
      { env, timeoutMs: 60_000 }
    ).catch(() => null)
    if (r?.code === 0 && existsSync(f)) out.push(readFileSync(f).toString('base64'))
    rmSync(f, { force: true })
  }
  return out
}

/** Omni's tags for the inputs, when the prompt doesn't already place them itself. */
function tagged(
  prompt: string,
  o: {
    first: boolean
    last: boolean
    source: boolean
    extend: boolean
    images: number
    videoRefs: number
  }
): string {
  let text = prompt.trim()
  if (o.extend && !/\bextend|\bcontinu/i.test(text)) text = `Extend this video. ${text}`
  if (text.includes('[# ')) return text
  const refTags = /<(IMAGE|VIDEO)_REF_\d+>/.test(text)
  const declare = o.source || ((o.images > 0 || o.videoRefs > 0) && !refTags)
  if (declare) {
    // media are numbered in the order they are sent: pictures, then clips
    const sources: string[] = []
    let image = 0
    if (o.first) sources.push(`<FIRST_FRAME>@Image${++image}`)
    if (o.last) sources.push(`<LAST_FRAME>@Image${++image}`)
    if (o.source) sources.push('<VIDEO_0>@Video1')
    const refs = [
      ...Array.from({ length: o.images }, (_, i) => `<IMAGE_REF_${i}>@Image${image + i + 1}`),
      ...Array.from(
        { length: o.videoRefs },
        (_, i) => `<VIDEO_REF_${i}>@Video${(o.source ? 1 : 0) + i + 1}`
      )
    ]
    const head = [
      sources.length ? `[# Sources ${sources.join(' ')}]` : '',
      refs.length ? `[# References ${refs.join(' ')}]` : ''
    ]
      .filter(Boolean)
      .join(' ')
    return `${head} ${text}`
  }
  if (o.first && o.last && !/<FIRST_FRAME>|<LAST_FRAME>/.test(text))
    return `<FIRST_FRAME> <LAST_FRAME> ${text}`
  if (o.first && !text.includes('<FIRST_FRAME>')) return `<FIRST_FRAME> ${text}`
  return text
}

/**
 * Make a video with Gemini Omni: from words, from pictures (first/last frame, references), or
 * by editing or continuing a clip in the project. Saves it in media/generated, sized for the
 * project unless another size is asked for, and remembers how it was made so it can be edited
 * again later.
 */
export async function generateVideo(
  dir: string,
  projectAspect: Aspect,
  req: VideoRequest,
  signal?: AbortSignal
): Promise<MadeVideo> {
  const prompt = req.prompt.trim()
  if (!prompt) throw new Error('Say what the video should show.')
  if (req.video && req.extend) throw new Error('Edit a clip or continue it, not both at once.')
  if (req.lastFrame && !req.firstFrame) throw new Error('A last frame needs a first frame too.')
  if (req.extend && (req.firstFrame || req.lastFrame))
    throw new Error('A continued clip already has its start; leave out the first and last frame.')
  if ((req.width === undefined) !== (req.height === undefined))
    throw new Error('Give both a width and a height, or neither.')
  const seconds =
    req.seconds === undefined
      ? undefined
      : Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(req.seconds)))

  const ai = client()
  const sourceRel = req.extend ?? req.video
  const mode = req.extend ? 'extend' : req.video ? 'edit' : null
  const sourceFile = sourceRel ? projectFile(dir, sourceRel) : null
  if (sourceFile && !VIDEO_EXT.has(extname(sourceFile).toLowerCase()))
    throw new Error(`${sourceRel} isn’t a video. To bring a picture to life, pass it as a picture.`)
  const source = sourceFile ? await probeVideo(sourceFile) : null
  if (sourceFile && !source) throw new Error(`Luca can’t read ${sourceRel} as a video.`)
  const made = sourceRel ? madeAll(dir)[sourceRel] : undefined
  if (mode === 'extend' && made && source && source.duration >= MAX_EXTENDED_SECONDS - 0.5)
    throw new Error(
      `That video is already ${MAX_EXTENDED_SECONDS} s long, as long as Gemini makes them.`
    )

  // the frame to deliver: as asked, else a clip's own shape, else the project's frame
  const exact: [number, number] | null =
    req.width && req.height ? [Math.round(req.width), Math.round(req.height)] : null
  const shape = exact ?? (source ? [source.width, source.height] : SIZE[projectAspect])
  const ratio = shape[0] / shape[1]
  const aspect = req.aspect ?? made?.aspect ?? aspectFor(shape[0], shape[1])
  // enough pixels for the project: that shape with the project's short side (1080)
  const short = Math.min(...SIZE[projectAspect])
  const want = exact ?? (ratio >= 1 ? [even(short * ratio), short] : [short, even(short / ratio)])
  const resolution = req.resolution ?? resolutionFor(want[0], want[1], aspect)
  const size = exact ?? fitRatio(...frameOf(resolution, aspect), ratio)

  const format: Interactions.VideoResponseFormat = {
    type: 'video',
    delivery: 'uri',
    aspect_ratio: aspect,
    resolution,
    ...(seconds ? { duration: `${seconds}s` } : {})
  }
  const refImages = await Promise.all((req.images ?? []).map((r) => imagePart(ai, dir, r, signal)))
  const refVideos = await Promise.all(
    (req.videoRefs ?? []).map(async (rel) => {
      const f = projectFile(dir, rel)
      const p = await probeVideo(f)
      if (!p) throw new Error(`Luca can’t read ${rel} as a video.`)
      const clip = await clipPart(dir, f, p, 0, Math.min(MAX_SECONDS, p.duration), true)
      const u = await upload(ai, clip, 'video/mp4', signal)
      return { type: 'video', uri: u.uri, mime_type: u.mimeType } as Part
    })
  )

  let window: { start: number; seconds: number } | undefined
  let it: Interactions.Interaction | null = null
  // a video made here is changed or continued from Gemini's own copy of it, whole
  if (made && mode && source) {
    const input: Part[] = [
      ...refImages,
      ...refVideos,
      {
        type: 'text',
        text: tagged(prompt, {
          first: false,
          last: false,
          source: false,
          extend: mode === 'extend',
          images: refImages.length,
          videoRefs: refVideos.length
        })
      }
    ]
    try {
      it = await interact(
        ai,
        {
          model: VIDEO_MODEL,
          input,
          response_format: format,
          previous_interaction_id: made.interaction
        },
        resolution,
        signal
      )
      window = { start: 0, seconds: source.duration }
    } catch (err) {
      // Google keeps interactions for a while only; after that the clip is sent like any other
      if (statusOf(err) !== 404) throw plainError(err)
    }
  }

  let sent = prompt
  let uploadedClip = false
  if (!it) {
    const inputs: Part[] = []
    if (req.firstFrame) inputs.push(await imagePart(ai, dir, req.firstFrame, signal))
    if (req.lastFrame) inputs.push(await imagePart(ai, dir, req.lastFrame, signal))
    inputs.push(...refImages)
    if (sourceFile && source && mode) {
      const len = Math.min(MAX_SECONDS, source.duration)
      const start = Math.max(
        0,
        Math.min(req.start ?? (mode === 'extend' ? source.duration - len : 0), source.duration - 1)
      )
      window = { start, seconds: Math.min(len, source.duration - start) }
      const clip = await clipPart(
        dir,
        sourceFile,
        source,
        start,
        window.seconds,
        req.sound !== 'new'
      )
      uploadedClip = true
      const u = await upload(ai, clip, 'video/mp4', signal)
      inputs.push({ type: 'video', uri: u.uri, mime_type: u.mimeType })
    }
    inputs.push(...refVideos)
    sent = tagged(prompt, {
      first: !!req.firstFrame,
      last: !!req.lastFrame,
      source: !!mode,
      extend: mode === 'extend',
      images: refImages.length,
      videoRefs: refVideos.length
    })
    inputs.push({ type: 'text', text: sent })
    try {
      it = await interact(
        ai,
        { model: VIDEO_MODEL, input: inputs, response_format: format },
        resolution,
        signal
      )
    } catch (err) {
      throw plainError(err)
    }
  }

  const out = videoOut(it)
  if (it.status !== 'completed' || !out) throw failure(it, uploadedClip || refVideos.length > 0)

  const raw = join(cacheDir(dir), `${it.id.replace(/[^\w-]/g, '_')}.mp4`)
  try {
    await download(ai, out, raw, signal)
  } catch (err) {
    rmSync(raw, { force: true })
    throw plainError(err)
  }
  const got = await probeVideo(raw)
  if (!got) {
    rmSync(raw, { force: true })
    throw new Error('The video Gemini sent can’t be read.')
  }
  const folder = join(dir, 'media', 'generated')
  mkdirSync(folder, { recursive: true })
  // taken at once, so clips made side by side never get the same name
  const name = freeName(folder, slug(prompt))
  const file = join(folder, name)
  writeFileSync(file, '')
  let reframed: boolean
  try {
    reframed = await finish(raw, file, got, size)
  } catch (err) {
    rmSync(file, { force: true })
    throw err
  } finally {
    rmSync(raw, { force: true })
  }
  const final = (await probeVideo(file)) ?? got
  const rel = `media/generated/${name}`
  remember(dir, rel, {
    interaction: it.id,
    prompt: sent,
    aspect,
    resolution,
    at: new Date().toISOString()
  })
  return {
    file: rel,
    width: final.width,
    height: final.height,
    seconds: Math.round(final.duration * 100) / 100,
    hasSound: !!final.audio,
    aspect,
    resolution,
    reframed,
    ...(mode && sourceRel && window
      ? {
          from: {
            mode,
            file: sourceRel,
            start: Math.round(window.start * 100) / 100,
            seconds: Math.round(window.seconds * 100) / 100,
            ...(mode === 'extend' ? { includesSource: final.duration >= window.seconds + 1.5 } : {})
          }
        }
      : {}),
    frames: await framesOf(dir, file, final.duration)
  }
}
