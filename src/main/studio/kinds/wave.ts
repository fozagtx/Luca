/**
 * wave: one to three dark audio cards, each a tiny mono caps label over a voice waveform of
 * rounded bars. A plain card arrives with dim ghost bars that light up left to right, as if
 * played; an accent card (the cloned voice) arrives empty, then its lime bars rise from a flat
 * center line all together. Settled bars keep a soft ripple. For "your voice" → "the clone",
 * before → after.
 */
import { esc, r1, waveBars } from '../parts'
import { t, when, type KindModule } from './types'

/** Card height as a share of its width, and the gap between cards as a share of its height. */
const RATIO = 0.26
const GAP = 0.34
/** Seeds that share an envelope, so a clone looks like its source with different detail. */
const SEEDS = [5, 2, 8]

export const wave: KindModule<'wave'> = {
  css: (s, k) => `
      ${s} .ls-k-wave { display: flex; flex-direction: column; align-items: center; justify-content: center; }
      ${s} .ls-k-wave.ls-wv-side { flex-direction: row; }
      ${s} .ls-k-wave .ls-wv {
        position: relative; flex: none; box-sizing: border-box;
        /* the reference's audio cards are near-black, a step darker than the other cards */
        background: color-mix(in srgb, var(--card) 62%, #000);
        box-shadow:
          inset 0 ${r1(1.5 * k)}px 0 rgba(255,255,255,0.08),
          inset 0 -${r1(2 * k)}px ${r1(6 * k)}px rgba(0,0,0,0.3),
          0 ${r1(26 * k)}px ${r1(52 * k)}px var(--shadow),
          0 ${r1(6 * k)}px ${r1(14 * k)}px var(--shadow);
      }
      ${s} .ls-k-wave .ls-wv::before {
        content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
        background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 55%);
      }
      ${s} .ls-k-wave .ls-wv-head { position: absolute; overflow: hidden; }
      ${s} .ls-k-wave .ls-wv-label {
        font-family: var(--mono), monospace; font-weight: 500; text-transform: uppercase; letter-spacing: 0.2em;
        line-height: 1; white-space: nowrap; color: var(--card-dim);
      }
      ${s} .ls-k-wave .ls-wv-accent .ls-wv-label { color: var(--accent); opacity: 0.75; }
      ${s} .ls-k-wave .ls-wv-bars { position: absolute; display: flex; align-items: center; justify-content: space-between; color: var(--card-fg); }
      ${s} .ls-k-wave .ls-wv-accent .ls-wv-bars { color: var(--accent); }
      ${s} .ls-k-wave .ls-wv-bar { flex: none; transform-origin: 50% 50%; }
      ${s} .ls-k-wave .ls-wv-bar b { display: block; width: 100%; height: 100%; background: currentColor; transform-origin: 50% 50%; }
`,
  render: (g, ctx) => {
    const { zone, k } = ctx
    const n = g.cards.length
    // stacked unless the zone is so wide and short that cards side by side come out bigger
    const stackW = Math.min(zone.w * 0.9, (zone.h * 0.94) / (RATIO * (n + GAP * (n - 1))), 980 * k)
    const sideW = Math.min((zone.w * 0.94) / (n + 0.06 * (n - 1)), (zone.h * 0.9) / RATIO, 980 * k)
    const side = n > 1 && sideW > stackW * 1.15
    const w = side ? sideW : stackW
    const h = w * RATIO
    const gap = side ? w * 0.06 : h * GAP
    const padX = w * 0.04
    const labelSize = Math.max(13 * k, h * 0.085)
    // dense enough (about 90 bars on a portrait card) to read as one envelope, not a spike plot
    const count = Math.max(48, Math.min(110, Math.round((w - padX * 2) / (9 * k))))
    const pitch = (w - padX * 2) / count
    const barW = pitch * 0.5
    const start = when(g.at, ctx.start, ctx.start)
    const spacing = Math.min(0.9, Math.max(0.45, (ctx.end - start - 0.8) / n))
    const times = g.cards.map((c, i) => when(c.at, start + i * spacing, ctx.start))

    const cards = g.cards.map((c, i) => {
      const labelled = !!c.label
      const maxH = h * (labelled ? 0.56 : 0.62)
      const mid = labelled ? h * 0.6 : h * 0.5
      const bars = waveBars(count, SEEDS[i % SEEDS.length])
        .map((v) => {
          // a voice never drops to silence mid-phrase: the quietest bar keeps about a third
          const bh = Math.max(barW, maxH * (0.3 + 0.7 * v))
          return `<i class="ls-wv-bar" style="width:${r1(barW)}px;height:${r1(bh)}px"><b style="border-radius:${r1(barW / 2)}px"></b></i>`
        })
        .join('')
      const head = labelled
        ? `<div class="ls-wv-head" style="left:${r1(padX)}px;top:${r1(h * 0.12)}px;width:${r1(w - padX * 2)}px"><div class="ls-wv-label" data-fit="parent" style="font-size:${r1(labelSize)}px">${esc(c.label!)}</div></div>`
        : ''
      const margin = i ? (side ? `margin-left:${r1(gap)}px;` : `margin-top:${r1(gap)}px;`) : ''
      return `<div class="ls-wv ls-wv-${i}${c.accent ? ' ls-wv-accent' : ''}" style="width:${r1(w)}px;height:${r1(h)}px;border-radius:${r1(Math.min(22 * k, h * 0.11))}px;${margin}">${head}<div class="ls-wv-bars" style="left:${r1(padX)}px;right:${r1(padX)}px;top:${r1(mid - maxH / 2)}px;height:${r1(maxH)}px">${bars}</div></div>`
    })

    const js: string[] = []
    g.cards.forEach((c, i) => {
      const at = times[i]
      const sel = `'.ls-wv-${i} .ls-wv-bar'`
      const inner = `'.ls-wv-${i} .ls-wv-bar b'`
      js.push(
        `H.blurIn(H.q('.ls-wv-${i}', G), ${t(at)}, { y: 20, blur: 12, scale: 0.98, dur: 0.3 });`
      )
      // the source plays: ghost bars light up left to right. The clone is generated: its card
      // sits empty a beat, then a flat lime line appears and swells to full all at once (no
      // sweep), early enough to be seen complete before the beat cuts
      const sweep = c.accent ? 0.06 : 0.42
      const from = c.accent ? Math.max(at + 0.1, Math.min(at + 0.3, ctx.end - 0.7)) : at + 0.1
      if (c.accent)
        js.push(
          `tl.fromTo(H.q('.ls-wv-${i} .ls-wv-bars', G), { opacity: 0 }, { opacity: 1, duration: 0.05, ease: 'none' }, ${t(from)});`
        )
      js.push(
        c.accent
          ? `H.qa(${sel}, G).forEach(function (el, j, a) { tl.fromTo(el, { scaleY: 0.06, opacity: 1 }, { scaleY: 1, opacity: 1, duration: 0.28, ease: 'power2.out' }, ${t(from)} + (j / a.length) * ${sweep}); });`
          : `H.qa(${sel}, G).forEach(function (el, j, a) { tl.fromTo(el, { scaleY: 0.5, opacity: 0.2 }, { scaleY: 1, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${t(from)} + (j / a.length) * ${sweep}); });`
      )
      // a settled card keeps breathing: a slow ripple travels along its bars until the beat ends
      const life = from + sweep + 0.4
      const period = 0.9
      const reps = Math.floor((ctx.end - life) / period)
      if (reps >= 1)
        js.push(
          `H.qa(${inner}, G).forEach(function (el, j, a) { tl.fromTo(el, { scaleY: 1 }, { scaleY: 0.78, duration: ${t(period)}, ease: 'sine.inOut', yoyo: true, repeat: ${reps} }, ${t(life)} + (j / a.length) * 0.7); });`
        )
    })
    return {
      html: `<div class="ls-k-wave${side ? ' ls-wv-side' : ''}">${cards.join('')}</div>`,
      js: js.join('\n')
    }
  }
}
