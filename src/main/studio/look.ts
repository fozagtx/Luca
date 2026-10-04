/**
 * The two Studio looks as design tokens. `paper` is the reference's AFTER: cream and warm-black
 * paper with a crumpled texture, a wide grotesk, glass app tiles, a lime accent. `serif` is its
 * BEFORE: flat light cards and black screens, a heavy italic serif, red names. Kinds read colors
 * through CSS variables, so a graphic that survives a background change recolors with one set.
 */
import type { StudioBg } from './schema'

export type StudioLook = {
  id: 'paper' | 'serif'
  /** Fonts the composition declares; bundled ones are copied into the project. */
  fonts: { display: string; text: string; serif: string; mono: string }
  /** Families that come with Luca (copied in) vs. built into HyperFrames. */
  bundled: string[]
  /** Title lines: the display face, and whether it's italic in this look. */
  displayItalic: boolean
  /** Weight of a title line asked for as black/bold/medium/light. */
  weights: { black: number; bold: number; medium: number; light: number }
  /** Paper texture on the backgrounds. */
  texture: boolean
  /** CSS variables per background. */
  themes: Record<StudioBg, Record<string, string>>
  /** The color names take in this look (the BEFORE's red serif names), else the text color. */
  nameColor: string | null
  alarm: string
}

const ALARM = '#E5322F'

export const LOOKS: Record<StudioLook['id'], StudioLook> = {
  paper: {
    id: 'paper',
    fonts: {
      display: 'Archivo Expanded',
      text: 'Archivo',
      serif: 'Instrument Serif',
      mono: 'JetBrains Mono'
    },
    bundled: ['Archivo Expanded', 'Archivo', 'Instrument Serif'],
    displayItalic: false,
    weights: { black: 900, bold: 700, medium: 500, light: 300 },
    texture: true,
    nameColor: null,
    alarm: ALARM,
    themes: {
      paper: {
        '--bg': '#E9E4D8',
        '--fg': '#121110',
        '--dim': '#8A857B',
        '--pill': '#F7F5F0',
        '--pill-fg': '#121110',
        '--line': 'rgba(18,17,16,0.32)',
        '--shadow': 'rgba(64,52,30,0.2)',
        '--card': '#1D1C1A',
        '--card-fg': '#F4F1EA',
        '--card-dim': '#8F8A80',
        '--tag': '#121110',
        '--tag-fg': '#F7F5F0'
      },
      ink: {
        '--bg': '#23211E',
        '--fg': '#F4F1EA',
        '--dim': '#A39E94',
        '--pill': '#F4F1EA',
        '--pill-fg': '#121110',
        '--line': 'rgba(244,241,234,0.4)',
        '--shadow': 'rgba(0,0,0,0.5)',
        '--card': '#2C2A27',
        '--card-fg': '#F4F1EA',
        '--card-dim': '#9A958B',
        '--tag': '#F4F1EA',
        '--tag-fg': '#121110'
      }
    }
  },
  serif: {
    id: 'serif',
    fonts: {
      display: 'Playfair Display',
      text: 'Inter',
      serif: 'Playfair Display',
      mono: 'JetBrains Mono'
    },
    bundled: [],
    displayItalic: true,
    weights: { black: 900, bold: 800, medium: 700, light: 500 },
    texture: false,
    nameColor: '#D2493A',
    alarm: ALARM,
    themes: {
      paper: {
        '--bg': '#F4F3F0',
        '--fg': '#111111',
        '--dim': '#6F6F6F',
        '--pill': '#FFFFFF',
        '--pill-fg': '#111111',
        '--line': 'rgba(17,17,17,0.3)',
        '--shadow': 'rgba(0,0,0,0.16)',
        '--card': '#0E0E0E',
        '--card-fg': '#F2F2F2',
        '--card-dim': '#8C8C8C',
        '--tag': '#111111',
        '--tag-fg': '#FFFFFF'
      },
      ink: {
        '--bg': '#030303',
        '--fg': '#FFFFFF',
        '--dim': '#9C9C9C',
        '--pill': '#FFFFFF',
        '--pill-fg': '#111111',
        '--line': 'rgba(255,255,255,0.35)',
        '--shadow': 'rgba(0,0,0,0.6)',
        '--card': '#141414',
        '--card-fg': '#F2F2F2',
        '--card-dim': '#8C8C8C',
        '--tag': '#FFFFFF',
        '--tag-fg': '#111111'
      }
    }
  }
}

export function lookOf(id: string | undefined): StudioLook {
  return id === 'serif' ? LOOKS.serif : LOOKS.paper
}

/** The variables as an inline style, e.g. for a graphic's box at its first background. */
export function themeStyle(look: StudioLook, bg: StudioBg): string {
  return Object.entries(look.themes[bg])
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}
