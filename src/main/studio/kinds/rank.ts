/**
 * rank: one entry of a countdown, the BEFORE edit's item card. A centered column: "#1", the name
 * big (a red heavy italic serif in the serif look, the wide grotesk in paper), "★ 161.8k stars",
 * the app's tile and a big number under it ("180,000"). Use it to open each item of a numbered
 * list. In a wide, short zone the tile sits left of the words.
 */
import { esc, r1, tile } from '../parts'
import { t, when, type KindModule } from './types'

/** Material Design's star (Apache 2.0), currentColor. */
const STAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'

/** Base sizes in 1080-units, and each row's line height. */
const NUM = 64
const NAME = 150
const STAT = 34
const TILE = 360
const VALUE = 110
const LH = { num: 1.15, name: 1.14, stat: 1.3, value: 1.14 }

export const rank: KindModule<'rank'> = {
  css: (s, k) => `
      ${s} .ls-k-rank { display: flex; align-items: center; justify-content: center; width: 100%; }
      ${s} .ls-k-rank .ls-rk-col { display: flex; flex-direction: column; align-items: center; min-width: 0; }
      ${s} .ls-k-rank.ls-rk-side .ls-rk-col { align-items: flex-start; }
      ${s} .ls-k-rank .ls-rk-num { font-weight: 700; color: var(--fg); letter-spacing: -0.01em; white-space: nowrap; }
      ${s} .ls-k-rank .ls-rk-box { max-width: 100%; padding: 0 0.14em 0.05em; margin: 0 -0.14em -0.05em; }
      ${s} .ls-k-rank .ls-rk-name { font-family: var(--display), sans-serif; }
      ${s} .ls-k-rank .ls-rk-stat {
        display: flex; align-items: center; font-family: var(--text), sans-serif; font-weight: 500;
        color: var(--fg); white-space: nowrap; letter-spacing: -0.005em;
      }
      ${s} .ls-k-rank .ls-rk-star { flex: none; width: 0.92em; height: 0.92em; margin-right: 0.85em; }
      ${s} .ls-k-rank .ls-rk-star svg { display: block; width: 100%; height: 100%; }
      ${s} .ls-k-rank .ls-rk-value { font-family: var(--display), sans-serif; color: var(--fg); }
      ${s} .ls-k-rank .ls-tile-light { box-shadow:
        inset 0 ${r1(2.5 * k)}px 0 rgba(255,255,255,0.9),
        0 ${r1(18 * k)}px ${r1(40 * k)}px var(--shadow), 0 ${r1(4 * k)}px ${r1(10 * k)}px var(--shadow); }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const serif = look.displayItalic
    const mark = g.mark
    const side = !!mark && zone.w / zone.h > 1.6
    const name = g.name
    const value = g.value
    // the column's height in 1080-units; everything scales together to fit the zone
    const rows: [number, number][] = [
      [NUM * LH.num, 0],
      [NAME * LH.name, 6],
      ...(g.stat ? [[STAT * LH.stat, 20] as [number, number]] : []),
      ...(mark && !side ? [[TILE, g.stat ? 56 : 44] as [number, number]] : []),
      ...(value ? [[VALUE * LH.value, side ? 36 : mark ? 48 : 40] as [number, number]] : [])
    ]
    const total = rows.reduce((n, [h, gap]) => n + h + gap, 0)
    const sc = Math.min(1, (zone.h * (side ? 0.9 : 0.95)) / (total * k))
    const u = sc * k
    const tileSize = side
      ? Math.min(zone.h * 0.8, 400 * k, zone.w * 0.36)
      : Math.min(TILE * u, zone.w * 0.46)
    const gapX = 60 * u
    const colW = side ? zone.w * 0.96 - tileSize - gapX : zone.w
    // a first guess at the width so the fit pass has little to do: wide grotesk vs the serif
    const nameSize = Math.min(NAME * u, colW / Math.max(3, name.length * (serif ? 0.56 : 0.68)))
    const valueSize = value
      ? Math.min(VALUE * u, colW / Math.max(3, value.length * (serif ? 0.6 : 0.74)))
      : 0
    const gap = (px: number): string => `margin-top:${r1(px * u)}px`
    const nameStyle = serif
      ? `font-style:italic;font-weight:${look.weights.black};letter-spacing:-0.005em;line-height:${LH.name}`
      : 'font-weight:500;letter-spacing:-0.035em;line-height:1.1'
    const valueStyle = serif
      ? `font-style:italic;font-weight:${look.weights.black};letter-spacing:0`
      : `font-weight:${look.weights.bold};letter-spacing:-0.03em`
    const col = [
      `<div class="ls-rk-num" style="font-size:${r1(NUM * u)}px;line-height:${LH.num};font-family:${serif ? 'var(--text)' : 'var(--display)'},sans-serif">#${g.rank}</div>`,
      `<div class="ls-mask ls-rk-box" style="font-size:${r1(nameSize)}px;${gap(6)}"><div class="ls-rise ls-rk-name" data-fit="parent" style="color:${look.nameColor ?? 'var(--fg)'};${nameStyle}">${esc(name)}</div></div>`,
      g.stat
        ? `<div class="ls-rk-stat" data-fit="parent" style="font-size:${r1(STAT * u)}px;line-height:${LH.stat};${gap(20)}"><span class="ls-rk-star">${STAR_SVG}</span><span>${esc(g.stat)}</span></div>`
        : '',
      mark && !side
        ? `<div style="${gap(g.stat ? 56 : 44)}">${tile(mark, { size: tileSize, light: serif, cls: 'ls-rk-tile' })}</div>`
        : '',
      value
        ? `<div class="ls-mask ls-rk-box" style="font-size:${r1(valueSize)}px;${gap(side ? 36 : mark ? 48 : 40)}"><div class="ls-rise ls-rk-value" data-fit="parent" style="line-height:${LH.value};${valueStyle}">${esc(value)}</div></div>`
        : ''
    ].join('')
    const html = side
      ? `<div class="ls-k-rank ls-rk-side">${tile(mark!, { size: tileSize, light: serif, cls: 'ls-rk-tile' })}<div class="ls-rk-col" style="max-width:${r1(colW)}px;margin-left:${r1(gapX)}px">${col}</div></div>`
      : `<div class="ls-k-rank"><div class="ls-rk-col" style="width:100%">${col}</div></div>`
    const at = when(g.at, ctx.start, ctx.start)
    const js = [
      `H.blurIn(H.q('.ls-rk-num', G), ${t(at)}, { blur: 10, y: 10 });`,
      `H.rise(H.q('.ls-rk-name', G), ${t(at + 0.08)});`,
      g.stat ? `H.blurIn(H.q('.ls-rk-stat', G), ${t(at + 0.2)}, { blur: 8, y: 8 });` : '',
      mark ? `H.pop(H.q('.ls-rk-tile', G), ${t(at + (side ? 0.12 : 0.26))}, { from: 0.7 });` : '',
      value ? `H.rise(H.q('.ls-rk-value', G), ${t(at + 0.42)});` : ''
    ]
    return { html, js: js.filter(Boolean).join('\n') }
  }
}
