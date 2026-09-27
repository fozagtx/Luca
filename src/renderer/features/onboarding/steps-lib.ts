import { nearestWeight } from '@shared/captions'
import { THEMES, type DesignTheme } from '@shared/styles'
import type { Aspect } from '@shared/types'
import { useEffect, useState, type CSSProperties } from 'react'
import { ensurePreviewFont } from '../captions/preview-lib'

/** What previews show while the theme is left to Luca. */
export const NEUTRAL_THEME: DesignTheme = {
  id: 'auto',
  name: 'Luca decides',
  blurb: '',
  bg: 'linear-gradient(135deg, #243042 0%, #111722 100%)',
  text: '#FFFFFF',
  accent: '#7DB4FF',
  accent2: '#33415A',
  dark: true,
  guide: ''
}

export function themeOf(id: string | undefined): DesignTheme {
  return THEMES.find((t) => t.id === id) ?? NEUTRAL_THEME
}

/** How the key word stands out in a theme: its accent colour, or a box when there is none. */
export function highlightOf(t: DesignTheme): CSSProperties {
  return t.accent.toLowerCase() === t.text.toLowerCase()
    ? { background: t.text, color: t.dark ? '#000' : '#fff', padding: '0 0.12em' }
    : { color: t.accent }
}

/** Tall, condensed display faces read best in capitals, the way short videos use them. */
const CAPS = new Set(['League Gothic', 'Oswald'])

export function fontStyle(family: string, weight = 800): CSSProperties {
  return {
    fontFamily: `'${family}', system-ui, sans-serif`,
    fontWeight: nearestWeight(family, weight),
    ...(CAPS.has(family) ? { textTransform: 'uppercase', letterSpacing: '0.01em' } : {})
  }
}

/** Loads a built-in font for previews (from Google Fonts, like Caption Studio). */
export function usePreviewFont(family: string | undefined): void {
  useEffect(() => {
    if (family) ensurePreviewFont(family)
  }, [family])
}

/** How a motion preview splits the words and plays each part's entrance. */
export type MotionFx = {
  split: 'line' | 'words' | 'letters'
  /** One part's entrance, in ms. */
  ms: number
  /** Delay between parts, in ms. */
  stagger: number
  /** An ease the motion always uses (typing is instant whatever the keyframes). */
  ease?: string
  /** The ease that suits it when the keyframes are left to Luca. */
  natural: string
}

export const MOTION_FX: Record<string, MotionFx> = {
  smooth: { split: 'line', ms: 800, stagger: 0, natural: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  pop: { split: 'words', ms: 460, stagger: 70, natural: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  kinetic: { split: 'words', ms: 300, stagger: 260, natural: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  slide: { split: 'line', ms: 720, stagger: 0, natural: 'cubic-bezier(0.65, 0, 0.35, 1)' },
  typewriter: { split: 'letters', ms: 10, stagger: 55, ease: 'steps(1, end)', natural: 'linear' },
  glitch: { split: 'line', ms: 520, stagger: 0, natural: 'linear' },
  cinematic: { split: 'line', ms: 1400, stagger: 0, natural: 'cubic-bezier(0.37, 0, 0.63, 1)' },
  bounce: { split: 'words', ms: 720, stagger: 90, natural: 'cubic-bezier(0.22, 1, 0.36, 1)' }
}

/** GSAP's elastic.out(1, 0.45). */
function elasticOut(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const p = 0.45
  return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1
}

type Curve = { css: string; points: [number, number][] }

/** A cubic-bezier's curve, traced along its own parameter (exact, no solving). */
function bezier(x1: number, y1: number, x2: number, y2: number): Curve {
  const at = (a: number, b: number, s: number): number =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3
  const points: [number, number][] = []
  for (let i = 0; i <= 40; i++) points.push([at(x1, x2, i / 40), at(y1, y2, i / 40)])
  return { css: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`, points }
}

function sampled(f: (t: number) => number, n = 48): Curve {
  const points: [number, number][] = []
  for (let i = 0; i <= n; i++) points.push([i / n, f(i / n)])
  return { css: `linear(${points.map(([, y]) => +y.toFixed(4)).join(', ')})`, points }
}

function stepped(n: number): Curve {
  const points: [number, number][] = [[0, 0]]
  for (let i = 1; i <= n; i++) points.push([i / n, (i - 1) / n], [i / n, i / n])
  return { css: `steps(${n}, end)`, points }
}

/** The keyframe styles (src/shared/styles.ts KEYFRAMES) as CSS eases and curves to draw. */
export const EASES: Record<string, Curve> = {
  natural: bezier(0.22, 1, 0.36, 1),
  snappy: bezier(0.16, 1, 0.3, 1),
  overshoot: bezier(0.34, 1.56, 0.64, 1),
  elastic: sampled(elasticOut),
  dreamy: bezier(0.37, 0, 0.63, 1),
  linear: {
    css: 'linear',
    points: [
      [0, 0],
      [1, 1]
    ]
  },
  stepped: stepped(6)
}

/** The CSS ease for a keyframe style; `linear()` falls back where it isn't supported. */
export function easeCss(id: string | undefined, fallback: string): string {
  const e = id ? EASES[id] : undefined
  if (!e) return fallback
  if (e.css.startsWith('linear(') && !CSS.supports('animation-timing-function', e.css))
    return EASES.overshoot.css
  return e.css
}

/** An SVG path of a curve in a w×h box, with room above and below for overshoot. */
export function curvePath(id: string, w: number, h: number, pad = 0.28): string {
  const pts = EASES[id]?.points ?? EASES.linear.points
  const span = 1 + 2 * pad
  return pts
    .map(
      ([x, y], i) =>
        `${i ? 'L' : 'M'}${(x * w).toFixed(1)},${(h - ((y + pad) / span) * h).toFixed(1)}`
    )
    .join(' ')
}

/** Counts up every `ms` so a preview can replay; frozen when people prefer reduced motion. */
export function useReplay(ms: number): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setN((x) => x + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return n
}

export const ASPECTS: { id: Aspect; label: string }[] = [
  { id: 'landscape', label: '16:9' },
  { id: 'portrait', label: '9:16' },
  { id: 'square', label: '1:1' }
]

const LENGTHS = [10, 15, 30, 45, 60]

/** Lengths to pick from, with the one asked for in the words when it isn't one of them. */
export function lengthOptions(current: number | null): { value: number | null; label: string }[] {
  const all =
    current && !LENGTHS.includes(current) ? [...LENGTHS, current].sort((a, b) => a - b) : LENGTHS
  return [
    { value: null, label: 'Any length' },
    ...all.map((s) => ({ value: s, label: s % 60 === 0 ? `${s / 60} min` : `${s} s` }))
  ]
}
