/**
 * compare: one picture, before and after. It arrives soft (blurred, a little flat and grey) under
 * a black "before" tag at its top-left corner; at `afterAt` a thin divider with an accent handle
 * sweeps across it and leaves the sharp picture behind, and the tag fills with the accent and
 * reads "after". For an upscaler, a filter, a retouch: anything that makes the same image better.
 */
import { esc, r1, tag } from '../parts'
import { t, when, type KindModule } from './types'

const HANDLE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M9.5 7.5L5 12l4.5 4.5M14.5 7.5L19 12l-4.5 4.5"/></svg>'

export const compare: KindModule<'compare'> = {
  css: (s, k) => `
      ${s} .ls-k-compare { display: flex; flex-direction: column; align-items: flex-start; }
      ${s} .ls-k-compare .ls-cp-tags { position: relative; display: flex; align-items: flex-end; width: 100%; }
      ${s} .ls-k-compare .ls-cp-after { position: absolute; left: 0; bottom: 0; }
      ${s} .ls-k-compare .ls-cp-atext { display: inline-block; }
      ${s} .ls-k-compare .ls-cp-card {
        position: relative; overflow: hidden; background: var(--card);
        box-shadow: 0 ${r1(26 * k)}px ${r1(56 * k)}px var(--shadow), 0 ${r1(6 * k)}px ${r1(14 * k)}px var(--shadow);
      }
      ${s} .ls-k-compare .ls-cp-img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
      ${s} .ls-k-compare .ls-cp-soft {
        left: -2%; top: -2%; width: 104%; height: 104%;
        filter: blur(${r1(5.5 * k)}px) saturate(0.72) contrast(0.84) brightness(1.04);
      }
      ${s} .ls-k-compare .ls-cp-sharp { position: absolute; inset: 0; }
      ${s} .ls-k-compare .ls-cp-bar {
        position: absolute; top: 0; bottom: 0; left: 0; width: ${r1(4 * k)}px; margin-left: -${r1(2 * k)}px;
        background: var(--pill); box-shadow: 0 0 ${r1(10 * k)}px rgba(0,0,0,0.35);
      }
      ${s} .ls-k-compare .ls-cp-knob {
        position: absolute; left: 50%; top: 50%; display: flex; align-items: center; justify-content: center;
        border-radius: 50%; background: var(--accent); color: var(--pill-fg);
        box-shadow: 0 ${r1(3 * k)}px ${r1(10 * k)}px rgba(0,0,0,0.35);
      }
      ${s} .ls-k-compare .ls-cp-knob svg { width: 62%; height: 62%; display: block; }
`,
  render: (g, ctx) => {
    const { zone, k } = ctx
    // ~4:5 in a tall zone, wider as the zone gets wider
    const aspect = Math.min(1.5, Math.max(0.8, (zone.w / zone.h) * 0.7))
    let tagS = 54 * k
    const tagGap = 14 * k
    const room = zone.h * 0.92 - tagS * 1.5 - tagGap
    const cardH = Math.min(room, (zone.w * 0.86) / aspect)
    const cardW = cardH * aspect
    tagS = Math.min(tagS, cardW * 0.08)
    const knob = 40 * k
    // the reference sits low in its zone: the picture's foot near the zone's foot
    const lower = Math.max(0, zone.h - (cardH + tagS * 1.5 + tagGap)) * 0.85

    const at = when(g.at, ctx.start, ctx.start)
    const afterAt = Math.min(Math.max(at + 0.3, ctx.end - 0.5), Math.max(at + 0.3, g.afterAt))
    const wipe = 0.45
    const flip = afterAt + wipe * 0.45
    const before = g.before ?? 'before'
    const after = g.after ?? 'after'
    const src = esc(g.image)

    const html = `<div class="ls-k-compare" style="width:${r1(cardW)}px;margin-top:${r1(lower)}px"><div class="ls-cp-tags" style="margin-bottom:${r1(tagGap)}px"><div class="ls-cp-before">${tag(before, tagS)}</div><span class="ls-tag ls-tag-accent ls-cp-after" style="font-size:${r1(tagS)}px"><span class="ls-cp-atext">${esc(after)}</span></span></div><div class="ls-cp-card" style="width:${r1(cardW)}px;height:${r1(cardH)}px;border-radius:${r1(20 * k)}px"><img class="ls-cp-img ls-cp-soft" src="${src}" alt="" /><div class="ls-cp-sharp"><img class="ls-cp-img" src="${src}" alt="" /></div><div class="ls-cp-bar"><div class="ls-cp-knob" style="width:${r1(knob)}px;height:${r1(knob)}px;margin:-${r1(knob / 2)}px 0 0 -${r1(knob / 2)}px">${HANDLE_SVG}</div></div></div></div>`

    const js = [
      `H.blurIn(H.q('.ls-cp-card', G), ${t(at)}, { y: 20, blur: 12, scale: 0.98, dur: 0.32 });`,
      `H.blurIn(H.q('.ls-cp-tags', G), ${t(at + 0.12)}, { y: 12, blur: 10 });`,
      // the divider sweeps left to right and the sharp picture follows it
      `tl.fromTo(H.q('.ls-cp-sharp', G), { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: ${wipe}, ease: 'power2.inOut' }, ${t(afterAt)});`,
      `tl.fromTo(H.q('.ls-cp-bar', G), { x: 0 }, { x: ${r1(cardW)}, duration: ${wipe}, ease: 'power2.inOut' }, ${t(afterAt)});`,
      `tl.fromTo(H.q('.ls-cp-bar', G), { opacity: 0 }, { opacity: 1, duration: 0.08 }, ${t(afterAt - 0.04)});`,
      `tl.fromTo(H.q('.ls-cp-bar', G), { opacity: 1 }, { opacity: 0, duration: 0.16, immediateRender: false }, ${t(afterAt + wipe)});`,
      // the tag fills with the accent, then reads "after"
      `tl.fromTo(H.q('.ls-cp-after', G), { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.2, ease: 'power2.out' }, ${t(flip)});`,
      `H.hide(H.q('.ls-cp-before', G), ${t(flip + 0.1)});`,
      `H.blurIn(H.q('.ls-cp-atext', G), ${t(flip + 0.14)}, { blur: 6, dur: 0.3 });`
    ]
    return { html, js: js.join('\n') }
  }
}
