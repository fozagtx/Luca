/**
 * Putting sound into a composition's HTML, as strings: which row a clip goes on, the tags
 * themselves, and shortening music that outlasts the video. Pure (the smoke script bundles it);
 * place.ts reads and writes the files.
 */
import { basename, extname } from 'node:path'
import type { PlaceAudio, Placed } from '../shared/ai33'
import { clipSrc, sourceTags } from './captions-html'
import {
  closingOffset,
  findTagById,
  findTags,
  insertIntoRoot,
  removeElement,
  replaceTag,
  setAttrs,
  type TagMatch
} from './html'
import { unescapeAttr } from './timeline-read'

export type RowRole = PlaceAudio['role']

/** What a clip on the timeline is: one of Luca's sounds, or the kind of media it is. */
type ClipRole = RowRole | 'video' | 'audio' | 'image' | 'other'

/** Music fades in and out by these many seconds, and a sound effect plays at this level, unless told otherwise. */
export const MUSIC_FADE_IN = 1
export const MUSIC_FADE_OUT = 2.5
export const SFX_VOLUME = 0.6

/** Clips that only touch at an edge don't overlap. */
const EPS = 0.001

const r2 = (n: number): number => Math.round(n * 100) / 100
const r3 = (n: number): number => Math.round(n * 1000) / 1000
const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const isSound = (v: string | undefined): v is RowRole =>
  v === 'voice' || v === 'music' || v === 'sfx'

/** `data-luca-role` when Luca wrote the clip, else the kind of media. */
function roleOf(tag: TagMatch): ClipRole {
  const made = tag.attrs['data-luca-role']?.trim().toLowerCase()
  if (isSound(made)) return made
  return tag.name === 'video'
    ? 'video'
    : tag.name === 'audio'
      ? 'audio'
      : tag.name === 'img'
        ? 'image'
        : 'other'
}

const rootOf = (tags: TagMatch[]): TagMatch | undefined =>
  tags.find((t) => t.attrs['data-composition-id'] !== undefined)

/**
 * Whether a tag is a clip of the timeline itself. Times inside a scene or group are its own, so
 * a tag nested in another timed element is not.
 */
function topLevelTest(html: string, tags: TagMatch[]): (t: TagMatch) => boolean {
  const root = rootOf(tags)
  const holders = tags
    .filter(
      (t) =>
        t !== root &&
        (t.attrs['data-composition-id'] !== undefined || t.attrs['data-start'] !== undefined)
    )
    .map((t) => ({ from: t.end, to: closingOffset(html, t)?.start ?? t.end }))
  return (t) => !holders.some((h) => t.start >= h.from && t.start < h.to)
}

type Timed = { role: ClipRole; row: number; start: number; end: number }

/**
 * Every element that sits on a row: what it is, where, and when. An element with no length
 * lasts to the end of the video, so it never counts as free space. Anything nested in a scene is
 * `other`: it holds its row's number but never its time.
 */
function timedClips(html: string): Timed[] {
  const tags = findTags(html)
  const root = rootOf(tags)
  const top = topLevelTest(html, tags)
  const out: Timed[] = []
  for (const t of tags) {
    if (t === root || t.name === 'script' || t.name === 'style') continue
    const row = num(t.attrs['data-track-index'], NaN)
    if (!Number.isInteger(row) || row < 0) continue
    const start = Math.max(0, num(t.attrs['data-start'], 0))
    const length = num(t.attrs['data-duration'], NaN)
    const end = length > 0 ? start + length : num(t.attrs['data-end'], Infinity)
    out.push(
      top(t)
        ? { role: roleOf(t), row, start, end }
        : { role: 'other', row, start: 0, end: Infinity }
    )
  }
  return out
}

const overlaps = (c: { start: number; end: number }, start: number, end: number): boolean =>
  c.start < end - EPS && start < c.end - EPS

const fits = (clips: Timed[], role: RowRole, row: number, start: number, end: number): boolean =>
  clips.filter((c) => c.row === row).every((c) => c.role === role && !overlaps(c, start, end))

/** Whether `row` can take a clip of `role` between `start` and `end`. */
export function rowFits(
  html: string,
  role: RowRole,
  row: number,
  start: number,
  end: number
): boolean {
  return fits(timedClips(html), role, row, start, end)
}

/**
 * The row for a clip of `role` between `start` and `end`: a row of the same role where nothing
 * overlaps, else a new row that no other role uses.
 */
export function rowFor(html: string, role: RowRole, start: number, end: number): number {
  const clips = timedClips(html)
  const rows = [...new Set(clips.map((c) => c.row))].sort((a, b) => a - b)
  for (const row of rows) if (fits(clips, role, row, start, end)) return row
  return rows.length ? rows[rows.length - 1] + 1 : 0
}

/** A sound clip as it stands in the composition. */
export type ClipInfo = {
  id: string
  role: ClipRole
  src: string
  start: number
  /** null when the clip has no length of its own. */
  end: number | null
  row: number
  mediaStart: number
  volume: number
  fadeIn: number
  fadeOut: number
  title: string | null
}

/** The `<audio>` with this id, or null. */
export function findClip(html: string, id: string): ClipInfo | null {
  const tag = findTagById(html, id)
  if (!tag || tag.name !== 'audio') return null
  const start = num(tag.attrs['data-start'], 0)
  const length = num(tag.attrs['data-duration'], NaN)
  const title = unescapeAttr(tag.attrs['data-luca-title'] ?? '').trim()
  return {
    id,
    role: roleOf(tag),
    src: clipSrc(tag),
    start,
    end: length > 0 ? r3(start + length) : null,
    row: num(tag.attrs['data-track-index'], 0),
    mediaStart: num(tag.attrs['data-media-start'], 0),
    volume: num(tag.attrs['data-volume'], 1),
    fadeIn: num(tag.attrs['data-fade-in'], 0),
    fadeOut: num(tag.attrs['data-fade-out'], 0),
    title: title || null
  }
}

/** The composition without the element with this id (unchanged when there is none). */
export function withoutClip(html: string, id: string): string {
  const tag = findTagById(html, id)
  return tag ? removeElement(html, tag) : html
}

const ROLE_WORD: Record<RowRole, string> = {
  voice: 'a voice',
  music: 'music',
  sfx: 'a sound effect'
}

const escapeAttr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A file name goes in as it is written on disk, with only the quote that would end the attribute
 * escaped: "&" is common in names, and the parser never undoes an "&amp;" it finds.
 */
const escapeSrc = (v: string): string => v.replace(/"/g, '&quot;')

const slugOf = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')

/**
 * The words in a file's name, without its folder, its extension or the hash Luca appends:
 * "media/generated/music/calm-piano-91ab0c33de-1.mp3" is "calm piano".
 */
export function nameFromFile(file: string): string {
  const stem = basename(file, extname(file)).replace(/-[0-9a-f]{10}(?:-[a-z0-9]+)?$/i, '')
  return stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** An id no element uses yet: `base`, else base-2, base-3… */
function freeId(html: string, base: string): string {
  const taken = new Set(findTags(html).map((t) => t.attrs.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/**
 * Add an `<audio>` clip on `o.row`, and where it went. Music never lengthens the video; a voice
 * with `extendRoot` does. With `replaces`, that clip (of the same role) comes out first.
 */
export function insertAudio(
  html: string,
  o: PlaceAudio & { row: number; duration: number }
): { html: string; placed: Placed } {
  let base = html
  if (o.replaces) {
    const old = findClip(base, o.replaces)
    if (!old) throw new Error(`There is no sound called “${o.replaces}” on the timeline.`)
    if (old.role !== o.role)
      throw new Error(`“${o.replaces}” isn’t ${ROLE_WORD[o.role]}, so this can’t take its place.`)
    base = withoutClip(base, o.replaces)
  }
  const duration = r3(o.duration)
  if (!(duration > 0)) throw new Error('That sound has no length to put on the timeline.')
  const start = r3(Math.max(0, o.start))
  const end = r3(start + duration)
  const music = o.role === 'music'
  const title = (o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const id = freeId(
    base,
    o.id?.trim() || `${o.role}-${slugOf(title) || slugOf(nameFromFile(o.file)) || 'sound'}`
  )
  const volume = r2(Math.max(0, o.volume ?? (o.role === 'sfx' ? SFX_VOLUME : 1)))
  let fadeIn = Math.max(0, o.fadeIn ?? (music ? MUSIC_FADE_IN : 0))
  let fadeOut = Math.max(0, o.fadeOut ?? (music ? MUSIC_FADE_OUT : 0))
  // the fades of a short clip share it, as the export does
  if (fadeIn + fadeOut > duration) {
    const scale = duration / (fadeIn + fadeOut)
    fadeIn *= scale
    fadeOut *= scale
  }
  fadeIn = r2(fadeIn)
  fadeOut = r2(fadeOut)
  const mediaStart = r3(Math.max(0, o.mediaStart ?? 0))

  const attrs: [string, string][] = [
    ['id', id],
    ['src', o.file],
    ['data-start', String(start)],
    ['data-duration', String(duration)],
    ...(music || mediaStart > 0
      ? [['data-media-start', String(mediaStart)] as [string, string]]
      : []),
    ['data-track-index', String(o.row)],
    ['data-volume', String(volume)],
    ...(fadeIn > 0 ? [['data-fade-in', String(fadeIn)] as [string, string]] : []),
    ...(fadeOut > 0 ? [['data-fade-out', String(fadeOut)] as [string, string]] : []),
    ...(music ? [['data-timeline-role', 'music'] as [string, string]] : []),
    ['data-luca-role', o.role],
    ...(title ? [['data-luca-title', title] as [string, string]] : [])
  ]
  const tag = `<audio ${attrs.map(([k, v]) => `${k}="${k === 'src' ? escapeSrc(v) : escapeAttr(v)}"`).join(' ')}></audio>`
  let out = insertIntoRoot(base, `      ${tag}\n`)
  if (!out) throw new Error('Couldn’t find the video’s timeline in index.html to add the sound to.')

  if (o.role === 'voice' && o.extendRoot) {
    const root = rootOf(findTags(out))
    if (root && num(root.attrs['data-duration'], 0) < end)
      out = replaceTag(out, root, setAttrs(root, { 'data-duration': String(end) }))
  }
  return {
    html: out,
    placed: {
      id,
      start,
      end,
      row: o.row,
      volume,
      ...(fadeIn > 0 ? { fadeIn } : {}),
      ...(fadeOut > 0 ? { fadeOut } : {}),
      ...(title ? { title } : {})
    }
  }
}

/**
 * Shorten music clips that run past the end of the video (or their file): never lengthens, so a
 * bed the person trimmed stays trimmed. `fileDurations` is by the clip's `src`; a file whose
 * length isn't known only has the video's end to keep to.
 */
export function clampBeds(
  html: string,
  o: { rootDuration: number; fileDurations: Record<string, number> }
): { html: string; changed: boolean } {
  if (!(o.rootDuration > 0)) return { html, changed: false }
  const tags = findTags(html)
  const top = topLevelTest(html, tags)
  const edits: { tag: TagMatch; raw: string }[] = []
  for (const tag of tags) {
    if (tag.name !== 'audio' || roleOf(tag) !== 'music' || !top(tag)) continue
    const start = num(tag.attrs['data-start'], 0)
    const current = num(tag.attrs['data-duration'], NaN)
    // no length written: the clip plays what the file has, and there is nothing to shorten
    if (!(current > 0) || start >= o.rootDuration) continue
    const file = o.fileDurations[clipSrc(tag)]
    const inFile = file > 0 ? file - Math.max(0, num(tag.attrs['data-media-start'], 0)) : Infinity
    const next = Math.min(current, o.rootDuration - start, inFile)
    if (next > 0 && next < current - 0.01)
      edits.push({ tag, raw: setAttrs(tag, { 'data-duration': String(r3(next)) }) })
  }
  let out = html
  for (const e of edits.sort((a, b) => b.tag.start - a.tag.start))
    out = replaceTag(out, e.tag, e.raw)
  return { html: out, changed: edits.length > 0 }
}

/** Whether the composition already has a voice: audible `source` footage, or a clip with role voice. */
export function hasVoice(html: string, source: string): boolean {
  const heard = (t: TagMatch): boolean => num(t.attrs['data-volume'], 1) > 0
  if (findTags(html, 'audio').some((t) => roleOf(t) === 'voice' && heard(t))) return true
  return sourceTags(html, source).some(
    (t) => (t.name === 'audio' || !('muted' in t.attrs)) && heard(t)
  )
}
