/**
 * cta: the ask at the end. A tiny spaced-out kicker ("• COMMENT BELOW"), a dark comment field
 * with a round avatar where the keyword types itself in the accent ("LOCAL") and the send button
 * lights up when it's done, then the promise in the italic serif ("and the link lands in your
 * dms"). Everything hangs off the field's left edge. Made for the inset layout.
 */
import { esc, r1, SEND_SVG, typed } from '../parts'
import { t, when, type KindModule } from './types'

/** Rough advance in em of the wide grotesk at bold. */
function ems(s: string): number {
  let n = 0
  for (const c of s)
    n += c === ' ' ? 0.32 : /[A-Z]/.test(c) ? 0.9 : /[0-9]/.test(c) ? 0.76 : /[a-z]/.test(c) ? 0.68 : 0.5
  return n
}

// sizes in 1080-units at full scale
const KICK = 26
const KICK_TRACK = 0.38
const KICK_GAP = 40
const FIELD_H = 112
const SUB_GAP = 50
const SUB = 58
const WORD = 48
const AVATAR = 62
const SEND = 66
const CPS = 12

export const cta: KindModule<'cta'> = {
  css: (s, k) => `
      ${s} .ls-k-cta { display: flex; flex-direction: column; align-items: flex-start; }
      ${s} .ls-k-cta .ls-kick {
        display: flex; align-items: center; font-family: var(--mono), monospace; font-weight: 500;
        letter-spacing: ${KICK_TRACK}em; text-transform: uppercase; color: var(--dim); white-space: nowrap; line-height: 1.2;
      }
      ${s} .ls-k-cta .ls-kick-dot { flex: none; width: 0.42em; height: 0.42em; border-radius: 50%; background: currentColor; margin-right: 0.7em; }
      ${s} .ls-k-cta .ls-field {
        position: relative; display: flex; align-items: center; box-sizing: border-box; width: 100%;
        background: linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), var(--card);
        box-shadow:
          inset 0 0 0 ${r1(1.5 * k)}px rgba(255,255,255,0.06),
          inset 0 ${r1(2 * k)}px 0 rgba(255,255,255,0.05),
          0 ${r1(14 * k)}px ${r1(36 * k)}px var(--shadow);
      }
      ${s} .ls-k-cta .ls-avatar {
        flex: none; border-radius: 50%;
        background: radial-gradient(circle at 34% 30%, var(--card-fg) 0%, var(--card-dim) 120%);
        box-shadow: inset 0 -${r1(3 * k)}px ${r1(6 * k)}px rgba(0,0,0,0.25);
      }
      ${s} .ls-k-cta .ls-word {
        flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; line-height: 1.25; color: var(--accent);
        font-family: var(--display), sans-serif; letter-spacing: -0.005em;
      }
      ${s} .ls-k-cta .ls-send { position: relative; flex: none; }
      ${s} .ls-k-cta .ls-send > span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
      ${s} .ls-k-cta .ls-send svg { width: 50%; height: 50%; display: block; }
      ${s} .ls-k-cta .ls-send-off { color: var(--card-dim); box-shadow: inset 0 0 0 ${r1(1.5 * k)}px rgba(255,255,255,0.1); }
      ${s} .ls-k-cta .ls-send-on { background: var(--card-fg); color: var(--card); }
      ${s} .ls-k-cta .ls-sub-box { width: 100%; }
      ${s} .ls-k-cta .ls-cta-sub {
        font-family: var(--serif), serif; font-style: italic; font-weight: 400; color: var(--dim);
        white-space: nowrap; line-height: 1.2;
      }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const kicker = g.kicker ?? 'COMMENT BELOW'
    const blockH = KICK * 1.2 + KICK_GAP + FIELD_H + (g.sub ? SUB_GAP + SUB * 1.2 : 0)
    const s = Math.min(1, (zone.h * 0.94) / (blockH * k))
    const u = k * s
    const width = Math.min(zone.w * 0.9, 900 * k)
    const fieldH = FIELD_H * u
    const avatar = AVATAR * u
    const send = SEND * u
    const padL = (fieldH - avatar) / 2
    const padR = (fieldH - send) / 2
    const gap = 22 * u
    // the word and its caret share what the avatar and the send button leave
    const room = width - padL - avatar - gap * 2 - send - padR
    const wordSize = Math.min(WORD * u, room / (ems(g.word) + 0.2))
    const kickSize = Math.min(KICK * u, width / ([...kicker].length * (0.6 + KICK_TRACK) + 1.2))
    const subSize = g.sub ? Math.min(SUB * u, width / ([...g.sub].length * 0.4)) : 0

    const kick = `<div class="ls-kick" data-fit="parent" style="font-size:${r1(kickSize)}px;margin-bottom:${r1(KICK_GAP * u)}px"><span class="ls-kick-dot"></span>${esc(kicker)}</div>`
    const word = `<div class="ls-word" style="font-size:${r1(wordSize)}px;font-weight:${look.weights.bold};${look.displayItalic ? 'font-style:italic;' : ''}margin:0 ${r1(gap)}px">${typed(g.word)}</div>`
    const field = `<div class="ls-field" style="height:${r1(fieldH)}px;padding:0 ${r1(padR)}px 0 ${r1(padL)}px;border-radius:${r1(28 * u)}px"><span class="ls-avatar" style="width:${r1(avatar)}px;height:${r1(avatar)}px"></span>${word}<span class="ls-send" style="width:${r1(send)}px;height:${r1(send)}px"><span class="ls-send-off">${SEND_SVG}</span><span class="ls-send-on">${SEND_SVG}</span></span></div>`
    const sub = g.sub
      ? `<div class="ls-sub-box" style="margin-top:${r1(SUB_GAP * u)}px"><div class="ls-cta-sub" data-fit="parent" style="font-size:${r1(subSize)}px">${esc(g.sub)}</div></div>`
      : ''

    const at = when(g.at, ctx.start, ctx.start)
    const typeAt = when(g.typeAt, at + 0.45, at + 0.25)
    const typeEnd = typeAt + [...g.word].length / CPS
    const js = [
      `H.blurIn(H.q('.ls-kick', G), ${t(at)}, { blur: 10, dur: 0.4 });`,
      `H.blurIn(H.q('.ls-field', G), ${t(at + 0.06)}, { y: 18, scale: 0.97, blur: 14, dur: 0.5, ease: 'expo.out' });`,
      `H.pop(H.q('.ls-avatar', G), ${t(at + 0.16)}, { from: 0.4 });`,
      `var caret = H.q('.ls-caret', G);`,
      `H.blink(caret, ${t(at + 0.06)}, ${t(typeAt)});`,
      `tl.set(caret, { opacity: 1 }, ${t(typeAt)});`,
      `H.type(H.q('.ls-word', G), ${t(typeAt)}, ${CPS});`,
      `H.blink(caret, ${t(typeEnd + 0.45)}, ${t(ctx.end)});`,
      `H.pop(H.q('.ls-send-on', G), ${t(typeEnd + 0.04)}, { from: 0.5, dur: 0.4 });`,
      g.sub ? `H.blurIn(H.q('.ls-cta-sub', G), ${t(typeEnd + 0.22)}, { y: 10, blur: 10, dur: 0.45 });` : ''
    ]
    return {
      html: `<div class="ls-k-cta" style="width:${r1(width)}px">${kick}${field}${sub}</div>`,
      js: js.filter(Boolean).join('\n')
    }
  }
}
