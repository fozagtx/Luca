/**
 * icons: a row of glass app tiles. By default they arrive blurred and grey and each snaps into
 * focus the moment its name is said (the hook's ChatGPT, Midjourney, ElevenLabs); red X strokes
 * cross out the paid ones.
 */
import { CROSS, esc, r1, tile } from '../parts'
import { t, when, type KindModule } from './types'

/** Rough advance of a label in em (Archivo at 500); data-fit catches what this misses. */
const ADVANCE = 0.55

/**
 * The longest line of a label broken in two at its best space or hyphen ("Magnific AI" /
 * "Upscaler Pro Max"): long names wrap once rather than shrinking the whole row to a whisper.
 */
function twoLineLen(label: string): number {
  const s = label.trim()
  let best = s.length
  for (let i = 1; i < s.length; i++) {
    if ((s[i - 1] !== ' ' && s[i - 1] !== '-') || s[i] === ' ') continue
    best = Math.min(best, Math.max(s.slice(0, i).trimEnd().length, s.slice(i).length))
  }
  return best
}

export const icons: KindModule<'icons'> = {
  css: (s) => `
      ${s} .ls-k-icons { display: flex; align-items: flex-start; justify-content: center; }
      ${s} .ls-k-icons .ls-icon { flex: none; display: flex; flex-direction: column; align-items: center; }
      ${s} .ls-k-icons .ls-label { margin-top: 0.55em; font-family: var(--text), sans-serif; font-weight: 500; color: var(--fg); line-height: 1.15; text-align: center; text-wrap: balance; overflow: hidden; letter-spacing: -0.01em; }
`,
  render: (g, ctx) => {
    const { zone, k } = ctx
    const n = g.items.length
    const labels = g.items.some((i) => i.label) && g.focus === false
    const gap = 26 * k
    const cap = (n === 1 ? 430 : n === 2 ? 360 : 290) * k
    // a labelled column is 0.9 gap wider than its tile, so the row budgets one more gap
    const size = Math.min(
      cap,
      (zone.w - gap * (labels ? n : n - 1)) / n,
      zone.h * (labels ? 0.7 : 0.85)
    )
    // each column is exactly as wide as its label may be, so a long name never pushes the row
    // wider than the tiles were sized for (off the frame, under the speaker card)
    const colW = labels ? size + gap * 0.9 : size
    const longest = Math.max(1, ...g.items.map((it) => (it.label ? twoLineLen(it.label) : 0)))
    const fsLabel = Math.min(size * 0.13, colW / (longest * ADVANCE))
    const focus = g.focus !== false
    const start = when(g.at, ctx.start, ctx.start)
    // names said later snap in on their word; without times, one after another
    const span = Math.max(0.3, Math.min(1.6, (ctx.end - start) * 0.6))
    const times = g.items.map((it, i) =>
      when(it.at, start + 0.35 + (span * i) / Math.max(1, n), start)
    )
    const items = g.items.map((it, i) => {
      const crossed = (g.cross ?? []).some((c) => c.index === i)
      const label =
        labels && it.label
          ? `<div class="ls-label" data-fit style="font-size:${r1(fsLabel)}px;max-width:${r1(colW)}px">${esc(it.label)}</div>`
          : ''
      return `<div class="ls-icon" style="width:${r1(colW)}px;margin:0 ${r1((size + gap - colW) / 2)}px">${tile(it, { size, light: g.light, cls: `ls-ic-${i}`, extra: crossed ? CROSS : '' })}${label}</div>`
    })
    const js: string[] = []
    if (focus) {
      js.push(`H.blurIn(H.q('.ls-k-icons', G), ${t(start)}, { blur: 18, dur: 0.4 });`)
      times.forEach((at, i) => {
        js.push(`H.focus(H.q('.ls-ic-${i} .ls-tile', G), ${t(at)});`)
      })
    } else {
      g.items.forEach((it, i) =>
        js.push(`H.pop(H.q('.ls-ic-${i}', G), ${t(when(it.at, start + i * 0.09, start))});`)
      )
    }
    for (const c of g.cross ?? []) {
      if (c.index >= n) continue
      js.push(
        `(function (x) { var b = H.qa('b', x); H.draw(b[0], ${t(c.at)}, { dur: 0.18 }); H.draw(b[1], ${t(c.at + 0.14)}, { dur: 0.18 }); })(H.q('.ls-ic-${c.index} .ls-x', G));`
      )
    }
    return { html: `<div class="ls-k-icons">${items.join('')}</div>`, js: js.join('\n') }
  }
}
