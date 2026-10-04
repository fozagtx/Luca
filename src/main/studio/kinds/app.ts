/**
 * app: a product's name card. The lowercase name rises, its glass tile pops in under it, and a
 * hairline drops from the tile to a stat ("180k / GitHub stars") or to what it is in two lines
 * ("a chat app / on top of ollama"). Satellites (the models it runs, what it plugs into) fly in
 * around the tile, overlapping it, each with a small name.
 */
import { esc, r1, tile } from '../parts'
import { t, when, type KindModule } from './types'

/** Where satellites sit around the main tile: offset in tile sizes, and size as a share of it. */
const ORBIT: [number, number, number][] = [
  [-0.9, 0.5, 0.6],
  [0.92, 0.55, 0.58],
  [-0.82, -0.52, 0.36],
  [0.86, -0.58, 0.34],
  [1.28, 0.02, 0.4],
  [-1.3, 0.04, 0.38]
]

export const app: KindModule<'app'> = {
  css: (s) => `
      ${s} .ls-k-app { display: flex; flex-direction: column; align-items: center; width: 100%; }
      ${s} .ls-k-app .ls-name { font-family: var(--display), sans-serif; font-weight: 500; letter-spacing: -0.035em; line-height: 1.05; text-align: center; }
      ${s} .ls-k-app .ls-hub { position: relative; display: flex; justify-content: center; }
      ${s} .ls-k-app .ls-sat { position: absolute; display: flex; flex-direction: column; align-items: center; }
      ${s} .ls-k-app .ls-sat-label { margin-top: 0.4em; font-family: var(--text), sans-serif; font-weight: 500; color: var(--fg); white-space: nowrap; }
      ${s} .ls-k-app .ls-wire { width: 0; border-left: 2px solid var(--line); transform-origin: top center; }
      ${s} .ls-k-app .ls-stat { font-family: var(--display), sans-serif; font-weight: 500; color: var(--fg); line-height: 1.1; letter-spacing: -0.02em; text-align: center; }
      ${s} .ls-k-app .ls-subline { font-family: var(--text), sans-serif; font-weight: 500; color: var(--dim); line-height: 1.2; text-align: center; white-space: nowrap; }
      ${s} .ls-k-app .ls-desc { font-family: var(--display), sans-serif; font-weight: 400; color: var(--fg); line-height: 1.2; letter-spacing: -0.02em; text-align: center; white-space: nowrap; }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const sats = g.satellites ?? []
    const hasFoot = !!g.stat || !!g.lines?.length
    // the name, the tile and the foot share the zone's height
    const nameSize = Math.min(
      (zone.w * 0.95) / Math.max(4, g.name.length * 0.62),
      zone.h * 0.16,
      170 * k
    )
    const tileSize = Math.min(
      zone.w * (sats.length ? 0.3 : 0.27),
      zone.h * (hasFoot ? 0.24 : 0.36),
      300 * k
    )
    const footSize = Math.min(58 * k, zone.w * 0.06)
    const at = when(g.at, ctx.start, ctx.start)
    const nameColor = look.nameColor ?? 'var(--fg)'
    const name = `<div class="ls-mask" style="max-width:100%"><div class="ls-rise ls-name" data-fit="parent" style="font-size:${r1(nameSize)}px;color:${nameColor};${look.displayItalic ? 'font-style:italic;font-weight:800;letter-spacing:-0.01em;' : ''}">${esc(g.name)}</div></div>`
    const satTimes = sats.map((s, i) => when(s.at, at + 0.6 + i * 0.22, ctx.start))
    const satHtml = sats
      .slice(0, ORBIT.length)
      .map((s, i) => {
        const [dx, dy, share] = ORBIT[i]
        const size = tileSize * share
        const left = tileSize / 2 + dx * tileSize - size / 2
        const top = tileSize / 2 + dy * tileSize - size / 2
        return `<div class="ls-sat ls-sat-${i}" style="left:${r1(left)}px;top:${r1(top)}px;width:${r1(size)}px;z-index:${dy > 0 ? 3 : 1}">${tile(s, { size, light: true })}${s.label ? `<div class="ls-sat-label" style="font-size:${r1(Math.max(16 * k, size * 0.15))}px">${esc(s.label)}</div>` : ''}</div>`
      })
      .join('')
    const hub = `<div class="ls-hub" style="margin-top:${r1(zone.h * 0.05)}px;width:${r1(tileSize)}px;height:${r1(tileSize)}px">${satHtml}<div style="position:relative;z-index:2">${tile(g.mark, { size: tileSize, cls: 'ls-main' })}</div></div>`
    let foot = ''
    if (g.stat)
      foot = `<div class="ls-wire" style="height:${r1(zone.h * 0.06)}px;margin:${r1(8 * k)}px 0"></div><div class="ls-mask"><div class="ls-rise ls-stat" style="font-size:${r1(footSize)}px">${esc(g.stat.value)}</div></div>${g.stat.label ? `<div class="ls-subline ls-stat-label" style="font-size:${r1(footSize * 0.66)}px">${esc(g.stat.label)}</div>` : ''}`
    else if (g.lines?.length)
      foot = `<div class="ls-wire" style="height:${r1(zone.h * 0.045)}px;margin:${r1(8 * k)}px 0"></div><div class="ls-desc ls-l0" data-fit="parent" style="font-size:${r1(footSize)}px">${esc(g.lines[0])}</div>${g.lines[1] ? `<div class="ls-subline ls-l1" data-fit="parent" style="font-size:${r1(footSize * 0.82)}px">${esc(g.lines[1])}</div>` : ''}`
    const footAt = when(g.stat?.at ?? g.linesAt, at + 0.7, ctx.start)
    const js = [
      `H.rise(H.q('.ls-name', G), ${t(at)});`,
      `H.pop(H.q('.ls-main', G), ${t(at + 0.14)}, { from: 0.7 });`,
      g.stat || g.lines?.length
        ? `tl.fromTo(H.q('.ls-wire', G), { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: 'power2.out' }, ${t(footAt)});`
        : '',
      g.stat ? `H.rise(H.q('.ls-stat', G), ${t(footAt + 0.18)});` : '',
      g.stat?.label ? `H.blurIn(H.q('.ls-stat-label', G), ${t(footAt + 0.4)}, { y: 10 });` : '',
      g.lines?.length ? `H.blurIn(H.q('.ls-l0', G), ${t(footAt + 0.15)}, { y: 12 });` : '',
      g.lines?.[1] ? `H.blurIn(H.q('.ls-l1', G), ${t(footAt + 0.32)}, { y: 12 });` : '',
      ...sats.slice(0, ORBIT.length).map((_, i) => {
        const [dx, dy] = ORBIT[i]
        return `tl.fromTo(H.q('.ls-sat-${i}', G), { opacity: 0, x: ${r1(dx * tileSize * 0.7)}, y: ${r1(dy * tileSize * 0.7)}, scale: 0.6, filter: 'blur(${r1(10 * k)}px)' }, { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.6, ease: 'expo.out' }, ${t(satTimes[i])});`
      })
    ]
    return {
      html: `<div class="ls-k-app">${name}${hub}${foot}</div>`,
      js: js.filter(Boolean).join('\n')
    }
  }
}
