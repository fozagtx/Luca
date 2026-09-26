import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  captionStyle,
  cleanWords,
  googleFontUrl,
  groupWords,
  round,
  BUILTIN_FONTS
} from '../shared/captions'
import type { CaptionConfig, CaptionState, Project, ProjectFont, Transcript } from '../shared/types'
import { CAPTIONS_FILE, CAPTIONS_ID, captionsComposition } from './captions-html'
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
type FontFile = { family: string; file: string; weight: number; italic: boolean }

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

/**
 * Where the transcribed media sits in the composition: its start, the trim offset into the file
 * and how long it plays. Captions are placed on the same stretch so they stay in sync after the
 * clip is moved or trimmed.
 */
function mediaPlacement(
  html: string,
  p: Project
): { start: number; mediaStart: number; duration: number } | null {
  const tags = [...findTags(html, 'video'), ...findTags(html, 'audio')]
  const src = (t: (typeof tags)[number]): string => t.attrs.src ?? ''
  const hit =
    tags.find((t) => /media\/clean-[0-9a-f]+\.mp4/.test(src(t))) ??
    (p.source ? tags.find((t) => src(t).endsWith(p.source)) : undefined) ??
    (p.source ? tags[0] : undefined)
  if (!hit) return null
  const { duration: total } = dims(html)
  const start = Number(hit.attrs['data-start'] ?? 0) || 0
  const duration = Number(hit.attrs['data-duration'] ?? 0) || Math.max(0, total - start)
  return { start, mediaStart: Number(hit.attrs['data-media-start'] ?? 0) || 0, duration }
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

/** Transcript words in the captions track's own time (0 = where the media clip starts). */
function placedWords(
  p: Project,
  html: string
): { words: TimedWord[]; start: number; duration: number } {
  const place = mediaPlacement(html, p)
  const all = readWords(p.dir)
  if (!place) return { words: [], start: 0, duration: 0 }
  const words = all
    .map((w) => ({
      text: w.text,
      start: round(w.start - place.mediaStart),
      end: round(w.end - place.mediaStart)
    }))
    .filter((w) => w.start >= 0 && w.start < place.duration)
  return { words, start: place.start, duration: place.duration }
}

function hasAudio(p: Project): boolean {
  const src = sourcePath(p)
  if (!src) return false
  const ext = extname(src).toLowerCase()
  return VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext)
}

const configFile = (dir: string): string => join(lucaDir(dir), 'captions.json')
const fontsFile = (dir: string): string => join(lucaDir(dir), 'fonts.json')

function readFontFiles(dir: string): FontFile[] {
  try {
    return JSON.parse(readFileSync(fontsFile(dir), 'utf8')) as FontFile[]
  } catch {
    return []
  }
}

export function projectFonts(dir: string): ProjectFont[] {
  const own = new Map<string, ProjectFont>()
  for (const f of readFontFiles(dir)) if (!own.has(f.family)) own.set(f.family, f)
  return [...own.values(), ...BUILTIN_FONTS.map((f) => ({ family: f.family }))]
}

export function captionState(p: Project): CaptionState {
  const html = readIndex(p.dir)
  let applied: CaptionConfig | null = null
  if (findTagById(html, HOST_ID) && existsSync(configFile(p.dir))) {
    try {
      applied = (JSON.parse(readFileSync(configFile(p.dir), 'utf8')) as { config: CaptionConfig })
        .config
    } catch {
      applied = null
    }
  }
  return {
    words: placedWords(p, html).words.length,
    applied,
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
      `      @font-face { font-family: '${f.family}'; src: url('${f.file}') format('${fmt[extname(f.file).toLowerCase()] ?? 'truetype'}'); font-weight: ${f.weight}; font-style: ${f.italic ? 'italic' : 'normal'}; font-display: block; }`
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
  writeFileSync(fontsFile(p.dir), JSON.stringify(list, null, 2))
  const index = join(p.dir, 'index.html')
  writeFileSync(index, upsertHeadBlock(readFileSync(index, 'utf8'), 'luca-fonts', fontFaces(p.dir)))
  await checkpoint(p.dir, `Add font${files.length === 1 ? '' : 's'}`)
  return projectFonts(p.dir)
}

// ------------------------------------------------------------------ apply / remove

export async function applyCaptions(p: Project, cfg: CaptionConfig): Promise<{ lines: number }> {
  const indexFile = join(p.dir, 'index.html')
  let html = readFileSync(indexFile, 'utf8')
  const placed = placedWords(p, html)
  if (!placed.words.length)
    throw new Error('There is no transcript to caption yet. Transcribe the video first.')
  const d = dims(html)
  const groups = groupWords(cleanWords(placed.words, cfg.clean), {
    wordsPerLine: cfg.wordsPerLine,
    portrait: d.h > d.w
  })
  if (!groups.length) throw new Error('The transcript has no words to show as captions.')
  const duration = round(placed.duration || d.duration)

  mkdirSync(join(p.dir, 'compositions'), { recursive: true })
  writeFileSync(
    join(p.dir, COMP_FILE),
    captionsComposition(groups, cfg, { w: d.w, h: d.h, duration })
  )

  const host = findTagById(html, HOST_ID)
  if (host) {
    html = replaceTag(
      html,
      host,
      setAttrs(host, {
        'data-start': String(round(placed.start)),
        'data-duration': String(duration)
      })
    )
  } else {
    const tag = `<div id="${HOST_ID}" class="clip" data-track-kind="captions" data-composition-id="${HOST_ID}" data-composition-src="${COMP_FILE}" data-start="${round(placed.start)}" data-duration="${duration}" data-track-index="${nextTrackIndex(html)}" style="position: absolute; inset: 0; z-index: 50; pointer-events: none"></div>`
    const inserted = insertIntoRoot(html, `      ${tag}\n`)
    if (!inserted) throw new Error('Could not find the main composition in index.html')
    html = inserted
  }
  html = withFonts(html, p.dir, cfg.font)
  writeFileSync(indexFile, html)
  writeFileSync(
    configFile(p.dir),
    JSON.stringify(
      { config: cfg, lines: groups.length, appliedAt: new Date().toISOString() },
      null,
      2
    )
  )
  await checkpoint(
    p.dir,
    `Captions: ${captionStyle(cfg.style).name} · ${cfg.font} · ${groups.length} lines`
  )
  return { lines: groups.length }
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
