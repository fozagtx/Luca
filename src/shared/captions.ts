import type { CaptionConfig, CaptionGroup } from './types'

/**
 * Caption engine shared by main (writes the HyperFrames captions composition) and the renderer
 * (live style previews): the style presets, the fonts HyperFrames embeds on its own, and the
 * transcript → caption lines pipeline (clean the noise, then group into readable lines).
 */

export type CaptionAnim =
  'fade' | 'slide' | 'pop' | 'karaoke' | 'highlight' | 'typewriter' | 'slam' | 'glow' | 'bounce'

export type CaptionStyle = {
  id: string
  name: string
  blurb: string
  font: string
  weight: number
  italic?: boolean
  /** Font size in px for a 1080 px short side. */
  size: number
  uppercase: boolean
  letterSpacing?: number
  color: string
  /** Active word color, or the pill behind it when `wordBox` is set. */
  accent: string
  /** Text color of the active word when it sits on the accent pill. */
  activeText?: string
  wordBox?: boolean
  /** Box behind the whole line. */
  box?: { bg: string; radius: number }
  /** Outline width in px (drawn with text-shadow so it renders everywhere). */
  outline?: number
  shadow?: string
  anim: CaptionAnim
  words: CaptionConfig['wordsPerLine']
}

export const CAPTION_STYLES: CaptionStyle[] = [
  {
    id: 'clean',
    name: 'Clean',
    blurb: 'Crisp white type that slides up. Works on anything.',
    font: 'Inter',
    weight: 700,
    size: 60,
    uppercase: false,
    color: '#FFFFFF',
    accent: '#FFFFFF',
    shadow: '0 4px 18px rgba(0,0,0,0.55)',
    anim: 'slide',
    words: 'normal'
  },
  {
    id: 'bold-pop',
    name: 'Bold pop',
    blurb: 'Heavy outlined caps; each word pops in yellow.',
    font: 'Montserrat',
    weight: 900,
    size: 74,
    uppercase: true,
    color: '#FFFFFF',
    accent: '#FFE14D',
    outline: 7,
    anim: 'pop',
    words: 'short'
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    blurb: 'A colored pill follows every word as it is said.',
    font: 'Poppins',
    weight: 800,
    size: 62,
    uppercase: false,
    color: '#FFFFFF',
    accent: '#7C5CFF',
    activeText: '#FFFFFF',
    wordBox: true,
    shadow: '0 3px 14px rgba(0,0,0,0.45)',
    anim: 'karaoke',
    words: 'normal'
  },
  {
    id: 'highlighter',
    name: 'Highlighter',
    blurb: 'TikTok-style yellow marker on the word being spoken.',
    font: 'Archivo Black',
    weight: 400,
    size: 66,
    uppercase: true,
    color: '#FFFFFF',
    accent: '#FFD400',
    activeText: '#111111',
    wordBox: true,
    outline: 5,
    anim: 'highlight',
    words: 'short'
  },
  {
    id: 'subtitle',
    name: 'Subtitle bar',
    blurb: 'Classic subtitles on a soft dark bar. Easy to read.',
    font: 'Roboto',
    weight: 500,
    size: 46,
    uppercase: false,
    color: '#FFFFFF',
    accent: '#FFFFFF',
    box: { bg: 'rgba(0,0,0,0.72)', radius: 10 },
    anim: 'fade',
    words: 'long'
  },
  {
    id: 'neon',
    name: 'Neon',
    blurb: 'Glowing cyan type for night and tech moods.',
    font: 'Outfit',
    weight: 700,
    size: 64,
    uppercase: false,
    color: '#E9FFFF',
    accent: '#22D3EE',
    shadow: '0 0 10px rgba(34,211,238,0.9), 0 0 28px rgba(34,211,238,0.6)',
    anim: 'glow',
    words: 'normal'
  },
  {
    id: 'typewriter',
    name: 'Typewriter',
    blurb: 'Monospace words typed out one at a time.',
    font: 'JetBrains Mono',
    weight: 700,
    size: 50,
    uppercase: false,
    color: '#F5F5F4',
    accent: '#A3E635',
    box: { bg: 'rgba(12,12,12,0.82)', radius: 8 },
    anim: 'typewriter',
    words: 'normal'
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Elegant italic serif with a slow, soft fade.',
    font: 'Playfair Display',
    weight: 600,
    italic: true,
    size: 58,
    uppercase: false,
    color: '#FFF7E8',
    accent: '#FFF7E8',
    shadow: '0 2px 14px rgba(0,0,0,0.6)',
    anim: 'fade',
    words: 'long'
  },
  {
    id: 'slam',
    name: 'Slam',
    blurb: 'Tall condensed caps that slam in word by word.',
    font: 'League Gothic',
    weight: 400,
    size: 112,
    uppercase: true,
    letterSpacing: 0.02,
    color: '#FFFFFF',
    accent: '#FF4D4D',
    shadow: '0 6px 24px rgba(0,0,0,0.55)',
    anim: 'slam',
    words: 'short'
  },
  {
    id: 'bubbly',
    name: 'Bubbly',
    blurb: 'Rounded type on a pink pill that bounces in.',
    font: 'Nunito',
    weight: 900,
    size: 60,
    uppercase: false,
    color: '#FFFFFF',
    accent: '#FFFFFF',
    box: { bg: '#FF5DA2', radius: 999 },
    anim: 'bounce',
    words: 'short'
  }
]

export function captionStyle(id: string): CaptionStyle {
  return CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0]
}

/** Fonts HyperFrames embeds by itself at render time (plus their Google Fonts weights for preview). */
export const BUILTIN_FONTS: {
  family: string
  weights: string
  italic?: boolean
  mono?: boolean
}[] = [
  { family: 'Inter', weights: '400;500;600;700;800;900' },
  { family: 'Montserrat', weights: '400;500;600;700;800;900' },
  { family: 'Poppins', weights: '400;500;600;700;800;900' },
  { family: 'Outfit', weights: '400;500;600;700;800;900' },
  { family: 'Nunito', weights: '400;600;700;800;900' },
  { family: 'Roboto', weights: '400;500;700;900' },
  { family: 'Open Sans', weights: '400;600;700;800' },
  { family: 'Lato', weights: '400;700;900' },
  { family: 'Oswald', weights: '400;500;600;700' },
  { family: 'League Gothic', weights: '400' },
  { family: 'Archivo Black', weights: '400' },
  { family: 'Playfair Display', weights: '400;600;700;800;900', italic: true },
  { family: 'EB Garamond', weights: '400;500;600;700;800', italic: true },
  { family: 'JetBrains Mono', weights: '400;500;700;800', mono: true },
  { family: 'Space Mono', weights: '400;700', mono: true },
  { family: 'IBM Plex Mono', weights: '400;500;600;700', mono: true },
  { family: 'Source Code Pro', weights: '400;500;600;700;900', mono: true },
  { family: 'Noto Sans JP', weights: '400;500;700;900' }
]

export function isBuiltinFont(family: string): boolean {
  return BUILTIN_FONTS.some((f) => f.family.toLowerCase() === family.toLowerCase())
}

/** Google Fonts stylesheet for a built-in font (the preview needs it; the render embeds its own). */
export function googleFontUrl(family: string): string | null {
  const f = BUILTIN_FONTS.find((x) => x.family.toLowerCase() === family.toLowerCase())
  if (!f) return null
  const name = f.family.replace(/ /g, '+')
  const w = f.weights.split(';')
  const axis = f.italic
    ? `ital,wght@${[...w.map((x) => `0,${x}`), ...w.map((x) => `1,${x}`)].join(';')}`
    : `wght@${w.join(';')}`
  return `https://fonts.googleapis.com/css2?family=${name}:${axis}&display=swap`
}

/** The closest weight a font actually ships, so a style never asks for a missing face. */
export function nearestWeight(family: string, wanted: number): number {
  const f = BUILTIN_FONTS.find((x) => x.family.toLowerCase() === family.toLowerCase())
  if (!f) return wanted
  const ws = f.weights.split(';').map(Number)
  return ws.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best))
}

export const DEFAULT_CAPTIONS: CaptionConfig = {
  style: 'clean',
  font: 'Inter',
  size: 'md',
  position: 'bottom',
  wordsPerLine: 'normal',
  uppercase: false,
  clean: true
}

export function configFor(styleId: string, prev?: Partial<CaptionConfig>): CaptionConfig {
  const s = captionStyle(styleId)
  return {
    ...DEFAULT_CAPTIONS,
    ...prev,
    style: s.id,
    font: s.font,
    uppercase: s.uppercase,
    wordsPerLine: s.words,
    accent: undefined
  }
}

// ------------------------------------------------------------------ transcript → lines

type TimedWord = { text: string; start: number; end: number }

const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'ah', 'hmm', 'mm', 'uhm', 'mhm', 'umm', 'uhh'])
const bare = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

export function isFillerWord(text: string): boolean {
  return FILLERS.has(bare(text).replace(/'/g, ''))
}

/**
 * The noise pass: drops non-words (music notes, stray punctuation), fillers, false starts
 * ("wh-") and stutters ("I I think" → "I think"), and tidies spacing. With `clean` off only the
 * non-words go.
 */
export function cleanWords(words: TimedWord[], clean = true): TimedWord[] {
  const out: TimedWord[] = []
  for (const raw of words) {
    const text = raw.text.replace(/\s+/g, ' ').trim()
    if (!text || !/[\p{L}\p{N}]/u.test(text)) continue
    if (!(raw.end >= raw.start)) continue
    if (clean) {
      if (isFillerWord(text)) {
        // "um," carried the pause; keep its sentence break on the word before
        const last = out[out.length - 1]
        if (last && /[.?!]$/.test(text) && !/[.?!,;:]$/.test(last.text)) last.text += '.'
        continue
      }
      if (/[-–—]$/.test(text) && text.length <= 6) continue
      const last = out[out.length - 1]
      if (last && bare(last.text) === bare(text) && raw.start - last.end < 0.8) {
        // stutter: keep one, spanning both, with the later punctuation
        out[out.length - 1] = { text, start: last.start, end: raw.end }
        continue
      }
    }
    out.push({ text, start: raw.start, end: raw.end })
  }
  return out
}

const LIMITS: Record<CaptionConfig['wordsPerLine'], { words: number; chars: number }> = {
  short: { words: 3, chars: 18 },
  normal: { words: 5, chars: 30 },
  long: { words: 8, chars: 44 }
}

/**
 * Groups words into caption lines: a line ends at a sentence end, at a clause break once it has
 * a couple of words, before a pause over 0.45 s, or at the length limit. Lines then linger up to
 * 0.6 s (never into the next line) so short ones stay readable.
 */
export function groupWords(
  words: TimedWord[],
  opts: { wordsPerLine: CaptionConfig['wordsPerLine']; portrait?: boolean }
): CaptionGroup[] {
  const lim = LIMITS[opts.wordsPerLine]
  const maxChars = Math.round(lim.chars * (opts.portrait ? 0.72 : 1))
  const groups: CaptionGroup[] = []
  let cur: TimedWord[] = []
  const flush = (): void => {
    if (!cur.length) return
    groups.push({
      text: cur.map((w) => w.text).join(' '),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      words: cur
    })
    cur = []
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const prev = cur[cur.length - 1]
    if (prev) {
      const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length
      if (w.start - prev.end > 0.45 || cur.length >= lim.words || chars > maxChars) flush()
    }
    cur.push(w)
    if (/[.?!…]["')\]]?$/.test(w.text)) flush()
    else if (/[,;:]$/.test(w.text) && cur.length >= 2 && cur.length >= lim.words - 1) flush()
  }
  flush()
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const next = groups[i + 1]
    const room = next ? next.start - 0.04 : g.end + 0.6
    g.end = Math.max(g.end, Math.min(g.end + 0.6, room))
    if (next && g.end > next.start) g.end = next.start
    g.start = round(g.start)
    g.end = round(g.end)
  }
  return groups.filter((g) => g.end - g.start > 0.05)
}

export const round = (n: number): number => Math.round(n * 1000) / 1000

/** Short sample lines for style previews when a project has no transcript yet. */
export const SAMPLE_WORDS: TimedWord[] = 'This is how your captions will look on the video'
  .split(' ')
  .map((text, i) => ({ text, start: i * 0.32, end: i * 0.32 + 0.28 }))
