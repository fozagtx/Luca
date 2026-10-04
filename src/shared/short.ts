/**
 * Sunroom, Luca's tutorial-short template: a person explains a tool to camera and the edit cuts
 * between three layouts on the words — the speaker filling the frame (full), sharing it with a
 * graphic on cream paper above them (split), or stepping aside for one (graphic). The structure
 * (where the speaker is, the paper, a slot for each graphic, where captions sit) is code; Luca
 * only chooses the beats and builds the graphics. Shared by main (the short_layout tool, the
 * captions that follow the layout) and the start card.
 */
import { HYPERFRAMES } from './hyperframes'
import type { ShortLayout } from './types'

export type { ShortLayout }

/** One beat as Luca chooses it: a stretch of the cut video and how the speaker shows on it. */
export type ShortBeat = {
  /** Seconds on the timeline. */
  start: number
  end: number
  layout: ShortLayout
  /** Captions show on this beat (default true): false when its headline already says the words. */
  caption?: boolean
  /** Full beats: how far the shot is punched in, 1–1.6 (default: 1.15 and 1 in turn). */
  zoom?: number
  /** Full beats: give it a slot for a sticker over the speaker. */
  sticker?: boolean
  /** What the beat's graphic shows, in a few words; kept in its file. */
  note?: string
  /** A ready-made graphic short_layout builds in the beat's slot, timed to the words. */
  graphic?: ShortGraphic
}

/** One of the template's ready-made graphics, with its own words. */
export type ShortGraphic = {
  kind: GraphicKind
  /** Graphic beats: the big serif headline at the top (the key words said), and its lighter line. */
  headline?: string
  sub?: string
  /** The graphic's name for itself: a file, folder, address, app or product name, a keyword. */
  label?: string
  /** Its rows in order: lines in a terminal, files, points, cards, nodes, chips. */
  items?: string[]
  /** When each item lands, in seconds on the timeline; by default on the word that starts it. */
  at?: number[]
}

/** The ready-made graphics: for split and graphic beats, then stickers for full beats. */
export const GRAPHICS = {
  phone: 'an app on a phone (label: the app; items: what its screen lists)',
  browser: 'a website in a browser (label: its address; items: its headline, then its button)',
  terminal: 'a terminal: the first item typed as a command, the others printed as steps done',
  doc: 'a file card such as SKILL.md (label: the file; items: its lines, "key: value")',
  files: 'file chips flying into a folder (label: the folder; items: the files)',
  folder: 'a folder’s files listed one by one (label: the folder; items: the files)',
  progress: 'a render: a strip of frames and a bar running to 100% (label: the file made)',
  checklist: 'numbered cards with a picture and serif words, checked as each is said (items: 2–4)',
  tiles: 'tall numbered cards dealt like a deck, one per item (items: 2–5)',
  clock: 'a clock with spinning hands: time passing, hours lost (label: words under it)',
  editor: 'a video editor whose clips build up as the playhead runs (label: the file)',
  video:
    'the finished video: a player card with a play button (label: the product; items: its tagline)',
  share: 'a video card over a share sheet: sending it to people (label: the product)',
  follow: 'a Follow button a cursor clicks into Following (items: topic chips under it)',
  graph: 'a node linked to others around it (label: the center; items: the nodes)',
  slides: 'a pile of half-made slides, a cursor and a question mark: not knowing how to present',
  link: 'a link card: the product, its link, sent to your DMs (label: the product)',
  tag: 'sticker: a price tag beside the head (label: "$0")',
  pill: 'sticker: a /keyword pill under the caption (label: the keyword)',
  comment: 'sticker: a comment box under the caption typing the keyword (label: the word)',
  notify: 'sticker: a New message notification sliding in at the top (items: its line)',
  bookmark: 'sticker: a bookmark beside the head that fills and says Saved',
  timer: 'sticker: a small clock beside the head (minutes, time)'
} as const

export type GraphicKind = keyof typeof GRAPHICS

export const GRAPHIC_KINDS = Object.keys(GRAPHICS) as GraphicKind[]

/** The kinds that are stickers over the speaker, for full beats. */
export const STICKERS: GraphicKind[] = ['tag', 'pill', 'comment', 'notify', 'bookmark', 'timer']

/** Where the speaker's face is in the frame, as fractions of its width and height. */
export type ShortFace = { x: number; y: number }

/** .luca/short.json: the layout on the timeline, which the captions follow, and its theme. */
export type ShortPlan = {
  version: 1
  beats: ShortBeat[]
  face: ShortFace
  palette?: ShortPaletteInput
  fonts?: ShortFonts
}

export const SUNROOM = {
  name: 'Sunroom',
  /** The caption look made for it (src/shared/captions.ts). */
  captionStyle: 'sunroom',
  /** Ink for captions on the paper when no theme is on the page. */
  ink: '#16130F',
  /** Top edge of the speaker card in split, as a fraction of the frame height. */
  cardTop: 0.52,
  /** The card's top corners, px for a 1080 px wide frame. */
  radius: 60,
  /** Where the bottom of a caption line sits on each layout, as a fraction of the height. */
  captionFloor: { full: 0.715, split: 0.497, graphic: 0.8 } as Record<ShortLayout, number>,
  /** Split: where the face lands in the card, as a fraction of the card's height. */
  faceInCard: 0.5,
  /** Full beats drift in by this much over the beat, so a held shot never freezes. */
  push: 0.03
}

export const DEFAULT_FACE: ShortFace = { x: 0.5, y: 0.4 }

/** Shortest beat Luca may lay out, in seconds. */
export const MIN_BEAT = 0.5
export const MAX_BEATS = 150
/** Beats meant to be this long or shorter; longer ones get a warning. */
const LONG_BEAT = 5.5
/** Gaps shorter than this between two beats are closed: they would flash the speaker for a frame. */
const SNAP_GAP = 0.25

const r3 = (n: number): number => Math.round(n * 1000) / 1000

/** The layout at a time: the beat it falls in, or full where no beat covers it. */
export function layoutAt(beats: ShortBeat[], t: number): ShortLayout {
  return beats.find((b) => t >= b.start - 1e-3 && t < b.end - 1e-3)?.layout ?? 'full'
}

/** The beat a time falls in, if any. */
export function beatAt(beats: ShortBeat[], t: number): ShortBeat | undefined {
  return beats.find((b) => t >= b.start - 1e-3 && t < b.end - 1e-3)
}

export type CheckedBeats =
  | { ok: true; beats: ShortBeat[]; notes: string[]; warnings: string[] }
  | { ok: false; error: string }

const at = (n: number): string => `${n.toFixed(2)} s`

/**
 * Beats as Luca sent them, checked against the video's length: in order, not overlapping, at
 * least MIN_BEAT long and inside the video. Tiny gaps close and ends past the video clip to it
 * (both noted); anything else wrong is an error that says which beat and how to fix it.
 */
export function checkBeats(raw: ShortBeat[], duration: number): CheckedBeats {
  if (!raw.length)
    return { ok: false, error: 'No beats: pass at least one, from 0 s to the end of the video.' }
  if (raw.length > MAX_BEATS)
    return { ok: false, error: `${raw.length} beats is too many; ${MAX_BEATS} at most.` }
  if (!(duration > 0)) return { ok: false, error: 'The video has no length yet.' }
  const notes: string[] = []
  const warnings: string[] = []
  const beats: ShortBeat[] = []
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i]
    const n = i + 1
    if (!Number.isFinite(b.start) || !Number.isFinite(b.end))
      return { ok: false, error: `Beat ${n} needs a start and an end in seconds.` }
    let start = b.start < 0 && b.start > -0.1 ? 0 : b.start
    let end = b.end
    if (start < 0) return { ok: false, error: `Beat ${n} starts before 0 s.` }
    if (start >= duration)
      return {
        ok: false,
        error: `Beat ${n} starts at ${at(start)}, after the video ends (${at(duration)}). Times are on the cut timeline: use the times transcribe or clean_edit returned last.`
      }
    if (end <= start)
      return { ok: false, error: `Beat ${n} ends (${at(end)}) before it starts (${at(start)}).` }
    if (end > duration) {
      if (end - duration > 0.5)
        notes.push(`Beat ${n} ran past the end of the video, so it ends there (${at(duration)}).`)
      end = duration
    }
    const prev = beats[beats.length - 1]
    if (prev) {
      if (start < prev.start - 1e-3)
        return {
          ok: false,
          error: `Beat ${n} (${at(start)}) comes before beat ${n - 1} (${at(prev.start)}): list the beats in time order.`
        }
      if (start < prev.end - 0.02)
        return {
          ok: false,
          error: `Beat ${n} starts at ${at(start)}, before beat ${n - 1} ends at ${at(prev.end)}: beats can't overlap. End beat ${n - 1} where beat ${n} starts.`
        }
      // a sliver between two beats would show the speaker full frame for a frame or two
      if (start - prev.end < SNAP_GAP) {
        if (start - prev.end > 0.02) notes.push(`Closed the gap before beat ${n}.`)
        prev.end = start = r3(Math.max(prev.end, start))
        if (prev.end - prev.start < MIN_BEAT - 1e-3)
          return {
            ok: false,
            error: `Beat ${n - 1} is ${(prev.end - prev.start).toFixed(2)} s long; beats need at least ${MIN_BEAT} s. Merge it into the beat before or after it.`
          }
      }
    } else if (start > 0 && start < SNAP_GAP) start = 0
    if (end - start < MIN_BEAT - 1e-3)
      return {
        ok: false,
        error: `Beat ${n} (${at(start)}–${at(end)}) is ${(end - start).toFixed(2)} s long; beats need at least ${MIN_BEAT} s. Merge it into the beat before or after it.`
      }
    const beat: ShortBeat = { start: r3(start), end: r3(end), layout: b.layout }
    if (b.caption === false) beat.caption = false
    if (b.layout === 'full') {
      if (typeof b.zoom === 'number' && Number.isFinite(b.zoom))
        beat.zoom = Math.round(Math.min(1.6, Math.max(1, b.zoom)) * 100) / 100
      if (b.sticker) beat.sticker = true
    }
    const note = b.note?.replace(/\s+/g, ' ').trim().slice(0, 140)
    if (note) beat.note = note
    if (b.graphic) {
      const g = checkGraphic(b.graphic, b.layout)
      if (typeof g === 'string') return { ok: false, error: `Beat ${n}: ${g}` }
      beat.graphic = g
      if (b.layout === 'full') beat.sticker = true
    }
    if (end - start > LONG_BEAT)
      warnings.push(
        `Beat ${n} is ${(end - start).toFixed(1)} s long: split it, so something new lands every 1.5–4 s.`
      )
    beats.push(beat)
  }
  // the reference cuts to the paper often: about 4 in 10 seconds are graphic beats
  const time = (l: ShortLayout): number =>
    beats.filter((b) => b.layout === l).reduce((t, b) => t + b.end - b.start, 0)
  if (duration > 12 && time('graphic') < duration * 0.25)
    warnings.push(
      `Only ${Math.round((time('graphic') / duration) * 100)} % of the video is graphic beats; the template runs about 40 % graphic, 30 % split and 30 % full. Turn a few explaining beats into graphic ones (a headline and a graphic).`
    )
  const last = beats[beats.length - 1]
  if (duration - last.end > 0.5)
    notes.push(`From ${at(last.end)} to the end the speaker fills the frame (no beat covers it).`)
  return { ok: true, beats, notes, warnings }
}

const words = (v: unknown, max: number): string | undefined => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
  return s || undefined
}

/** A beat's graphic as Luca asked for it, cleaned up, or why it can't be made. */
function checkGraphic(raw: ShortGraphic, layout: ShortLayout): ShortGraphic | string {
  const kind = raw.kind
  if (!GRAPHIC_KINDS.includes(kind))
    return `there is no ready-made graphic called “${String(kind)}”. The kinds are ${GRAPHIC_KINDS.join(', ')}.`
  const sticker = STICKERS.includes(kind)
  if (layout === 'full' && !sticker)
    return `a full beat shows the speaker, so its graphic is a sticker (${STICKERS.join(', ')}); make it a split or graphic beat for a ${kind}.`
  if (layout !== 'full' && sticker)
    return `${kind} is a sticker over the speaker, for a full beat; on a ${layout} beat use one of ${GRAPHIC_KINDS.filter((k) => !STICKERS.includes(k)).join(', ')}.`
  const g: ShortGraphic = { kind }
  const headline = words(raw.headline, 48)
  const sub = words(raw.sub, 48)
  const label = words(raw.label, 60)
  if (headline) g.headline = headline
  if (sub) g.sub = sub
  if (label) g.label = label
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((i) => words(i, 120))
    .filter((i): i is string => !!i)
    .slice(0, 6)
  if (items.length) g.items = items
  const at = (Array.isArray(raw.at) ? raw.at : []).filter((t) => Number.isFinite(t)).slice(0, 6)
  if (at.length) g.at = at.map(r3)
  return g
}

/** The beats as the stage reads them: "s:0:2.5;g:2.5:4;f:4:6". */
export function encodeBeats(beats: ShortBeat[]): string {
  return beats.map((b) => `${b.layout[0]}:${b.start}:${b.end}`).join(';')
}

/** Where the footage is on one stretch of time: its GSAP transform from `start` for `duration`. */
export type SpeakerState = {
  start: number
  duration: number
  x: number
  y: number
  scale: number
  /** Scale at the end of the stretch (a slow push on full beats). */
  to: number
  origin: string
}

/**
 * Where the footage sits on every stretch of the video, beats and the time between them (full),
 * in composition px. Full: punched in about the face, drifting in slowly. Split: the face lifted
 * into the card below the paper, the footage still covering the card edge to edge. Graphic: left
 * as it is under the paper.
 */
export function speakerStates(
  beats: ShortBeat[],
  opts: { duration: number; width: number; height: number; face: ShortFace }
): SpeakerState[] {
  const { width: W, height: H, face } = opts
  const fx = Math.min(0.9, Math.max(0.1, face.x))
  const fy = Math.min(0.9, Math.max(0.05, face.y))
  const out: SpeakerState[] = []
  let fullCount = 0
  const full = (start: number, end: number, zoom?: number): void => {
    const z = zoom ?? (fullCount % 2 === 0 ? 1.15 : 1)
    fullCount++
    out.push({
      start,
      duration: r3(end - start),
      x: 0,
      y: 0,
      scale: z,
      to: r3(z * (1 + SUNROOM.push)),
      origin: `${r3(fx * 100)}% ${r3(fy * 100)}%`
    })
  }
  const split = (start: number, end: number): void => {
    const top = SUNROOM.cardTop
    const target = top + (1 - top) * SUNROOM.faceInCard
    // an off-center face moves to the middle, so the footage grows enough to keep both edges covered
    const s = Math.min(1.6, Math.max(1, 1 / (1 - 2 * Math.abs(fx - 0.5))))
    const reach = ((s - 1) * W) / 2
    const x = Math.max(-reach, Math.min(reach, -s * (fx - 0.5) * W))
    const y = Math.max(H * (1 - s), Math.min(top * H, target * H - s * fy * H))
    out.push({
      start,
      duration: r3(end - start),
      x: Math.round(x),
      y: Math.round(y),
      scale: r3(s),
      to: r3(s),
      origin: '50% 0%'
    })
  }
  const hidden = (start: number, end: number): void => {
    out.push({ start, duration: r3(end - start), x: 0, y: 0, scale: 1, to: 1, origin: '50% 50%' })
  }
  let cursor = 0
  for (const b of beats) {
    if (b.start > cursor + 1e-3) full(cursor, b.start)
    if (b.layout === 'full') full(b.start, b.end, b.zoom)
    else if (b.layout === 'split') split(b.start, b.end)
    else hidden(b.start, b.end)
    cursor = b.end
  }
  if (opts.duration > cursor + 1e-3) full(cursor, opts.duration)
  return out
}

// ------------------------------------------------------------------ the theme

/** The four colors a palette is made of; everything else is worked out from them. */
export type ShortColors = { paper: string; ink: string; accent: string; card: string }

export type ShortPalettePreset = { id: string; name: string; blurb: string; colors: ShortColors }

/**
 * The palettes that come with the template. Sunroom is the reference's own look and the default;
 * every one keeps captions and ink readable on its paper (ink at least 11:1, the lighter headline
 * line at least 3:1, the accent at least 3.5:1).
 */
export const PALETTES: ShortPalettePreset[] = [
  {
    id: 'sunroom',
    name: 'Sunroom',
    blurb: 'Warm cream paper, near-black ink, terracotta',
    colors: { paper: '#F2ECE7', ink: '#16130F', accent: '#C8553A', card: '#FFFBF5' }
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    blurb: 'Cool off-white, blue-black ink, cobalt',
    colors: { paper: '#EDF0F4', ink: '#101827', accent: '#2B54E0', card: '#FFFFFF' }
  },
  {
    id: 'sage',
    name: 'Sage',
    blurb: 'Sage paper, forest ink, deep green',
    colors: { paper: '#E2E8DC', ink: '#1B2B21', accent: '#2E6347', card: '#F8FAF5' }
  },
  {
    id: 'night',
    name: 'Night',
    blurb: 'Charcoal paper, light ink, apricot',
    colors: { paper: '#1D1B19', ink: '#F2ECE4', accent: '#F08A57', card: '#2A2724' }
  },
  {
    id: 'blush',
    name: 'Blush',
    blurb: 'Blush paper, plum ink and plum',
    colors: { paper: '#F5E6E3', ink: '#2B1621', accent: '#8A2F62', card: '#FFF8F6' }
  }
]

export const DEFAULT_PALETTE = 'sunroom'

/** What Luca asks for: a preset, and any of its colors replaced (a brand color as the accent). */
export type ShortPaletteInput = { preset?: string } & Partial<ShortColors>

/** The type pairing: a sans for captions and UI, an italic serif for headlines and emphasis. */
export type ShortFonts = { sans?: string; serif?: string }

export const DEFAULT_FONTS = { sans: 'Inter', serif: 'Instrument Serif' }

export function palettePreset(id: string | undefined): ShortPalettePreset {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

/** "#abc" or "#aabbcc" (any case) as "#AABBCC", or null. */
export function hexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${h.toUpperCase()}`
}

const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two colors, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `a` moved `t` of the way to `b`. */
export function mixColor(a: string, b: string, t: number): string {
  const A = channels(a)
  const B = channels(b)
  return `#${A.map((v, i) =>
    Math.round(v + (B[i] - v) * t)
      .toString(16)
      .padStart(2, '0')
  )
    .join('')
    .toUpperCase()}`
}

const rgba = (hex: string, alpha: number): string => `rgba(${channels(hex).join(', ')}, ${alpha})`

/** The more readable of near-black and near-white on `bg`. */
const readable = (bg: string): string =>
  contrast('#16130F', bg) >= contrast('#FBF8F4', bg) ? '#16130F' : '#FBF8F4'

const FAMILY = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u

export type ShortTheme = {
  preset: string
  colors: ShortColors
  fonts: { sans: string; serif: string }
  /** Every token as `--sr-…: value`, for :root. */
  tokens: Record<string, string>
  /** What was adjusted to keep it readable, or worth knowing. */
  notes: string[]
}

/**
 * The theme for a palette (a preset, any colors replaced) and fonts: the colors as tokens the
 * stage, the graphic kit and the captions all read, so changing them recolors everything at once.
 * Ink that would be hard to read on the paper is swapped for one that isn't (and said so).
 */
export function resolveTheme(input?: ShortPaletteInput, fonts?: ShortFonts): ShortTheme {
  const preset = palettePreset(input?.preset)
  const notes: string[] = []
  if (input?.preset && preset.id !== input.preset)
    notes.push(`There is no “${input.preset}” palette, so this uses ${preset.name}.`)
  const own = (k: keyof ShortColors): string | null => {
    const v = input?.[k]
    if (v === undefined) return null
    const hex = hexColor(v)
    if (!hex) notes.push(`“${v}” is not a hex color, so the ${k} stays ${preset.colors[k]}.`)
    return hex
  }
  const paper = own('paper') ?? preset.colors.paper
  const dark = luminance(paper) < 0.18
  let ink = own('ink') ?? (input?.paper ? readable(paper) : preset.colors.ink)
  if (contrast(ink, paper) < 4.5) {
    const fixed = readable(paper)
    notes.push(
      `The ink ${ink} is hard to read on ${paper} (${contrast(ink, paper).toFixed(1)}:1), so text on the paper is ${fixed}.`
    )
    ink = fixed
  }
  const accent = own('accent') ?? preset.colors.accent
  if (contrast(accent, paper) < 2.2)
    notes.push(
      `The accent ${accent} is faint on ${paper} (${contrast(accent, paper).toFixed(1)}:1): fills and badges still read, thin accent lines less so. A deeper shade of it would stand out more.`
    )
  const card =
    own('card') ??
    (input?.paper || input?.ink
      ? dark
        ? mixColor(paper, '#FFFFFF', 0.07)
        : mixColor(paper, '#FFFFFF', 0.75)
      : preset.colors.card)
  const cardInk = contrast(ink, card) >= 4.5 ? ink : readable(card)
  const font = (v: string | undefined, fallback: string, kind: string): string => {
    const name = v?.trim().replace(/\s+/g, ' ')
    if (!name) return fallback
    if (FAMILY.test(name)) return name
    notes.push(`“${v}” is not a font name, so the ${kind} stays ${fallback}.`)
    return fallback
  }
  const sans = font(fonts?.sans, DEFAULT_FONTS.sans, 'sans')
  const serif = font(fonts?.serif, DEFAULT_FONTS.serif, 'serif')
  const shade = dark ? '#000000' : ink
  const tokens: Record<string, string> = {
    '--sr-paper': paper,
    '--sr-ink': ink,
    '--sr-ink-soft': mixColor(ink, paper, 0.45),
    '--sr-accent': accent,
    '--sr-on-accent': readable(accent),
    '--sr-card': card,
    '--sr-card-ink': cardInk,
    '--sr-line': rgba(cardInk, dark ? 0.16 : 0.12),
    '--sr-shade': shade,
    '--sr-shade-strength': dark ? '2.4' : '1',
    '--sr-glow': dark ? 'rgba(255, 240, 220, 0.07)' : 'rgba(255, 252, 246, 0.6)',
    '--sr-shadow': dark
      ? '0 34px 60px -26px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.04)'
      : `0 34px 60px -30px ${rgba(shade, 0.4)}, 0 2px 6px ${rgba(shade, 0.07)}`,
    '--sr-term': dark ? mixColor(paper, '#000000', 0.45) : mixColor(ink, '#000000', 0.1),
    '--sr-sans': `'${sans}', 'Inter', sans-serif`,
    '--sr-serif': `'${serif}', 'Instrument Serif', serif`,
    '--sr-mono': `'JetBrains Mono', monospace`
  }
  return {
    preset: preset.id,
    colors: { paper, ink, accent, card },
    fonts: { sans, serif },
    tokens,
    notes
  }
}

/** The theme as a :root rule. */
export function themeCss(theme: ShortTheme): string {
  return `:root {\n${Object.entries(theme.tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}`
}

// ------------------------------------------------------------------ the guide

/**
 * The template as Luca follows it: written to .luca/TEMPLATE.md when a project starts from it and
 * into the first request, so later turns keep to it. The structure is the short_layout tool's;
 * this says what Luca decides (beats, palette, graphics, emphasis) and how.
 */
export const SUNROOM_GUIDE = `# Sunroom: the tutorial-short template

This video is a Sunroom short: a person explains a tool or a how-to to camera, and the edit cuts, on the words, between three layouts, with a clean UI graphic for nearly every point. The short_layout tool makes the structure (where the speaker is, the paper, a slot per graphic, where captions sit) and builds ready-made graphics in the slots; you choose the beats, the palette and each beat's graphic and its words. Keep every edit in this template unless the user asks otherwise.

## The look
- Paper: one flat paper color with soft leaf shadows drifting across it, like dappled window light. The stage draws it; never draw a background of your own.
- Type: a bold, tightly set sans for captions and UI words; a large italic serif for headlines and the one key word of a sentence; a monospace for small labels, file names and code.
- Graphics: big, flat, clean, light UI mock-ups (a phone, a browser, a terminal, file chips and folders, a progress bar, checklist cards, a clock, a share sheet, a Follow button) that fill the paper, one accent color for badges, playheads, progress bars, check marks and stickers. No gradients on UI, no glows, no 3D, no emoji.
- Captions: 1–4 words at a time, each line blurring into focus as it is said; the key word in the italic serif on its own row.

## The three layouts
- full: the speaker fills the frame, punched in a little (1.15× and 1× in turn, or zoom), drifting in slowly. White captions about 70 % down. Stickers beside the head when the words call for one.
- split: the paper covers the top half with one graphic of what is being said; the speaker is in a full-width card below it with rounded top corners; the caption sits on the paper just above the card, in the ink color.
- graphic: no speaker, the whole frame is paper: a big italic-serif headline at the top (1–4 key words in lowercase, as they are said: “the crazy part”, “no idea”; a lighter second line under it with the words said next) AND a graphic under it. Never a headline alone on empty paper. Captions sit low (about 75–80 % down); pass caption: false when the headline already says the words.
- Layouts change with a hard cut on a word; nothing slides between them. What is new animates in just after the cut.

## Pacing
- A new beat every 1.5–4 s (never over 5 s), so a new graphic lands every 1.5–3 s. Cut at the start of a word, using the word times transcribe gave (after the clean edit). Beats run back to back from 0 s to the end of the video.
- About 4 in 10 seconds graphic, 3 split, 3 full. Graphic for a concept, a list, a number, a before and after, "the crazy part"; split for explaining something that has a picture; full for feelings, asides, jokes and the call to action. The speaker is never off screen for more than about 6 s.
- The hook: the first beat starts at 0 s and is a split (or graphic) beat whose graphic shows what the video is about within half a second (the app on a phone, the site in a browser, the result).
- The ending: the last 3–8 s are mostly full beats with stickers for what is asked: comment on "comment …", notify on "I'll send it", a follow beat (split) on "follow", bookmark on "save this". It ends on the last word: no outro card.

## Ready-made graphics
Give every split and graphic beat a graphic in short_layout: {kind, headline?, sub?, label?, items?, at?}. The tool builds it in the beat's slot, sized for the layout, in the theme's colors, every item landing on the word that starts it (or at the times in at). The words are yours: take them from what is said and from the brief (the product's name, its address, the command, the files, the points). headline and sub are for graphic beats.
${Object.entries(GRAPHICS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}
The ones marked sticker go on full beats (sticker: true is implied); the others on split and graphic beats. A slot without a graphic is empty for you to build in. A built slot is yours to edit (add a second state, a screenshot the user gave); once edited, calling short_layout again keeps it.

## The palette is a theme
- short_layout's palette sets the colors as tokens, which the paper, every graphic and the captions read. Presets: ${PALETTES.map((p) => `${p.id} (${p.blurb.toLowerCase()})`).join('; ')}. Or pass your own hex colors on top of one: paper, ink (text on the paper), accent, card (UI surfaces).
- Choose it from the user: a color they name, their brief, their product, logo or screenshots (their brand color becomes the accent; keep the paper light unless the brand is dark). Use ${DEFAULT_PALETTE} only when nothing suggests a color. The reference this template came from showed its creator's green product: that was their branding, not the format, so never pick a color because of it.
- In a graphic you write yourself every color is a token, never a hex value: var(--sr-paper), var(--sr-ink), var(--sr-ink-soft) (lighter text, a headline's second line), var(--sr-accent), var(--sr-on-accent) (text on the accent), var(--sr-card) and var(--sr-card-ink) (UI surfaces and their text), var(--sr-line) (hairlines), and the fonts var(--sr-sans), var(--sr-serif), var(--sr-mono). Mixes are fine: color-mix(in srgb, var(--sr-accent) 30%, var(--sr-card)). Screenshots and logos the user gave keep their own colors.
- When the user asks later ("make it blue", "use my brand color #6C5CE7", "a darker background"), call short_layout with only palette (and fonts if asked): the beats and graphics stay and everything recolors. Darker means the night preset or a dark paper with a light ink. The tool keeps text readable and says what it adjusted.
- fonts: {sans, serif} swaps the pairing for any font that comes with Luca or a Google Fonts family (default Inter and Instrument Serif italic). Keep a bold sans with an italic serif.

## Order of work
1. transcribe (and clean_edit when the plan asks for it), so the words and their times are final.
2. Look at the footage (\`npx ${HYPERFRAMES} snapshot --at 1\`) and note where the face is: its center (about the nose) as fractions of the frame's width and height.
3. Read the words and choose the beats, each with its graphic: [{start, end, layout, caption?, zoom?, graphic: {kind, headline?, sub?, label?, items?}}].
4. Choose the palette (above).
5. Call short_layout {beats, face, palette}. It returns the slots: built ones, and empty ones (a beat without a graphic) for you to build.
6. Build the empty slots, if any (Building a beat, below). These graphics come from this template, not the catalog: use catalog_search only for something none of them shows (a chart, a map).
7. captions_apply {style: "sunroom", emphasis: [3–8 key words or short phrases, with the time each is said]}. The captions follow the layout by themselves; never move them by hand.
8. Lint, then snapshot a frame of each layout and the first 0.3 s after two cuts; fix cut-off text, overlaps with the face or the caption, empty paper, text too small to read on a phone.
9. Reply in 2–4 short lines, no lists: what you made, the palette and why, and that they can ask for another palette or font.

## Building a beat
- A slot file is a small composition: the root, #<slot>-area (its content box) and one paused timeline already registered. Put the markup inside the area and the tweens on that timeline; prefix every id with the slot id (#beat-03-card). Never move, crop or hide the footage or draw a background: the layout does that. Fill the area: a graphic 860–960 px wide, nothing smaller than 24 px text.
- Motion, all with fromTo on the slot's timeline, times from the beat's start (word time − beat start): a card enters {opacity: 0, y: 40, scale: 0.96, filter: 'blur(8px)'} → {opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.38, ease: 'power3.out'} at 0.04; headline words blur in ({opacity: 0, filter: 'blur(14px)'} → clear, 0.4 s) on the word that says them; things build up on the words that name them; stickers pop ({opacity: 0, scale: 0.6, rotation: -10} → 1, 0.32 s, 'back.out(1.8)'); a held graphic drifts (scale 1 → 1.02 over the beat). No exits: the cut ends the beat.
- The kit's classes (sr-…) are in index.html: .sr-stack, .sr-headline (.sr-sub, .sr-word), .sr-serif, .sr-bold, .sr-label, .sr-code; .sr-card, .sr-ph, .sr-slide, .sr-step (.sr-thumb), .sr-tile; .sr-pill (.dark .accent .big), .sr-button, .sr-check, .sr-tag, .sr-bookmark (.on), .sr-avatar, .sr-cursor, .sr-strike; .sr-phone > .sr-screen, .sr-browser > .sr-bar (three <i></i>, .sr-url) + .sr-page, .sr-terminal > .sr-bar + .sr-term (.sr-prompt, .sr-type, .sr-caret, .ok); .sr-app (a small app screen: .sr-app-top, .sr-app-hero with b and .sr-app-bars, .sr-app-row; size it with font-size), .sr-video (.sr-play), .sr-film > .sr-frame; .sr-chip, .sr-folder, .sr-list > .sr-file (.sr-icon); .sr-editor > .sr-viewer + .sr-tracks > .sr-track (.sr-clip, .sr-key) + .sr-playhead; .sr-progress > .sr-progress-row + .sr-bar-track > .sr-fill; .sr-clock > .sr-hand.h + .sr-hand.m; .sr-notify, .sr-share, .sr-input; svg.sr-links; .sr-sticker. A built slot shows how they fit together.`

/** A beat's slot id and file: beat-01 … in the order of the beats. */
export const slotId = (index: number): string => `beat-${String(index + 1).padStart(2, '0')}`
