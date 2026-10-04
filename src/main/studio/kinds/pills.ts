/**
 * pills: what something needs, as big white pills in a centered stack: a quiet intro line ("some
 * of these want"), then each requirement ("a decent GPU", "an M-series Mac") blurring up into
 * place on its word, with a tiny italic joiner ("or", "+") between them. Made for the inset
 * layout, the speaker in the card under it; very wide, short zones put the pills in one row.
 */
import { esc, r1 } from '../parts'
import { t, when, type KindModule } from './types'

// average advance per character class, in em
const EM: [RegExp, number][] = [
  [/\s/, 0.32],
  [/[A-Z]/, 0.9],
  [/\d/, 0.76],
  [/[a-z]/, 0.68]
]

/** Rough advance of a line in em, for the wide grotesk at bold; data-fit catches the rest. */
function ems(s: string): number {
  let n = 0
  for (const c of s) n += EM.find(([re]) => re.test(c))?.[1] ?? 0.5
  return n
}

// pill box in em of its text: line height plus padding
const PAD_X = 0.72
const PAD_Y = 0.38
const LINE = 1.2
const PILL_H = LINE + PAD_Y * 2
// intro and joiner sizes as shares of the pill text
const INTRO = 0.55
const JOIN = 0.52

export const pills: KindModule<'pills'> = {
  css: (s, k) => `
      ${s} .ls-k-pills { display: flex; flex-direction: column; align-items: center; width: 100%; }
      ${s} .ls-k-pills .ls-intro-box { width: 100%; display: flex; justify-content: center; }
      ${s} .ls-k-pills .ls-intro { color: var(--fg); opacity: 0.8; white-space: nowrap; line-height: 1.3; letter-spacing: -0.01em; text-align: center; }
      ${s} .ls-k-pills .ls-pill-set { display: flex; flex-direction: column; align-items: center; width: 100%; }
      ${s} .ls-k-pills .ls-pill-set.ls-pill-row { flex-direction: row; justify-content: center; }
      ${s} .ls-k-pills .ls-pill-w { display: flex; justify-content: center; width: 100%; }
      ${s} .ls-k-pills .ls-pill-row .ls-pill-w { width: auto; flex: none; }
      ${s} .ls-k-pills .ls-pill {
        flex: none; white-space: nowrap; line-height: ${LINE}; padding: ${PAD_Y}em ${PAD_X}em; border-radius: 0.3em;
        background: var(--pill); color: var(--pill-fg); font-family: var(--display), sans-serif; letter-spacing: -0.015em;
        box-shadow:
          inset 0 -${r1(3 * k)}px 0 rgba(0,0,0,0.07),
          inset 0 0 0 ${r1(1.5 * k)}px rgba(0,0,0,0.06),
          0 ${r1(14 * k)}px ${r1(34 * k)}px var(--shadow),
          0 ${r1(2 * k)}px ${r1(5 * k)}px var(--shadow);
      }
      ${s} .ls-k-pills .ls-join {
        flex: none; font-family: var(--serif), serif; font-style: italic; font-weight: 400; color: var(--dim);
        line-height: 1.2; white-space: nowrap; text-align: center;
      }
      ${s} .ls-k-pills .ls-join-sym { font-family: var(--display), sans-serif; font-style: normal; font-weight: 500; }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const n = g.items.length
    const narrow = look.id === 'serif' ? 0.86 : 1
    const em = g.items.map((it) => ems(it.text) * narrow)
    const introH = g.intro ? INTRO * 1.3 + 0.5 : 0
    const joinGap = g.joiner ? (n > 2 ? 1.3 : 1.85) : 0.34
    const joinEm = g.joiner ? [...g.joiner].length * 0.42 * JOIN : 0
    const cap = 86 * k
    // one column (the reference) unless one row gives clearly bigger pills
    const colW = Math.max(...em) + PAD_X * 2
    const colH = introH + n * PILL_H + (n - 1) * joinGap
    const fCol = Math.min(cap, (zone.w * 0.98) / colW, (zone.h * 0.92) / colH)
    const rowGap = g.joiner ? joinEm + 0.7 : 0.42
    const rowW = em.reduce((a, b) => a + b + PAD_X * 2, 0) + (n - 1) * rowGap
    const fRow = Math.min(cap, (zone.w * 0.98) / rowW, (zone.h * 0.92) / (introH + PILL_H))
    const row = n > 1 && fRow > fCol * 1.12
    const f = row ? fRow : fCol

    const pillStyle = `font-size:${r1(f)}px;font-weight:${look.weights.bold};${look.displayItalic ? 'font-style:italic;' : ''}`
    const introFont =
      look.id === 'serif'
        ? 'font-family:var(--text),sans-serif;font-weight:500'
        : 'font-family:var(--display),sans-serif;font-weight:400'
    const introSize = g.intro
      ? Math.min(f * INTRO, (zone.w * 0.94) / ([...g.intro].length * 0.62))
      : 0
    const intro = g.intro
      ? `<div class="ls-intro-box" style="margin-bottom:${r1(f * 0.5)}px"><div class="ls-intro" data-fit="parent" style="font-size:${r1(introSize)}px;${introFont}">${esc(g.intro)}</div></div>`
      : ''
    // a word ("or") in the italic serif; a symbol ("+", "/") in the grotesk, where it has weight
    const sym = !!g.joiner && !/\p{L}/u.test(g.joiner)
    const joinSize = f * JOIN * (sym ? 1.15 : 1)
    const joiner = (i: number): string => {
      if (!g.joiner) return ''
      const space = row
        ? `margin:0 ${r1(f * 0.35)}px`
        : `margin:${r1((f * joinGap - joinSize * 1.2) / 2)}px 0`
      return `<div class="ls-join${sym ? ' ls-join-sym' : ''} ls-j-${i}" style="font-size:${r1(joinSize)}px;${space}">${esc(g.joiner)}</div>`
    }
    const items = g.items.map((it, i) => {
      const space =
        i && !g.joiner
          ? row
            ? `margin-left:${r1(f * rowGap)}px`
            : `margin-top:${r1(f * joinGap)}px`
          : ''
      const pill = `<div class="ls-pill-w ls-p-${i}" style="${space}"><div class="ls-pill"${row ? '' : ' data-fit="parent"'} style="${pillStyle}">${esc(it.text)}</div></div>`
      return (i ? joiner(i - 1) : '') + pill
    })

    const at = when(g.at, ctx.start, ctx.start)
    const first = at + (g.intro ? 0.08 : 0)
    const step = Math.min(0.75, Math.max(0.22, ((ctx.end - first) * 0.4) / Math.max(1, n - 1)))
    const times = g.items.map((it, i) => when(it.at, first + i * step, ctx.start))
    const js = [
      g.intro ? `H.blurIn(H.q('.ls-intro-box', G), ${t(at)}, { y: 10, blur: 10, dur: 0.4 });` : '',
      ...times.map(
        (time, i) =>
          `H.blurIn(H.q('.ls-p-${i}', G), ${t(time)}, { y: 44, scale: 0.9, blur: 18, dur: 0.48, ease: 'expo.out' });`
      ),
      ...(g.joiner
        ? times
            .slice(1)
            .map(
              (next, i) =>
                `H.blurIn(H.q('.ls-j-${i}', G), ${t(Math.max(times[i] + 0.12, next - 0.14))}, { y: 8, blur: 8, dur: 0.35 });`
            )
        : [])
    ]
    return {
      html: `<div class="ls-k-pills">${intro}<div class="ls-pill-set${row ? ' ls-pill-row' : ''}">${items.join('')}</div></div>`,
      js: js.filter(Boolean).join('\n')
    }
  }
}
