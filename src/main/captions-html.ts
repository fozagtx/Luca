import { basename, extname } from 'node:path'
import {
  captionCase,
  captionLook,
  captionStyle,
  captionTextShadow,
  googleFontUrl,
  round,
  scatterLayout,
  splitAtBreaks,
  type CaptionLook,
  type SpeechClip
} from '../shared/captions'
import type { CaptionConfig, CaptionGroup, ProjectFontFace } from '../shared/types'
import { findTags } from './html'

/**
 * The captions sub-composition Luca writes: static caption lines (so every frame is
 * deterministic and seekable) plus one GSAP timeline that shows each line on its words' times,
 * following the structure of HyperFrames' own captions example. Also where the transcribed
 * media plays in index.html, so the captions can follow it.
 */

export const CAPTIONS_ID = 'luca-captions'
export const CAPTIONS_FILE = `compositions/${CAPTIONS_ID}.html`
const HOST_ID = CAPTIONS_ID
const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Where a stretch of captions sits and what color it takes, in the captions track's own time:
 * the Studio look moves them above the speaker's card and recolors them for each background.
 */
export type CaptionZone = {
  start: number
  end: number
  /** Line center and widest line, in frame px. */
  x: number
  y: number
  w: number
  /** Text color for an adaptive style; its shadow goes with it on a light background. */
  color?: string
  light?: boolean
}

/** How the Studio look places captions: zones over time, and words set in the italic serif. */
export type CaptionPlacement = {
  zones: CaptionZone[]
  /** Lowercase words or phrases ("api key") shown in `emphasisFont` when they are said. */
  emphasis: string[]
  emphasisFont: string | null
}

const bare = (w: string): string => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

/** Which words of a line are emphasis: single words, or every word of a phrase said in order. */
function emphasized(words: { text: string }[], emphasis: string[]): boolean[] {
  const out = words.map(() => false)
  if (!emphasis.length) return out
  const plain = words.map((w) => bare(w.text))
  for (const e of emphasis) {
    const parts = e.split(/\s+/).map(bare).filter(Boolean)
    if (!parts.length) continue
    for (let i = 0; i + parts.length <= plain.length; i++)
      if (parts.every((p, j) => plain[i + j] === p)) parts.forEach((_, j) => (out[i + j] = true))
  }
  return out
}

/** CSS that puts one line group in its zone (and recolors it for an adaptive style). */
function zoneProps(
  z: CaptionZone,
  look: CaptionLook,
  d: { w: number; h: number }
): { group: Record<string, string>; line: Record<string, string> } {
  const pad = (v: number): number => Math.max(0, Math.round(v))
  const group = {
    'align-items': 'center',
    padding: `${pad(2 * z.y - d.h)}px ${pad(d.w - 2 * z.x)}px ${pad(d.h - 2 * z.y)}px ${pad(2 * z.x - d.w)}px`
  }
  const line: Record<string, string> = { 'max-width': `${Math.round(z.w)}px` }
  if (look.adaptive && z.color) line.color = z.color
  if (look.adaptive && z.light) line['text-shadow'] = 'none'
  return { group, line }
}

const inline = (css: Record<string, string>): string =>
  Object.entries(css)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')

/** The same CSS as GSAP set vars: camelCase properties. */
const camel = (css: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(css).map(([key, v]) => [
      key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
      v
    ])
  )

function css(
  look: CaptionLook,
  cfg: CaptionConfig,
  d: { w: number; h: number },
  emFont: string | null = null
): string {
  const k = Math.min(d.w, d.h) / 1080
  const portrait = d.h > d.w
  const size = Math.round(look.size * k)
  const shadow = captionTextShadow(look, k)
  const pad = Math.round((portrait ? 0.27 : 0.1) * d.h)
  const align =
    cfg.position === 'top' ? 'flex-start' : cfg.position === 'middle' ? 'center' : 'flex-end'
  const s = `[data-composition-id="${HOST_ID}"]`
  const box = look.box
  const radius = box && (box.radius >= 999 ? '999px' : `${Math.round(box.radius * k)}px`)
  return `
      ${s} .lc-stage { position: absolute; inset: 0; pointer-events: none; }
      ${s} .cg {
        position: absolute; inset: 0; display: flex; justify-content: center; align-items: ${align};
        padding: ${pad}px ${Math.round(d.w * 0.08)}px; box-sizing: border-box;
        visibility: hidden; opacity: 0;
      }
      ${s} .cl {
        max-width: ${Math.round(d.w * (portrait ? 0.86 : 0.8))}px; text-align: center;
        font-family: '${cfg.font}', 'Inter', sans-serif; font-weight: ${look.weight};
        font-style: ${look.italic ? 'italic' : 'normal'}; font-size: ${size}px; line-height: 1.18;
        letter-spacing: ${look.letterSpacing}em; color: ${look.color};
        text-transform: ${captionCase(cfg, look)};
        ${shadow ? `text-shadow: ${shadow};` : ''}
        ${box ? `background: ${box.bg}; border-radius: ${radius}; padding: ${box.padding};` : ''}
        overflow: visible;
      }
      ${s} .w { display: inline-block; ${look.wordBox ? 'padding: 0.02em 0.16em; border-radius: 0.2em;' : ''} }
      ${emFont ? `${s} .w.em { font-family: '${emFont}', serif; font-style: italic; font-weight: 400; font-size: 1.16em; letter-spacing: 0; line-height: 1; }` : ''}
      ${scatterCss(look, cfg, d)}
    `
}

/** The scatter layout's own rules: each word is a span pinned to its slot on the stage. */
function scatterCss(look: CaptionLook, cfg: CaptionConfig, d: { w: number; h: number }): string {
  if (look.layout !== 'scatter') return ''
  const hero = look.hero
  const s = `[data-composition-id="${HOST_ID}"]`
  const shadow = captionTextShadow(look, Math.min(d.w, d.h) / 1080)
  return `
      ${s} .w {
        position: absolute; white-space: nowrap; opacity: 0; line-height: 1.1;
        font-family: '${cfg.font}', 'Inter', sans-serif; font-weight: ${look.weight};
        font-style: ${look.italic ? 'italic' : 'normal'}; color: ${look.color};
        text-transform: ${cfg.uppercase ? 'uppercase' : 'none'};
        ${shadow ? `text-shadow: ${shadow};` : ''}
      }
      ${s} .hw {
        font-family: '${hero?.font ?? cfg.font}', 'Inter', sans-serif;
        font-weight: ${hero?.weight ?? 900}; line-height: 0.95;
        color: ${hero?.color ?? look.color};
        text-transform: ${hero?.uppercase ? 'uppercase' : 'none'};
        letter-spacing: ${hero?.letterSpacing ?? -0.02}em;
      }`
}

/** A line restyled mid-way, when the picture cuts while it is still up: at, group CSS, line CSS. */
type Restyle = [number, Record<string, string>, Record<string, string>]

/**
 * `colorAt`: the line's color at a moment when an adaptive style takes the picture's colors there,
 * so a marked word goes back to it (not to the style's own color) when the next word comes.
 */
function script(
  groups: CaptionGroup[],
  look: CaptionLook,
  d: { w: number; h: number },
  restyles: Restyle[][] = [],
  colorAt: (t: number) => string | undefined = () => undefined
): string {
  const data = groups.map((g, i) => [
    g.start,
    g.end,
    g.words.map((w, j) => {
      const back = j + 1 < g.words.length ? colorAt(g.words[j + 1].start) : undefined
      return back ? [w.start, w.end, back] : [w.start, w.end]
    }),
    restyles[i] ?? []
  ])
  const opts = {
    anim: look.anim,
    layout: look.layout,
    color: look.color,
    accent: look.accent,
    active: look.activeText,
    slow: look.slow,
    k: Math.round((Math.min(d.w, d.h) / 1080) * 100) / 100
  }
  return `
      (function () {
        var root = document.querySelector('[data-composition-id="${HOST_ID}"]');
        var G = ${JSON.stringify(data)};
        var O = ${JSON.stringify(opts)};
        var tl = gsap.timeline({ paused: true });
        var clear = 'rgba(0,0,0,0)';
        // scatter words are pinned by left/top; gsap owns their transform (align + animation)
        root.querySelectorAll('.w[data-align]').forEach(function (w) {
          gsap.set(w, { xPercent: w.dataset.align === 'left' ? 0 : w.dataset.align === 'right' ? -100 : -50, yPercent: -50 });
        });
        function mark(words, g, on, off) {
          g[2].forEach(function (w, j) {
            if (!words[j]) return;
            tl.to(words[j], Object.assign({ duration: 0.06, ease: 'power1.out' }, on), w[0]);
            if (j + 1 < g[2].length)
              tl.to(words[j], Object.assign({ duration: 0.08, ease: 'power1.out' }, off, w[2] && off.color ? { color: w[2] } : {}), g[2][j + 1][0]);
          });
        }
        function reveal(words, g, from, to) {
          g[2].forEach(function (w, j) {
            if (words[j]) tl.fromTo(words[j], from, Object.assign({}, to), w[0]);
          });
        }
        G.forEach(function (g, i) {
          var el = root.querySelector('#lc-' + i);
          if (!el) return;
          var line = el.querySelector('.cl');
          var words = el.querySelectorAll('.w');
          tl.set(el, { visibility: 'visible', opacity: 1 }, g[0]);
          // the picture cut while the line is up: it moves and recolors with it
          g[3].forEach(function (r) {
            tl.set(el, r[1], r[0]);
            if (line) tl.set(line, r[2], r[0]);
          });
          if (O.layout === 'scatter') {
            g[2].forEach(function (w, j) {
              var span = words[j];
              if (!span) return;
              if (span.classList.contains('hw'))
                tl.fromTo(span, { opacity: 0, scale: 1.18 }, { opacity: 1, scale: 1, duration: 0.22, ease: 'power3.out' }, w[0]);
              else
                tl.fromTo(span, { opacity: 0, y: 10 * O.k }, { opacity: 1, y: 0, duration: 0.12, ease: 'power2.out' }, w[0]);
            });
          } else switch (O.anim) {
            case 'slide':
              tl.fromTo(line, { opacity: 0, y: 22 * O.k }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out' }, g[0]);
              break;
            case 'pop':
              tl.fromTo(line, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.2, ease: 'back.out(2)' }, g[0]);
              mark(words, g, { color: O.accent, scale: 1.12 }, { color: O.color, scale: 1 });
              break;
            case 'karaoke':
              tl.fromTo(line, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'power2.out' }, g[0]);
              mark(words, g, { backgroundColor: O.accent, color: O.active }, { backgroundColor: clear, color: O.color });
              break;
            case 'highlight':
              tl.fromTo(line, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.14, ease: 'power2.out' }, g[0]);
              mark(words, g, { backgroundColor: O.accent, color: O.active, scale: 1.06 }, { backgroundColor: clear, color: O.color, scale: 1 });
              break;
            case 'typewriter':
              tl.set(line, { opacity: 1 }, g[0]);
              reveal(words, g, { opacity: 0 }, { opacity: 1, duration: 0.05 });
              mark(words, g, { color: O.accent }, { color: O.color });
              break;
            case 'slam':
              tl.set(line, { opacity: 1 }, g[0]);
              reveal(words, g, { opacity: 0, scale: 1.7 }, { opacity: 1, scale: 1, duration: 0.16, ease: 'power4.out' });
              mark(words, g, { color: O.accent }, { color: O.color });
              break;
            case 'glow':
              tl.fromTo(line, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' }, g[0]);
              mark(words, g, { color: O.accent }, { color: O.color });
              break;
            case 'bounce':
              tl.fromTo(line, { opacity: 0, y: 46 * O.k, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.55)' }, g[0]);
              break;
            case 'blur':
              tl.fromTo(line, { opacity: 0, y: 8 * O.k, filter: 'blur(' + Math.round(7 * O.k) + 'px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.3, ease: 'power2.out' }, g[0]);
              break;
            default:
              tl.fromTo(line, { opacity: 0 }, { opacity: 1, duration: O.slow ? 0.45 : 0.25, ease: 'power2.out' }, g[0]);
          }
          tl.to(el, { opacity: 0, duration: 0.12, ease: 'power2.in' }, Math.max(g[0], g[1] - 0.12));
          tl.set(el, { opacity: 0, visibility: 'hidden' }, g[1]);
        });
        window.__timelines = window.__timelines || {};
        window.__timelines['${HOST_ID}'] = tl;
      })();`
}

/**
 * `fontFaces`: @font-face rules for the project's own fonts the captions use. `place`: where the
 * Studio look puts them over time, and its emphasis words.
 */
export function captionsComposition(
  lineGroups: CaptionGroup[],
  cfg: CaptionConfig,
  d: { w: number; h: number; duration: number },
  faces?: ProjectFontFace[],
  fontFaces: string[] = [],
  place: CaptionPlacement | null = null
): string {
  const style = captionStyle(cfg.style)
  const look = captionLook(cfg, faces)
  const zoneAt = (t: number): CaptionZone | undefined =>
    place?.zones.find((z) => t >= z.start - 0.001 && t < z.end)
  // a line whose first word lands on a cut (up to 0.05 s early) belongs to the picture after it
  const anchor = (g: CaptionGroup): number => Math.min(g.start + 0.05, (g.start + g.end) / 2)
  const emFont = place?.emphasis.length ? place.emphasisFont : null
  const k = Math.min(d.w, d.h) / 1080
  const restyles: Restyle[][] = []
  let groups = lineGroups
  if (place?.zones.length && look.layout !== 'scatter') {
    // a line breaks where the picture cuts to a place or color of its own, so it moves on the
    // same word as the picture; one still being said across the cut is restyled at it
    const key = (z: CaptionZone): string => JSON.stringify(zoneProps(z, look, d))
    const cuts = place.zones.filter((z, i) => i > 0 && key(z) !== key(place.zones[i - 1]))
    groups = splitAtBreaks(
      groups,
      cuts.map((z) => z.start)
    )
    groups.forEach((g, i) => {
      let cur = zoneAt(anchor(g))
      const list: Restyle[] = []
      for (const z of cuts) {
        if (z.start <= anchor(g) || z.start >= g.end) continue
        const from = cur && zoneProps(cur, look, d)
        const to = zoneProps(z, look, d)
        const line = { ...to.line }
        // the style's own shadow comes back when the line leaves a light background
        if (from?.line['text-shadow'] && !line['text-shadow'])
          line['text-shadow'] = captionTextShadow(look, k) || 'none'
        list.push([z.start, camel(to.group), camel(line)])
        cur = z
      }
      restyles[i] = list
    })
  }
  // the producer embeds only some weights of a built-in italic: the stylesheet brings the rest
  const fontLink = look.italic ? googleFontUrl(cfg.font) : null
  const lines =
    look.layout === 'scatter'
      ? groups
          .map((g, i) => {
            const spots = scatterLayout(g, look, cfg, d, i)
            const spans = g.words
              .map((w, j) => {
                const p = spots[j]
                if (!p) return ''
                return `<span class="w${p.hero ? ' hw' : ''}" data-align="${p.align}" style="left:${round(p.x * 100)}%;top:${round(p.y * 100)}%;font-size:${Math.max(6, Math.round(p.size * k))}px">${esc(w.text)}</span>`
              })
              .join('')
            return `      <div class="cg" id="lc-${i}">${spans}</div>`
          })
          .join('\n')
      : groups
          .map((g, i) => {
            const zone = zoneAt(anchor(g))
            const props = zone ? zoneProps(zone, look, d) : null
            const z = {
              group: props ? inline(props.group) : '',
              line: props ? inline(props.line) : ''
            }
            const em = emFont ? emphasized(g.words, place?.emphasis ?? []) : []
            return `      <div class="cg" id="lc-${i}"${z.group ? ` style="${z.group}"` : ''}><div class="cl"${z.line ? ` style="${z.line}"` : ''}>${g.words
              .map((w, j) => `<span class="w${em[j] ? ' em' : ''}">${esc(w.text)}</span>`)
              .join(' ')}</div></div>`
          })
          .join('\n')
  return `<!-- Captions made by Luca (style: ${style.name}${cfg.overrides ? ', customized' : ''}, font: ${cfg.font}). Luca rebuilds this file from the transcript whenever the captions or the clips under them change, so edits here are lost: change captions with the captions_apply tool. -->
<template id="${HOST_ID}-template">
  <div
    data-composition-id="${HOST_ID}"
    data-width="${d.w}"
    data-height="${d.h}"
    data-duration="${round(d.duration)}"
  >
    <div class="lc-stage">
${lines}
    </div>

${fontLink ? `    <link rel="stylesheet" href="${esc(fontLink)}" />\n` : ''}    <style>${fontFaces.length ? `\n${fontFaces.join('\n')}` : ''}${css(look, cfg, d, emFont)}
    </style>

    <script src="${GSAP}"></script>
    <script>${script(groups, look, d, restyles, (t) => (look.adaptive ? zoneAt(t)?.color : undefined))}
    </script>
  </div>
</template>
`
}

// ------------------------------------------------------------------ where the speech plays

const CLEAN_MASTER = /(^|\/)media\/clean-[0-9a-f]+\.mp4$/

/**
 * Every clip in index.html that plays the transcribed media: the clean master once a clean edit
 * replaced the source (the transcript then follows it), else the source file. Clips you can hear
 * win over muted ones, so a video piece moved away from its own sound doesn't take the captions
 * with it; muted clips count only when nothing plays the sound.
 */
export function speechClips(html: string, source: string): SpeechClip[] {
  const root = findTags(html).find((t) => t.attrs['data-composition-id'] !== undefined)
  const total = Number(root?.attrs['data-duration'] ?? 0) || 0
  const media = [...findTags(html, 'video'), ...findTags(html, 'audio')]
  const src = (t: (typeof media)[number]): string => (t.attrs.src ?? '').split(/[?#]/)[0]
  const stem = (f: string): string => basename(f, extname(f))
  let hits = media.filter((t) => CLEAN_MASTER.test(src(t)))
  if (!hits.length && source) {
    hits = media.filter((t) => basename(src(t)) === basename(source))
    if (!hits.length) hits = media.filter((t) => stem(src(t)) === stem(source))
  }
  const heard = hits.filter((t) => t.name === 'audio' || !('muted' in t.attrs))
  return (heard.length ? heard : hits)
    .map((t) => {
      const start = Number(t.attrs['data-start'] ?? 0) || 0
      const rate = Number(t.attrs['data-playback-rate'] ?? 1) || 1
      return {
        start,
        mediaStart: Number(t.attrs['data-media-start'] ?? 0) || 0,
        duration: Number(t.attrs['data-duration'] ?? 0) || Math.max(0, total - start),
        ...(rate !== 1 ? { rate } : {})
      }
    })
    .filter((c) => c.duration > 0)
    .sort((a, b) => a.start - b.start)
}
