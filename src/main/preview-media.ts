/**
 * Edit-friendly copies of the footage, for the preview only.
 *
 * Phone footage is hard on a browser that has to seek: 60 fps with dropped frames (a variable
 * frame rate), a keyframe only every few seconds (a seek decodes every frame since the last one)
 * and often the index at the end of the file. In Luca's preview such a clip took 1.3 s to play
 * again after a seek, 3.3 s after a reload and lost lip sync while decoding fell behind. So the
 * preview plays a copy made for it, like an editor's proxy: at most 30 fps (what the export
 * renders), a keyframe every half second, at most 1280 px on the long side (sharp at the size the
 * preview shows it, and a quarter of 4K's decoding), index first, the sound as it was. The
 * composition still names the original, the export renders from the original, and nothing in
 * media/ is touched; only the page the preview loads points at the copy. Copies live in
 * .luca/cache/preview/ (out of history and of the watcher), named by the source's path, size and
 * modification time.
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { basename, dirname, extname, join, normalize, relative, sep } from 'node:path'
import { childEnv, run, which } from './env'
import { VIDEO_EXT } from './footage'
import { findTags } from './html'

/** Bump when copies are made differently, so the old ones are made again. */
const RECIPE = 'v1'
const MAX_FPS = 30
const KEYFRAME_SECONDS = 0.5
const MAX_SIDE = 1280

export const previewDir = (projectDir: string): string =>
  join(projectDir, '.luca', 'cache', 'preview')

/** The copy's file name for a project file as it is now, or null when it doesn't exist. */
function copyName(projectDir: string, rel: string): string | null {
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(join(projectDir, rel))
  } catch {
    return null
  }
  if (!st.isFile()) return null
  const key = `${RECIPE}|${rel}|${st.size}|${Math.round(st.mtimeMs)}`
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12)
  return `${basename(rel, extname(rel))}-${hash}.mp4`
}

/** A media src as a project-relative path, or null for a URL, a data: src or outside the project. */
function projectFile(projectDir: string, htmlRel: string, src: string): string | null {
  if (!src || /^[a-z][\w+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('/'))
    return null
  let clean: string
  try {
    clean = decodeURIComponent(src.split(/[?#]/)[0])
  } catch {
    return null
  }
  // relative to the page, or (sub-compositions are inlined into the root page) to the project
  for (const base of [dirname(htmlRel), '.']) {
    const rel = normalize(join(base, clean))
    if (rel.startsWith('..') || rel.startsWith(sep)) continue
    if (existsSync(join(projectDir, rel))) return rel
  }
  return null
}

/**
 * For the page the preview loads: the src a `<video>` or `<audio>` should use instead of `src`,
 * relative to the page, when a ready copy of its file exists; null keeps the original.
 */
export function previewMediaSrc(projectDir: string, htmlRel: string, src: string): string | null {
  const rel = projectFile(projectDir, htmlRel, src)
  if (!rel || !VIDEO_EXT.has(extname(rel).toLowerCase())) return null
  const name = copyName(projectDir, rel)
  if (!name || !existsSync(join(previewDir(projectDir), name))) return null
  const copy = relative(join(projectDir, dirname(htmlRel)), join(previewDir(projectDir), name))
  return copy.split(sep).join('/')
}

type Probe = {
  width: number
  height: number
  duration: number
  /** r_frame_rate: the rate the stream is timed at. */
  rate: number
  rateText: string
  /** avg_frame_rate: frames actually there per second. */
  avg: number
  bitrate: number
}

async function probe(file: string): Promise<Probe | null> {
  const ffprobe = (await which('ffprobe')) ?? 'ffprobe'
  const r = await run(
    ffprobe,
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    { env: await childEnv(), timeoutMs: 30_000 }
  ).catch(() => null)
  if (!r || r.code !== 0) return null
  type S = {
    codec_type?: string
    width?: number
    height?: number
    r_frame_rate?: string
    avg_frame_rate?: string
    disposition?: { attached_pic?: number }
  }
  let j: { streams?: S[]; format?: { duration?: string; bit_rate?: string } }
  try {
    j = JSON.parse(r.stdout || '{}')
  } catch {
    return null
  }
  const v = j.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (!v?.width || !v.height) return null
  const ratio = (s?: string): number => {
    const [n, d] = (s ?? '').split('/').map(Number)
    return n > 0 && d > 0 ? n / d : 0
  }
  return {
    width: v.width,
    height: v.height,
    duration: Number(j.format?.duration) || 0,
    rate: ratio(v.r_frame_rate),
    rateText: v.r_frame_rate ?? '',
    avg: ratio(v.avg_frame_rate),
    bitrate: Number(j.format?.bit_rate) || 0
  }
}

/** The longest stretch without a keyframe in the first 30 s, in seconds. */
async function longestKeyframeGap(file: string, duration: number): Promise<number> {
  const ffprobe = (await which('ffprobe')) ?? 'ffprobe'
  const window = Math.min(30, duration || 30)
  const r = await run(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-read_intervals',
      `%+${window}`,
      '-show_entries',
      'packet=pts_time,flags',
      '-of',
      'csv=p=0',
      file
    ],
    { env: await childEnv(), timeoutMs: 60_000 }
  ).catch(() => null)
  if (!r || r.code !== 0) return 0
  const keys = r.stdout
    .split('\n')
    .filter((l) => l.includes('K'))
    .map((l) => Number(l.split(',')[0]))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
  if (keys.length === 0) return window
  let gap = window - keys[keys.length - 1]
  for (let i = 1; i < keys.length; i++) gap = Math.max(gap, keys[i] - keys[i - 1])
  return gap
}

/** True when the file's index (moov) comes after its media data: a browser reads the end first. */
function indexAtEnd(file: string): boolean {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const size = statSync(file).size
    const head = Buffer.alloc(16)
    let pos = 0
    for (let i = 0; i < 32 && pos + 8 <= size; i++) {
      readSync(fd, head, 0, 16, pos)
      let len = head.readUInt32BE(0)
      const type = head.toString('latin1', 4, 8)
      if (type === 'moov') return false
      if (type === 'mdat') return true
      if (len === 1) len = Number(head.readBigUInt64BE(8))
      if (len < 8) return false
      pos += len
    }
    return false
  } catch {
    return false
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Why a video needs a copy for the preview, or null when it plays well as it is. */
async function previewReason(file: string, p: Probe): Promise<string | null> {
  if (p.rate > MAX_FPS + 0.5 || p.avg > MAX_FPS + 0.5) return `${Math.round(p.rate)} fps`
  if (p.rate > 0 && p.avg > 0 && Math.abs(p.rate - p.avg) / p.rate > 0.02)
    return 'variable frame rate'
  if (Math.max(p.width, p.height) > MAX_SIDE * 1.05) return `${p.width}×${p.height}`
  if (p.bitrate > 25_000_000) return `${Math.round(p.bitrate / 1e6)} Mbit/s`
  if (indexAtEnd(file)) return 'index at the end'
  const gap = await longestKeyframeGap(file, p.duration)
  if (gap > 1.05) return `a keyframe every ${gap.toFixed(1)} s`
  return null
}

let capsP: Promise<boolean> | null = null
const hasVideoToolbox = (): Promise<boolean> =>
  (capsP ??= (async () => {
    if (process.platform !== 'darwin') return false
    const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
    const r = await run(ffmpeg, ['-hide_banner', '-encoders'], {
      env: await childEnv(),
      timeoutMs: 15_000
    }).catch(() => null)
    return !!r && /\bh264_videotoolbox\b/.test(r.stdout)
  })())

/** Make the copy at `out` (through a temporary file, so a half-made one is never served). */
async function makeCopy(src: string, out: string, p: Probe, signal: AbortSignal): Promise<boolean> {
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const nice = process.platform === 'win32' ? null : await which('nice')
  const rate = p.rate > 0 && p.rate <= MAX_FPS + 0.5 ? p.rateText : String(MAX_FPS)
  const fps = p.rate > 0 && p.rate <= MAX_FPS + 0.5 ? p.rate : MAX_FPS
  const gop = String(Math.max(1, Math.round(fps * KEYFRAME_SECONDS)))
  // a constant rate from the fps filter, which shows each frame at the nearest moment (`-r` moved
  // the picture 67 ms late against the sound on 60 fps phone footage); the long side at most
  // MAX_SIDE; even sides for 4:2:0
  const filters =
    `fps=${rate},` +
    `scale='if(gte(iw,ih),min(${MAX_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${MAX_SIDE},ih))',` +
    'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p'
  const [w, h] = p.width >= p.height ? [MAX_SIDE, MAX_SIDE * 0.5625] : [MAX_SIDE * 0.5625, MAX_SIDE]
  const kbps = Math.round(Math.min(w * h, p.width * p.height) * fps * 0.00014)
  const encoder = (await hasVideoToolbox())
    ? ['-c:v', 'h264_videotoolbox', '-b:v', `${Math.max(2000, kbps)}k`, '-g', gop]
    : [
        ...['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-bf', '0'],
        ...['-g', gop, '-keyint_min', gop, '-sc_threshold', '0']
      ]
  const tmp = `${out}.part.mp4`
  const args = [
    ...['-y', '-v', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a:0?'],
    ...['-vf', filters, ...encoder, '-pix_fmt', 'yuv420p'],
    // the sound is the original's, so it keeps its exact timing against the picture
    ...['-c:a', 'copy', '-movflags', '+faststart', tmp]
  ]
  const r = await run(nice ?? ffmpeg, nice ? ['-n', '10', ffmpeg, ...args] : args, {
    env: await childEnv(),
    timeoutMs: 3_600_000,
    signal
  }).catch(() => null)
  const made = r?.code === 0 ? await probe(tmp) : null
  // a copy that doesn't last as long as its source would play the clip out of time
  if (!made || Math.abs(made.duration - p.duration) > 0.25) {
    if (r && r.code !== 0) console.warn('[luca] preview copy failed', src, r.stderr.slice(-400))
    rmSync(tmp, { force: true })
    return false
  }
  renameSync(tmp, out)
  return true
}

/** The video files a project's compositions play, project-relative. */
function videosIn(projectDir: string): string[] {
  const pages = ['index.html']
  try {
    for (const f of readdirSync(join(projectDir, 'compositions')))
      if (f.endsWith('.html')) pages.push(`compositions/${f}`)
  } catch {
    // no sub-compositions
  }
  const out = new Set<string>()
  for (const page of pages) {
    let html: string
    try {
      html = readFileSync(join(projectDir, page), 'utf8')
    } catch {
      continue
    }
    for (const t of findTags(html, 'video')) {
      const rel = t.attrs.src ? projectFile(projectDir, page, t.attrs.src) : null
      if (rel && VIDEO_EXT.has(extname(rel).toLowerCase())) out.add(rel)
    }
  }
  return [...out]
}

/** Files already looked at this session that play well as they are. */
const fine = new Set<string>()
let job: { projectDir: string; abort: AbortController; again: boolean } | null = null

/**
 * Make the copies a project's footage needs, one at a time in the background, at a low priority.
 * `onReady` runs after each new copy (the preview reloads to pick it up). Calling it again while
 * it works re-reads the compositions when it is done (a clip was added); another project stops it.
 */
export function ensurePreviewCopies(projectDir: string, onReady: (rel: string) => void): void {
  if (job && job.projectDir === projectDir) {
    job.again = true
    return
  }
  job?.abort.abort()
  const mine = { projectDir, abort: new AbortController(), again: true }
  job = mine
  void (async () => {
    while (mine.again && !mine.abort.signal.aborted) {
      mine.again = false
      for (const rel of videosIn(projectDir)) {
        if (mine.abort.signal.aborted) break
        const name = copyName(projectDir, rel)
        const abs = join(projectDir, rel)
        if (!name || fine.has(`${abs}|${name}`)) continue
        const out = join(previewDir(projectDir), name)
        if (existsSync(out)) continue
        const p = await probe(abs)
        const why = p ? await previewReason(abs, p) : null
        if (!p || !why) {
          fine.add(`${abs}|${name}`)
          continue
        }
        mkdirSync(previewDir(projectDir), { recursive: true })
        const t0 = Date.now()
        if (await makeCopy(abs, out, p, mine.abort.signal)) {
          console.log(`[luca] preview copy of ${rel} (${why}) in ${Date.now() - t0} ms`)
          dropStaleCopies(projectDir)
          if (!mine.abort.signal.aborted) onReady(rel)
        } else if (!mine.abort.signal.aborted) fine.add(`${abs}|${name}`)
      }
    }
    if (job === mine) job = null
  })().catch((err) => {
    console.warn('[luca] preview copies stopped', err)
    if (job === mine) job = null
  })
}

/** Stop making copies (the project closed). */
export function stopPreviewCopies(): void {
  job?.abort.abort()
  job = null
}

/** Copies of files that changed or left the project since. */
function dropStaleCopies(projectDir: string): void {
  const keep = new Set(videosIn(projectDir).map((rel) => copyName(projectDir, rel)))
  try {
    for (const f of readdirSync(previewDir(projectDir)))
      if (!keep.has(f) && !f.endsWith('.part.mp4')) rmSync(join(previewDir(projectDir), f))
  } catch {
    // nothing to tidy
  }
}
