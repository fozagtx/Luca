/**
 * title: one to three big lines, e.g. the hook's "STOP" (black caps) over "paying" (light
 * lowercase), or "no API key" struck through when it's said. Lines rise out of their masks.
 */
import { esc, r1 } from '../parts'
import { t, when, type KindModule } from './types'

export const title: KindModule<'title'> = {
  css: (s) => `
      ${s} .ls-k-title { display: flex; flex-direction: column; align-items: center; gap: 0.02em; }
      ${s} .ls-k-title .ls-line { position: relative; max-width: 100%; }
      ${s} .ls-k-title .ls-rise { font-family: var(--display), sans-serif; line-height: 1.02; letter-spacing: -0.015em; color: var(--fg); text-align: center; }
      ${s} .ls-k-title .ls-serif { font-family: var(--serif), serif; font-style: italic; font-weight: 400; letter-spacing: 0; }
      ${s} .ls-k-title.ls-tight .ls-rise { line-height: 0.94; padding-bottom: 0.2em; }
      ${s} .ls-k-title.ls-tight .ls-mask { padding-bottom: 0; margin-bottom: -0.2em; }
`,
  render: (g, ctx) => {
    const { zone, look } = ctx
    const n = g.lines.length
    const longest = Math.max(...g.lines.map((l) => l.text.length))
    // ~0.62 em a character in the wide grotesk; the fit pass shrinks anything still too wide
    const byWidth = (zone.w * 0.96) / Math.max(3, longest * (look.id === 'serif' ? 0.5 : 0.64))
    // the BEFORE's hook is modest, about 0.55 of a 9:16 frame's width over its row of icons
    const cap = look.id === 'serif' ? (n > 1 ? 114 : 120) : n > 1 ? 156 : 150
    const size = Math.min(byWidth, (zone.h * 0.9) / (n * 1.05), cap * ctx.k)
    const lines = g.lines.map((l, i) => {
      const weight = look.weights[l.weight ?? (n > 1 ? (i === 0 ? 'black' : 'light') : 'bold')]
      const color =
        l.color === 'accent'
          ? 'var(--accent)'
          : l.color === 'alarm'
            ? 'var(--alarm)'
            : l.color === 'dim'
              ? 'var(--dim)'
              : 'var(--fg)'
      const em = look.id === 'serif' ? 0.5 : 0.64
      const own = Math.min((zone.w * 0.96) / Math.max(3, l.text.length * em), size)
      const fs = r1(l.serif ? own * 1.18 : own)
      const style = `font-weight:${weight};color:${color};${look.displayItalic && !l.serif ? 'font-style:italic;' : ''}`
      // the line carries the size, so the strike's em is the text's
      return `<div class="ls-line" style="font-size:${fs}px"><div class="ls-mask"><div class="ls-rise${l.serif ? ' ls-serif' : ''}" data-fit="parent" style="${style}">${esc(l.text)}</div></div>${g.strikeAt !== undefined ? `<i class="ls-strike" style="color:${color}"></i>` : ''}</div>`
    })
    const at = when(g.at, ctx.start, ctx.start)
    const js = [
      `H.qa('.ls-rise', G).forEach(function (el, i) { H.rise(el, ${t(at)} + i * 0.08); });`,
      g.strikeAt !== undefined
        ? `H.qa('.ls-strike', G).forEach(function (el, i) { H.draw(el, ${t(Math.max(at + 0.3, g.strikeAt))} + i * 0.06); });`
        : ''
    ]
    // the BEFORE sets its serif lines tight; the rise keeps room under them so the deep italic
    // descenders clear the mask, and its travel grows with it so nothing peeks in early
    const tight = look.id === 'serif' ? ' ls-tight' : ''
    return { html: `<div class="ls-k-title${tight}">${lines.join('')}</div>`, js: js.join('\n') }
  }
}
