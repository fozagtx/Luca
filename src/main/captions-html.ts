import { basename, extname } from 'node:path'
import {
  captionLook,
  captionStyle,
  captionTextShadow,
  round,
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

function css(look: CaptionLook, cfg: CaptionConfig, d: { w: number; h: number }): string {
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
        text-transform: ${cfg.uppercase ? 'uppercase' : 'none'};
        ${shadow ? `text-shadow: ${shadow};` : ''}
        ${box ? `background: ${box.bg}; border-radius: ${radius}; padding: ${box.padding};` : ''}
        overflow: visible;
      }
      ${s} .w { display: inline-block; ${look.wordBox ? 'padding: 0.02em 0.16em; border-radius: 0.2em;' : ''} }`
}

function script(groups: CaptionGroup[], look: CaptionLook, d: { w: number; h: number }): string {
  const data = groups.map((g) => [g.start, g.end, g.words.map((w) => [w.start, w.end])])
  const opts = {
    anim: look.anim,
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
        function mark(words, g, on, off) {
          g[2].forEach(function (w, j) {
            if (!words[j]) return;
            tl.to(words[j], Object.assign({ duration: 0.06, ease: 'power1.out' }, on), w[0]);
            if (j + 1 < g[2].length)
              tl.to(words[j], Object.assign({ duration: 0.08, ease: 'power1.out' }, off), g[2][j + 1][0]);
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
          switch (O.anim) {
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

export function captionsComposition(
  groups: CaptionGroup[],
  cfg: CaptionConfig,
  d: { w: number; h: number; duration: number },
  faces?: ProjectFontFace[]
): string {
  const style = captionStyle(cfg.style)
  const look = captionLook(cfg, faces)
  const lines = groups
    .map(
      (g, i) =>
        `      <div class="cg" id="lc-${i}"><div class="cl">${g.words
          .map((w) => `<span class="w">${esc(w.text)}</span>`)
          .join(' ')}</div></div>`
    )
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

    <style>${css(look, cfg, d)}
    </style>

    <script src="${GSAP}"></script>
    <script>${script(groups, look, d)}
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
