/**
 * terminal: a near-black terminal window with three traffic-light dots. The prompt types a
 * command ("$ ollama run qwen3") ahead of a blinking block caret, then the output prints one line
 * after another and the caret waits at its end. Use it when the words name a command to run, an
 * install, or anything that happens in a shell.
 */
import { esc, r1 } from '../parts'
import { t, when, type KindModule } from './types'

/** JetBrains Mono's advance, in em (a hair over 0.6 so the guess never undercounts rows). */
const ADVANCE = 0.605
const LINE = 1.5

/** Rows a line takes in a box `cols` characters wide, wrapping at spaces as pre-wrap does. */
function rowsOf(text: string, cols: number): number {
  let rows = 1
  let col = 0
  for (const word of text.split(' ')) {
    const len = [...word].length
    if (col > 0 && col + 1 + len > cols) {
      rows++
      col = 0
    } else if (col > 0) col++
    col += len
    while (col > cols) {
      rows++
      col -= cols
    }
  }
  return rows
}

export const terminal: KindModule<'terminal'> = {
  css: (s, k) => `
      ${s} .ls-k-terminal { display: flex; align-items: center; justify-content: center; width: 100%; }
      ${s} .ls-k-terminal .ls-tm-win {
        box-sizing: border-box; background: #0E0E10; color: var(--card-fg);
        font-family: var(--mono), monospace; font-weight: 500; line-height: ${LINE}; text-align: left;
        box-shadow: inset 0 0 0 ${r1(Math.max(1, 1.5 * k))}px rgba(255,255,255,0.06),
          0 ${r1(24 * k)}px ${r1(56 * k)}px var(--shadow), 0 ${r1(5 * k)}px ${r1(12 * k)}px var(--shadow);
      }
      ${s} .ls-k-terminal .ls-tm-dots { display: flex; margin-left: -${r1(8 * k)}px; }
      ${s} .ls-k-terminal .ls-tm-dots i { width: ${r1(18 * k)}px; height: ${r1(18 * k)}px; border-radius: 50%; margin-right: ${r1(13 * k)}px; }
      ${s} .ls-k-terminal .ls-tm-dots i:nth-child(1) { background: #FF5F57; }
      ${s} .ls-k-terminal .ls-tm-dots i:nth-child(2) { background: #FEBC2E; }
      ${s} .ls-k-terminal .ls-tm-dots i:nth-child(3) { background: #28C840; }
      ${s} .ls-k-terminal .ls-tm-cmd { position: relative; }
      ${s} .ls-k-terminal .ls-tm-line { white-space: pre-wrap; overflow-wrap: anywhere; }
      ${s} .ls-k-terminal .ls-tm-ghost { visibility: hidden; }
      ${s} .ls-k-terminal .ls-tm-live { position: absolute; left: 0; top: 0; right: 0; }
      ${s} .ls-k-terminal .ls-tm-ps { color: var(--card-dim); }
      ${s} .ls-k-terminal .ls-tm-out { color: var(--card-dim); }
      ${s} .ls-k-terminal .ls-tm-caret {
        display: inline-block; width: 0.6em; height: 1.2em; vertical-align: -0.24em; border-radius: 0.06em;
      }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const out = g.output ?? []
    const cmd = `$ ${g.command}`
    const width = Math.min(zone.w * 0.92, 1040 * k)
    const padX = 40 * k
    const padTop = 26 * k
    const dot = 18 * k
    const inner = width - padX * 2
    // the caret rides at the end of the command, then of the last output line
    const lines = [cmd + '_', ...out.map((o, i) => (i === out.length - 1 ? o + '_' : o))]
    const heightAt = (fs: number): number => {
      const cols = Math.max(8, Math.floor(inner / (fs * ADVANCE)))
      const rows = lines.reduce((n, l) => n + rowsOf(l, cols), 0)
      return padTop + dot + fs * 1.5 + rows * fs * LINE + (out.length ? fs * 0.3 : 0) + fs * 1.35
    }
    // every line on one row when it can be, then smaller until the window fits the zone
    const longest = Math.max(...lines.map((l) => [...l].length))
    let fs = Math.min(46 * k, Math.max(26 * k, inner / (longest * ADVANCE)))
    while (heightAt(fs) > zone.h * 0.94 && fs > 14 * k) fs *= 0.94
    const caretColor = look.nameColor ?? 'var(--accent)'
    const caret = (cls = ''): string =>
      `<span class="ls-tm-caret${cls}" style="background:${caretColor}"></span>`
    const chars = [...g.command].map((c) => `<span class="ls-ch">${esc(c)}</span>`).join('')
    const cmdHtml = `<div class="ls-tm-cmd"><div class="ls-tm-line ls-tm-ghost" aria-hidden="true">${esc(cmd)}${caret()}</div><div class="ls-tm-line ls-tm-live"><span class="ls-tm-ps">$ </span>${chars}${caret(' ls-tm-c0')}</div></div>`
    const outHtml = out
      .map(
        (o, i) =>
          `<div class="ls-tm-line ls-tm-out ls-tm-o${i}"${i === 0 ? ` style="margin-top:${r1(fs * 0.3)}px"` : ''}>${esc(o)}${i === out.length - 1 ? caret(' ls-tm-c1') : ''}</div>`
      )
      .join('')
    const html = `<div class="ls-k-terminal"><div class="ls-tm-win" style="width:${r1(width)}px;padding:${r1(padTop)}px ${r1(padX)}px ${r1(fs * 1.35)}px;border-radius:${r1(18 * k)}px;font-size:${r1(fs)}px"><div class="ls-tm-dots" style="margin-bottom:${r1(fs * 1.5)}px"><i></i><i></i><i></i></div>${cmdHtml}${outHtml}</div></div>`

    const at = when(g.at, ctx.start, ctx.start)
    const typeAt = when(g.typeAt, at + 0.3, ctx.start)
    const n = [...g.command].length
    // ~12 characters a second, faster when the beat (or the output's moment) leaves less room
    const until =
      g.outputAt !== undefined
        ? g.outputAt - 0.25
        : ctx.end - 0.5 - (out.length ? 0.35 + out.length * 0.12 : 0)
    const room = until - typeAt
    const cps = Math.min(60, Math.max(12, room > 0 ? n / room : 60))
    const typeEnd = typeAt + n / cps
    // the output lands before the cut, even when the plan asks for it later
    const outAt = Math.min(
      ctx.end - 0.3 - (out.length - 1) * 0.12,
      Math.max(when(g.outputAt, typeEnd + 0.35, ctx.start), typeEnd + 0.15)
    )
    const lastAt = outAt + (out.length - 1) * 0.12
    const js = [
      `H.blurIn(H.q('.ls-tm-win', G), ${t(at)}, { y: 28, blur: 12 });`,
      `var c0 = H.q('.ls-tm-c0', G);`,
      `H.blink(c0, ${t(at)}, ${t(typeAt)});`,
      `H.show(c0, ${t(typeAt)});`,
      `H.type(H.q('.ls-tm-live', G), ${t(typeAt)}, ${t(cps)});`,
      out.length
        ? `H.blink(c0, ${t(typeEnd + 0.5)}, ${t(outAt)});\nH.hide(c0, ${t(outAt)});`
        : `H.blink(c0, ${t(typeEnd + 0.5)}, ${t(ctx.end)});`,
      ...out.map(
        (_, i) =>
          `tl.fromTo(H.q('.ls-tm-o${i}', G), { opacity: 0, y: ${r1(8 * k)} }, { opacity: 1, y: 0, duration: 0.18, ease: 'power2.out' }, ${t(outAt + i * 0.12)});`
      ),
      out.length ? `H.blink(H.q('.ls-tm-c1', G), ${t(lastAt + 0.3)}, ${t(ctx.end)});` : ''
    ]
    return { html, js: js.filter(Boolean).join('\n') }
  }
}
