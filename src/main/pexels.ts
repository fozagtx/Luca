import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { DEFAULT_ASPECT, orientationOf, sizeOf, type Orientation } from '../shared/aspect'
import type { AddedBroll, Aspect, BrollItem, BrollResults, BrollSearch } from '../shared/types'
import { getSecret, setSecret } from './secrets'

const API = 'https://api.pexels.com'

type PexelsPhoto = {
  id: number
  width: number
  height: number
  url: string
  alt: string | null
  photographer: string
  src: { original: string }
}

type PexelsVideoFile = {
  quality: string | null
  file_type: string | null
  width: number | null
  height: number | null
  link: string
}

type PexelsVideo = {
  id: number
  width: number
  height: number
  url: string
  image: string
  duration: number
  user: { name: string }
  video_files: PexelsVideoFile[]
}

type Page = { page: number; next_page?: string | null }
type PhotoPage = Page & { photos: PexelsPhoto[] }
type VideoPage = Page & { videos: PexelsVideo[] }

/** Videos longer than this make heavy downloads for a few seconds of B-roll, so they are left out. */
const MAX_VIDEO_SECONDS = 60

/** The key: one saved in Luca, else PEXELS_API_KEY from the environment or the build (.env). */
export function pexelsKey(): string | null {
  return (
    getSecret('pexels') ||
    process.env.PEXELS_API_KEY?.trim() ||
    import.meta.env.MAIN_VITE_PEXELS_API_KEY?.trim() ||
    null
  )
}

export function hasPexelsKey(): boolean {
  return !!pexelsKey()
}

function plainError(status: number): Error {
  if (status === 401 || status === 403)
    return new Error('Pexels didn’t accept the API key. Check it in the B-roll panel.')
  if (status === 429)
    return new Error(
      'Pexels limits searches to a few hundred an hour. Try again in a little while.'
    )
  return new Error(`Pexels didn’t answer (${status}). Try again in a moment.`)
}

async function get<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  key = pexelsKey()
): Promise<T> {
  if (!key) throw new Error('Connect Pexels in the B-roll panel to find B-roll.')
  const url = new URL(path, API)
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) url.searchParams.set(k, String(v))
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Error('Couldn’t reach Pexels. Check your internet connection.')
  }
  if (!res.ok) throw plainError(res.status)
  return (await res.json()) as T
}

/**
 * Save a Pexels API key after checking it with Pexels (an empty key removes it). A key Pexels
 * refuses is not saved; one that can't be checked (offline) is kept.
 */
export async function savePexelsKey(key: string): Promise<boolean> {
  const k = key.trim()
  if (k) {
    const res = await fetch(`${API}/v1/curated?per_page=1`, {
      headers: { Authorization: k },
      signal: AbortSignal.timeout(10_000)
    }).catch(() => null)
    if (res && (res.status === 401 || res.status === 403))
      throw new Error('Pexels didn’t accept this key. Check that you copied all of it.')
  }
  setSecret('pexels', k)
  return hasPexelsKey()
}

// ------------------------------------------------------------------------------ normalizing

/** Words from the page address ("…/video/aerial-view-of-a-beach-2169880/") when there's no alt. */
function titleOf(url: string, alt: string | null | undefined, fallback: string): string {
  const a = alt?.trim()
  if (a) return a
  const m = /\/(?:photo|video)\/([^/]+?)-\d+\/?$/.exec(url)
  const words = m ? decodeURIComponent(m[1]).replace(/-+/g, ' ').trim() : ''
  return words ? words[0].toUpperCase() + words.slice(1) : fallback
}

/** A Pexels image cropped to w×h (images.pexels.com resizes on request). */
function sized(src: string, w: number, h: number): string {
  try {
    const u = new URL(src)
    u.search = ''
    u.searchParams.set('auto', 'compress')
    u.searchParams.set('cs', 'tinysrgb')
    u.searchParams.set('fit', 'crop')
    u.searchParams.set('w', String(w))
    u.searchParams.set('h', String(h))
    return u.toString()
  } catch {
    return src
  }
}

const THUMB: Record<Orientation, [number, number]> = {
  landscape: [480, 270],
  portrait: [270, 480],
  square: [360, 360]
}

const short = (f: { width: number | null; height: number | null }): number =>
  Math.min(f.width ?? 0, f.height ?? 0)

/** The smallest MP4 at least `minShort` pixels on its short side, else the biggest there is. */
function pickFile(files: PexelsVideoFile[], minShort: number): PexelsVideoFile | null {
  const mp4 = files
    .filter(
      (f) =>
        f.link &&
        f.width &&
        f.height &&
        f.quality !== 'hls' &&
        (f.file_type === 'video/mp4' || /\.mp4(\?|$)/i.test(f.link))
    )
    .sort((a, b) => short(a) - short(b))
  return mp4.find((f) => short(f) >= minShort) ?? mp4[mp4.length - 1] ?? null
}

function fromPhoto(p: PexelsPhoto, orientation: Orientation): BrollItem {
  const [tw, th] = THUMB[orientation]
  return {
    id: `photo:${p.id}`,
    media: 'photo',
    width: p.width,
    height: p.height,
    title: titleOf(p.url, p.alt, 'Photo'),
    thumb: sized(p.src.original, tw, th),
    author: p.photographer
  }
}

function fromVideo(v: PexelsVideo, orientation: Orientation): BrollItem {
  const [tw, th] = THUMB[orientation]
  return {
    id: `video:${v.id}`,
    media: 'video',
    width: v.width,
    height: v.height,
    duration: v.duration,
    title: titleOf(v.url, null, 'Video'),
    thumb: sized(v.image, tw, th),
    preview: pickFile(v.video_files, 540)?.link,
    author: v.user.name
  }
}

const usable = (v: PexelsVideo): boolean =>
  v.duration > 0 && v.duration <= MAX_VIDEO_SECONDS && !!pickFile(v.video_files, 0)

// ------------------------------------------------------------------------------ search

/** Items seen in recent searches, so adding one doesn't need another request. */
const seen = new Map<string, { photo?: PexelsPhoto; video?: PexelsVideo }>()

function remember(photos: PexelsPhoto[], videos: PexelsVideo[]): void {
  if (seen.size > 2000) seen.clear()
  for (const p of photos) seen.set(`photo:${p.id}`, { photo: p })
  for (const v of videos) seen.set(`video:${v.id}`, { video: v })
}

/** Photos and short videos for plain words, interleaved (video first: they move). */
export async function searchBroll(s: BrollSearch): Promise<BrollResults> {
  const media = s.media ?? 'all'
  const page = Math.max(1, Math.floor(s.page ?? 1))
  const query = s.query.trim()
  if (!query) throw new Error('Say what the B-roll should show.')
  const orientation = orientationOf(s.orientation ?? DEFAULT_ASPECT)
  const per = media === 'all' ? 12 : 24
  const [photos, videos] = await Promise.all([
    media === 'video'
      ? null
      : get<PhotoPage>('/v1/search', { query, orientation, per_page: per, page }),
    media === 'photo'
      ? null
      : get<VideoPage>('/videos/search', {
          query,
          orientation,
          per_page: per,
          page,
          max_duration: MAX_VIDEO_SECONDS
        })
  ])
  const ps = photos?.photos ?? []
  const vs = (videos?.videos ?? []).filter(usable)
  remember(ps, vs)
  const items: BrollItem[] = []
  for (let i = 0; i < Math.max(ps.length, vs.length); i++) {
    if (vs[i]) items.push(fromVideo(vs[i], orientation))
    if (ps[i]) items.push(fromPhoto(ps[i], orientation))
  }
  return { items, page, hasMore: !!photos?.next_page || !!videos?.next_page }
}

async function lookup(id: string): Promise<{ photo?: PexelsPhoto; video?: PexelsVideo }> {
  const hit = seen.get(id)
  if (hit) return hit
  const m = /^(photo|video):(\d+)$/.exec(id.trim())
  if (!m) throw new Error(`“${id}” isn’t a Pexels id (they look like video:123 or photo:456).`)
  if (m[1] === 'photo') return { photo: await get<PexelsPhoto>(`/v1/photos/${m[2]}`, {}) }
  return { video: await get<PexelsVideo>(`/videos/videos/${m[2]}`, {}) }
}

// ------------------------------------------------------------------------------ adding

async function download(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) return
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) }).catch(() => null)
  if (!res) throw new Error('Couldn’t reach Pexels to download the B-roll.')
  if (!res.ok || !res.body) throw new Error(`Couldn’t download the B-roll (${res.status}).`)
  const part = `${dest}.part`
  try {
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
      createWriteStream(part)
    )
    renameSync(part, dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
}

/** One line per picture or clip in media/broll/CREDITS.txt (Pexels asks for credit where possible). */
function credit(folder: string, line: string): void {
  const f = join(folder, 'CREDITS.txt')
  const has = existsSync(f) ? readFileSync(f, 'utf8') : ''
  if (!has.includes(line)) appendFileSync(f, `${line}\n`)
}

/**
 * Download B-roll into the project's media/broll, sized for its composition: a photo cropped to
 * the frame, a video as the smallest file that fills it. Files already there are reused.
 */
export async function addBroll(dir: string, id: string, aspect: Aspect): Promise<AddedBroll> {
  const { photo, video } = await lookup(id)
  const [w, h] = sizeOf(aspect)
  const folder = join(dir, 'media', 'broll')
  mkdirSync(folder, { recursive: true })
  if (photo) {
    const name = `pexels-photo-${photo.id}-${w}x${h}.jpg`
    await download(sized(photo.src.original, w, h), join(folder, name))
    const by = `Photo by ${photo.photographer} on Pexels`
    credit(folder, `${name}: ${by} (${photo.url})`)
    return {
      id: `photo:${photo.id}`,
      media: 'photo',
      file: `media/broll/${name}`,
      width: w,
      height: h,
      title: titleOf(photo.url, photo.alt, 'Photo'),
      credit: by
    }
  }
  if (!video) throw new Error('That picture or clip couldn’t be found on Pexels.')
  const file = pickFile(video.video_files, Math.min(w, h))
  if (!file) throw new Error('That video has no file Luca can use.')
  const name = `pexels-video-${video.id}-${short(file)}p.mp4`
  await download(file.link, join(folder, name))
  const by = `Video by ${video.user.name} on Pexels`
  credit(folder, `${name}: ${by} (${video.url})`)
  return {
    id: `video:${video.id}`,
    media: 'video',
    file: `media/broll/${name}`,
    width: file.width ?? w,
    height: file.height ?? h,
    duration: video.duration,
    title: titleOf(video.url, null, 'Video'),
    credit: by
  }
}
