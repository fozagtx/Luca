/**
 * app: a product's name card. The lowercase name rises, its glass tile pops in under it, and a
 * hairline drops from the tile to a stat ("180k / GitHub stars") or to what it is in two lines
 * ("a chat app / on top of ollama"). Satellites (the models it runs, what it plugs into) fly in
 * around the tile, overlapping it, each with its name inside, and the tile drops to make room.
 */
import type { StudioMark } from '../schema'
import { esc, initials, r1, tile } from '../parts'
import { t, when, type KindModule } from './types'

/**
 * Where satellites sit around the main tile: offset in tile sizes, and size as a share of it.
 * Measured on the reference: two big ones in front overlapping the tile's lower corners, small
 * ones behind and to the sides.
 */
const ORBIT: [number, number, number][] = [
  [-0.78, 0.5, 0.84],
  [0.38, 0.6, 0.95],
  [-0.52, -0.7, 0.24],
  [0.6, -0.6, 0.44],
  [1.1, 0.04, 0.44],
  [-1.27, -0.18, 0.44]
]

/**
 * A satellite: a light tile with its name inside along the bottom, as in the reference, so a long
 * name shrinks to the tile instead of running into a neighbour or under the main tile.
 */
function satTile(m: StudioMark, size: number, k: number): string {
  const named = !!m.label
  const logo = r1(size * (named ? 0.42 : 0.6))
  const mono = m.mono ?? initials(m.label ?? '')
  const monoSize = size * (mono.length > 2 ? 0.3 : 0.38) * (named ? 0.75 : 1)
  const mark = m.logo
    ? `<img class="ls-logo${m.tint ? ' ls-tint' : ''}" src="${esc(m.logo)}" alt="" style="width:${logo}px;height:${logo}px" />`
    : `<span class="ls-mono" style="font-size:${r1(monoSize)}px">${esc(mono)}</span>`
  const label = named
    ? `<div class="ls-sat-lw"><div class="ls-sat-label" data-fit="parent" style="font-size:${r1(Math.max(11 * k, size * 0.12))}px">${esc(m.label!)}</div></div>`
    : ''
  return `<div class="ls-tile-wrap" style="width:${r1(size)}px;height:${r1(size)}px"><div class="ls-tile ls-tile-light ls-sat-tile" style="border-radius:${r1(size * 0.24)}px;gap:${r1(size * 0.05)}px">${mark}${label}</div></div>`
}

export const app: KindModule<'app'> = {
  css: (s) => `
      ${s} .ls-k-app { display: flex; flex-direction: column; align-items: center; width: 100%; }
      ${s} .ls-k-app .ls-name { font-family: var(--display), sans-serif; font-weight: 500; letter-spacing: -0.035em; line-height: 1.05; text-align: center; }
      ${s} .ls-k-app .ls-hub { position: relative; display: flex; justify-content: center; }
      ${s} .ls-k-app .ls-sat { position: absolute; }
      ${s} .ls-k-app .ls-sat-tile { flex-direction: column; }
      ${s} .ls-k-app .ls-sat-lw { width: 84%; display: flex; justify-content: center; }
      ${s} .ls-k-app .ls-sat-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-family: var(--display), sans-serif; font-weight: 600; line-height: 1.1; letter-spacing: -0.03em; white-space: nowrap; }
      ${s} .ls-k-app .ls-foot { display: flex; flex-direction: column; align-items: center; max-width: 100%; }
      ${s} .ls-k-app .ls-wire { width: 0; border-left: 2px solid var(--line); transform-origin: top center; }
      ${s} .ls-k-app .ls-stat { font-family: var(--display), sans-serif; font-weight: 500; color: var(--fg); line-height: 1.1; letter-spacing: -0.02em; text-align: center; }
      ${s} .ls-k-app .ls-subline { font-family: var(--small), sans-serif; font-weight: 400; letter-spacing: -0.02em; color: var(--dim); line-height: 1.2; text-align: center; white-space: nowrap; }
      ${s} .ls-k-app .ls-desc { font-family: var(--display), sans-serif; font-weight: 400; color: var(--fg); line-height: 1.2; letter-spacing: -0.02em; text-align: center; white-space: nowrap; }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const sats = g.satellites ?? []
    const hasFoot = !!g.stat || !!g.lines?.length
    // the name, the tile and the foot share the zone's height
    const nameSize = Math.min(
      (zone.w * 0.82) / Math.max(4, g.name.length * 0.62),
      zone.h * 0.16,
      170 * k
    )
    // satellites need the room under the tile that a foot would take
    const below = hasFoot || sats.length > 0
    const tileSize = Math.min(zone.w * 0.31, zone.h * (below ? 0.27 : 0.36), 300 * k)
    const footSize = Math.min(58 * k, zone.w * 0.06)
    const at = when(g.at, ctx.start, ctx.start)
    const nameColor = look.nameColor ?? 'var(--fg)'
    const name = `<div class="ls-mask" style="max-width:100%"><div class="ls-rise ls-name" data-fit="parent" style="font-size:${r1(nameSize)}px;color:${nameColor};${look.displayItalic ? 'font-style:italic;font-weight:800;letter-spacing:-0.01em;' : ''}">${esc(g.name)}</div></div>`
    const footAt = when(g.stat?.at ?? g.linesAt, at + 0.7, ctx.start)
    // satellites wait until what is under the tile has been read
    const satTimes = sats.map((s, i) =>
      when(s.at, (hasFoot ? footAt + 1.1 : at + 0.6) + i * 0.22, ctx.start)
    )
    const satHtml = sats
      .slice(0, ORBIT.length)
      .map((s, i) => {
        const [dx, dy, share] = ORBIT[i]
        const size = tileSize * share
        const left = tileSize / 2 + dx * tileSize - size / 2
        const top = tileSize / 2 + dy * tileSize - size / 2
        return `<div class="ls-sat ls-sat-${i}" style="left:${r1(left)}px;top:${r1(top)}px;z-index:${dy > 0 ? 3 : 1}">${satTile(s, size, k)}</div>`
      })
      .join('')
    // without a foot, the hub keeps the foot's room below it so the dropped cluster stays in the zone
    const room = sats.length && !hasFoot ? `margin-bottom:${r1(tileSize * 0.75)}px;` : ''
    const hub = `<div class="ls-hub" style="margin-top:${r1(zone.h * 0.09)}px;${room}width:${r1(tileSize)}px;height:${r1(tileSize)}px">${satHtml}<div style="position:relative;z-index:2">${tile(g.mark, { size: tileSize, cls: 'ls-main' })}</div></div>`
    let foot = ''
    if (g.stat)
      foot = `<div class="ls-wire" style="height:${r1(zone.h * 0.08)}px;margin:${r1(8 * k)}px 0"></div><div class="ls-mask"><div class="ls-rise ls-stat" style="font-size:${r1(footSize)}px">${esc(g.stat.value)}</div></div>${g.stat.label ? `<div class="ls-subline ls-stat-label" style="font-size:${r1(footSize * 0.66)}px">${esc(g.stat.label)}</div>` : ''}`
    else if (g.lines?.length)
      foot = `<div class="ls-wire" style="height:${r1(zone.h * 0.07)}px;margin:${r1(8 * k)}px 0"></div><div class="ls-desc ls-l0" data-fit="parent" style="font-size:${r1(footSize)}px">${esc(g.lines[0])}</div>${g.lines[1] ? `<div class="ls-subline ls-l1" data-fit="parent" style="font-size:${r1(footSize * 0.82)}px">${esc(g.lines[1])}</div>` : ''}`
    const js = [
      `H.rise(H.q('.ls-name', G), ${t(at)});`,
      `H.pop(H.q('.ls-main', G), ${t(at + 0.14)}, { from: 0.7 });`,
      g.stat || g.lines?.length
        ? `H.enter(H.q('.ls-wire', G), { scaleY: 0 }, { scaleY: 1, duration: 0.2, ease: 'power2.out' }, ${t(footAt)});`
        : '',
      g.stat ? `H.rise(H.q('.ls-stat', G), ${t(footAt + 0.08)});` : '',
      g.stat?.label ? `H.blurIn(H.q('.ls-stat-label', G), ${t(footAt + 0.24)}, { y: 10 });` : '',
      g.lines?.length ? `H.blurIn(H.q('.ls-l0', G), ${t(footAt + 0.08)}, { y: 12 });` : '',
      g.lines?.[1] ? `H.blurIn(H.q('.ls-l1', G), ${t(footAt + 0.22)}, { y: 12 });` : '',
      // the satellites take the room: what was under the tile clears before the first arrives,
      // then the tile drops half its size into it
      hasFoot && sats.length
        ? `tl.fromTo(H.q('.ls-foot', G), { opacity: 1 }, { opacity: 0, duration: 0.25, ease: 'power2.in', immediateRender: false }, ${t(Math.max(footAt + 0.4, Math.min(...satTimes) - 0.3))});`
        : '',
      sats.length
        ? `tl.fromTo(H.q('.ls-hub', G), { y: 0 }, { y: ${r1(tileSize * 0.5)}, duration: 0.6, ease: 'expo.inOut', immediateRender: false }, ${t(Math.max(at + 0.3, Math.min(...satTimes) - 0.1))});`
        : '',
      ...sats.slice(0, ORBIT.length).map((_, i) => {
        const [dx, dy] = ORBIT[i]
        return `H.enter(H.q('.ls-sat-${i}', G), { opacity: 0, x: ${r1(dx * tileSize * 0.7)}, y: ${r1(dy * tileSize * 0.7)}, scale: 0.6, filter: 'blur(${r1(10 * k)}px)' }, { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.6, ease: 'expo.out' }, ${t(satTimes[i])});`
      })
    ]
    return {
      html: `<div class="ls-k-app">${name}${hub}${foot ? `<div class="ls-foot">${foot}</div>` : ''}</div>`,
      js: js.filter(Boolean).join('\n')
    }
  }
}
