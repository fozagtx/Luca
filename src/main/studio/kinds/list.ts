/**
 * list: white rows stacking in from the right, one per name, each with a GitHub mark (or a
 * check, number or dot). Names can start blurred, a teaser before they're revealed; one row can
 * light up in the accent with a badge (the bonus "+1").
 */
import { CHECK_SVG, esc, GITHUB_SVG, r1 } from '../parts'
import { t, when, type KindModule } from './types'

export const list: KindModule<'list'> = {
  css: (s, k) => `
      ${s} .ls-k-list { display: flex; flex-direction: column; align-items: center; width: 100%; }
      ${s} .ls-k-list .ls-row {
        display: flex; align-items: center; box-sizing: border-box; background: var(--pill); color: var(--pill-fg);
        box-shadow: 0 ${r1(10 * k)}px ${r1(26 * k)}px var(--shadow), 0 ${r1(2 * k)}px ${r1(4 * k)}px var(--shadow);
        font-family: var(--display), sans-serif; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap;
      }
      ${s} .ls-k-list .ls-row.ls-hl { background: var(--accent); color: #121110; }
      ${s} .ls-k-list .ls-mark { flex: none; display: flex; align-items: center; justify-content: center; }
      ${s} .ls-k-list .ls-mark svg { width: 100%; height: 100%; display: block; }
      ${s} .ls-k-list .ls-text { flex: 1; min-width: 0; overflow: hidden; }
      ${s} .ls-k-list .ls-badge { flex: none; font-weight: 700; }
      ${s} .ls-k-list .ls-dot { border-radius: 50%; background: currentColor; }
`,
  render: (g, ctx) => {
    const { zone, k } = ctx
    const n = g.items.length
    const rowH = Math.min(134 * k, zone.h / (n * 1.2), zone.w * 0.15)
    const gap = rowH * 0.18
    const width = Math.min(zone.w * 0.94, 960 * k)
    const fs = rowH * 0.36
    const mark = g.mark ?? 'github'
    const at = when(g.at, ctx.start, ctx.start)
    const step = Math.min(0.32, Math.max(0.1, ((ctx.end - at) * 0.5) / n))
    const rows = g.items.map((it, i) => {
      const hl = g.highlight?.index === i
      const icon =
        mark === 'github'
          ? GITHUB_SVG
          : mark === 'check'
            ? CHECK_SVG
            : mark === 'number'
              ? `<span style="font-size:${r1(fs)}px">${i + 1}.</span>`
              : mark === 'dot'
                ? `<span class="ls-dot" style="width:${r1(rowH * 0.16)}px;height:${r1(rowH * 0.16)}px"></span>`
                : ''
      const markHtml =
        mark === 'none'
          ? ''
          : `<span class="ls-mark" style="width:${r1(rowH * 0.36)}px;height:${r1(rowH * 0.36)}px;margin-right:${r1(rowH * 0.22)}px">${icon}</span>`
      const blur = g.blur && !hl ? `filter:blur(${r1(rowH * 0.075)}px);` : ''
      return `<div class="ls-row ls-row-${i}${hl ? ' ls-hl' : ''}" style="width:${r1(width)}px;height:${r1(rowH)}px;margin-top:${i ? r1(gap) : 0}px;padding:0 ${r1(rowH * 0.3)}px;border-radius:${r1(rowH * 0.16)}px;font-size:${r1(fs)}px">${markHtml}<span class="ls-text" style="${blur}">${esc(it.text)}</span>${hl && g.highlight?.badge ? `<span class="ls-badge">${esc(g.highlight.badge)}</span>` : ''}</div>`
    })
    const js = g.items.map((it, i) => {
      const hl = g.highlight?.index === i
      const time =
        hl && g.highlight?.at !== undefined
          ? when(g.highlight.at, at, ctx.start)
          : when(it.at, at + i * step, ctx.start)
      return `H.slideIn(H.q('.ls-row-${i}', G), ${t(time)}, { dx: ${r1((width * 0.55) / k)} });`
    })
    return { html: `<div class="ls-k-list">${rows.join('')}</div>`, js: js.join('\n') }
  }
}
