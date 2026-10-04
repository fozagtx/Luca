/**
 * icons: a row of glass app tiles. By default they arrive blurred and grey and each snaps into
 * focus the moment its name is said (the hook's ChatGPT, Midjourney, ElevenLabs); red X strokes
 * cross out the paid ones.
 */
import { CROSS, esc, r1, tile } from '../parts'
import { t, when, type KindModule } from './types'

export const icons: KindModule<'icons'> = {
  css: (s) => `
      ${s} .ls-k-icons { display: flex; align-items: flex-start; justify-content: center; }
      ${s} .ls-k-icons .ls-icon { display: flex; flex-direction: column; align-items: center; }
      ${s} .ls-k-icons .ls-label { margin-top: 0.55em; font-family: var(--text), sans-serif; font-weight: 500; color: var(--fg); white-space: nowrap; letter-spacing: -0.01em; }
`,
  render: (g, ctx) => {
    const { zone, k } = ctx
    const n = g.items.length
    const labels = g.items.some((i) => i.label) && g.focus === false
    const gap = 26 * k
    const cap = (n === 1 ? 430 : n === 2 ? 360 : 290) * k
    const size = Math.min(cap, (zone.w - gap * (n - 1)) / n, zone.h * (labels ? 0.7 : 0.85))
    const focus = g.focus !== false
    const start = when(g.at, ctx.start, ctx.start)
    // names said later snap in on their word; without times, one after another
    const span = Math.max(0.3, Math.min(1.6, (ctx.end - start) * 0.6))
    const times = g.items.map((it, i) =>
      when(it.at, start + 0.35 + (span * i) / Math.max(1, n), start)
    )
    const items = g.items.map((it, i) => {
      const crossed = (g.cross ?? []).some((c) => c.index === i)
      return `<div class="ls-icon" style="margin:0 ${r1(gap / 2)}px">${tile(it, { size, light: g.light, cls: `ls-ic-${i}`, extra: crossed ? CROSS : '' })}${labels && it.label ? `<div class="ls-label" style="font-size:${r1(size * 0.13)}px">${esc(it.label)}</div>` : ''}</div>`
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
