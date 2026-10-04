/**
 * quote: a pull quote in the italic serif, centered under an oversized opening quote mark, sized
 * from its length and the zone so it wraps to at most four balanced lines. The words arrive one
 * at a time out of a soft blur; who said it follows small under a short drawn rule. For a line
 * worth reading twice: a customer, a founder, the speaker's own thesis.
 */
import { esc, r1 } from '../parts'
import { t, when, type KindModule } from './types'

/** Instrument Serif Italic's “ (OFL), so the mark is the same in both looks. 294 × 229 units. */
const MARK_SVG =
  '<svg viewBox="0 -1 294 230" aria-hidden="true"><path fill="currentColor" d="M50 228Q27 228 13.5 212.5Q0 197 0 173Q0 124 34 77.5Q68 31 123 4Q132 -1 138 0.5Q144 2 144 9Q144 16 135 21Q95 45 79.5 68Q64 91 64 109Q64 125 73 134Q82 143 90.5 152.5Q99 162 99 181Q99 200 85.5 214Q72 228 50 228ZM200 228Q177 228 163.5 212.5Q150 197 150 173Q150 124 184 77.5Q218 31 273 4Q282 -1 288 0.5Q294 2 294 9Q294 16 285 21Q245 45 229.5 68Q214 91 214 109Q214 125 223 134Q232 143 240.5 152.5Q249 162 249 181Q249 200 235.5 214Q222 228 200 228Z"/></svg>'

const LINE = 1.02
const MAX_LINES = 4
/** The mark's height and the space under it, in ems of the quote. */
const MARK_H = 0.7
const MARK_GAP = 0.2
/** The longest line, in ems: a pull quote reads in short lines even in a wide zone. */
const MEASURE = 12.5

/** Advance widths in em per character class (spaces with the word spacing): Instrument Serif
 * Italic, Playfair Display Italic. */
const WIDTHS = {
  paper: { lower: 0.4, upper: 0.5, digit: 0.4, punct: 0.22, space: 0.22, other: 0.46 },
  serif: { lower: 0.47, upper: 0.68, digit: 0.5, punct: 0.27, space: 0.3, other: 0.55 }
}

type Widths = (typeof WIDTHS)['paper']

function wordWidth(word: string, w: Widths): number {
  let n = 0
  for (const c of word) {
    if (/[a-z]/.test(c)) n += c === 'm' || c === 'w' ? 0.72 : c === 'i' || c === 'l' ? 0.24 : w.lower
    else if (/[A-Z]/.test(c)) n += c === 'M' || c === 'W' ? w.upper * 1.6 : w.upper
    else if (/[0-9]/.test(c)) n += w.digit
    else if (/[.,;:!?'’"“”()-]/.test(c)) n += w.punct
    else n += w.other
  }
  return n
}

/** Lines a greedy wrap takes for words of these widths (em) in a measure of `max` em. */
function lineCount(words: number[], space: number, max: number): number {
  let lines = 1
  let cur = 0
  for (const w of words) {
    if (cur === 0) cur = w
    else if (cur + space + w <= max) cur += space + w
    else {
      lines++
      cur = w
    }
  }
  return lines
}

/** Curly apostrophes and quotes where the face has them; the outer pair goes (the mark says it). */
function tidy(text: string, curly: boolean): string {
  let s = text.trim()
  if (/^["“'‘«]/.test(s) && /["”'’»]$/.test(s) && s.length > 2) s = s.slice(1, -1).trim()
  if (!curly) return s
  return s
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/(^|\s)"(\S)/g, '$1“$2')
    .replace(/"/g, '”')
    .replace(/'/g, '’')
}

export const quote: KindModule<'quote'> = {
  css: (s, k) => `
      ${s} .ls-k-quote { display: flex; flex-direction: column; align-items: center; }
      ${s} .ls-k-quote .ls-qbody { display: flex; flex-direction: column; align-items: center; }
      ${s} .ls-k-quote .ls-qmark { height: ${MARK_H}em; margin-bottom: ${MARK_GAP}em; }
      ${s} .ls-k-quote .ls-qmark svg { display: block; height: 100%; width: auto; overflow: visible; }
      ${s} .ls-k-quote .ls-qt {
        font-family: var(--serif), serif; font-style: italic; font-weight: 400; line-height: ${LINE};
        letter-spacing: -0.005em; word-spacing: 0.05em; color: var(--fg); text-align: center;
        text-wrap: balance;
      }
      ${s} .ls-k-quote .ls-qw { display: inline-block; }
      ${s} .ls-k-quote .ls-qby-w { text-align: center; }
      ${s} .ls-k-quote .ls-qby {
        display: inline-flex; align-items: center; white-space: nowrap; color: var(--dim);
        font-family: var(--text), sans-serif; font-weight: 500; letter-spacing: 0.005em; line-height: 1.2;
      }
      ${s} .ls-k-quote .ls-qrule {
        display: block; flex: none; width: 1.4em; height: ${r1(Math.max(2, 2.5 * k))}px; margin-right: 0.55em;
        background: currentColor; border-radius: ${r1(2 * k)}px; transform-origin: left center;
      }
`,
  render: (g, ctx) => {
    const { zone, k, look } = ctx
    const w = look.id === 'serif' ? WIDTHS.serif : WIDTHS.paper
    const text = tidy(g.text, look.id === 'paper')
    const words = text.split(/\s+/).filter(Boolean)
    const widths = words.map((x) => wordWidth(x, w))
    const byFs = g.by ? Math.min(34 * k, zone.h * 0.05) : 0

    // the biggest size (~110 at 1080, a little more for a few words) that wraps to four lines and
    // fits the zone's height
    const top = (110 + 26 * Math.max(0, Math.min(1, (30 - text.length) / 16))) * k
    const fit = (mark: boolean): { size: number; width: number } => {
      let size = top
      for (; size > 28 * k; size *= 0.97) {
        const width = Math.min(zone.w * 0.92, size * MEASURE)
        const lines = lineCount(widths, w.space, width / size)
        const by = g.by ? size * 0.42 + byFs * 1.25 : 0
        const height = lines * size * LINE + (mark ? size * (MARK_H + MARK_GAP) : 0) + by
        if (lines <= MAX_LINES && height <= zone.h * 0.94) break
      }
      return { size, width: Math.min(zone.w * 0.92, size * MEASURE) }
    }
    // the mark gives way when it would cost the words too much size
    const plain = fit(false)
    const marked = fit(true)
    const mark = marked.size >= plain.size * 0.86
    const { size, width } = mark ? marked : plain
    const byGap = size * 0.42
    const bodyMax = zone.h * 0.94 - (g.by ? byGap + byFs * 1.25 : 0)

    const at = when(g.at, ctx.start, ctx.start)
    const first = at + (mark ? 0.14 : 0)
    const step = Math.min(0.08, Math.max(0.05, ((ctx.end - first) * 0.4) / words.length))
    const last = first + (words.length - 1) * step
    const byAt = Math.max(at + 0.3, Math.min(last + 0.25, ctx.end - 0.7))
    const markColor = look.nameColor ?? 'var(--dim)'

    const body = `<div class="ls-qbody" style="font-size:${r1(size)}px">${mark ? `<div class="ls-qmark" style="color:${markColor}">${MARK_SVG}</div>` : ''}<div class="ls-qt" style="width:${r1(width)}px">${words.map((x) => `<span class="ls-qw">${esc(x)}</span>`).join(' ')}</div></div>`
    const by = g.by
      ? `<div class="ls-qby-w" style="width:${r1(width)}px;margin-top:${r1(byGap)}px"><div class="ls-qby" data-fit="parent" style="font-size:${r1(byFs)}px"><i class="ls-qrule"></i><span class="ls-qname">${esc(g.by)}</span></div></div>`
      : ''

    const js = [
      // the estimate above is close; the real text shrinks until it's four lines and fits
      `(function () {
  var body = H.q('.ls-qbody', G), qt = H.q('.ls-qt', G), fs = ${r1(size)};
  for (var n = 0; n < 24; n++) {
    var lines = Math.round(qt.offsetHeight / (fs * ${LINE}));
    if (lines <= ${MAX_LINES} && body.offsetHeight <= ${r1(bodyMax)} && qt.scrollWidth <= qt.clientWidth + 1) break;
    fs *= 0.95;
    body.style.fontSize = Math.round(fs * 10) / 10 + 'px';
  }
})();`,
      mark
        ? `H.blurIn(H.q('.ls-qmark', G), ${t(at)}, { y: 16, blur: 14, scale: 0.86, dur: 0.7 });`
        : '',
      `H.qa('.ls-qw', G).forEach(function (el, i) { H.blurIn(el, ${t(first)} + i * ${t(step)}, { y: 26, blur: 12, dur: 0.6 }); });`,
      g.by ? `H.draw(H.q('.ls-qrule', G), ${t(byAt)}, { dur: 0.4, ease: 'power3.out' });` : '',
      g.by
        ? `H.blurIn(H.q('.ls-qname', G), ${t(byAt + 0.1)}, { y: 10, blur: 8, dur: 0.5 });`
        : ''
    ]
    return {
      html: `<div class="ls-k-quote">${body}${by}</div>`,
      js: js.filter(Boolean).join('\n')
    }
  }
}
