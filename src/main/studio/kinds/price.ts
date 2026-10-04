/**
 * price: the price you stop paying, then the one you pay now. The paid tool's name small over
 * its price in red, a dark line striking it through when it's said, then the free one's black tag
 * and "$0" landing under it, settling out of a blur. With `crossed`, the paid tools are frosted
 * glass tiles (name inside, under the logo) and each gets a red X instead. Stacks in tall frames;
 * old price left, new price right in wide ones.
 */
import { CROSS, esc, initials, r1, tag } from '../parts'
import type { StudioMark } from '../schema'
import { t, when, type KindModule } from './types'

/** Em per character: the grotesk's medium lowercase, a tag's bold. */
const LOW = 0.6
const TAG = 0.64

/** Rough width in em of each character of a price in the grotesk's black, tracking included. */
const EM: [RegExp, number][] = [
  [/[0-9$€£¥]/, 0.75],
  [/[.,:;'!|]/, 0.32],
  [/\s/, 0.26],
  [/[/\-()~]/, 0.48],
  [/[mwMW%@]/, 1.08],
  [/[A-Z]/, 0.86]
]
const figEm = (s: string): number =>
  Math.max(
    1.4,
    [...s].reduce((n, c) => n + (EM.find(([re]) => re.test(c))?.[1] ?? 0.76), 0)
  )

/** A frosted glass tile with the tool's name written small inside it, under the logo. */
function paidTile(m: StudioMark, size: number, i: number): string {
  const s = r1(size)
  const named = !!m.label
  const logo = r1(size * (named ? 0.38 : 0.56))
  const mark = m.logo
    ? `<img class="ls-logo${m.tint ? ' ls-tint' : ''}" src="${esc(m.logo)}" alt="" style="width:${logo}px;height:${logo}px" />`
    : `<span class="ls-mono" style="font-size:${r1(size * (named ? 0.27 : 0.36))}px">${esc(m.mono ?? initials(m.label ?? ''))}</span>`
  const label = named
    ? `<div class="ls-pr-tlw"><div class="ls-pr-tl" data-fit="parent" style="font-size:${r1(size * 0.1)}px">${esc(m.label!)}</div></div>`
    : ''
  return `<div class="ls-tile-wrap ls-pr-t ls-pr-t-${i}" style="width:${s}px;height:${s}px"><div class="ls-tile ls-tile-light ls-pr-tile" style="border-radius:${r1(size * 0.16)}px;gap:${r1(size * 0.06)}px">${mark}${label}</div>${CROSS}</div>`
}

export const price: KindModule<'price'> = {
  css: (s, k) => `
      ${s} .ls-k-price { display: flex; align-items: center; justify-content: center; width: 100%; }
      ${s} .ls-k-price .ls-pr-old, ${s} .ls-k-price .ls-pr-new { display: flex; flex-direction: column; align-items: center; max-width: 100%; }
      ${s} .ls-k-price .ls-pr-label { font-family: var(--display), sans-serif; color: var(--dim); line-height: 1.2; letter-spacing: -0.03em; white-space: nowrap; text-align: center; }
      ${s} .ls-k-price .ls-pr-fw, ${s} .ls-k-price .ls-pr-tw { position: relative; max-width: 100%; }
      ${s} .ls-k-price .ls-pr-fig { font-family: var(--display), sans-serif; line-height: 1; letter-spacing: -0.04em; white-space: nowrap; text-align: center; }
      ${s} .ls-k-price .ls-pr-from { color: var(--alarm); }
      ${s} .ls-k-price .ls-pr-to { color: var(--fg); transform-origin: 50% 62%; will-change: transform, filter; }
      ${s} .ls-k-price .ls-pr-fw .ls-strike {
        left: -5%; right: -5%; top: 55%; height: 0.05em; min-height: ${r1(4 * k)}px; color: var(--fg); rotate: -2.5deg;
      }
      ${s} .ls-k-price .ls-pr-row { display: flex; align-items: center; justify-content: center; }
      ${s} .ls-k-price .ls-pr-tile {
        flex-direction: column;
        background: linear-gradient(158deg, rgba(244,242,237,0.95) 0%, rgba(216,212,204,0.93) 48%, rgba(194,190,182,0.95) 100%);
      }
      ${s} .ls-k-price .ls-pr-tlw { width: 84%; display: flex; justify-content: center; }
      ${s} .ls-k-price .ls-pr-tl { font-family: var(--display), sans-serif; font-weight: 600; line-height: 1.1; letter-spacing: -0.03em; white-space: nowrap; }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const marks = (g.crossed ?? []).slice(0, 3)
    const n = marks.length
    const wide = zone.w / zone.h > 1.6
    const italic = look.displayItalic ? 'font-style:italic;' : ''

    // sizes for a 1080 px short side, then shrunk together until they fit the zone
    let label = !n && g.label ? 46 * k : 0
    let from = !n && g.from ? 210 * k : 0
    let to = 225 * k
    let tagS = g.tag ? 52 * k : 0
    let tileS = n ? 365 * k : 0
    let tileGap = 58 * k
    let gapL = 30 * k
    let gapA = (n ? 170 : 84) * k
    let gapB = 30 * k
    const label0 = g.label ?? ''
    const labelEm = Math.max(5, label0.length) * LOW
    const tagEm = (g.tag ?? '').length * TAG + 1
    // the serif look's italic figures run much narrower
    const figW = (s: string): number => figEm(s) * (look.id === 'serif' ? 0.7 : 1)
    const oldW = n
      ? n * tileS + (n - 1) * tileGap
      : Math.max(label * labelEm, from * figW(g.from ?? ''))
    const newW = Math.max(to * figW(g.to), tagS * tagEm)
    const oldH = (label ? label * 1.2 + gapL : 0) + from + tileS
    const newH = (tagS ? tagS * 1.5 + gapB : 0) + to
    const gapMid = zone.w * 0.1
    const height = wide ? Math.max(oldH, newH) : oldH + (oldH ? gapA : 0) + newH
    const fit = Math.min(
      1,
      wide ? (zone.w * 0.9 - gapMid) / (oldW + newW) : (zone.w * 0.9) / Math.max(oldW, newW),
      (zone.h * (wide ? 0.86 : 0.9)) / height
    )
    // small text keeps a readable size while it has the room
    const share = wide ? 0.42 : 0.9
    if (label) label = Math.min(Math.max(label * fit, 32 * k), (zone.w * share) / labelEm)
    if (tagS) tagS = Math.min(Math.max(tagS * fit, 34 * k), (zone.w * share) / tagEm)
    from *= fit
    to *= fit
    tileS *= fit
    tileGap *= fit
    gapL *= fit
    gapA *= fit
    gapB *= fit
    // the reference sits a little under the middle of its zone
    const lower = Math.max(0, Math.min(zone.h - height * fit, 100 * k))

    const at = when(g.at, ctx.start, ctx.start)
    const late = Math.max(at + 0.25, ctx.end - 0.4)
    const strikeAt = Math.min(late, Math.max(at + 0.25, when(g.strikeAt, at + 0.6, ctx.start)))
    const toAt = Math.min(late, when(g.toAt, at + 1, ctx.start))
    // each tool is crossed on its own beat, the last one well before the cut
    const step = n > 1 ? Math.min(0.35, Math.max(0.12, (ctx.end - 0.45 - strikeAt) / (n - 1))) : 0

    const old: string[] = []
    if (n)
      old.push(
        `<div class="ls-pr-row" style="gap:${r1(tileGap)}px">${marks.map((m, i) => paidTile(m, tileS, i)).join('')}</div>`
      )
    else {
      if (label)
        old.push(
          `<div class="ls-pr-label" data-fit="parent" style="font-size:${r1(label)}px;font-weight:${look.weights.medium};margin-bottom:${r1(gapL)}px;${italic}">${esc(label0)}</div>`
        )
      if (from)
        old.push(
          `<div class="ls-pr-fw" style="font-size:${r1(from)}px"><div class="ls-pr-fig ls-pr-from" data-fit="parent" style="font-size:${r1(from)}px;font-weight:${look.weights.black};${italic}">${esc(g.from!)}</div><i class="ls-strike"></i></div>`
        )
    }
    const neu = [
      tagS
        ? `<div class="ls-pr-tag" style="margin-bottom:${r1(gapB)}px">${tag(g.tag!, tagS)}</div>`
        : '',
      `<div class="ls-pr-tw"><div class="ls-pr-fig ls-pr-to" data-fit="parent" style="font-size:${r1(to)}px;font-weight:${look.weights.black};${italic}">${esc(g.to)}</div></div>`
    ]
    const hasOld = old.length > 0
    const layout = wide
      ? `flex-direction:row;align-items:${n ? 'center' : 'flex-end'};gap:${r1(gapMid)}px`
      : 'flex-direction:column'
    const html = `<div class="ls-k-price" style="${layout};margin-top:${r1(lower)}px">${hasOld ? `<div class="ls-pr-old">${old.join('')}</div>` : ''}<div class="ls-pr-new"${hasOld && !wide ? ` style="margin-top:${r1(gapA)}px"` : ''}>${neu.join('')}</div></div>`

    // pops with a soft overshoot; the blur clears on its own ease so it never goes negative
    const js: string[] = [
      `function pop(el, at, from) { if (!el) return; tl.fromTo(el, { opacity: 0, scale: from }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.5)' }, at); tl.fromTo(el, { filter: 'blur(${r1(8 * k)}px)' }, { filter: 'blur(0px)', duration: 0.32, ease: 'power2.out' }, at); }`
    ]
    if (n) {
      marks.forEach((_, i) => {
        js.push(`pop(H.q('.ls-pr-t-${i}', G), ${t(at + i * 0.08)}, 0.7);`)
        const c =
          marks[i].at !== undefined ? Math.max(at + 0.25, marks[i].at!) : strikeAt + i * step
        js.push(
          `(function (x) { var b = H.qa('b', x); H.draw(b[0], ${t(c)}, { dur: 0.18 }); H.draw(b[1], ${t(c + 0.13)}, { dur: 0.18 }); })(H.q('.ls-pr-t-${i} .ls-x', G));`
        )
      })
    } else {
      if (label) js.push(`H.blurIn(H.q('.ls-pr-label', G), ${t(at)}, { y: 14, blur: 12 });`)
      if (from) {
        js.push(`H.blurIn(H.q('.ls-pr-fw', G), ${t(at + 0.05)}, { y: 26, blur: 18, dur: 0.5 });`)
        js.push(`H.draw(H.q('.ls-pr-fw .ls-strike', G), ${t(strikeAt)}, { dur: 0.3 });`)
      }
    }
    if (tagS) js.push(`pop(H.q('.ls-pr-tag', G), ${t(Math.max(at, toAt - 0.06))}, 0.8);`)
    // lands: settles from a slight zoom out of a blur
    js.push(
      `tl.fromTo(H.q('.ls-pr-to', G), { opacity: 0, scale: 1.22, filter: 'blur(${r1(16 * k)}px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.6, ease: 'expo.out' }, ${t(toAt)});`
    )
    return { html, js: js.join('\n') }
  }
}
