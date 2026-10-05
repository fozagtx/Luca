/**
 * window: the product on screen. With screenshots, one or two rounded cards (stacked, or side
 * by side in a wide zone) with a small white label stepping through features (tools → masks →
 * layers) and an amber box gliding over the first one to each feature as it's named. Without
 * screenshots, a clean dark chat app drawn in HTML: the prompt types into the field, jumps up
 * as the user's bubble, three dots pulse, and the reply blurs in where they were.
 */
import type { GraphicOf } from '../schema'
import { esc, r1, SEND_SVG, tag, typed } from '../parts'
import { t, when, type KindCtx, type KindModule, type KindOut } from './types'

type Win = GraphicOf<'window'>
type Label = { text: string; at: number }

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/** The labels, in time order, all in one grid cell so each swaps in where the last one was. */
function labelBlock(labels: Label[], fs: number, style: string): string {
  if (!labels.length) return ''
  const items = labels.map(
    (l, i) => `<div class="ls-wlab ls-wlab-${i}">${tag(l.text, fs, false, 'ls-wtag')}</div>`
  )
  return `<div class="ls-wlabels" style="${style}">${items.join('')}</div>`
}

function labelJs(labels: Label[], ctx: KindCtx): string[] {
  const times = labels.map((l) => when(l.at, ctx.start, ctx.start))
  return labels.flatMap((_, i) => [
    `H.blurIn(H.q('.ls-wlab-${i} .ls-tag', G), ${t(times[i])}, { y: 14, blur: 8, dur: 0.28 });`,
    i + 1 < labels.length
      ? `H.hide(H.q('.ls-wlab-${i}', G), ${t(Math.max(times[i] + 0.05, times[i + 1]))});`
      : ''
  ])
}

function sortedLabels(g: Win): Label[] {
  return [...(g.labels ?? [])].sort((a, b) => a.at - b.at)
}

/** Screenshots in rounded cards, a label stepping through features, an amber box moving over the first. */
function images(g: Win, ctx: KindCtx): KindOut {
  const { zone, k } = ctx
  const shots = (g.images ?? []).slice(0, 2)
  const n = shots.length
  const labels = sortedLabels(g)
  const tagFs = Math.min(34 * k, zone.h * 0.05)
  const gap = Math.max(tagFs * 1.1, 18 * k)
  const tagArea = labels.length ? tagFs * 1.5 + gap * 2 : 0
  const rowGap = 40 * k
  const stackGap = labels.length ? tagArea : 44 * k
  // stacked shots run a touch past the zone, the ~0.9 w the reference gives them
  const stackW = zone.w * 1.02
  // two cards go side by side when that makes them bigger (a typical 16:10 screenshot)
  const side =
    n === 2 &&
    Math.min((zone.w - rowGap) / 2, (zone.h - tagArea) * 1.6) >
      Math.min(stackW, ((zone.h - stackGap) / 2) * 1.6) * 1.05
  // the most room each card may take; its real size follows the image's own shape once loaded
  const maxW = side ? (zone.w - rowGap) / 2 : n === 2 ? stackW : zone.w * 0.96
  const maxH = side ? zone.h - tagArea : n === 2 ? (zone.h - stackGap) / 2 : zone.h - tagArea
  const w0 = Math.min(maxW, maxH * 1.6)
  // each image's own shape when Luca read it from the file; else a 16:10 guess the js corrects
  const ratios = shots.map((s) => {
    const size = ctx.imageSize(s.image)
    return size && size[0] > 0 && size[1] > 0 ? size[0] / size[1] : null
  })
  const widths = ratios.map((r) => (r ? Math.min(maxW, maxH * r) : w0))
  // two stacked shots of known shape share one width (so the height splits by their shapes)
  // when that shows about as much of them as an even height split: two wide shots fill the
  // column, a portrait next to a landscape keeps equal heights. One width wins near-ties: the
  // column reads tidier and the boxed first shot is never the narrow one
  const [ra, rb] = ratios
  if (n === 2 && !side && ra && rb) {
    const inv = 1 / ra + 1 / rb
    const wEq = Math.min(maxW, (zone.h - stackGap) / inv)
    if (wEq * wEq * inv > ((widths[0] * widths[0]) / ra + (widths[1] * widths[1]) / rb) * 0.95)
      widths.fill(wEq)
  }
  const sorted = [...(g.boxes ?? [])].sort((a, b) => a.at - b.at)
  const boxes = sorted.map((b) => {
    const x = clamp(b.x, 0, 0.98)
    const y = clamp(b.y, 0, 0.98)
    return { x, y, w: Math.min(b.w, 1 - x), h: Math.min(b.h, 1 - y) }
  })
  const boxAt: number[] = []
  for (const b of sorted)
    boxAt.push(Math.max(when(b.at, ctx.start, ctx.start), (boxAt[boxAt.length - 1] ?? -1) + 0.05))
  const at = when(g.at, ctx.start, ctx.start)
  const cardAt = shots.map((s, i) => when(s.at, at + i * 0.28, ctx.start))
  // the box lives in a 1000 × 1000 box stretched over the image; its stroke keeps its width
  const radius = 12 * k
  const attr = (b: { x: number; y: number; w: number; h: number }): string =>
    `attr: { x: ${r1(b.x * 1000)}, y: ${r1(b.y * 1000)}, width: ${r1(b.w * 1000)}, height: ${r1(b.h * 1000)} }`
  const cards = shots.map((s, i) => {
    const size = ctx.imageSize(s.image)
    const r = ratios[i] ?? 1.6
    const w = widths[i]
    const box =
      i === 0 && boxes.length
        ? `<svg class="ls-wbox" viewBox="0 0 1000 1000" preserveAspectRatio="none"><rect x="${r1(boxes[0].x * 1000)}" y="${r1(boxes[0].y * 1000)}" width="${r1(boxes[0].w * 1000)}" height="${r1(boxes[0].h * 1000)}" rx="${r1((radius * 1000) / w)}" ry="${r1((radius * 1000 * r) / w)}" vector-effect="non-scaling-stroke" /></svg>`
        : ''
    return `<div class="ls-wcard ls-wcard-${i}"${size ? '' : ` data-mw="${r1(maxW)}" data-mh="${r1(maxH)}"`} style="width:${r1(w)}px;height:${r1(w / r)}px"><div class="ls-wshot"><img src="${esc(s.image)}" alt="" /></div>${box}</div>`
  })
  const lab = labelBlock(labels, tagFs, `margin:${r1(gap)}px 0;height:${r1(tagFs * 1.5)}px`)
  let body: string
  if (side) body = `<div class="ls-wrow" style="gap:${r1(rowGap)}px">${cards.join('')}</div>${lab}`
  else if (n === 2)
    body = labels.length
      ? cards[0] + lab + cards[1]
      : `${cards[0]}<div style="height:${r1(stackGap)}px"></div>${cards[1]}`
  else body = cards[0] + lab

  const js = [
    // a card whose image size wasn't known takes the image's shape once it has loaded
    `H.qa('.ls-wcard[data-mw]', G).forEach(function (c) {
  var img = H.q('img', c);
  function fit() {
    var r = img.naturalWidth / img.naturalHeight;
    if (!r) return;
    var w = Math.min(+c.dataset.mw, +c.dataset.mh * r);
    c.style.width = Math.round(w * 10) / 10 + 'px';
    c.style.height = Math.round((w / r) * 10) / 10 + 'px';
    var box = H.q('.ls-wbox rect', c);
    if (box) {
      box.setAttribute('rx', Math.round(${r1(radius * 1000)} / w * 10) / 10);
      box.setAttribute('ry', Math.round(${r1(radius * 1000)} * r / w * 10) / 10);
    }
  }
  if (img.complete) fit();
  else img.addEventListener('load', fit);
});`,
    ...cardAt.map(
      (c, i) =>
        `H.blurIn(H.q('.ls-wcard-${i}', G), ${t(c)}, { y: 24, blur: 12, scale: 0.98, dur: 0.32 });`
    ),
    ...labelJs(labels, ctx)
  ]
  if (boxes.length) {
    const b0 = boxes[0]
    const grow = { x: b0.x - 0.03, y: b0.y - 0.05, w: b0.w + 0.06, h: b0.h + 0.1 }
    const first = boxAt.length > 1 ? Math.min(0.32, boxAt[1] - boxAt[0]) : 0.32
    js.push(
      `var box = H.q('.ls-wbox', G), frame = H.q('.ls-wbox rect', G);`,
      `tl.fromTo(box, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out' }, ${t(boxAt[0])});`,
      `tl.fromTo(frame, { ${attr(grow)} }, { ${attr(b0)}, duration: ${t(first)}, ease: 'power3.out' }, ${t(boxAt[0])});`
    )
    boxes.slice(1).forEach((b, j) => {
      const dur = Math.min(0.35, boxAt[j + 1] - boxAt[j])
      js.push(
        `tl.fromTo(frame, { ${attr(boxes[j])} }, { ${attr(b)}, duration: ${t(dur)}, ease: 'power3.inOut', immediateRender: false }, ${t(boxAt[j + 1])});`
      )
    })
  }
  return { html: `<div class="ls-k-window">${body}</div>`, js: js.filter(Boolean).join('\n') }
}

/** A dark chat app: the prompt types in, jumps up as a bubble, dots pulse, the reply arrives. */
function chat(g: Win, ctx: KindCtx): KindOut {
  const { zone, k } = ctx
  const c = g.chat
  const prompt = c?.prompt ?? ''
  const labels = sortedLabels(g)
  const tagFs = Math.min(34 * k, zone.h * 0.05)
  const tagArea = labels.length ? tagFs * 2.7 : 0
  const room = zone.h - tagArea
  const wide = zone.w / room > 1.6
  const aspect = wide ? 0.66 : 0.95
  const W = Math.min(zone.w * 0.95, room / aspect, 1000 * k)
  const Hh = Math.min(W * aspect, room)
  // sizes measured off the reference window (911 × 878 px in a 1080-wide frame); a wide window
  // packs its rows tighter, so its type can stay big
  const u = Math.min(W / 911, Hh / (wide ? 650 : 760))
  const px = (n: number): string => `${r1(n * u)}px`
  const pad = 52
  const barH = 76
  const fieldIn = 26
  const fieldH = Math.min(wide ? 130 : 150, (Hh / u) * 0.18)
  const send = Math.min(62, fieldH * 0.44)
  const textW = W / u - fieldIn * 2 - 32 - send - 40
  // a long prompt shrinks a little, then scrolls like a real field (its end stays in view)
  const promptFs = clamp(textW / Math.max(10, prompt.length * 0.54), 30, 40)

  const at = when(g.at, ctx.start, ctx.start)
  const typeAt = when(c?.typeAt, at + 0.35, ctx.start)
  // ~18 characters a second, quicker when the beat (or the reply) leaves less room: the send,
  // the jump and about a second of thinking dots must still fit before the cut
  const deadline = Math.min(ctx.end - 1.3, c?.replyAt !== undefined ? c.replyAt - 1.1 : Infinity)
  const cps = clamp(prompt.length / Math.max(0.1, deadline - typeAt), 18, 40)
  const typeEnd = typeAt + prompt.length / cps
  const jumpAt = typeEnd + 0.18
  const dotsAt = jumpAt + 0.22
  const replyAt = c?.reply
    ? Math.max(dotsAt + 0.45, when(c.replyAt, dotsAt + 1.2, ctx.start))
    : ctx.end
  const dotsEnd = Math.min(replyAt, ctx.end)

  const bar = `<div class="ls-wbar" style="height:${px(barH)};padding:0 ${px(30)};gap:${px(13)}"><span class="ls-wico" style="width:${px(30)};height:${px(30)};--ls-ring:${px(3)}"></span><span class="ls-wtitle" style="font-size:${px(27)}">${esc(c?.title ?? 'New chat')}</span></div>`
  const greet = `<div class="ls-wgreet"><span class="ls-wbub" style="font-size:${px(39)};padding:${px(10)} ${px(22)};border-radius:${px(15)}">${esc(c?.greeting ?? 'How can I help you today?')}</span></div>`
  const user = prompt
    ? `<div class="ls-wuser"><span class="ls-wbub ls-wme" style="font-size:${px(40)};padding:${px(12)} ${px(24)};border-radius:${px(17)}">${esc(prompt)}</span></div>`
    : ''
  const dots = `<div class="ls-wdots-w"><div class="ls-wdots" style="gap:${px(13)};padding:${px(14)} ${px(4)}">${`<i style="width:${px(14)};height:${px(14)}"></i>`.repeat(3)}</div></div>`
  const reply = c?.reply
    ? `<div class="ls-wreply" style="font-size:${px(38)};padding:0 ${px(4)}">${esc(c.reply)}</div>`
    : ''
  const msgs = `<div class="ls-wmsgs" style="top:${px(barH)};bottom:${px(fieldH + fieldIn * 2)};padding:${px(wide ? 46 : 72)} ${px(pad)} 0;gap:${px(wide ? 38 : 60)}">${greet}${user}${prompt ? `<div class="ls-wans">${dots}${reply}</div>` : ''}</div>`
  const field = `<div class="ls-wfield" style="left:${px(fieldIn)};right:${px(fieldIn)};bottom:${px(fieldIn)};height:${px(fieldH)};border-radius:${px(22)};padding:0 ${px(20)} 0 ${px(32)};gap:${px(20)}"><div class="ls-wtext" style="font-size:${px(promptFs)}"><span class="ls-wph">Ask anything</span><span class="ls-wtyped">${typed(prompt)}</span></div><div class="ls-wsend" style="width:${px(send)};height:${px(send)}"><span class="ls-wsend-off" style="border-radius:${px(12)}"></span><span class="ls-wsend-on"><span style="width:${px(send * 0.5)};height:${px(send * 0.5)}">${SEND_SVG}</span></span></div></div>`
  const win = `<div class="ls-wwin" style="width:${r1(W)}px;height:${r1(Hh)}px;border-radius:${r1(Math.max(14 * k, 28 * u))}px">${bar}${msgs}${field}</div>`
  const lab = labelBlock(
    labels,
    tagFs,
    `margin-top:${r1(tagFs * 1.1)}px;height:${r1(tagFs * 1.5)}px`
  )

  const js = [
    `var win = H.q('.ls-wwin', G), caret = H.q('.ls-caret', G);`,
    `H.blurIn(win, ${t(at)}, { y: 16, blur: 14, scale: 0.98, dur: 0.3 });`,
    `H.blurIn(H.q('.ls-wgreet', G), ${t(at + 0.2)}, { y: 10, blur: 8, dur: 0.45 });`,
    `H.blink(caret, ${t(at)}, ${t(prompt ? typeAt : ctx.end)});`,
    ...labelJs(labels, ctx)
  ]
  if (prompt) {
    js.push(
      `H.show(caret, ${t(typeAt)});`,
      `H.hide(H.q('.ls-wph', G), ${t(typeAt)});`,
      `H.type(H.q('.ls-wtyped', G), ${t(typeAt)}, ${r1(cps)});`,
      // sent: the button presses and goes grey, the field clears
      `tl.fromTo(H.q('.ls-wsend', G), { scale: 1 }, { scale: 0.84, duration: 0.1, ease: 'power2.in' }, ${t(jumpAt - 0.12)});`,
      `tl.fromTo(H.q('.ls-wsend', G), { scale: 0.84 }, { scale: 1, duration: 0.3, ease: 'back.out(2)', immediateRender: false }, ${t(jumpAt - 0.02)});`,
      `tl.fromTo(H.q('.ls-wsend-on', G), { opacity: 1 }, { opacity: 0, duration: 0.25, ease: 'power1.out' }, ${t(jumpAt)});`,
      `tl.fromTo(H.q('.ls-wsend-off', G), { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out' }, ${t(jumpAt)});`,
      `H.hide(H.q('.ls-wtyped', G), ${t(jumpAt)});`,
      `tl.fromTo(H.q('.ls-wph', G), { opacity: 0 }, { opacity: 0.75, duration: 0.3, ease: 'power1.out', immediateRender: false }, ${t(jumpAt + 0.15)});`,
      // the prompt jumps from the field up to its bubble
      `var user = H.q('.ls-wuser', G);
function top(el) { var y = 0; while (el && el !== win) { y += el.offsetTop; el = el.offsetParent; } return y; }
var from = H.q('.ls-wtyped', G);
var dy = top(from) + from.offsetHeight / 2 - top(user) - user.offsetHeight / 2;
tl.fromTo(user, { y: dy, opacity: 0, scale: 0.9, filter: 'blur(${r1(8 * k)}px)' }, { y: 0, opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.55, ease: 'expo.out' }, ${t(jumpAt)});`,
      `H.blurIn(H.q('.ls-wdots', G), ${t(dotsAt)}, { y: 6, blur: 6, dur: 0.3 });`,
      // the dots pulse one after another until the reply lands; a pulse that the reply or the cut
      // interrupts is still worth starting once its rise shows
      `H.qa('.ls-wdots i', G).forEach(function (d, i) {
  for (var p = ${t(dotsAt + 0.2)} + i * 0.15; p + 0.25 < ${t(dotsEnd)}; p += 0.9) {
    tl.fromTo(d, { opacity: 0.35, y: 0 }, { opacity: 1, y: ${r1(-6 * u)}, duration: 0.25, ease: 'sine.out', immediateRender: false }, p);
    tl.fromTo(d, { opacity: 1, y: ${r1(-6 * u)} }, { opacity: 0.35, y: 0, duration: 0.3, ease: 'sine.in', immediateRender: false }, p + 0.25);
  }
});`
    )
    if (c?.reply)
      js.push(
        `H.hide(H.q('.ls-wdots-w', G), ${t(replyAt)});`,
        `H.blurIn(H.q('.ls-wreply', G), ${t(replyAt)}, { y: 10, blur: 10, dur: 0.5 });`
      )
  }
  return { html: `<div class="ls-k-window">${win}${lab}</div>`, js: js.join('\n') }
}

export const win: KindModule<'window'> = {
  css: (s, k) => {
    const px = (n: number): string => `${r1(n * k)}px`
    const mix = (v: string, p: number): string => `color-mix(in srgb, var(${v}) ${p}%, transparent)`
    return `
      ${s} .ls-k-window { --ls-amber: #F5A524; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; }
      ${s} .ls-k-window .ls-wrow { display: flex; align-items: center; justify-content: center; }
      ${s} .ls-k-window .ls-wcard { position: relative; flex: none; }
      ${s} .ls-k-window .ls-wshot {
        position: absolute; inset: 0; overflow: hidden; border-radius: ${px(18)}; background: var(--card);
        box-shadow: 0 ${px(30)} ${px(70)} var(--shadow), 0 ${px(8)} ${px(18)} var(--shadow);
      }
      ${s} .ls-k-window .ls-wshot::after {
        content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
        box-shadow: inset 0 0 0 ${px(1.5)} ${mix('--card-fg', 12)};
      }
      ${s} .ls-k-window .ls-wshot img { display: block; width: 100%; height: 100%; object-fit: cover; }
      ${s} .ls-k-window .ls-wbox {
        position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none;
        filter: drop-shadow(0 0 ${px(9)} ${mix('--ls-amber', 70)});
      }
      ${s} .ls-k-window .ls-wbox rect { fill: ${mix('--ls-amber', 8)}; stroke: var(--ls-amber); stroke-width: ${px(4)}; }
      ${s} .ls-k-window .ls-wlabels { display: grid; place-items: center; }
      ${s} .ls-k-window .ls-wlab { grid-area: 1 / 1; }
      ${s} .ls-k-window .ls-tag.ls-wtag {
        background: var(--pill); color: var(--pill-fg); font-weight: 700; padding: 0.2em 0.55em;
        box-shadow: 0 ${px(6)} ${px(16)} var(--shadow), 0 ${px(1)} ${px(3)} var(--shadow);
      }
      ${s} .ls-k-window .ls-wwin {
        position: relative; flex: none; overflow: hidden; color: var(--card-fg);
        font-family: var(--text), sans-serif; font-weight: 500; letter-spacing: -0.005em;
        background: linear-gradient(180deg, color-mix(in srgb, var(--card-fg) 5%, var(--card)) 0%, var(--card) 38%);
        box-shadow: inset 0 0 0 ${px(1.5)} ${mix('--card-fg', 13)}, 0 ${px(40)} ${px(90)} var(--shadow), 0 ${px(12)} ${px(26)} var(--shadow);
      }
      ${s} .ls-k-window .ls-wbar {
        position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; box-sizing: border-box;
        border-bottom: ${px(1.5)} solid ${mix('--card-fg', 8)};
      }
      ${s} .ls-k-window .ls-wico { position: relative; flex: none; border-radius: 50%; background: var(--card-fg); }
      ${s} .ls-k-window .ls-wico::after {
        content: ''; position: absolute; inset: 26%; border-radius: 50%; border: var(--ls-ring) solid var(--card);
      }
      ${s} .ls-k-window .ls-wtitle { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      ${s} .ls-k-window .ls-wmsgs {
        position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: stretch;
        box-sizing: border-box; overflow: hidden;
      }
      ${s} .ls-k-window .ls-wgreet, ${s} .ls-k-window .ls-wuser { display: flex; }
      ${s} .ls-k-window .ls-wuser { justify-content: flex-end; transform-origin: 100% 50%; }
      ${s} .ls-k-window .ls-wbub { max-width: 78%; line-height: 1.3; background: ${mix('--card-fg', 6)}; color: var(--card-dim); }
      ${s} .ls-k-window .ls-wme { background: ${mix('--card-fg', 11)}; color: var(--card-fg); font-weight: 500; }
      ${s} .ls-k-window .ls-wans { display: grid; justify-items: start; align-items: start; }
      ${s} .ls-k-window .ls-wans > * { grid-area: 1 / 1; }
      ${s} .ls-k-window .ls-wdots { display: flex; }
      ${s} .ls-k-window .ls-wdots i { display: block; border-radius: 50%; background: var(--card-fg); opacity: 0.35; }
      ${s} .ls-k-window .ls-wreply { max-width: 88%; line-height: 1.38; color: var(--card-fg); }
      ${s} .ls-k-window .ls-wfield {
        position: absolute; display: flex; align-items: center; box-sizing: border-box;
        background: ${mix('--card-fg', 7)}; box-shadow: inset 0 0 0 ${px(1)} ${mix('--card-fg', 6)};
      }
      ${s} .ls-k-window .ls-wtext {
        position: relative; flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center;
        justify-content: flex-end; overflow: hidden; white-space: nowrap; line-height: 1.2;
      }
      ${s} .ls-k-window .ls-wph { position: absolute; left: 0; top: 0; bottom: 0; display: flex; align-items: center; color: var(--card-dim); opacity: 0.75; }
      ${s} .ls-k-window .ls-wtyped { flex: none; margin-right: auto; color: var(--card-fg); }
      ${s} .ls-k-window .ls-wsend { position: relative; flex: none; }
      ${s} .ls-k-window .ls-wsend-off, ${s} .ls-k-window .ls-wsend-on { position: absolute; inset: 0; }
      ${s} .ls-k-window .ls-wsend-off { background: ${mix('--card-fg', 12)}; opacity: 0; }
      ${s} .ls-k-window .ls-wsend-on {
        display: flex; align-items: center; justify-content: center; border-radius: 50%;
        background: var(--card-fg); color: var(--card);
      }
      ${s} .ls-k-window .ls-wsend-on > span { display: block; }
      ${s} .ls-k-window .ls-wsend-on svg { display: block; width: 100%; height: 100%; }
`
  },
  render: (g, ctx) => (g.images?.length ? images(g, ctx) : chat(g, ctx))
}
