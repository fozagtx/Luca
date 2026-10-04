/**
 * Where things go in the Studio look at any frame size: the speaker's card, the zone a graphic
 * fills for each speaker position, and where captions sit. Measured off the reference in 9:16
 * and carried to other shapes: tall and square frames stack (graphic above, speaker card along the
 * bottom); wide frames go side by side (graphic left, speaker card on the right).
 */
import type { StudioSpeaker } from './schema'

export type Rect = { x: number; y: number; w: number; h: number }

export type StudioGeometry = {
  w: number
  h: number
  /** min(w, h) / 1080: px values in the look are for a 1080 px short side. */
  k: number
  /** Graphic left, speaker right. */
  side: boolean
  /** The speaker's card in the inset position; it bleeds off the bottom edge. */
  card: Rect & { r: number }
  /** The rect each speaker position leaves for the graphic. */
  zones: Record<StudioSpeaker, Rect>
  /** Caption line centers (px) and the widest a line may be, per speaker position. */
  captions: Record<StudioSpeaker, { x: number; y: number; w: number }>
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t))
const round = (n: number): number => Math.round(n * 10) / 10

export function studioGeometry(w: number, h: number): StudioGeometry {
  const k = Math.min(w, h) / 1080
  const ratio = w / h
  const side = ratio >= 1.2
  if (side) {
    // landscape: card on the right third, graphic on the left
    const card = { x: w * 0.6, y: h * 0.26, w: w * 0.355, h: h * 0.74 + 40 * k, r: 34 * k }
    const left = { x: w * 0.05, y: h * 0.1, w: w * 0.51, h: h * 0.7 }
    return {
      w,
      h,
      k,
      side,
      card: rounded(card),
      zones: {
        inset: rounded(left),
        none: rounded({ x: w * 0.08, y: h * 0.06, w: w * 0.84, h: h * 0.74 }),
        full: rounded({ x: w * 0.06, y: h * 0.08, w: w * 0.4, h: h * 0.42 })
      },
      captions: {
        inset: { x: round(left.x + left.w / 2), y: round(h * 0.88), w: round(left.w * 0.9) },
        none: { x: round(w / 2), y: round(h * 0.87), w: round(w * 0.6) },
        full: { x: round(w / 2), y: round(h * 0.87), w: round(w * 0.6) }
      }
    }
  }
  // 9:16 (0.5625) → square (1.0): the card grows shorter as the frame gets wider
  const t = clamp01((ratio - 0.5625) / (1 - 0.5625))
  const cardTop = h * lerp(0.73, 0.64, t)
  const margin = w * lerp(0.065, 0.2, t)
  const card = { x: margin, y: cardTop, w: w - margin * 2, h: h - cardTop + 40 * k, r: 46 * k }
  const zoneTop = h * lerp(0.07, 0.07, t)
  const insetBottom = cardTop - h * lerp(0.15, 0.14, t)
  const pad = w * lerp(0.06, 0.1, t)
  return {
    w,
    h,
    k,
    side,
    card: rounded(card),
    zones: {
      inset: rounded({ x: pad, y: zoneTop, w: w - pad * 2, h: insetBottom - zoneTop }),
      none: rounded({ x: pad, y: h * 0.06, w: w - pad * 2, h: h * lerp(0.58, 0.66, t) }),
      full: rounded({ x: pad, y: h * 0.06, w: w - pad * 2, h: h * 0.3 })
    },
    captions: {
      inset: { x: round(w / 2), y: round(cardTop - h * lerp(0.13, 0.1, t)), w: round(w * 0.8) },
      none: { x: round(w / 2), y: round(h * lerp(0.74, 0.84, t)), w: round(w * 0.8) },
      full: { x: round(w / 2), y: round(h * lerp(0.74, 0.84, t)), w: round(w * 0.8) }
    }
  }
}

function rounded<T extends Rect>(r: T): T {
  return { ...r, x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }
}

/**
 * The speaker layer's transform for a position: the footage, the size of the frame, scaled by
 * `scale` about the frame origin and moved by (x, y). `face` is where the face sits in the
 * footage (0–1).
 */
export type SpeakerPose = { x: number; y: number; scale: number }

/** Full frame, punched in by `zoom` around the face. */
export function fullPose(
  g: StudioGeometry,
  face: { x: number; y: number },
  zoom: number
): SpeakerPose {
  const fx = face.x * g.w
  const fy = face.y * g.h
  return { x: round(fx * (1 - zoom)), y: round(fy * (1 - zoom)), scale: zoom }
}

/**
 * In the card. Without a cut-out the footage covers the card (a wide crop around the face). With
 * one the person is smaller and placed low, so their head rises above the card's top edge.
 */
export function insetPose(
  g: StudioGeometry,
  face: { x: number; y: number },
  popout: boolean
): SpeakerPose {
  const { card } = g
  const visibleH = Math.min(card.y + card.h, g.h) - card.y
  const cover = Math.max(card.w / g.w, visibleH / g.h)
  // the face lands in the card's middle (cover) or just below its top edge (pop-out)
  const scale = popout ? cover * (g.side ? 0.78 : 0.6) : cover
  const tx = card.x + card.w / 2
  const ty = popout ? card.y + visibleH * (g.side ? 0.2 : 0.36) : card.y + visibleH * 0.48
  let x = tx - face.x * g.w * scale
  let y = ty - face.y * g.h * scale
  if (!popout) {
    // the footage must still cover the whole card
    x = Math.min(card.x, Math.max(card.x + card.w - g.w * scale, x))
    y = Math.min(card.y, Math.max(card.y + visibleH - g.h * scale, y))
  } else {
    // the person's feet stay below the frame
    y = Math.max(g.h - g.h * scale, y)
  }
  return { x: round(x), y: round(y), scale: Math.round(scale * 10000) / 10000 }
}

/** clip-path: inset(...) for a frame-space rect, in the speaker layer's own (unscaled) space. */
export function clipFor(
  g: StudioGeometry,
  pose: SpeakerPose,
  rect: Rect & { r: number },
  openTop = false
): string {
  const s = pose.scale
  const top = openTop ? -g.h : (rect.y - pose.y) / s
  const left = (rect.x - pose.x) / s
  const right = g.w - (rect.x + rect.w - pose.x) / s
  const bottom = g.h - (rect.y + rect.h - pose.y) / s
  const px = (n: number): string => `${round(n)}px`
  const r = openTop ? '0px' : `${px(rect.r / s)} ${px(rect.r / s)} 0px 0px`
  return `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)} round ${r})`
}
