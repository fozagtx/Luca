/**
 * list: white rows stacking in from the right, one per name, each with a GitHub mark (or a
 * check, number or dot). Names can start blurred, a teaser before they're revealed; one row can
 * light up in the accent with a badge (the bonus "+1").
 */
import { CHECK_SVG, esc, GITHUB_SVG, r1 } from '../parts'
import { t, when, type KindModule } from './types'

// row parts as shares of the row height, measured off the reference: side padding, the mark and
// the space after it, the gap between rows and the name size before any shrinking
const PAD = 0.34
const MARK = 0.52
const MARK_GAP = 0.28
const GAP = 0.28
const NAME = 0.48
// the badge is smaller than the name; its left margin in its own em
const BADGE = 0.72
const BADGE_GAP = 0.8

// average advance per character class, in em, for the wide grotesk at bold
const EM: [RegExp, number][] = [
  [/\s/, 0.3],
  [/[A-Z]/, 0.88],
  [/\d/, 0.74],
  [/[a-z]/, 0.66],
  [/[-.,!'|:;]/, 0.4]
]

/** Rough advance of a name in em; data-fit catches what this misses (a row of W's). */
function ems(s: string): number {
  let n = 0
  for (const c of s) n += EM.find(([re]) => re.test(c))?.[1] ?? 0.6
  return n
}

export const list: KindModule<'list'> = {
  css: (s, k) => `
      ${s} .ls-k-list { display: flex; flex-direction: column; align-items: center; width: 100%; }
      ${s} .ls-k-list .ls-row {
        display: flex; align-items: center; box-sizing: border-box; background: var(--pill); color: var(--pill-fg);
        box-shadow:
          0 ${r1(12 * k)}px ${r1(24 * k)}px var(--shadow),
          0 ${r1(3 * k)}px ${r1(6 * k)}px var(--shadow),
          inset 0 ${r1(2 * k)}px 0 rgba(255,255,255,0.75),
          inset 0 -${r1(3 * k)}px 0 rgba(0,0,0,0.06);
        font-family: var(--display), sans-serif; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap;
      }
      ${s} .ls-k-list .ls-row.ls-hl { background: var(--accent); color: #121110; }
      ${s} .ls-k-list .ls-mark { flex: none; display: flex; align-items: center; justify-content: center; }
      ${s} .ls-k-list .ls-mark svg { width: 100%; height: 100%; display: block; }
      ${s} .ls-k-list .ls-text { flex: 1; min-width: 0; overflow: hidden; }
      ${s} .ls-k-list .ls-badge { flex: none; font-size: ${BADGE}em; margin-left: ${BADGE_GAP}em; }
      ${s} .ls-k-list .ls-dot { border-radius: 50%; background: currentColor; }
`,
  render: (g, ctx) => {
    const { zone, k } = ctx
    const n = g.items.length
    // the stack keeps about the same height at any count, at most as tall as 0.9 of the zone's
    // width (0.45 of a tall frame): fewer rows are taller, more rows shorter, and a short row gets
    // a narrower pill rather than a thin strip
    const span = Math.min(zone.h, zone.w) * 0.9
    const rowH = Math.min(145 * k, span / (n + (n - 1) * GAP), zone.w * 0.16)
    const gap = rowH * GAP
    const width = Math.min(zone.w * 0.9, 860 * k, rowH * 8.5)
    const mark = g.mark ?? 'github'
    // one size for every name, small enough for the longest to fit beside the mark and badge
    const room = width - rowH * PAD * 2 - (mark === 'none' ? 0 : rowH * (MARK + MARK_GAP))
    const badge = g.highlight?.badge
    const need = g.items.map(
      (it, i) =>
        ems(it.text) + (badge && g.highlight?.index === i ? BADGE * (ems(badge) + BADGE_GAP) : 0)
    )
    const fs = Math.min(rowH * NAME, room / Math.max(...need))
    const at = when(g.at, ctx.start, ctx.start)
    const step = Math.min(0.32, Math.max(0.1, ((ctx.end - at) * 0.5) / n))
    const rows = g.items.map((it, i) => {
      const hl = g.highlight?.index === i
      const icon =
        mark === 'github'
          ? GITHUB_SVG
          : mark === 'check'
            ? CHECK_SVG
            : mark === 'number'
              ? `<span>${i + 1}.</span>`
              : mark === 'dot'
                ? `<span class="ls-dot" style="width:${r1(rowH * 0.16)}px;height:${r1(rowH * 0.16)}px"></span>`
                : ''
      const markHtml =
        mark === 'none'
          ? ''
          : `<span class="ls-mark" style="width:${r1(rowH * MARK)}px;height:${r1(rowH * MARK)}px;margin-right:${r1(rowH * MARK_GAP)}px">${icon}</span>`
      const blur = g.blur && !hl ? `filter:blur(${r1(rowH * 0.075)}px);` : ''
      // data-fit measures the text's own box: as the flex item it is the room the row leaves
      return `<div class="ls-row ls-row-${i}${hl ? ' ls-hl' : ''}" style="width:${r1(width)}px;height:${r1(rowH)}px;margin-top:${i ? r1(gap) : 0}px;padding:0 ${r1(rowH * PAD)}px;border-radius:${r1(rowH * 0.2)}px;font-size:${r1(fs)}px">${markHtml}<span class="ls-text" data-fit style="${blur}">${esc(it.text)}</span>${hl && badge ? `<span class="ls-badge">${esc(badge)}</span>` : ''}</div>`
    })
    const js = g.items.map((it, i) => {
      const hl = g.highlight?.index === i
      const time =
        hl && g.highlight?.at !== undefined
          ? when(g.highlight.at, at, ctx.start)
          : when(it.at, at + i * step, ctx.start)
      return `H.slideIn(H.q('.ls-row-${i}', G), ${t(time)}, { dx: ${r1((width * 0.55) / k)} });`
    })
    return { html: `<div class="ls-k-list">${rows.join('')}</div>`, js: js.join('\n') }
  }
}
