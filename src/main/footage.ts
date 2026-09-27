import {
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Aspect, Chip, FootageInfo, MediaInput, MediaKind } from '../shared/types'
import { childEnv, ffmpegProgress, probeMedia, run, which } from './env'

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm'])
export const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'])
/** Images Chromium shows as they are; others (HEIC, TIFF) are converted to JPEG on import. */
export const WEB_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])
export const IMAGE_EXT = new Set([...WEB_IMAGE_EXT, '.heic', '.heif', '.tif', '.tiff'])

/** Video codecs every browser plays; HEVC (iPhones), ProRes and the rest become H.264. */
const WEB_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
/** 8-bit 4:2:0 only: Chromium can't play 10-bit or 4:2:2 H.264. */
const WEB_PIXELS = new Set(['yuv420p', 'yuvj420p'])
const WEB_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
/** PQ and HLG, what iPhones record in HDR. */
const HDR = new Set(['smpte2084', 'arib-std-b67'])

/** The picture Luca is shown of an attachment is at most this many pixels on its long side. */
const VIEW_MAX = 1568
const THUMB_WIDTH = 320

export type MediaChip = Extract<Chip, { kind: 'media' }>

const r2 = (n: number): number => Math.round(n * 100) / 100
const stemOf = (name: string): string => basename(name, extname(name))

export function mediaKind(file: string): MediaKind | null {
  const ext = extname(file).toLowerCase()
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (IMAGE_EXT.has(ext)) return 'image'
  return null
}

/** "My clip #2.MOV" → "My-clip-2.MOV": safe in a URL and an HTML attribute. */
export function safeName(name: string): string {
  const ext = extname(name).replace(/[^\w.]/g, '')
  const stem =
    stemOf(name)
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'media'
  return stem + ext
}

/** `name` in `dir`, or name-2, name-3… when it is taken. */
export function uniqueFile(dir: string, name: string): string {
  const ext = extname(name)
  let file = name
  for (let n = 2; existsSync(join(dir, file)); n++) file = `${stemOf(name)}-${n}${ext}`
  return file
}

/**
 * A free `media/<name>` path in a project. The a-roll sits at the project root and Luca looks for
 * the source in media/ first, so a clip may never take the root file's name either.
 */
export function mediaPath(projectDir: string, name: string): string {
  const ext = extname(name)
  let file = name
  for (
    let n = 2;
    existsSync(join(projectDir, 'media', file)) || existsSync(join(projectDir, file));
    n++
  )
    file = `${stemOf(name)}-${n}${ext}`
  return `media/${file}`
}

/** Copy without blocking the app (a clone on APFS, so even long clips are instant there). */
export function copyMedia(src: string, dest: string): Promise<void> {
  return copyFile(src, dest, constants.COPYFILE_FICLONE)
}

type Stream = {
  codec_type?: string
  codec_name?: string
  pix_fmt?: string
  width?: number
  height?: number
  sample_aspect_ratio?: string
  color_transfer?: string
  color_primaries?: string
  color_space?: string
  avg_frame_rate?: string
  duration?: string
  disposition?: { attached_pic?: number }
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
}

/** What Luca needs to know about a video (or image): its shape as shown, and what it is made of. */
export type VideoProbe = {
  /** Displayed size: after rotation metadata and non-square pixels. */
  width: number
  height: number
  duration: number
  fps: number
  /** Overall bit/s, 0 when unknown. */
  bitrate: number
  codec: string
  pixFmt: string
  transfer: string
  primaries: string
  matrix: string
  /** The audio codec, or null for a silent video. */
  audio: string | null
}

export async function probeVideo(file: string): Promise<VideoProbe | null> {
  const ffprobe = await which('ffprobe')
  if (!ffprobe) throw new Error('ffprobe not found')
  const r = await run(
    ffprobe,
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    {
      env: await childEnv(),
      timeoutMs: 30_000
    }
  )
  if (r.code !== 0) return null
  let j: { streams?: Stream[]; format?: { duration?: string; bit_rate?: string } }
  try {
    j = JSON.parse(r.stdout || '{}')
  } catch {
    return null
  }
  const v = j.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (!v?.width || !v.height) return null
  // phones store portrait video as landscape frames plus a rotation to apply when shown
  const rotation =
    v.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ??
    Number(v.tags?.rotate ?? 0)
  const [sn, sd] = (v.sample_aspect_ratio ?? '').split(':').map(Number)
  const w = sn > 0 && sd > 0 ? Math.round((v.width * sn) / sd) : v.width
  const turned = Math.abs(Math.round(rotation)) % 180 === 90
  const [fn, fd] = (v.avg_frame_rate ?? '').split('/').map(Number)
  return {
    width: turned ? v.height : w,
    height: turned ? w : v.height,
    duration: Number(v.duration) || Number(j.format?.duration) || 0,
    fps: fn > 0 && fd > 0 ? fn / fd : 30,
    bitrate: Number(j.format?.bit_rate) || 0,
    codec: v.codec_name ?? '',
    pixFmt: v.pix_fmt ?? '',
    transfer: v.color_transfer ?? '',
    primaries: v.color_primaries ?? '',
    matrix: v.color_space ?? '',
    audio: j.streams?.find((s) => s.codec_type === 'audio')?.codec_name ?? null
  }
}

/** The project shape footage fits best: mostly vertical, near square, or wide. */
export function aspectOf(width: number, height: number): Aspect {
  const r = width / height
  if (r <= 0.76) return 'portrait'
  if (r >= 1.32) return 'landscape'
  return 'square'
}

/** A video's shape and length for the start card, or null when it can't be read. */
export async function footageInfo(file: string): Promise<FootageInfo | null> {
  const p = await probeVideo(file).catch(() => null)
  if (!p) return null
  return {
    width: p.width,
    height: p.height,
    duration: p.duration,
    aspect: aspectOf(p.width, p.height)
  }
}

const videoPlays = (p: VideoProbe): boolean =>
  WEB_VIDEO.has(p.codec) && WEB_PIXELS.has(p.pixFmt) && !HDR.has(p.transfer)
const audioPlays = (p: VideoProbe): boolean => !p.audio || WEB_AUDIO.has(p.audio)

/** True when the preview and export can't use the video as it is. */
export function needsPreparing(p: VideoProbe): boolean {
  return !videoPlays(p) || !audioPlays(p)
}

let capsP: Promise<{ videotoolbox: boolean; tonemap: boolean }> | null = null

/** What this ffmpeg can do, asked once. */
function ffmpegCaps(): Promise<{ videotoolbox: boolean; tonemap: boolean }> {
  capsP ??= (async () => {
    const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
    const env = await childEnv()
    const list = (what: string): Promise<string> =>
      run(ffmpeg, ['-hide_banner', what], { env, timeoutMs: 15_000 }).then(
        (r) => r.stdout,
        () => ''
      )
    const [encoders, filters] = await Promise.all([list('-encoders'), list('-filters')])
    return {
      videotoolbox: process.platform === 'darwin' && /\bh264_videotoolbox\b/.test(encoders),
      tonemap: /\bzscale\b/.test(filters) && /\btonemap\b/.test(filters)
    }
  })()
  return capsP
}

/** Even sides (4:2:0 needs them) and 8-bit 4:2:0 pixels. */
const PLAIN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p'

/** HDR (PQ or HLG, BT.2020) to normal-range BT.709. */
function toneMap(p: VideoProbe): string {
  const known = (v: string, fallback: string): string => (v && v !== 'unknown' ? v : fallback)
  return [
    `zscale=tin=${p.transfer}:pin=${known(p.primaries, 'bt2020')}:min=${known(p.matrix, 'bt2020nc')}:t=linear:npl=100`,
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    PLAIN
  ].join(',')
}

/** Roughly the source's quality in H.264, which needs more bits than HEVC for the same picture. */
function targetKbps(p: VideoProbe): number {
  const guess = p.bitrate > 0 ? p.bitrate * 1.5 : p.width * p.height * p.fps * 0.1
  return Math.round(Math.min(60_000, Math.max(6_000, guess / 1000)))
}

/**
 * Make a video play in the preview and the export. HEVC, ProRes, 10-bit or HDR footage (what
 * iPhones record) becomes 8-bit H.264 with AAC audio at `out`, HDR tone-mapped to normal range,
 * rotation applied. Returns `src` itself when it plays as it is.
 */
export async function prepareVideo(
  src: string,
  out: string,
  onProgress: (p: number) => void,
  probe?: VideoProbe
): Promise<string> {
  const info = probe ?? (await probeVideo(src))
  if (!info) throw new Error(`Luca can't read ${basename(src)} as a video`)
  if (!needsPreparing(info)) return src
  const caps = await ffmpegCaps()
  const hdr = HDR.has(info.transfer)
  // video that plays is kept as it is; only its sound is converted
  const copy = videoPlays(info)
  const encoders: string[][] = copy
    ? [['-c:v', 'copy']]
    : [
        ...(caps.videotoolbox
          ? [['-c:v', 'h264_videotoolbox', '-b:v', `${targetKbps(info)}k`, '-pix_fmt', 'yuv420p']]
          : []),
        ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p']
      ]
  // when tone mapping fails, plain 8-bit still plays (flatter colours beat no picture)
  const filters: (string | null)[] = copy
    ? [null]
    : hdr && caps.tonemap
      ? [toneMap(info), PLAIN]
      : [PLAIN]
  const sdr = hdr
    ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
    : []
  const audio = !info.audio
    ? []
    : info.audio === 'aac'
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k']
  let error = ''
  for (const encoder of encoders) {
    for (const vf of filters) {
      onProgress(0)
      const r = await ffmpegProgress(
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
          ...(vf ? ['-vf', vf, ...sdr] : []),
          ...encoder,
          ...audio,
          '-movflags',
          '+faststart',
          out
        ],
        info.duration,
        onProgress,
        { timeoutMs: 3_600_000 }
      )
      if (r.code === 0 && existsSync(out) && statSync(out).size > 0) return out
      error = r.stderr.trim().slice(-600)
    }
  }
  rmSync(out, { force: true })
  console.warn('[luca] preparing video failed', src, error)
  throw new Error(`Luca couldn't get ${basename(src)} ready to play`)
}

/** HEIC/TIFF → JPEG at `out` so Chromium can show it (sips on macOS, else ffmpeg). */
export async function convertImage(src: string, out: string): Promise<void> {
  const sips = await which('sips')
  const ffmpeg = await which('ffmpeg')
  const r = sips
    ? await run(sips, ['-s', 'format', 'jpeg', src, '--out', out], { timeoutMs: 60_000 })
    : ffmpeg
      ? await run(ffmpeg, ['-y', '-v', 'error', '-i', src, out], {
          env: await childEnv(),
          timeoutMs: 60_000
        })
      : null
  if (!r || r.code !== 0 || !existsSync(out))
    throw new Error(`Couldn't convert ${basename(src)} to JPEG`)
}

// ------------------------------------------------------------------------------ chat attachments

/** Where the pictures of chat attachments are kept, out of the project's history. */
const attachmentsDir = (dir: string): string => join(dir, '.luca', 'cache', 'attachments')

/** One frame (at `at` seconds for a video), at most VIEW_MAX px on its long side. */
async function still(src: string, out: string, at?: number): Promise<boolean> {
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const fit = `scale='min(${VIEW_MAX},iw)':'min(${VIEW_MAX},ih)':force_original_aspect_ratio=decrease`
  const r = await run(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      ...(at !== undefined ? ['-ss', at.toFixed(2)] : []),
      '-i',
      src,
      '-frames:v',
      '1',
      '-vf',
      fit,
      ...(out.endsWith('.png') ? [] : ['-q:v', '3']),
      out
    ],
    { env: await childEnv(), timeoutMs: 60_000 }
  ).catch(() => null)
  return !!r && r.code === 0 && existsSync(out)
}

/** A small JPEG of `view` as a data URL, for the chip's hover preview. */
async function thumbOf(view: string): Promise<string | undefined> {
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const out = `${view}.thumb.jpg`
  const r = await run(
    ffmpeg,
    ['-y', '-v', 'error', '-i', view, '-vf', `scale=${THUMB_WIDTH}:-2`, '-q:v', '5', out],
    { env: await childEnv(), timeoutMs: 30_000 }
  ).catch(() => null)
  if (!r || r.code !== 0 || !existsSync(out)) return undefined
  return `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`
}

/**
 * Copy a video, audio file or image the person added in the chat into the project's media/
 * folder (videos made ready to play, HEIC/TIFF converted), with a picture of it for Luca.
 */
export async function addMedia(
  dir: string,
  input: MediaInput,
  onProgress: (p: number) => void
): Promise<MediaChip> {
  const pasted = !('path' in input)
  const file = pasted ? `pasted-image${extname(input.name) || '.png'}` : basename(input.path)
  const kind = mediaKind(file)
  if (!kind) throw new Error(`Luca can't use ${extname(file) || 'these'} files`)
  const cache = attachmentsDir(dir)
  mkdirSync(cache, { recursive: true })
  mkdirSync(join(dir, 'media'), { recursive: true })
  let src = pasted ? '' : input.path
  if (pasted) {
    src = join(cache, uniqueFile(cache, `incoming-${safeName(file)}`))
    writeFileSync(src, new Uint8Array(input.data))
  }
  const name = pasted ? 'Pasted image' : stemOf(file)
  try {
    if (kind === 'video') return await addVideo(dir, src, file, name, onProgress)
    if (kind === 'image') return await addImage(dir, src, file, name)
    return await addAudio(dir, src, file, name)
  } finally {
    if (pasted) rmSync(src, { force: true })
  }
}

/** `file`: the name it gets in media/ (made safe and unique); `name`: what people see. */
async function addVideo(
  dir: string,
  src: string,
  file: string,
  name: string,
  onProgress: (p: number) => void
): Promise<MediaChip> {
  const info = await probeVideo(src)
  if (!info) throw new Error(`Luca can't read ${file} as a video`)
  let rel: string
  if (needsPreparing(info)) {
    rel = mediaPath(dir, `${stemOf(safeName(file))}.mp4`)
    await prepareVideo(src, join(dir, rel), onProgress, info)
  } else {
    rel = mediaPath(dir, safeName(file))
    await copyMedia(src, join(dir, rel))
  }
  const final = (await probeVideo(join(dir, rel)).catch(() => null)) ?? info
  const view = join(attachmentsDir(dir), `${basename(rel)}.jpg`)
  const at = Math.min(Math.max(final.duration * 0.1, 0.5), Math.max(final.duration - 0.1, 0))
  const seen = await still(join(dir, rel), view, at)
  return {
    kind: 'media',
    media: 'video',
    path: rel,
    name,
    duration: r2(final.duration),
    width: final.width,
    height: final.height,
    thumb: seen ? await thumbOf(view) : undefined
  }
}

async function addImage(dir: string, src: string, file: string, name: string): Promise<MediaChip> {
  let rel: string
  if (WEB_IMAGE_EXT.has(extname(file).toLowerCase())) {
    rel = mediaPath(dir, safeName(file))
    await copyMedia(src, join(dir, rel))
  } else {
    rel = mediaPath(dir, `${stemOf(safeName(file))}.jpg`)
    await convertImage(src, join(dir, rel))
  }
  const size = await probeVideo(join(dir, rel)).catch(() => null)
  // PNG keeps transparency (a logo) and sharp text (a screenshot); everything else is a JPEG
  const png = extname(rel).toLowerCase() === '.png'
  const view = join(attachmentsDir(dir), `${basename(rel)}${png ? '.png' : '.jpg'}`)
  const seen = await still(join(dir, rel), view)
  return {
    kind: 'media',
    media: 'image',
    path: rel,
    name,
    ...(size ? { width: size.width, height: size.height } : {}),
    thumb: seen ? await thumbOf(view) : undefined
  }
}

async function addAudio(dir: string, src: string, file: string, name: string): Promise<MediaChip> {
  const rel = mediaPath(dir, safeName(file))
  await copyMedia(src, join(dir, rel))
  const { duration } = await probeMedia(join(dir, rel)).catch(() => ({ duration: 0 }))
  return { kind: 'media', media: 'audio', path: rel, name, duration: r2(duration) || undefined }
}

/** The picture made when the file was attached, as Claude takes it (bare base64). */
function viewOf(
  dir: string,
  rel: string
): { mediaType: 'image/jpeg' | 'image/png'; data: string } | null {
  for (const [ext, mediaType] of [
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg']
  ] as const) {
    const f = join(attachmentsDir(dir), `${basename(rel)}${ext}`)
    if (existsSync(f)) return { mediaType, data: readFileSync(f).toString('base64') }
  }
  return null
}

/** How an attached file is described to Luca, and the picture of it Luca is shown. */
export function describeMedia(
  dir: string,
  chip: MediaChip
): { line: string; image: ReturnType<typeof viewOf> } {
  const image = chip.media === 'audio' ? null : viewOf(dir, chip.path)
  const facts = [
    chip.width && chip.height ? `${chip.width}×${chip.height}` : '',
    chip.duration ? `${chip.duration}s` : ''
  ].filter(Boolean)
  const at = `saved at ${chip.path}${facts.length ? ` (${facts.join(', ')})` : ''}`
  switch (chip.media) {
    case 'image':
      return {
        image,
        line: `The user attached an image, ${at}${image ? '; it is attached below' : ''}. Use it in the video only if they ask; otherwise treat it as a reference (for example a caption or style to match).`
      }
    case 'video':
      return {
        image,
        line: `The user attached a video, ${at}${image ? '; a frame from it is attached below' : ''}. Add it to the video only if they ask (as a clip with its own audio, like the a-roll); otherwise treat it as a reference.`
      }
    case 'audio':
      return {
        image,
        line: `The user attached an audio file, ${at}. Use it in the video only if they ask (for example as music, as its own audio clip); otherwise treat it as a reference.`
      }
  }
}
