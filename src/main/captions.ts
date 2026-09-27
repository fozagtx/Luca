import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  captionStyle,
  cleanCaptionConfig,
  cleanWords,
  familyCssUrls,
  googleFontUrl,
  groupWords,
  keepFontSubsets,
  parseFontFaces,
  parseGoogleFontsInput,
  placeWords,
  round,
  BUILTIN_FONTS,
  type GoogleFontFace
} from '../shared/captions'
import type {
  CaptionConfig,
  CaptionState,
  Project,
  ProjectFont,
  ProjectFontFace,
  Transcript
} from '../shared/types'
import { CAPTIONS_FILE, CAPTIONS_ID, captionsComposition, speechClips } from './captions-html'
import { sourcePath } from './clean'
import {
  findTagById,
  findTags,
  insertIntoRoot,
  nextTrackIndex,
  removeElement,
  replaceTag,
  setAttrs,
  upsertHeadBlock
} from './html'
import { AUDIO_EXT, VIDEO_EXT, lucaDir } from './projects'
import { checkpoint } from './versions'

const HOST_ID = CAPTIONS_ID
const COMP_FILE = CAPTIONS_FILE

type TimedWord = { text: string; start: number; end: number }
/** One entry of .luca/fonts.json. */
type FontFile = ProjectFontFace & {
  family: string
  /** Downloaded from Google Fonts; replaced when the family is added again. */
  google?: boolean
}
/**
 * .luca/captions.json: the look last put on the timeline, and `speech`, a fingerprint of the
 * clips and transcript the captions were timed to.
 */
type Saved = { config: CaptionConfig; lines?: number; appliedAt?: string; speech?: string }

// ------------------------------------------------------------------ project reading

function readIndex(dir: string): string {
  return readFileSync(join(dir, 'index.html'), 'utf8')
}

function dims(html: string): { w: number; h: number; duration: number } {
  const root = findTags(html).find((t) => t.attrs['data-composition-id'] !== undefined)
  return {
    w: Number(root?.attrs['data-width'] ?? 1920) || 1920,
    h: Number(root?.attrs['data-height'] ?? 1080) || 1080,
    duration: Number(root?.attrs['data-duration'] ?? 0) || 0
  }
}

function readWords(dir: string): TimedWord[] {
  const f = join(dir, 'transcript.json')
  if (!existsSync(f)) return []
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Transcript | Transcript['words']
    const words = Array.isArray(raw) ? raw : raw.words
    return (words ?? []).filter((w) => typeof w.text === 'string' && w.end >= w.start)
  } catch {
    return []
  }
}

export function hasTranscript(dir: string): boolean {
  return readWords(dir).length > 0
}

/** Changes exactly when the words' timing on the timeline can: the speech clips or the transcript. */
function speechPrint(p: Project, html: string): string {
  const f = join(p.dir, 'transcript.json')
  return createHash('sha1')
    .update(JSON.stringify(speechClips(html, p.source)))
    .update(existsSync(f) ? readFileSync(f) : '')
    .digest('hex')
    .slice(0, 16)
}

/**
 * Transcript words in the captions track's own time (0 = where the first clip playing the speech
 * starts), across every clip that plays it: the track spans them all, and splits, trims, deletes
 * and moves of those clips carry the words with them.
 */
function placedWords(
  p: Project,
  html: string
): { words: TimedWord[]; start: number; duration: number } {
  const clips = speechClips(html, p.source)
  if (!clips.length) return { words: [], start: 0, duration: 0 }
  const start = Math.min(...clips.map((c) => c.start))
  const end = Math.max(...clips.map((c) => c.start + c.duration))
  const words = placeWords(readWords(p.dir), clips).map((w) => ({
    text: w.text,
    start: round(w.start - start),
    end: round(w.end - start)
  }))
  return { words, start: round(start), duration: round(end - start) }
}

function hasAudio(p: Project): boolean {
  const src = sourcePath(p)
  if (!src) return false
  const ext = extname(src).toLowerCase()
  return VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext)
}

const configFile = (dir: string): string => join(lucaDir(dir), 'captions.json')
const fontsFile = (dir: string): string => join(lucaDir(dir), 'fonts.json')

function readConfig(dir: string): Saved | null {
  try {
    const saved = JSON.parse(readFileSync(configFile(dir), 'utf8')) as Saved
    return saved?.config ? saved : null
  } catch {
    return null
  }
}

function readFontFiles(dir: string): FontFile[] {
  try {
    return JSON.parse(readFileSync(fontsFile(dir), 'utf8')) as FontFile[]
  } catch {
    return []
  }
}

const faceOf = (f: FontFile): ProjectFontFace => ({
  file: f.file,
  weight: f.weight,
  ...(f.weightMax ? { weightMax: f.weightMax } : {}),
  italic: f.italic,
  ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {})
})

export function projectFonts(dir: string): ProjectFont[] {
  const own = new Map<string, ProjectFont>()
  for (const f of readFontFiles(dir)) {
    const font = own.get(f.family) ?? { family: f.family, file: f.file, faces: [] }
    font.faces!.push(faceOf(f))
    own.set(f.family, font)
  }
  return [...own.values(), ...BUILTIN_FONTS.map((f) => ({ family: f.family }))]
}

/** The project's files for a family (empty for built-in fonts), so weights match what exists. */
function familyFaces(dir: string, family: string): ProjectFontFace[] {
  return readFontFiles(dir)
    .filter((f) => f.family.toLowerCase() === family.toLowerCase())
    .map(faceOf)
}

/** The family as the project or the built-in list spells it, or null when it has neither. */
export function knownFont(dir: string, family: string): string | null {
  const want = family.trim().toLowerCase()
  return (
    readFontFiles(dir).find((f) => f.family.toLowerCase() === want)?.family ??
    BUILTIN_FONTS.find((f) => f.family.toLowerCase() === want)?.family ??
    null
  )
}

export function captionState(p: Project): CaptionState {
  const html = readIndex(p.dir)
  const saved = findTagById(html, HOST_ID) ? readConfig(p.dir) : null
  return {
    words: placedWords(p, html).words.length,
    applied: saved?.config ?? null,
    fonts: projectFonts(p.dir),
    hasAudio: hasAudio(p)
  }
}

export function captionWords(p: Project): TimedWord[] {
  return placedWords(p, readIndex(p.dir)).words
}

// ------------------------------------------------------------------ fonts in index.html

function fontFaces(dir: string): string | null {
  const files = readFontFiles(dir)
  if (!files.length) return null
  const fmt: Record<string, string> = {
    '.woff2': 'woff2',
    '.woff': 'woff',
    '.ttf': 'truetype',
    '.otf': 'opentype'
  }
  const faces = files.map(
    (f) =>
      `      @font-face { font-family: '${f.family}'; src: url('${f.file}') format('${fmt[extname(f.file).toLowerCase()] ?? 'truetype'}'); font-weight: ${f.weight}${f.weightMax ? ` ${f.weightMax}` : ''}; font-style: ${f.italic ? 'italic' : 'normal'}; font-display: block;${f.unicodeRange ? ` unicode-range: ${f.unicodeRange};` : ''} }`
  )
  return `<style id="luca-fonts">\n${faces.join('\n')}\n    </style>`
}

function withFonts(html: string, dir: string, family: string): string {
  let out = upsertHeadBlock(html, 'luca-fonts', fontFaces(dir))
  const url = googleFontUrl(family)
  out = upsertHeadBlock(
    out,
    'luca-font-link',
    url
      ? `<link id="luca-font-link" rel="stylesheet" href="${url.replace(/&/g, '&amp;')}" />`
      : null
  )
  return out
}

function writeFontFiles(dir: string, list: FontFile[]): void {
  writeFileSync(fontsFile(dir), JSON.stringify(list, null, 2))
  const index = join(dir, 'index.html')
  writeFileSync(index, upsertHeadBlock(readFileSync(index, 'utf8'), 'luca-fonts', fontFaces(dir)))
}

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra-?light|ultra-?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi-?bold|demi-?bold/i, 600],
  [/extra-?bold|ultra-?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700]
]

/** "BrandSans-SemiBoldItalic.woff2" → BrandSans, 600, italic. */
function describeFontFile(name: string): { family: string; weight: number; italic: boolean } {
  const stem = basename(name, extname(name))
  const [head, ...tail] = stem.split(/[-_]/)
  const suffix = tail.join('-')
  const weight = WEIGHTS.find(([re]) => re.test(suffix))?.[1] ?? 400
  const family = (head || stem)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b(VF|Variable)\b/g, '')
    .trim()
  return { family: family || stem, weight, italic: /italic|oblique/i.test(suffix) }
}

export const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2']

/** Copy font files into fonts/ and register them with @font-face in index.html. */
export async function addFonts(p: Project, files: string[]): Promise<ProjectFont[]> {
  const list = readFontFiles(p.dir)
  mkdirSync(join(p.dir, 'fonts'), { recursive: true })
  for (const src of files) {
    const ext = extname(src).toLowerCase()
    if (!FONT_EXT.includes(ext.slice(1))) continue
    const safe = basename(src).replace(/[^\w.-]+/g, '-')
    copyFileSync(src, join(p.dir, 'fonts', safe))
    const rel = `fonts/${safe}`
    const info = describeFontFile(safe)
    const next = { ...info, file: rel }
    const i = list.findIndex((f) => f.file === rel)
    if (i >= 0) list[i] = next
    else list.push(next)
  }
  writeFontFiles(p.dir, list)
  await checkpoint(p.dir, `Add font${files.length === 1 ? '' : 's'}`)
  return projectFonts(p.dir)
}

// ------------------------------------------------------------------ Google Fonts

/** A current desktop Chrome, so Google Fonts serves woff2 files. */
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const OFFLINE = "Couldn't reach Google Fonts. Check your internet connection and try again."

async function googleFetch(url: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch {
    throw new Error(OFFLINE)
  }
}

/** The stylesheet, or null when Google Fonts has no such family (or none of the asked weights). */
async function googleCss(url: string): Promise<string | null> {
  const res = await googleFetch(url, 15_000)
  if (res.status === 400 || res.status === 404) return null
  if (!res.ok) throw new Error(`Google Fonts didn't answer (${res.status}). Try again in a moment.`)
  return res.text()
}

async function downloadWoff2(url: string, to: string): Promise<void> {
  const res = await googleFetch(url, 30_000)
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null
  if (!buf || buf.subarray(0, 4).toString('latin1') !== 'wOF2')
    throw new Error("Couldn't download the font from Google Fonts. Try again in a moment.")
  writeFileSync(to, buf)
}

/** A family's stylesheet with the weights captions use, or every weight it has when it has none of those. */
async function familyCss(name: string): Promise<string | null> {
  for (const { weights, plain, each } of familyCssUrls(name)) {
    const all = await googleCss(weights)
    if (all) return all
    const regular = await googleCss(plain)
    if (!regular) continue // not this spelling
    const found = (await Promise.all(each.map((url) => googleCss(url).catch(() => null)))).filter(
      (css): css is string => !!css
    )
    return found.length ? found.join('\n') : regular
  }
  return null
}

const slug = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * Adds fonts from a Google Fonts link or name to the project, the way fonts added from files
 * are: their woff2 files (Latin and Latin Extended) go in fonts/, listed in .luca/fonts.json and
 * declared with @font-face in index.html, so the preview shows them and exports never need the
 * internet. Adding a family again replaces its earlier download. Returns the families added.
 */
export async function addGoogleFont(dir: string, input: string): Promise<string[]> {
  const req = parseGoogleFontsInput(input)
  if (!req)
    throw new Error(
      "That isn't a Google Fonts link or font name. Paste a link from fonts.google.com or type the font's name."
    )
  let faces: GoogleFontFace[] = []
  if (req.kind === 'css') {
    const css = await googleCss(req.url)
    if (!css)
      throw new Error(
        `Google Fonts couldn't find ${req.families.join(' or ')} with those settings. Check the link and try again.`
      )
    faces = parseFontFaces(css)
  } else {
    for (const name of req.families) {
      const css = await familyCss(name)
      if (!css) throw new Error(`Google Fonts has no font called “${name}”.`)
      faces.push(...parseFontFaces(css))
    }
  }
  faces = keepFontSubsets(faces).filter((f) => f.url.startsWith('https://fonts.gstatic.com/'))
  if (!faces.length) throw new Error("Google Fonts didn't send any font files for that.")

  // one file per URL: a variable font serves every weight from the same file
  const byUrl = new Map<string, FontFile & { subset: string }>()
  faces.forEach((f, i) => {
    const hit = byUrl.get(f.url)
    if (hit) {
      hit.weightMax = Math.max(hit.weightMax ?? hit.weight, f.weightMax ?? f.weight)
      hit.weight = Math.min(hit.weight, f.weight)
      return
    }
    byUrl.set(f.url, {
      family: f.family,
      file: '',
      weight: f.weight,
      ...(f.weightMax ? { weightMax: f.weightMax } : {}),
      italic: f.italic,
      ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
      google: true,
      subset: f.subset ?? String(i + 1)
    })
  })
  mkdirSync(join(dir, 'fonts'), { recursive: true })
  const added: FontFile[] = []
  await Promise.all(
    [...byUrl].map(async ([url, { subset, ...f }]) => {
      if (f.weightMax === f.weight) delete f.weightMax
      const weights = f.weightMax ? `${f.weight}-${f.weightMax}` : String(f.weight)
      f.file = `fonts/${slug(f.family)}-${weights}${f.italic ? '-italic' : ''}-${slug(subset)}.woff2`
      await downloadWoff2(url, join(dir, f.file))
      added.push(f)
    })
  )

  // in the order they were asked for: Google lists them alphabetically, downloads finish in any order
  const asked = req.families.map((n) => n.toLowerCase())
  const rank = (family: string): number => {
    const i = asked.indexOf(family.toLowerCase())
    return i < 0 ? asked.length : i
  }
  const families = [...new Set([...byUrl.values()].map((f) => f.family))].sort(
    (a, b) => rank(a) - rank(b)
  )
  const before = readFontFiles(dir)
  const replaced = before.filter((f) => f.google && families.includes(f.family))
  const list = [
    ...before.filter((f) => !replaced.includes(f)),
    ...added.sort(
      (a, b) =>
        a.family.localeCompare(b.family) ||
        Number(a.italic) - Number(b.italic) ||
        a.weight - b.weight ||
        a.file.localeCompare(b.file)
    )
  ]
  for (const f of replaced)
    if (!list.some((x) => x.file === f.file)) rmSync(join(dir, f.file), { force: true })
  writeFontFiles(dir, list)
  return families
}

// ------------------------------------------------------------------ apply / remove

/**
 * The captions composition and index.html with its host clip, for a config over the current
 * clips. `empty` (re-timing only) allows no words at all: the speech was trimmed or deleted
 * away, so the captions stay on the timeline showing nothing until it comes back.
 */
function buildCaptions(
  p: Project,
  cfg: CaptionConfig,
  html: string,
  empty = false
): { index: string; comp: string; lines: number } {
  const placed = placedWords(p, html)
  if (!placed.words.length && !empty)
    throw new Error(
      hasTranscript(p.dir)
        ? "The video the transcript belongs to isn't on the timeline anymore, so there are no words to caption."
        : 'There is no transcript to caption yet. Transcribe the video first.'
    )
  const d = dims(html)
  const groups = groupWords(cleanWords(placed.words, cfg.clean), {
    wordsPerLine: cfg.wordsPerLine,
    portrait: d.h > d.w
  })
  if (!groups.length && !empty) throw new Error('The transcript has no words to show as captions.')
  const host = findTagById(html, HOST_ID)
  const start = placed.duration ? placed.start : Number(host?.attrs['data-start'] ?? 0) || 0
  const duration = round(placed.duration || Number(host?.attrs['data-duration'] ?? 0) || d.duration)
  const comp = captionsComposition(
    groups,
    cfg,
    { w: d.w, h: d.h, duration },
    familyFaces(p.dir, cfg.font)
  )
  let index = html
  if (host) {
    index = replaceTag(
      index,
      host,
      setAttrs(host, { 'data-start': String(round(start)), 'data-duration': String(duration) })
    )
  } else {
    const tag = `<div id="${HOST_ID}" class="clip" data-track-kind="captions" data-composition-id="${HOST_ID}" data-composition-src="${COMP_FILE}" data-start="${round(start)}" data-duration="${duration}" data-track-index="${nextTrackIndex(index)}" style="position: absolute; inset: 0; z-index: 50; pointer-events: none"></div>`
    const inserted = insertIntoRoot(index, `      ${tag}\n`)
    if (!inserted) throw new Error('Could not find the main composition in index.html')
    index = inserted
  }
  return { index: withFonts(index, p.dir, cfg.font), comp, lines: groups.length }
}

/**
 * Puts captions on the timeline (or updates them) in a look. `checkpoint: false` leaves the
 * version to the caller, e.g. Luca's turn, which is saved as one version when it ends.
 */
export async function applyCaptions(
  p: Project,
  config: CaptionConfig,
  opts: { checkpoint?: boolean } = {}
): Promise<{ lines: number; config: CaptionConfig }> {
  const cfg = cleanCaptionConfig(config)
  const indexFile = join(p.dir, 'index.html')
  const html = readFileSync(indexFile, 'utf8')
  const built = buildCaptions(p, cfg, html)
  mkdirSync(join(p.dir, 'compositions'), { recursive: true })
  writeFileSync(join(p.dir, COMP_FILE), built.comp)
  writeFileSync(indexFile, built.index)
  const saved: Saved = {
    config: cfg,
    lines: built.lines,
    appliedAt: new Date().toISOString(),
    speech: speechPrint(p, html)
  }
  writeFileSync(configFile(p.dir), JSON.stringify(saved, null, 2))
  if (opts.checkpoint !== false)
    await checkpoint(
      p.dir,
      `Captions: ${captionStyle(cfg.style).name} · ${cfg.font} · ${built.lines} lines`
    )
  return { lines: built.lines, config: cfg }
}

/**
 * Re-times captions already on the timeline, in the look last applied, once the clips under them
 * or the transcript changed: a timeline edit moved, trimmed, split or deleted a clip playing the
 * speech, a clean edit cut it, or Luca edited it. Anything else leaves the captions exactly as
 * they are, so it never rewrites a file (or wakes the file watcher) for nothing, and a change
 * made to the captions clip itself holds until the speech under it moves. Makes no version of
 * its own: the caller's checkpoint saves the edit and its captions as one. Returns whether
 * anything changed.
 */
export function refreshCaptions(p: Project): boolean {
  const indexFile = join(p.dir, 'index.html')
  const html = readFileSync(indexFile, 'utf8')
  const saved = findTagById(html, HOST_ID) ? readConfig(p.dir) : null
  if (!saved) return false
  const speech = speechPrint(p, html)
  if (saved.speech === speech) return false
  const built = buildCaptions(p, cleanCaptionConfig(saved.config), html, true)
  const compFile = join(p.dir, COMP_FILE)
  let changed = false
  if (!existsSync(compFile) || readFileSync(compFile, 'utf8') !== built.comp) {
    mkdirSync(join(p.dir, 'compositions'), { recursive: true })
    writeFileSync(compFile, built.comp)
    changed = true
  }
  if (built.index !== html) {
    writeFileSync(indexFile, built.index)
    changed = true
  }
  writeFileSync(
    configFile(p.dir),
    JSON.stringify({ ...saved, lines: built.lines, speech } satisfies Saved, null, 2)
  )
  return changed
}

export async function removeCaptions(p: Project): Promise<void> {
  const indexFile = join(p.dir, 'index.html')
  let html = readFileSync(indexFile, 'utf8')
  const host = findTagById(html, HOST_ID)
  if (host) html = removeElement(html, host)
  html = upsertHeadBlock(html, 'luca-font-link', null)
  writeFileSync(indexFile, html)
  rmSync(join(p.dir, COMP_FILE), { force: true })
  rmSync(configFile(p.dir), { force: true })
  await checkpoint(p.dir, 'Remove captions')
}
