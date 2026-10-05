/**
 * The Studio composition Luca writes from a scene plan: the paper and ink backgrounds with their
 * texture, the speaker (full frame, in the card with the head popping out of it, or gone) cut
 * and moved on the plan's beats, and one box per beat holding its graphic. Everything is static
 * markup plus one paused GSAP timeline built after the fonts load, so every frame is a pure
 * function of the playhead, like the captions file.
 */
import {
  clipFor,
  fullPose,
  insetPose,
  popoutFits,
  studioGeometry,
  type Rect,
  type SpeakerPose
} from './geometry'
import { lookOf, type StudioLook } from './look'
import { esc, partsCss, r1 } from './parts'
import { RUNTIME } from './runtime'
import {
  segments,
  type NormalizedPlan,
  type StudioBg,
  type StudioKind,
  type StudioSpeaker
} from './schema'
import { KINDS } from './kinds'
import { t, type KindCtx, type KindModule } from './kinds/types'

export const STUDIO_ID = 'luca-studio'
export const STUDIO_FILE = `compositions/${STUDIO_ID}.html`
const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js'
const SCOPE = `[data-composition-id="${STUDIO_ID}"]`

/** One clip of the speaker's footage as index.html plays it, mirrored inside the composition. */
export type FootageClip = {
  src: string
  start: number
  duration: number
  mediaStart: number
  rate?: number
  /** The footage's color grade (data-color-grading, as index.html writes it). */
  grading?: string
}

export type StudioCtx = {
  w: number
  h: number
  duration: number
  footage: FootageClip[]
  /** The cut-out (transparent video) made from a footage file, by that file's src. */
  cutouts: Record<string, string>
  /** @font-face rules for the fonts the look uses that live in the project. */
  fontFaces: string[]
  /** Project path of the paper texture, or null to draw flat colors. */
  texture: string | null
  /** Pixel sizes of the images the plan names, by project path. */
  images?: Record<string, [number, number]>
  /** Stylesheets for built-in fonts the look uses (the preview needs them; renders embed them). */
  fontLinks?: string[]
}

type Pose = SpeakerPose & { plainClip: string; cutClip: string; cut: boolean }

const PLAIN_OPEN = 'inset(0px 0px 0px 0px)'

/** How long the outgoing graphic takes to whip out of the frame on a layout change. */
const WHIP = 0.16

/** A box's colors: its background's theme, or over the face the ink theme with a soft shadow. */
function themeVars(
  look: StudioLook,
  bg: StudioBg,
  speaker: StudioSpeaker,
  k: number
): Record<string, string> {
  const face = speaker === 'full'
  return {
    ...look.themes[face ? 'ink' : bg],
    '--glow': face ? `0 ${r1(2 * k)}px ${r1(18 * k)}px rgba(0,0,0,0.45)` : 'none'
  }
}

const styleOf = (vars: Record<string, string>): string =>
  Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')

function videoTags(clips: FootageClip[], cls: string, src: (c: FootageClip) => string): string {
  return clips
    .map(
      (c, i) =>
        `<video id="ls-${cls}-${i}" class="clip ls-video" src="${esc(src(c))}" muted playsinline data-start="${r1(c.start * 100) / 100}" data-duration="${Math.round(c.duration * 1000) / 1000}" data-media-start="${Math.round(c.mediaStart * 1000) / 1000}"${c.rate && c.rate !== 1 ? ` data-playback-rate="${c.rate}"` : ''}${c.grading ? ` data-color-grading="${c.grading}"` : ''} data-track-index="0"></video>`
    )
    .join('\n          ')
}

/** How much of a beat's height each kind takes when graphics stack. */
const SHARE: Partial<Record<StudioKind, number>> = { title: 0.8, icons: 1, number: 1, pills: 1.2 }

/** The zone split top to bottom between stacked graphics, with a gap between them. */
function stack(zone: Rect, graphics: { kind: StudioKind }[]): Rect[] {
  if (graphics.length === 1) return [zone]
  const gap = zone.h * 0.04
  const weights = graphics.map((g) => SHARE[g.kind] ?? 1.4)
  const total = weights.reduce((a, b) => a + b, 0)
  const free = zone.h - gap * (graphics.length - 1)
  let y = zone.y
  return weights.map((wt) => {
    const h = (free * wt) / total
    const r = { x: zone.x, y: r1(y), w: zone.w, h: r1(h) }
    y += h + gap
    return r
  })
}

export function studioComposition(plan: NormalizedPlan, ctx: StudioCtx): string {
  const { w, h, duration } = ctx
  const look = lookOf(plan.look)
  const geo = studioGeometry(w, h, look.id)
  const k = geo.k
  const segs = segments(plan, duration)
  // the head rises out of a card along the bottom; a tall side card (landscape) shows the
  // footage itself, as a body cut off mid-card would read as a mistake
  const hasCut =
    plan.popout &&
    look.id === 'paper' &&
    popoutFits(geo, plan.face) &&
    ctx.footage.length > 0 &&
    ctx.footage.every((c) => !!ctx.cutouts[c.src])
  const insetP = insetPose(geo, plan.face, hasCut)
  const inset: Pose = {
    ...insetP,
    plainClip: clipFor(geo, insetP, geo.card),
    cutClip: clipFor(geo, insetP, geo.card, true),
    cut: hasCut
  }
  const full = (zoom: number): Pose => ({
    ...fullPose(geo, plan.face, zoom),
    plainClip: PLAIN_OPEN,
    cutClip: PLAIN_OPEN,
    cut: false
  })

  // ---- the stage's timeline: backgrounds and the speaker, cut on every segment
  const stage: string[] = []
  const poseJs = (p: Pose): string => `{ x: ${r1(p.x)}, y: ${r1(p.y)}, scale: ${p.scale} }`
  // how far the card travels to clear the bottom edge, the popped-out head with it
  const offY = r1(h - geo.card.y + h * 0.16)
  segs.forEach((s, i) => {
    const prev = segs[i - 1]
    const at = t(s.start)
    const set = (sel: string, vars: string): void => {
      stage.push(i === 0 ? `gsap.set(${sel}, ${vars});` : `tl.set(${sel}, ${vars}, ${at});`)
    }
    if (!prev || prev.bg !== s.bg) set('bgInk', `{ opacity: ${s.bg === 'ink' ? 1 : 0} }`)
    if (s.speaker === 'none' && prev?.speaker === 'inset') {
      // the card drops out of the frame, then the speaker is gone
      const d = Math.min(0.16, s.end - s.start)
      const gone = t(s.start + d)
      stage.push(
        `tl.fromTo(card, { y: 0 }, { y: ${offY}, duration: ${t(d)}, ease: 'power2.in', immediateRender: false }, ${at});`,
        `tl.fromTo(speaker, { y: ${r1(inset.y)} }, { y: ${r1(inset.y + offY)}, duration: ${t(d)}, ease: 'power2.in', immediateRender: false }, ${at});`,
        `tl.set(speaker, { opacity: 0 }, ${gone});`,
        `tl.set(card, { opacity: 0 }, ${gone});`,
        `tl.set(texFace, { opacity: 0 }, ${gone});`
      )
      return
    }
    if (s.speaker === 'none') {
      set('speaker', '{ opacity: 0 }')
      set('card', '{ opacity: 0 }')
      set('texFace', '{ opacity: 0 }')
      return
    }
    const p = s.speaker === 'full' ? full(s.zoom) : inset
    set('speaker', `{ opacity: 1, x: ${r1(p.x)}, y: ${r1(p.y)}, scale: ${p.scale} }`)
    set('plain', `{ clipPath: '${p.plainClip}', opacity: ${p.cut ? 0 : 1} }`)
    set('cut', `{ clipPath: '${p.cutClip}', opacity: ${p.cut ? 1 : 0} }`)
    set('card', `{ opacity: ${s.speaker === 'inset' && p.cut ? 1 : 0}, y: 0 }`)
    set('texFace', `{ opacity: ${s.speaker === 'full' ? 1 : 0} }`)
    if (s.speaker === 'full') {
      // a hold keeps moving: a slow push into the face
      const to = full(s.zoom * 1.035)
      stage.push(
        `tl.fromTo(speaker, ${poseJs(p)}, { x: ${r1(to.x)}, y: ${r1(to.y)}, scale: ${to.scale}, duration: ${t(s.end - s.start)}, ease: 'none', immediateRender: false }, ${at});`
      )
    } else if (i > 0 && prev.speaker === 'none') {
      // the card rises in from below the frame, head first; from the full face it's a hard cut
      stage.push(
        `tl.fromTo(speaker, { y: ${r1(p.y + offY)} }, { y: ${r1(p.y)}, duration: 0.35, ease: 'expo.out', immediateRender: false }, ${at});`,
        `tl.fromTo(card, { y: ${offY} }, { y: 0, duration: 0.35, ease: 'expo.out', immediateRender: false }, ${at});`
      )
    }
  })

  // ---- one box per beat with a graphic
  const used = new Set<StudioKind>()
  const boxes: string[] = []
  const kindJs: string[] = []
  const endOf = (i: number): { bg: StudioBg; speaker: StudioSpeaker } => {
    const s = plan.scenes[i]
    return s.changes[s.changes.length - 1] ?? s
  }
  // when the card leaves or comes back over the same background, the outgoing graphic whips out
  // of the frame (to the left as the speaker leaves, up as the card rises in) while the next one
  // comes in; a background change or the full face is a hard cut
  const whips = plan.scenes.map((scene, i) => {
    const next = plan.scenes[i + 1]
    const end = endOf(i)
    const pair = [end.speaker, next?.speaker]
    return (
      !!next &&
      pair.includes('inset') &&
      pair.includes('none') &&
      scene.graphics.length > 0 &&
      next.start - scene.end < 0.02 &&
      next.bg === end.bg
    )
  })
  plan.scenes.forEach((scene, i) => {
    if (!scene.graphics.length) return
    // a beat whose speaker moves mid-way lays out for the tightest position it visits, so the
    // card and the popped-out head never land on its graphic
    const visited = [scene.speaker, ...scene.changes.map((c) => c.speaker)]
    const pos: StudioSpeaker = visited.includes('inset')
      ? 'inset'
      : (visited.find((v) => v !== 'full') ?? 'full')
    const zone = geo.zones[pos]
    const id = `ls-g${i}`
    const parts = stack(zone, scene.graphics)
    const subs: string[] = []
    const subJs: string[] = []
    // after a whip, what has no time of its own enters as the old graphic clears
    const graphics = whips[i - 1]
      ? scene.graphics.map((g) => (g.at === undefined ? { ...g, at: scene.start + 0.12 } : g))
      : scene.graphics
    graphics.forEach((g, j) => {
      const sub = parts[j]
      const kctx: KindCtx = {
        id: `${id}-${j}`,
        zone: sub,
        k,
        geo,
        look,
        accent: plan.accent,
        start: scene.start,
        end: scene.end,
        bg: scene.bg,
        speaker: pos,
        imageSize: (path) => ctx.images?.[path] ?? null
      }
      const mod = KINDS[g.kind] as KindModule<typeof g.kind>
      const out = mod.render(g as never, kctx)
      used.add(g.kind)
      subs.push(
        `<div id="${id}-${j}" class="ls-sub" style="left:${r1(sub.x - zone.x)}px;top:${r1(sub.y - zone.y)}px;width:${sub.w}px;height:${sub.h}px">${out.html}</div>`
      )
      subJs.push(
        `(function (G) {\n          ${out.js.split('\n').join('\n          ')}\n        })(H.q('#${id}-${j}'));`
      )
    })
    const whip = whips[i]
    const next = plan.scenes[i + 1]
    // a whipping box outlives its beat by the whip; the alternating tracks allow the overlap
    const shown = scene.end - scene.start + (whip ? WHIP : 0)
    boxes.push(
      `<div id="${id}" class="clip ls-g" data-start="${t(scene.start)}" data-duration="${t(shown)}" data-track-index="${2 + (i % 2)}" style="left:${zone.x}px;top:${zone.y}px;width:${zone.w}px;height:${zone.h}px;${styleOf(themeVars(look, scene.bg, scene.speaker, k))}"><div class="ls-gi">${subs.join('')}</div></div>`
    )
    // recolored when the background changes, and when the face comes in under it or leaves
    const themeKey = (c: { bg: StudioBg; speaker: StudioSpeaker }): string =>
      c.speaker === 'full' ? 'face' : c.bg
    const recolor = scene.changes
      .filter((c, j) => themeKey(c) !== themeKey(j ? scene.changes[j - 1] : scene))
      .map((c) => `H.theme(G, ${t(c.at)}, ${JSON.stringify(themeVars(look, c.bg, c.speaker, k))});`)
    if (whip && next) {
      const to =
        next.speaker === 'inset' ? `y: ${-r1(zone.y + zone.h)}` : `x: ${-r1(zone.x + zone.w)}`
      recolor.push(
        `tl.fromTo(G, { x: 0, y: 0, filter: 'blur(0px)' }, { ${to}, filter: 'blur(${r1(16 * k)}px)', duration: ${WHIP}, ease: 'power2.in', immediateRender: false }, ${t(scene.end)});`
      )
    }
    kindJs.push(
      `      (function (G) {\n        if (!G) return;\n        H.drift(H.q('.ls-gi', G), ${t(scene.start)}, ${t(scene.end)}, 0.022);\n        ${[...subJs, ...recolor].join('\n        ')}\n      })(H.q('#${id}'));`
    )
  })

  const kindCss = [...used]
    .map((kind) => (KINDS[kind] as KindModule<typeof kind>).css?.(SCOPE, k) ?? '')
    .join('')
  const tex = ctx.texture && look.texture && plan.texture > 0
  // every face the kinds use, loaded before fitAll measures any text
  const fontsToLoad = [
    ...new Set([
      ...[300, 400, 500, 600, 700, 800, 900].map((w) => `${w} 100px "${look.fonts.display}"`),
      ...(look.displayItalic
        ? [800, 900].map((w) => `italic ${w} 100px "${look.fonts.display}"`)
        : []),
      ...[400, 500, 600, 700].map((w) => `${w} 50px "${look.fonts.text}"`),
      `400 50px "${look.fonts.serif}"`,
      `italic 400 50px "${look.fonts.serif}"`,
      `400 50px "${look.fonts.mono}"`,
      `500 50px "${look.fonts.mono}"`
    ])
  ]
  const card = geo.card
  const css = `${ctx.fontFaces.length ? `\n${ctx.fontFaces.join('\n')}` : ''}
      ${SCOPE} {
        --accent: ${plan.accent}; --alarm: ${look.alarm};
        --display: '${look.fonts.display}'; --text: '${look.fonts.text}'; --serif: '${look.fonts.serif}'; --mono: '${look.fonts.mono}';
        --small: ${look.id === 'paper' ? 'var(--display)' : 'var(--text)'};
      }
      ${SCOPE} .ls-stage { position: absolute; inset: 0; overflow: hidden; background: ${look.themes.paper['--bg']}; }
      ${SCOPE} .ls-bg { position: absolute; inset: 0; }
      ${SCOPE} .ls-bg-paper { background: ${look.themes.paper['--bg']}; }
      ${SCOPE} .ls-bg-ink { background: ${look.themes.ink['--bg']}; opacity: 0; }
      ${SCOPE} .ls-tex { position: absolute; inset: 0; pointer-events: none; ${tex ? `background: url('${esc(ctx.texture!)}') center / cover no-repeat;` : 'display: none;'} }
      ${SCOPE} .ls-bg-paper .ls-tex { mix-blend-mode: soft-light; opacity: ${r1(0.55 * plan.texture * 100) / 100}; }
      ${SCOPE} .ls-bg-ink .ls-tex { mix-blend-mode: overlay; opacity: ${r1(plan.texture * 100) / 100}; }
      ${SCOPE} .ls-tex-face { mix-blend-mode: soft-light; opacity: 0; }
      ${SCOPE} .ls-tex-face .ls-tex { opacity: ${r1(0.3 * plan.texture * 100) / 100}; }
      ${SCOPE} .ls-card {
        position: absolute; left: ${card.x}px; top: ${card.y}px; width: ${card.w}px; height: ${card.h}px;
        border-radius: ${card.closed ? `${card.r}px` : `${card.r}px ${card.r}px 0 0`}; opacity: 0;
        background: linear-gradient(180deg, #2a2926 0%, #191816 100%);
        box-shadow: inset 0 ${r1(1.5 * k)}px 0 rgba(255,255,255,0.07), 0 -${r1(10 * k)}px ${r1(40 * k)}px rgba(40,30,15,0.12);
      }
      ${SCOPE} .ls-speaker { position: absolute; left: 0; top: 0; width: ${w}px; height: ${h}px; transform-origin: 0 0; }
      ${SCOPE} .ls-layer { position: absolute; inset: 0; }
      ${SCOPE} .ls-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      ${SCOPE} .ls-g { position: absolute; display: flex; align-items: center; justify-content: center; text-shadow: var(--glow, none); }
      ${SCOPE} .ls-gi { position: absolute; inset: 0; transform-origin: 50% 50%; }
      ${SCOPE} .ls-sub { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; }
${partsCss(SCOPE, k)}${kindCss}`

  const cutSrc = (c: FootageClip): string => ctx.cutouts[c.src] ?? c.src
  const html = `<!-- The Studio look, made by Luca from .luca/studio.json (${plan.look} look, ${plan.scenes.length} beats). Luca rebuilds this file whenever the plan or the footage under it changes, so edits here are lost: change the plan with the studio_apply tool. -->
<template id="${STUDIO_ID}-template">
  <div
    data-composition-id="${STUDIO_ID}"
    data-width="${w}"
    data-height="${h}"
    data-duration="${t(duration)}"
  >
    <div class="ls-stage">
      <div class="ls-bg ls-bg-paper"><div class="ls-tex"></div></div>
      <div class="ls-bg ls-bg-ink" id="ls-bg-ink"><div class="ls-tex"></div></div>
      <div class="ls-card" id="ls-card"></div>
      <div class="ls-speaker" id="ls-speaker">
        <div class="ls-layer" id="ls-plain">
          ${videoTags(ctx.footage, 'v', (c) => c.src)}
        </div>
        <div class="ls-layer" id="ls-cut" style="opacity:0">
          ${hasCut ? videoTags(ctx.footage, 'c', cutSrc) : ''}
        </div>
      </div>
      <div class="ls-tex-face" id="ls-tex-face"><div class="ls-tex"></div></div>
      ${boxes.join('\n      ')}
    </div>

${(ctx.fontLinks ?? []).map((u) => `    <link rel="stylesheet" href="${esc(u)}" />\n`).join('')}    <style>${css}
    </style>

    <script src="${GSAP}"></script>
    <script>
      (function () {
        var root = document.querySelector('${SCOPE}');
        var K = ${k};
        var tl = gsap.timeline({ paused: true });
${RUNTIME}
        function build() {
          fitAll();
          var bgInk = H.q('#ls-bg-ink'), speaker = H.q('#ls-speaker'), plain = H.q('#ls-plain'),
            cut = H.q('#ls-cut'), card = H.q('#ls-card'), texFace = H.q('#ls-tex-face');
          // spans the whole video, so holds keep the timeline's clock honest
          tl.to({ v: 0 }, { v: 1, duration: ${t(duration)}, ease: 'none' }, 0);
          ${stage.join('\n          ')}
${kindJs.join('\n')}
          window.__timelines['${STUDIO_ID}'] = tl;
        }
        var fonts = ${JSON.stringify(fontsToLoad)};
        if (document.fonts && document.fonts.load)
          Promise.all(fonts.map(function (f) { return document.fonts.load(f).catch(function () {}); })).then(build, build);
        else build();
      })();
    </script>
  </div>
</template>
`
  return html
}
