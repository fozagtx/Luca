import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closingOffset, findTags } from './html'
import { unescapeAttr } from './timeline-read'

/** What ffprobe found in a file: whether it has sound, and how long it is (null: it doesn't say). */
export type AudioProbe = { audio: boolean; duration: number | null }
/** null: not media at all. Throws when ffprobe could not be asked (not installed, timed out). */
export type AudioProbeFn = (file: string) => Promise<AudioProbe | null>

export type ExportPreflight = {
  /** false only when a sound would make the render fail. */
  ok: boolean
  /** The plain sentence to show when `ok` is false. */
  error?: string
  /** Things that don't stop the export; logged, not shown. */
  warnings: string[]
}

/** The tail every audio message shares; also what tells the person what to do next. */
const FIX_ONE = 'Ask Luca to make it again, or delete it from the timeline, then export again.'
const FIX_MANY = 'Ask Luca to make them again, or delete them from the timeline, then export again.'

const humanize = (id: string): string => id.replace(/[-_]+/g, ' ')

/** The one sentence for any sound the render can't use; `titles` are the names people see. */
export function unreadableSound(titles: string[]): string {
  const shown = titles.slice(0, 3).join(', ')
  const more = titles.length > 3 ? ` and ${titles.length - 3} more` : ''
  const which = titles.length ? ` (${shown}${more})` : ''
  return titles.length > 1
    ? `Some of the sounds in this video couldn’t be read${which}. ${FIX_MANY}`
    : `One of the sounds in this video couldn’t be read${which}. ${FIX_ONE}`
}

/** ffprobe's `-show_entries stream=codec_type,duration:format=duration -of json` output. */
export function readProbe(stdout: string): AudioProbe | null {
  let j: {
    streams?: { codec_type?: string; duration?: string }[]
    format?: { duration?: string }
  }
  try {
    j = JSON.parse(stdout) as typeof j
  } catch {
    return null
  }
  if (!j || typeof j !== 'object') return null
  const audio = (j.streams ?? []).find((s) => s?.codec_type === 'audio')
  // the container's length, else the sound stream's own; "N/A" and the like count as unknown
  const n = [j.format?.duration, audio?.duration]
    .map((d) => (d === undefined || d === '' ? NaN : Number(d)))
    .find((d) => Number.isFinite(d))
  return { audio: !!audio, duration: n ?? null }
}

/** Sound the render can use: there is an audio stream and it isn't zero-length. */
const usable = (p: AudioProbe | null): boolean =>
  !!p && p.audio && (p.duration === null || p.duration > 0)

/** Comments, scripts, styles and templates blanked (same length): tags inside them aren't clips. */
function mask(html: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, blank)
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, blank)
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, blank)
}

// file: is not here: it names a file on this Mac, which localFile turns into a path
const REMOTE_OR_INLINE = /^(https?:|data:|blob:|\/\/|#)/i
const PLACEHOLDER = /^__[A-Z_]+__$|<<[^<>]+>>|\{\{[^{}]+\}\}|\$\{[^{}]+\}/

/** The file an `<audio src>` means, the way the renderer resolves it; null when it isn't there. */
function localFile(dir: string, src: string): string | null {
  // the tag parser hands back what is written ("Q&amp;A.mp3" is the file "Q&A.mp3"); entities first,
  // since "&#39;" holds the character that starts a fragment
  const written = unescapeAttr(src.trim())
  let clean = written.split(/[?#]/, 1)[0] ?? ''
  if (/^file:/i.test(clean)) {
    try {
      clean = fileURLToPath(new URL(written.split(/[?#]/, 1)[0]))
    } catch {
      return null
    }
  }
  const variants = [clean]
  try {
    const decoded = decodeURIComponent(clean)
    if (decoded !== clean) variants.unshift(decoded)
  } catch {
    /* not percent-encoded */
  }
  for (const v of variants) {
    if (isAbsolute(v) && existsSync(v)) return v
    const joined = join(dir, v)
    if (existsSync(joined)) return joined
  }
  return null
}

/** Verdicts by path, size and time, so an unchanged file is asked about once. */
const known = new Map<string, boolean>()
const asking = new Map<string, Promise<boolean | null>>()
const KNOWN_MAX = 500

/** true: sound the render can use. false: not. null: ffprobe couldn't be asked, so no verdict. */
function readable(file: string, probe: AudioProbeFn): Promise<boolean | null> {
  let key: string
  try {
    const st = statSync(file)
    if (!st.isFile()) return Promise.resolve(false)
    key = `${file}|${st.size}|${st.mtimeMs}`
  } catch {
    return Promise.resolve(false)
  }
  const hit = known.get(key)
  if (hit !== undefined) return Promise.resolve(hit)
  // two clips of one file (or two checks in a row) share one ffprobe
  const running = asking.get(key)
  if (running) return running
  const p = Promise.resolve()
    .then(() => probe(file))
    .then(
      (found) => {
        const verdict = usable(found)
        if (known.size >= KNOWN_MAX) known.clear()
        known.set(key, verdict)
        return verdict
      },
      // that ffprobe couldn't run says nothing about the file, so it never blocks an export
      () => null
    )
  asking.set(key, p)
  void p.finally(() => asking.delete(key))
  return p
}

/** Seconds of the root composition and of its latest-ending clip, when both are readable. */
function lengths(src: string): { root: number; last: number } | null {
  const tags = findTags(src)
  const root = tags.find((t) => t.attrs['data-composition-id'] !== undefined)
  const rootLen = Number(root?.attrs['data-duration'])
  if (!(rootLen > 0)) return null
  let last = 0
  for (const t of tags) {
    if (t.name !== 'audio' && t.name !== 'video' && t.name !== 'img') continue
    const start = Number(t.attrs['data-start'])
    const len = Number(t.attrs['data-duration'])
    if (Number.isFinite(start) && len > 0) last = Math.max(last, start + len)
  }
  return { root: rootLen, last }
}

/**
 * Only what would make the render fail stops an export: a local `<audio>` that is missing or
 * that ffprobe can't read as sound (one such file fails the whole mix). HyperFrames clips
 * overrunning audio and degrades a missing picture, so those never block; remote and inline
 * sources, images and `<video>` aren't looked at.
 */
export async function checkAudio(
  html: string,
  dir: string,
  probe: AudioProbeFn
): Promise<ExportPreflight> {
  const src = mask(html)
  const warnings: string[] = []

  const len = lengths(src)
  if (len && len.last > len.root + 0.05)
    warnings.push(
      `The video is ${len.root.toFixed(2)} s long but its last clip runs to ${len.last.toFixed(2)} s, so the end of that clip is cut off.`
    )

  // the renderer drops a sound under `data-hidden`, on itself or on anything around it
  const hidden = findTags(src)
    .filter((t) => t.attrs['data-hidden'] !== undefined)
    .map((t) => ({ from: t.start, to: closingOffset(src, t)?.end ?? t.end }))

  const todo = findTags(src, 'audio').filter((t) => {
    const file = t.attrs.src?.trim()
    if (!t.attrs.id || !file) return false
    if (REMOTE_OR_INLINE.test(file) || PLACEHOLDER.test(file)) return false
    // a clip with no length never plays (the engine skips its window), so its file is not needed
    const length = t.attrs['data-duration']?.trim()
    if (length && Number.isFinite(Number(length)) && Number(length) <= 0) return false
    return !hidden.some((h) => t.start >= h.from && t.start < h.to)
  })

  const results: (boolean | null)[] = []
  let next = 0
  // a few at a time: a project of sound effects would otherwise start dozens of ffprobes
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const i = next++
      const file = localFile(dir, todo[i].attrs.src)
      results[i] = file ? await readable(file, probe) : false
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])

  const bad = todo.flatMap((t, i) =>
    results[i] === false
      ? [unescapeAttr(t.attrs['data-luca-title'] ?? '').trim() || humanize(t.attrs.id)]
      : []
  )
  return bad.length === 0
    ? { ok: true, warnings }
    : { ok: false, error: unreadableSound([...new Set(bad)]), warnings }
}

/** Failures of the machine, not of a sound: whatever clip they name, the file is not what went wrong. */
const NOT_THE_SOUND =
  /ENOSPC|No space left|ENOMEM|out of memory|Cannot allocate|SIGKILL|SIGSEGV|SIGABRT|was killed|EACCES|EPERM|Permission denied|spawn \S*ffmpeg|ffmpeg (?:is )?not (?:found|installed)|timed out/i

/**
 * The renderer's own words for a failed export, in the person's: when it stopped on a sound it
 * says `audio_processing_failed` and names the element, and that becomes the same sentence the
 * check before the render gives. Anything else is passed through, including a failure that names
 * no sound Luca made (footage, or a mix that broke) and one that is the machine's (a full disk,
 * ffmpeg killed): telling those to make a sound again would send people the wrong way.
 */
export function plainExportError(text: string, html: string | null): string {
  if (!/audio_processing_failed|Audio (?:mix|processing) failed/i.test(text)) return text
  if (NOT_THE_SOUND.test(text)) return text
  const titles: string[] = []
  const sounds = findTags(html === null ? '' : mask(html), 'audio')
  for (const m of text.matchAll(/\belement\s+(\w[\w.-]*)/gi)) {
    const id = m[1].replace(/[.-]+$/, '')
    const tag = sounds.find((t) => t.attrs.id === id)
    // only a sound Luca made has a name people know; the footage's own sound is not "made again"
    if (!tag || !(tag.attrs['data-luca-title'] || tag.attrs['data-luca-role'])) continue
    const title = unescapeAttr(tag.attrs['data-luca-title'] ?? '').trim() || humanize(id)
    if (!titles.includes(title)) titles.push(title)
  }
  return titles.length ? unreadableSound(titles) : text
}
