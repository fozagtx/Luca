/**
 * number: one huge value that lands, e.g. "monthly bill" struck through, then "$0" rising out
 * of its mask and settling from a slight zoom and blur, "after that" small under it. For the
 * single figure a beat is about: a price that drops to nothing, "10×", "3 min".
 */
import { esc, r1 } from '../parts'
import { t, when, type KindModule } from './types'

export const number: KindModule<'number'> = {
  css: (s) => `
      ${s} .ls-k-number { display: flex; flex-direction: column; align-items: center; width: 100%; }
      ${s} .ls-k-number .ls-nb-line { position: relative; max-width: 100%; }
      ${s} .ls-k-number .ls-nb-label { font-family: var(--display), sans-serif; line-height: 1.08; letter-spacing: -0.035em; color: var(--fg); text-align: center; }
      ${s} .ls-k-number .ls-nb-line .ls-strike { top: 56%; color: var(--fg); }
      ${s} .ls-k-number .ls-nb-vmask { overflow: hidden; max-width: 100%; padding: 0.1em 0.2em 0.03em; margin: -0.1em -0.2em -0.03em; box-sizing: content-box; }
      ${s} .ls-k-number .ls-nb-value {
        font-family: var(--display), sans-serif; line-height: 1; letter-spacing: -0.045em; color: var(--fg);
        white-space: nowrap; text-align: center; transform-origin: 50% 70%; will-change: transform, filter;
      }
      ${s} .ls-k-number .ls-nb-sub { font-family: var(--display), sans-serif; line-height: 1.2; color: var(--dim); white-space: nowrap; text-align: center; letter-spacing: -0.02em; }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const italic = look.displayItalic ? 'font-style:italic;' : ''
    // the grotesk's black digits run ~0.8 em wide, its medium lowercase ~0.5–0.6 em; the fit pass
    // shrinks anything still too wide
    let value = Math.min(400 * k, (zone.w * 0.9) / Math.max(1.6, g.value.length * 0.8))
    let label = g.label ? Math.min(104 * k, (zone.w * 0.9) / Math.max(5, g.label.length * 0.52)) : 0
    let sub = g.sub ? Math.min(46 * k, (zone.w * 0.9) / Math.max(8, g.sub.length * 0.62)) : 0
    // gaps sized off the value, then everything shrinks together if the zone is short
    const total = (): number =>
      (label ? label * 1.08 + value * 0.15 : 0) +
      value * 1.05 +
      (sub ? value * 0.12 + sub * 1.2 : 0)
    const fit = Math.min(1, (zone.h * 0.92) / total())
    value *= fit
    label *= fit
    sub *= fit

    const at = when(g.at, ctx.start, ctx.start)
    const strikeAt =
      g.label && g.strikeAt !== undefined ? Math.max(at + 0.3, g.strikeAt) : undefined
    const valueAt = Math.min(
      Math.max(at, ctx.end - 0.35),
      when(g.valueAt, g.label ? (strikeAt ?? at + 0.45) : at, ctx.start)
    )

    const html: string[] = []
    if (g.label)
      html.push(
        `<div class="ls-nb-line" style="font-size:${r1(label)}px;margin-bottom:${r1(value * 0.15)}px"><div class="ls-mask"><div class="ls-rise ls-nb-label" data-fit="parent" style="font-size:${r1(label)}px;font-weight:${look.weights.medium};${italic}">${esc(g.label)}</div></div>${strikeAt !== undefined ? `<i class="ls-strike" style="height:${r1(Math.max(4 * k, label * 0.075))}px"></i>` : ''}</div>`
      )
    html.push(
      `<div class="ls-nb-vmask" style="font-size:${r1(value)}px"><div class="ls-nb-vrise"><div class="ls-nb-value" data-fit="parent" style="font-size:${r1(value)}px;font-weight:${look.weights.black};${italic}">${esc(g.value)}</div></div></div>`
    )
    if (g.sub)
      html.push(
        `<div class="ls-nb-sub" data-fit="parent" style="font-size:${r1(sub)}px;${look.id === 'serif' ? 'font-family:var(--text),sans-serif;font-weight:500' : `font-weight:${look.weights.medium}`};margin-top:${r1(value * 0.12)}px">${esc(g.sub)}</div>`
      )

    const js = [
      g.label ? `H.rise(H.q('.ls-nb-label', G), ${t(at)});` : '',
      strikeAt !== undefined ? `H.draw(H.q('.ls-strike', G), ${t(strikeAt)}, { dur: 0.28 });` : '',
      // lands: rises out of its mask while it settles from a slight zoom and blur
      `H.rise(H.q('.ls-nb-vrise', G), ${t(valueAt)}, { dur: 0.6 });`,
      `tl.fromTo(H.q('.ls-nb-value', G), { scale: 1.2, filter: 'blur(${r1(14 * k)}px)' }, { scale: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out' }, ${t(valueAt)});`,
      g.sub ? `H.blurIn(H.q('.ls-nb-sub', G), ${t(valueAt + 0.28)}, { y: 14 });` : ''
    ]
    return {
      html: `<div class="ls-k-number">${html.join('')}</div>`,
      js: js.filter(Boolean).join('\n')
    }
  }
}
