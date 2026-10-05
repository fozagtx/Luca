/**
 * Building blocks the Studio kinds share: escaped text, mask lines, glass app tiles, pills, tags,
 * icons and waveforms, as HTML strings sized in px for the frame. The CSS for all of them is
 * PARTS_CSS, written once per composition.
 */
import type { StudioMark } from './schema'

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const r1 = (n: number): number => Math.round(n * 10) / 10

/** A line of text that rises out of its own mask: the inner .ls-rise is what H.rise moves. */
export function maskLine(text: string, cls: string, style = '', fit = true): string {
  return `<div class="ls-mask"><div class="ls-rise ${cls}"${fit ? ' data-fit="parent"' : ''} style="${style}">${esc(text)}</div></div>`
}

/** Characters H.type reveals one at a time, then a caret. */
export function typed(text: string, caret = true): string {
  const chars = [...text].map((c) => `<span class="ls-ch">${c === ' ' ? '&nbsp;' : esc(c)}</span>`)
  return `${chars.join('')}${caret ? '<span class="ls-caret"></span>' : ''}`
}

export type TileOpts = {
  size: number
  light?: boolean
  /** Extra classes on the outer element (the one kinds animate). */
  cls?: string
  id?: string
  /** HTML inside the wrap, over the tile (a cross, a badge). */
  extra?: string
}

/**
 * A glass app tile: a frosted mid-grey slab with a crisp top bevel, a thin dark edge and a soft
 * drop shadow (or frosted grey-beige when light), the logo (or 1–3
 * letters) inside. Outer .ls-tile-wrap is for entrance tweens, inner .ls-tile for focus tweens,
 * so the two never fight over the same property.
 */
export function tile(mark: StudioMark, o: TileOpts): string {
  const s = r1(o.size)
  const radius = r1(s * 0.16)
  const inner = mark.logo
    ? `<img class="ls-logo${mark.tint ? ' ls-tint' : ''}" src="${esc(mark.logo)}" alt="" style="width:${r1(s * 0.6)}px;height:${r1(s * 0.6)}px" />`
    : `<span class="ls-mono" style="font-size:${r1(s * (mark.mono && mark.mono.length > 2 ? 0.3 : 0.38))}px">${esc(mark.mono ?? initials(mark.label ?? ''))}</span>`
  return `<div class="ls-tile-wrap ${o.cls ?? ''}"${o.id ? ` id="${o.id}"` : ''} style="width:${s}px;height:${s}px"><div class="ls-tile${o.light ? ' ls-tile-light' : ''}" style="border-radius:${radius}px">${inner}</div>${o.extra ?? ''}</div>`
}

/** "Open WebUI" → "OW"; a single word gives its first two letters. */
export function initials(label: string): string {
  const words = label
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean)
  if (!words.length) return '•'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** The GitHub mark (Simple Icons, CC0), currentColor. */
export const GITHUB_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3.997.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.319 3.27-.997 3.27-.997.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>'

export const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.5l5 5 10-11"/></svg>'

export const SEND_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.5a1.2 1.2 0 0 1 .85.35l6 6a1.2 1.2 0 1 1-1.7 1.7l-3.95-3.95V19.3a1.2 1.2 0 1 1-2.4 0V7.6L6.85 11.55a1.2 1.2 0 1 1-1.7-1.7l6-6A1.2 1.2 0 0 1 12 3.5z"/></svg>'

/** A small pill tag: black on paper, light on ink (the theme decides), or the accent. */
export function tag(text: string, size: number, accent = false, cls = ''): string {
  return `<span class="ls-tag${accent ? ' ls-tag-accent' : ''} ${cls}" style="font-size:${r1(size)}px">${esc(text)}</span>`
}

/**
 * Deterministic waveform bar heights (0–1) for a seed: a voice-like envelope of syllables
 * over noise, never random at render time.
 */
export function waveBars(n: number, seed: number): number[] {
  let state = (seed * 2654435761) >>> 0 || 1
  const next = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / n
    const syll = Math.abs(Math.sin(t * Math.PI * (7 + (seed % 3))))
    const env = 0.35 + 0.65 * syll
    out.push(Math.max(0.08, Math.min(1, env * (0.45 + next() * 0.65))))
  }
  return out
}

/** The CSS of the shared parts; kinds add their own rules next to it. */
export function partsCss(scope: string, k: number): string {
  const px = (n: number): string => `${r1(n * k)}px`
  return `
      ${scope} .ls-mask { overflow: hidden; padding: 0 ${px(6)} ${px(4)}; margin: 0 -${px(6)} -${px(4)}; }
      ${scope} .ls-rise { white-space: nowrap; will-change: transform; }
      ${scope} .ls-tile-wrap { position: relative; flex: none; }
      ${scope} .ls-tile {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        background: linear-gradient(158deg, #807c77 0%, #64605b 42%, #4e4b47 100%);
        box-shadow:
          inset 0 ${px(2.5)} 0 rgba(255,255,255,0.34),
          inset 0 -${px(3)} 0 rgba(0,0,0,0.32),
          inset ${px(2)} 0 0 rgba(255,255,255,0.1),
          inset -${px(2)} 0 0 rgba(0,0,0,0.25),
          0 0 0 ${px(1.5)} rgba(0,0,0,0.35),
          0 ${px(22)} ${px(44)} rgba(0,0,0,0.34),
          0 ${px(6)} ${px(12)} rgba(0,0,0,0.24);
        color: #F7F5F0;
      }
      ${scope} .ls-tile::after {
        content: ''; position: absolute; inset: ${px(5)}; border-radius: inherit;
        border: ${px(1.5)} solid rgba(255,255,255,0.16); pointer-events: none;
      }
      ${scope} .ls-tile-light {
        background: linear-gradient(158deg, #e2dfd6 0%, #cdcabe 48%, #bab6aa 100%);
        box-shadow:
          inset 0 ${px(2.5)} 0 rgba(255,255,255,0.9),
          inset 0 -${px(4)} ${px(8)} rgba(120,110,90,0.25),
          0 ${px(20)} ${px(40)} rgba(70,58,36,0.22),
          0 ${px(5)} ${px(10)} rgba(70,58,36,0.16);
        color: #121110;
      }
      ${scope} .ls-tile-light::after { border-color: rgba(255,255,255,0.7); }
      ${scope} .ls-logo { object-fit: contain; display: block; }
      ${scope} .ls-tint { filter: brightness(0) invert(1); }
      ${scope} .ls-tile-light .ls-tint { filter: brightness(0); }
      ${scope} .ls-mono {
        font-family: var(--display), sans-serif; font-weight: 700; letter-spacing: -0.02em; line-height: 1;
      }
      ${scope} .ls-tag {
        display: inline-flex; align-items: center; padding: 0.22em 0.5em; border-radius: 0.32em;
        background: var(--tag); color: var(--tag-fg); font-family: var(--display), sans-serif;
        font-weight: 600; line-height: 1.05; white-space: nowrap; letter-spacing: -0.01em;
      }
      ${scope} .ls-tag-accent { background: var(--accent); color: #121110; }
      ${scope} .ls-ch { display: none; }
      ${scope} .ls-caret {
        display: inline-block; width: 0.08em; height: 1.05em; margin-left: 0.04em;
        background: currentColor; vertical-align: -0.16em;
      }
      ${scope} .ls-strike {
        position: absolute; left: -4%; right: -4%; top: 52%; height: 0.075em; min-height: ${px(4)};
        background: currentColor; transform-origin: left center; border-radius: ${px(3)};
      }
      ${scope} .ls-x { position: absolute; inset: -9%; pointer-events: none; }
      ${scope} .ls-x i {
        position: absolute; left: -14%; top: 50%; width: 128%; height: ${px(19)}; margin-top: -${px(9.5)};
      }
      ${scope} .ls-x i:nth-child(1) { rotate: 45deg; }
      ${scope} .ls-x i:nth-child(2) { rotate: -45deg; }
      ${scope} .ls-x b {
        display: block; width: 100%; height: 100%; background: var(--alarm); border-radius: ${px(10)};
        transform-origin: left center; box-shadow: 0 ${px(2)} ${px(6)} rgba(150,20,20,0.25);
      }
`
}

/** A red X over its parent: two strokes (its `b`s) H.draw draws one after the other. */
export const CROSS = '<div class="ls-x"><i><b></b></i><i><b></b></i></div>'
