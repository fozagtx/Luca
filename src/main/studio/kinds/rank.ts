/**
 * rank: one entry of a countdown, the BEFORE edit's item card. A centered column: "#1", the name
 * big (a red-to-salmon heavy italic serif in the serif look, the wide grotesk in paper),
 * "★ 161.8k stars", the app's tile and a big number under it ("180,000"). Use it to open each
 * item of a numbered list. In a wide, short zone the tile sits left of the words.
 */
import { esc, r1, tile } from '../parts'
import { t, when, type KindModule } from './types'

/** Material Design's star (Apache 2.0), currentColor. */
const STAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'

/** Sizes in 1080-units as measured off the reference, and each row's line height. */
const NUM = 80
const NAME = 160
const STAT = 44
const TILE = 420
const VALUE = 120
const LH = { num: 1.15, name: 1.14, stat: 1.3, value: 1.14 }
/** Space above each row: under the number, the name, the stat line and the tile. */
const GAP = { name: 6, stat: 30, tile: 80, value: 100 }

/** Rough width of a line in em, so the first size is close and the fit pass has little to do. */
function widthEm(text: string, serif: boolean): number {
  let em = 0
  for (const c of text) {
    if (c === ' ') em += serif ? 0.25 : 0.3
    else if (/[0-9]/.test(c)) em += serif ? 0.6 : 0.7
    else if (/[A-Z]/.test(c)) em += serif ? 0.72 : 0.8
    else if (/[a-z]/.test(c)) em += serif ? 0.5 : 0.6
    else em += serif ? 0.32 : 0.36
  }
  return em + 0.3
}

/** A long name in two lines, broken at the space or hyphen that balances them best. */
function splitName(name: string, serif: boolean): string[] {
  let best = [name]
  let widest = widthEm(name, serif)
  for (let i = 1; i < name.length - 1; i++) {
    if (name[i] !== ' ' && name[i] !== '-') continue
    const lines = [name.slice(0, name[i] === '-' ? i + 1 : i), name.slice(i + 1)]
    const w = Math.max(...lines.map((l) => widthEm(l, serif)))
    if (w < widest) [best, widest] = [lines, w]
  }
  return best
}

export const rank: KindModule<'rank'> = {
  css: (s, k) => `
      ${s} .ls-k-rank { display: flex; align-items: center; justify-content: center; width: 100%; }
      ${s} .ls-k-rank .ls-rk-col { display: flex; flex-direction: column; align-items: center; min-width: 0; }
      ${s} .ls-k-rank.ls-rk-side .ls-rk-col { align-items: flex-start; }
      ${s} .ls-k-rank .ls-rk-num { font-weight: 700; color: var(--fg); letter-spacing: -0.01em; white-space: nowrap; }
      ${s} .ls-k-rank .ls-rk-box { max-width: 100%; padding: 0 0.04em 0.16em; margin: 0 -0.04em -0.16em; }
      ${s} .ls-k-rank.ls-rk-side .ls-rk-box { margin-left: -0.16em; }
      ${s} .ls-k-rank .ls-rk-name, ${s} .ls-k-rank .ls-rk-value {
        font-family: var(--display), sans-serif; font-variant-numeric: lining-nums; padding: 0 0.12em;
      }
      ${s} .ls-k-rank .ls-rk-grad { -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
      ${s} .ls-k-rank .ls-rk-stat {
        display: flex; align-items: center; font-family: var(--text), sans-serif; font-weight: 600;
        color: var(--fg); white-space: nowrap; letter-spacing: -0.005em;
      }
      ${s} .ls-k-rank .ls-rk-star { flex: none; width: 0.95em; height: 0.95em; margin-right: 1.05em; }
      ${s} .ls-k-rank .ls-rk-star svg { display: block; width: 100%; height: 100%; }
      ${s} .ls-k-rank .ls-rk-value { color: var(--fg); }
      ${s} .ls-k-rank.ls-rk-sans .ls-mono { font-family: var(--text), sans-serif; font-weight: 600; letter-spacing: 0.01em; }
      ${s} .ls-k-rank .ls-tile-light {
        background: linear-gradient(180deg, var(--pill) 55%, color-mix(in srgb, var(--pill) 94%, var(--fg)));
        box-shadow: inset 0 ${r1(2.5 * k)}px 0 rgba(255,255,255,0.9),
          0 ${r1(22 * k)}px ${r1(48 * k)}px var(--shadow), 0 ${r1(4 * k)}px ${r1(10 * k)}px var(--shadow);
      }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const serif = look.displayItalic
    const mark = g.mark
    const side = !!mark && zone.w / zone.h > 1.6
    const value = g.value
    const tileTop = g.stat ? GAP.tile : GAP.stat * 1.6
    const valueTop = mark && !side ? GAP.value : 48
    // the column's height in 1080-units; everything scales together to fit the zone
    const scaleFor = (nameLines: number): number => {
      const rows: [number, number][] = [
        [NUM * LH.num, 0],
        [NAME * LH.name * nameLines, GAP.name],
        ...(g.stat ? [[STAT * LH.stat, GAP.stat] as [number, number]] : []),
        ...(mark && !side ? [[TILE, tileTop] as [number, number]] : []),
        ...(value ? [[VALUE * LH.value, valueTop] as [number, number]] : [])
      ]
      const total = rows.reduce((n, [h, gap]) => n + h + gap, 0)
      return Math.min(1, (zone.h * (side ? 0.9 : 0.96)) / (total * k)) * k
    }
    const tileSize = (u: number): number =>
      side ? Math.min(zone.h * 0.8, 400 * k, zone.w * 0.36) : Math.min(TILE * u, zone.w * 0.46)
    const colWidth = (u: number): number =>
      side ? zone.w * 0.96 - tileSize(u) - 64 * u : zone.w * 0.98
    let u = scaleFor(1)
    let names = [g.name]
    // a name that would come out much smaller than the rest goes onto two lines when it can
    if ((widthEm(g.name, serif) * NAME * u) / colWidth(u) > 1.6) {
      const two = splitName(g.name, serif)
      if (two.length > 1) {
        names = two
        u = scaleFor(2)
      }
    }
    const size = tileSize(u)
    const gapX = 64 * u
    const colW = colWidth(u)
    const nameSize = Math.min(NAME * u, colW / Math.max(...names.map((l) => widthEm(l, serif))))
    const valueSize = value ? Math.min(VALUE * u, colW / widthEm(value, serif)) : 0
    const nameColor = look.nameColor
    // the serif look's names run red at the top to salmon at the bottom, like the reference
    const nameStyle = serif
      ? `font-style:italic;font-weight:${look.weights.black};letter-spacing:-0.005em;line-height:${LH.name};${nameColor ? `background-image:linear-gradient(180deg, ${nameColor} 18%, color-mix(in srgb, ${nameColor} 62%, #F6C7B4) 92%)` : ''}`
      : `font-weight:500;letter-spacing:-0.035em;line-height:1.1;color:${nameColor ?? 'var(--fg)'}`
    const valueStyle = serif
      ? `font-style:italic;font-weight:${look.weights.black};letter-spacing:0.005em`
      : `font-weight:${look.weights.bold};letter-spacing:-0.03em`
    const mt = (px: number): string => `margin-top:${r1(px * u)}px`
    const tileHtml = mark ? tile(mark, { size, light: serif, cls: 'ls-rk-tile' }) : ''
    const nameHtml = names
      .map(
        (line, i) =>
          `<div class="ls-mask ls-rk-box" style="font-size:${r1(nameSize)}px;${i ? 'margin-top:-0.1em' : mt(GAP.name)}"><div class="ls-rise ls-rk-name${serif && nameColor ? ' ls-rk-grad' : ''}" data-fit="parent" style="${nameStyle}">${esc(line)}</div></div>`
      )
      .join('')
    const col = [
      `<div class="ls-rk-num" style="font-size:${r1(NUM * u)}px;line-height:${LH.num};font-family:${serif ? 'var(--text)' : 'var(--display)'},sans-serif">#${g.rank}</div>`,
      nameHtml,
      g.stat
        ? `<div class="ls-rk-stat" data-fit="parent" style="font-size:${r1(STAT * u)}px;line-height:${LH.stat};${mt(GAP.stat)}"><span class="ls-rk-star">${STAR_SVG}</span><span>${esc(g.stat)}</span></div>`
        : '',
      mark && !side ? `<div style="${mt(tileTop)}">${tileHtml}</div>` : '',
      value
        ? `<div class="ls-mask ls-rk-box" style="font-size:${r1(valueSize)}px;${mt(valueTop)}"><div class="ls-rise ls-rk-value" data-fit="parent" style="line-height:${LH.value};${valueStyle}">${esc(value)}</div></div>`
        : ''
    ].join('')
    const cls = `ls-k-rank${side ? ' ls-rk-side' : ''}${serif ? ' ls-rk-sans' : ''}`
    const html = side
      ? `<div class="${cls}">${tileHtml}<div class="ls-rk-col" style="max-width:${r1(colW)}px;margin-left:${r1(gapX)}px">${col}</div></div>`
      : `<div class="${cls}"><div class="ls-rk-col" style="width:100%">${col}</div></div>`
    const at = when(g.at, ctx.start, ctx.start)
    const js = [
      `H.blurIn(H.q('.ls-rk-num', G), ${t(at)}, { blur: 10, y: 10 });`,
      `H.qa('.ls-rk-name', G).forEach(function (el, i) { H.rise(el, ${t(at + 0.08)} + i * 0.07); });`,
      g.stat ? `H.blurIn(H.q('.ls-rk-stat', G), ${t(at + 0.2)}, { blur: 8, y: 8 });` : '',
      mark ? `H.pop(H.q('.ls-rk-tile', G), ${t(at + (side ? 0.12 : 0.26))}, { from: 0.7 });` : '',
      value ? `H.rise(H.q('.ls-rk-value', G), ${t(when(g.valueAt, at + 0.42, at))});` : ''
    ]
    return { html, js: js.filter(Boolean).join('\n') }
  }
}
