/**
 * image: a photo or a B-roll still in a rounded card with a big soft shadow, as big as the zone
 * allows: 4:5 in a tall zone, 16:10 in a wide one (a square-ish zone follows the picture's own
 * shape). It arrives out of a blur, rising a little, then the picture keeps pushing in slowly
 * inside its frame for the rest of the beat. An optional caption sits under it as a small tag.
 * For a beat that shows the thing being talked about: a place, a product shot, a screenshot.
 */
import { esc, r1 } from '../parts'
import { t, when, type KindModule } from './types'

export const image: KindModule<'image'> = {
  css: (s, k) => {
    const px = (n: number): string => `${r1(n * k)}px`
    return `
      ${s} .ls-k-image { display: flex; flex-direction: column; align-items: center; }
      ${s} .ls-k-image .ls-im-card {
        position: relative; flex: none; background: var(--card);
        box-shadow: 0 ${px(34)} ${px(80)} var(--shadow), 0 ${px(10)} ${px(22)} var(--shadow);
      }
      ${s} .ls-k-image .ls-im-frame { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
      ${s} .ls-k-image .ls-im-frame::after {
        content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
        box-shadow: inset 0 0 0 ${px(1.5)} color-mix(in srgb, var(--card-fg) 12%, transparent);
      }
      ${s} .ls-k-image .ls-im-img {
        display: block; width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%;
        transform-origin: 50% 40%;
      }
      ${s} .ls-k-image .ls-im-cap { display: flex; justify-content: center; }
`
  },
  render: (g, ctx) => {
    const { zone, k } = ctx
    const cap = g.caption ?? ''
    // the caption is estimated to fit (~0.68 em a character in the wide grotesk, plus padding);
    // the fit pass catches the rest
    let capFs = cap ? Math.min(34 * k, zone.h * 0.045) : 0
    const capGap = capFs * 0.8
    const capArea = cap ? capFs * 1.5 + capGap : 0
    const roomW = zone.w * 0.9
    const roomH = zone.h * 0.94 - capArea
    // 4:5 when the room is tall, 16:10 when it's wide; in between, the picture decides
    const r = roomW / roomH
    const size = ctx.imageSize(g.image)
    const landscape = !!size && size[0] / size[1] > 1.15
    const aspect = r >= 1.3 || (r >= 0.9 && landscape) ? 1.6 : 0.8
    const cardW = Math.min(roomW, roomH * aspect)
    const cardH = cardW / aspect
    if (cap) capFs = Math.min(capFs, (cardW * 0.94) / (cap.length * 0.68 + 1))

    const at = when(g.at, ctx.start, ctx.start)
    const caption = cap
      ? `<div class="ls-im-cap" style="width:${r1(cardW)}px;margin-top:${r1(capGap)}px"><span class="ls-tag ls-im-tag" data-fit="parent" style="font-size:${r1(capFs)}px">${esc(cap)}</span></div>`
      : ''
    const html = `<div class="ls-k-image"><div class="ls-im-card" style="width:${r1(cardW)}px;height:${r1(cardH)}px;border-radius:${r1(22 * k)}px"><div class="ls-im-frame"><img class="ls-im-img" src="${esc(g.image)}" alt="" /></div></div>${caption}</div>`

    const js = [
      `H.blurIn(H.q('.ls-im-card', G), ${t(at)}, { y: 44, blur: 20, scale: 0.965, dur: 0.6 });`,
      // a slow push on the picture, inside the frame, for the rest of the beat
      ctx.end - at > 0.2
        ? `tl.fromTo(H.q('.ls-im-img', G), { scale: 1 }, { scale: 1.06, duration: ${t(ctx.end - at)}, ease: 'none' }, ${t(at)});`
        : '',
      cap ? `H.blurIn(H.q('.ls-im-tag', G), ${t(at + 0.22)}, { y: 12, blur: 8, dur: 0.4 });` : ''
    ]
    return { html, js: js.filter(Boolean).join('\n') }
  }
}
