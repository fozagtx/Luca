import type {
  CaptionAnimation,
  CaptionConfig,
  CaptionGroup,
  CaptionOverrides,
  ProjectFontFace
} from './types'

/**
 * Caption engine shared by main (writes the HyperFrames captions composition) and the renderer
 * (live style previews): the style presets and the custom looks on top of them, the fonts
 * HyperFrames embeds on its own (and reading Google Fonts links for the others), the transcript →
 * caption lines pipeline (clean the noise, then group into readable lines) and where those words
 * land on the timeline.
 */

export type CaptionAnim = CaptionAnimation

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

/** The animations the styles use, any of which a custom look can pick. */
export const CAPTION_ANIMATIONS: { id: CaptionAnim; blurb: string }[] = [
  { id: 'fade', blurb: 'lines fade in' },
  { id: 'slide', blurb: 'lines slide up' },
  { id: 'pop', blurb: 'lines pop in; the spoken word grows in the highlight color' },
  { id: 'karaoke', blurb: 'a pill in the highlight color follows the spoken word' },
  { id: 'highlight', blurb: 'a marker in the highlight color on the spoken word' },
  { id: 'typewriter', blurb: 'words appear one at a time; the spoken word in the highlight color' },
  { id: 'slam', blurb: 'words slam in big, one at a time' },
  { id: 'glow', blurb: 'lines fade in; the spoken word lights up in the highlight color' },
  { id: 'bounce', blurb: 'lines bounce up' }
]

export const CAPTION_SIZES: Record<CaptionConfig['size'], number> = { sm: 0.82, md: 1, lg: 1.22 }

// ------------------------------------------------------------------ the look a config draws

/** Everything a caption line is drawn with: its style, then the config's own choices on top. */
export type CaptionLook = {
  anim: CaptionAnim
  /** The line fades in slowly (Cinematic). */
  slow: boolean
  weight: number
  italic: boolean
  /** Font size in px for a 1080 px short side, the config's size included. */
  size: number
  letterSpacing: number
  color: string
  accent: string
  /** Text color of the spoken word on its pill. */
  activeText: string
  /** The spoken word sits on a pill of the accent color. */
  wordBox: boolean
  /** Width in px for a 1080 px short side. */
  outline: { color: string; width: number } | null
  /** CSS text-shadow for a 1080 px short side, besides the outline. */
  shadow: string | null
  /** `radius` in px for a 1080 px short side (999 is a pill); `padding` is CSS. */
  box: { bg: string; radius: number; padding: string } | null
}

const OUTLINE = 'rgba(0,0,0,0.92)'

export function captionLook(
  cfg: CaptionConfig,
  faces?: Pick<ProjectFontFace, 'weight' | 'weightMax'>[]
): CaptionLook {
  const s = captionStyle(cfg.style)
  const o = cleanOverrides(cfg.overrides) ?? {}
  const anim = o.animation ?? s.anim
  const color = o.color ?? s.color
  const accent = safeColor(cfg.accent) ?? s.accent
  const wordBox = anim === 'karaoke' || anim === 'highlight'
  let box: CaptionLook['box'] = null
  if (o.box) {
    const radius = o.box.radius ?? s.box?.radius ?? 10
    const pill = radius >= 999
    const x = o.box.padding ?? (pill ? 0.9 : 0.55)
    const y = Math.round(x * (pill ? 0.31 : 0.36) * 100) / 100
    box = { bg: withAlpha(o.box.color, o.box.opacity ?? 1), radius, padding: `${y}em ${x}em` }
  } else if (s.box && o.box !== null) {
    const pill = s.box.radius === 999
    box = { bg: s.box.bg, radius: s.box.radius, padding: pill ? '0.28em 0.9em' : '0.2em 0.55em' }
  }
  return {
    anim,
    slow: s.id === 'cinematic' && anim === 'fade',
    weight: fontWeight(cfg.font, o.weight ?? s.weight, faces),
    italic: o.italic ?? !!s.italic,
    size: s.size * CAPTION_SIZES[cfg.size],
    letterSpacing: o.letterSpacing ?? s.letterSpacing ?? 0,
    color,
    accent,
    // a pill the style never had needs text that reads on it
    activeText: o.activeColor ?? s.activeText ?? (wordBox ? readableOn(accent, color) : color),
    wordBox,
    outline:
      o.outline !== undefined ? o.outline : s.outline ? { color: OUTLINE, width: s.outline } : null,
    shadow:
      o.shadow !== undefined
        ? o.shadow && `0 ${o.shadow.y ?? 0}px ${o.shadow.blur}px ${o.shadow.color}`
        : (s.shadow ?? null),
    box
  }
}

/** The outline and shadow as one CSS text-shadow, at `k` times the 1080 px scale. */
export function captionTextShadow(look: CaptionLook, k: number, steps = 16): string {
  const out: string[] = []
  if (look.outline && look.outline.width > 0) {
    const px = Math.max(0.6, look.outline.width * k)
    for (let a = 0; a < steps; a++) {
      const t = (a / steps) * Math.PI * 2
      out.push(
        `${(Math.cos(t) * px).toFixed(1)}px ${(Math.sin(t) * px).toFixed(1)}px 0 ${look.outline.color}`
      )
    }
  }
  if (look.shadow)
    out.push(look.shadow.replace(/(-?\d*\.?\d+)px/g, (_, n: string) => `${round(Number(n) * k)}px`))
  return out.join(', ')
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const COLOR = /^((rgb|rgba|hsl|hsla)\([\d\s.,%/+-]+\)|[a-z]{3,24})$/i

/** A CSS color that is safe to write into a stylesheet, or undefined. */
export function safeColor(c: unknown): string | undefined {
  if (typeof c !== 'string') return undefined
  const s = c.trim()
  return HEX.test(s) || COLOR.test(s) ? s : undefined
}

function hexRgb(c: string): [number, number, number] | null {
  if (!HEX.test(c)) return null
  let h = c.slice(1)
  if (h.length <= 4) h = [...h].map((x) => x + x).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

export function withAlpha(color: string, opacity: number): string {
  if (opacity >= 1) return color
  const rgb = hexRgb(color)
  return rgb
    ? `rgba(${rgb.join(',')},${round(opacity)})`
    : `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`
}

/** Near-black on light backgrounds, else white; `fallback` when the color can't be read. */
function readableOn(bg: string, fallback: string): string {
  const rgb = hexRgb(bg)
  if (!rgb) return fallback
  const [r, g, b] = rgb.map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111111' : '#FFFFFF'
}

const clamp = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * Overrides with every value checked: colors that are real CSS colors, numbers in range, known
 * animations. Anything else is dropped; undefined when nothing is left.
 */
export function cleanOverrides(raw: unknown): CaptionOverrides | undefined {
  const r = obj(raw)
  if (!r) return undefined
  const out: CaptionOverrides = {}
  const color = safeColor(r.color)
  if (color) out.color = color
  const active = safeColor(r.activeColor)
  if (active) out.activeColor = active
  const weight = clamp(r.weight, 100, 900)
  if (weight !== undefined) out.weight = Math.round(weight)
  if (typeof r.italic === 'boolean') out.italic = r.italic
  const spacing = clamp(r.letterSpacing, -0.1, 0.5)
  if (spacing !== undefined) out.letterSpacing = round(spacing)
  if (r.outline === null) out.outline = null
  else if (obj(r.outline)) {
    const o = obj(r.outline)!
    const width = clamp(o.width, 0, 24) ?? 6
    out.outline = width > 0 ? { color: safeColor(o.color) ?? '#000000', width: round(width) } : null
  }
  if (r.box === null) out.box = null
  else if (obj(r.box)) {
    const b = obj(r.box)!
    const bg = safeColor(b.color)
    if (bg) {
      out.box = { color: bg }
      const opacity = clamp(b.opacity, 0, 1)
      if (opacity !== undefined) out.box.opacity = round(opacity)
      const radius = clamp(b.radius, 0, 999)
      if (radius !== undefined) out.box.radius = Math.round(radius)
      const padding = clamp(b.padding, 0, 3)
      if (padding !== undefined) out.box.padding = round(padding)
    }
  }
  if (r.shadow === null) out.shadow = null
  else if (obj(r.shadow)) {
    const sh = obj(r.shadow)!
    const shadow = safeColor(sh.color)
    if (shadow)
      out.shadow = {
        color: shadow,
        blur: round(clamp(sh.blur, 0, 80) ?? 16),
        y: round(clamp(sh.y, -40, 40) ?? 0)
      }
  }
  const anim = CAPTION_ANIMATIONS.find((a) => a.id === r.animation)
  if (anim) out.animation = anim.id
  return Object.keys(out).length ? out : undefined
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

/** Like nearestWeight, for built-in fonts and fonts added to the project alike. */
export function fontWeight(
  family: string,
  wanted: number,
  faces?: Pick<ProjectFontFace, 'weight' | 'weightMax'>[]
): number {
  if (isBuiltinFont(family) || !faces?.length) return nearestWeight(family, wanted)
  // a variable font covers its whole range
  if (faces.some((f) => wanted >= f.weight && wanted <= (f.weightMax ?? f.weight))) return wanted
  const ws = faces.flatMap((f) => [f.weight, f.weightMax ?? f.weight])
  return ws.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best))
}

// ------------------------------------------------------------------ Google Fonts links

/** What to fetch for a pasted Google Fonts link or font name. */
export type GoogleFontsRequest =
  /** A stylesheet link: fetched as given, with the weights and styles it asks for. */
  | { kind: 'css'; url: string; families: string[] }
  /** A specimen page or a family name: Luca picks the weights (see familyCssUrls). */
  | { kind: 'family'; families: string[] }

/** `Inter`, `Inter:wght@400;700`, `Roboto Flex:opsz,wght@8..144,100..1000`, `Open Sans:400,700italic`. */
const SPEC = /^[A-Za-z0-9][A-Za-z0-9 ]*(:[A-Za-z0-9,;@.-]+)?$/
const specName = (spec: string): string => spec.split(':')[0].trim().replace(/\s+/g, ' ')
const specParam = (spec: string): string => spec.trim().replace(/\s+/g, '+')

/**
 * Reads what someone pasted: a fonts.google.com/specimen/<Name> page, a share link, a
 * fonts.googleapis.com css2 (or older css) stylesheet link, the `<link>` or `@import` embed code
 * around one, a family spec like `Inter:wght@400;700`, or plain family names. Null when it is
 * none of these.
 */
export function parseGoogleFontsInput(input: string): GoogleFontsRequest | null {
  const text = input.trim().replace(/&amp;/g, '&')
  if (!text) return null
  const link =
    /(?:https?:)?(?:\/\/)?(fonts\.googleapis\.com|fonts\.google\.com)(\/[^\s"'<>()]*)?/i.exec(text)
  if (link) {
    let url: URL
    try {
      url = new URL(`https://${link[1].toLowerCase()}${link[2] ?? '/'}`)
    } catch {
      return null
    }
    const families = (specs: string[]): string[] => [...new Set(specs.map(specName))]
    if (url.hostname === 'fonts.googleapis.com') {
      const v1 = url.pathname.replace(/\/$/, '') === '/css'
      if (!v1 && url.pathname.replace(/\/$/, '') !== '/css2') return null
      // the older API lists families in one parameter, split by |
      const specs = url.searchParams
        .getAll('family')
        .flatMap((f) => (v1 ? f.split('|') : [f]))
        .map((f) => f.trim())
        .filter(Boolean)
      if (!specs.length || !specs.every((s) => SPEC.test(s))) return null
      const query = v1
        ? `family=${specs.map(specParam).join('|')}`
        : specs.map((s) => `family=${specParam(s)}`).join('&')
      return {
        kind: 'css',
        url: `https://fonts.googleapis.com/${v1 ? 'css' : 'css2'}?${query}&display=swap`,
        families: families(specs)
      }
    }
    const specimen = /\/specimen\/([^/?#]+)/.exec(url.pathname)
    if (specimen) {
      const name = specName(decodeURIComponent(specimen[1].replace(/\+/g, ' ')))
      return SPEC.test(name) ? { kind: 'family', families: [name] } : null
    }
    // share links: fonts.google.com/share?selection.family=Inter:wght@400;700|Anton
    const selection = url.searchParams.get('selection.family')
    if (selection) {
      const specs = selection
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
      if (!specs.length || !specs.every((s) => SPEC.test(s))) return null
      return {
        kind: 'css',
        url: `https://fonts.googleapis.com/css2?${specs.map((s) => `family=${specParam(s)}`).join('&')}&display=swap`,
        families: families(specs)
      }
    }
    return null
  }
  const bare = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/\+/g, ' ')
  if (bare.includes(':')) {
    const spec = bare.trim()
    return SPEC.test(spec)
      ? {
          kind: 'css',
          url: `https://fonts.googleapis.com/css2?family=${specParam(spec)}&display=swap`,
          families: [specName(spec)]
        }
      : null
  }
  const names = bare
    .split(/[,|]/)
    .map((n) => n.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  return names.length && names.every((n) => SPEC.test(n))
    ? { kind: 'family', families: [...new Set(names)] }
    : null
}

/** The weights Luca asks for when nobody said which: regular for reading, bold to black for captions. */
export const GOOGLE_WEIGHTS = '400;700;800;900'

/**
 * Stylesheet links to try in order for a family name. Google Fonts answers 400 when none of the
 * asked weights exist (the plain link then gets whatever the family has) and names are
 * case-sensitive, so "bebas neue" is also tried as "Bebas Neue" and "dm sans" as "DM Sans".
 */
export function familyCssUrls(name: string): string[] {
  const title = name.replace(/\b[a-z]/g, (c) => c.toUpperCase())
  const acronyms = title.replace(/\b[A-Za-z]{2,3}\b/g, (w) =>
    /[aeiou]/i.test(w.slice(1)) && w.length === 3 ? w : w.toUpperCase()
  )
  const urls: string[] = []
  for (const n of new Set([name, title, acronyms])) {
    const p = specParam(n)
    urls.push(`https://fonts.googleapis.com/css2?family=${p}:wght@${GOOGLE_WEIGHTS}&display=swap`)
    urls.push(`https://fonts.googleapis.com/css2?family=${p}&display=swap`)
  }
  return urls
}

/** One @font-face of a Google Fonts stylesheet. */
export type GoogleFontFace = {
  family: string
  italic: boolean
  weight: number
  /** Upper end of a variable font's weight range ("100 1000"). */
  weightMax?: number
  url: string
  unicodeRange?: string
  /** The script it covers, from the comment above it ("latin", "latin-ext", "cyrillic"…). */
  subset?: string
}

/** Every @font-face in a Google Fonts stylesheet, with the subset comment each one follows. */
export function parseFontFaces(css: string): GoogleFontFace[] {
  const out: GoogleFontFace[] = []
  const re = /(?:\/\*\s*([^*]+?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    const decl = (name: string): string | undefined =>
      new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(m![2])?.[1].trim()
    const family = decl('font-family')?.replace(/^["']|["']$/g, '')
    const url = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/.exec(decl('src') ?? '')?.[1]
    if (!family || !url) continue
    const [lo, hi] = (decl('font-weight') ?? '400').split(/\s+/).map(Number)
    out.push({
      family,
      italic: /italic|oblique/i.test(decl('font-style') ?? ''),
      weight: lo || 400,
      ...(hi && hi !== lo ? { weightMax: hi } : {}),
      url,
      ...(decl('unicode-range') ? { unicodeRange: decl('unicode-range') } : {}),
      ...(m[1] ? { subset: m[1].trim() } : {})
    })
  }
  return out
}

/**
 * The faces worth keeping: Latin and Latin Extended cover English and most European languages
 * at a few dozen KB per weight. Stylesheets without subset comments are kept whole; a family
 * with no Latin at all keeps everything unless that is more files than is sensible.
 */
export function keepFontSubsets(faces: GoogleFontFace[]): GoogleFontFace[] {
  return [...new Set(faces.map((f) => f.family))].flatMap((family) => {
    const all = faces.filter((f) => f.family === family)
    if (!all.some((f) => f.subset)) return all
    const latin = all.filter((f) => f.subset === 'latin' || f.subset === 'latin-ext')
    if (latin.length) return latin
    return all.length <= 24 ? all : []
  })
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
    accent: undefined,
    overrides: undefined
  }
}

const FAMILY = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u
const oneOf = <T extends string>(v: unknown, ok: readonly T[], fallback: T): T =>
  ok.includes(v as T) ? (v as T) : fallback

/** A config from outside (the renderer, the agent) with every field checked before it is written. */
export function cleanCaptionConfig(raw: Partial<CaptionConfig>): CaptionConfig {
  const s = captionStyle(String(raw.style ?? ''))
  const font = typeof raw.font === 'string' ? raw.font.trim().replace(/\s+/g, ' ') : ''
  const accent = safeColor(raw.accent)
  const overrides = cleanOverrides(raw.overrides)
  return {
    style: s.id,
    font: FAMILY.test(font) ? font : s.font,
    size: oneOf(raw.size, ['sm', 'md', 'lg'], 'md'),
    position: oneOf(raw.position, ['bottom', 'middle', 'top'], 'bottom'),
    wordsPerLine: oneOf(raw.wordsPerLine, ['short', 'normal', 'long'], s.words),
    uppercase: typeof raw.uppercase === 'boolean' ? raw.uppercase : s.uppercase,
    clean: raw.clean !== false,
    ...(accent ? { accent } : {}),
    ...(overrides ? { overrides } : {})
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

// ------------------------------------------------------------------ transcript → timeline

/**
 * One clip playing the transcribed media: where it starts in the video, the trim offset into the
 * file, how long it plays and how fast.
 */
export type SpeechClip = { start: number; mediaStart: number; duration: number; rate?: number }

/**
 * Transcript words (file time) in video time, across every clip that plays the file: a word shows
 * wherever a clip plays its start, words in trimmed-off or deleted parts drop out, and a word two
 * clips play at the same moment (a video and its own audio) shows once.
 */
export function placeWords(words: TimedWord[], clips: SpeechClip[]): TimedWord[] {
  const out: (TimedWord & { i: number })[] = []
  const seen = new Set<string>()
  for (const c of clips) {
    const rate = c.rate && c.rate > 0 ? c.rate : 1
    const end = c.start + c.duration
    words.forEach((w, i) => {
      const at = c.start + (w.start - c.mediaStart) / rate
      if (at < c.start - 1e-3 || at >= end - 1e-3) return
      const key = `${i}@${Math.round(at * 20)}`
      if (seen.has(key)) return
      seen.add(key)
      const to = Math.min(end, c.start + (w.end - c.mediaStart) / rate)
      out.push({ text: w.text, start: round(Math.max(c.start, at)), end: round(to), i })
    })
  }
  return out
    .sort((a, b) => a.start - b.start || a.i - b.i)
    .map(({ text, start, end }) => ({ text, start, end }))
}
