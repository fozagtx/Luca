export type Aspect = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '3:4'
export type AspectChoice = Aspect | 'auto'

/** What `hyperframes init --resolution` and the Pexels API understand. */
export type Orientation = 'landscape' | 'portrait' | 'square'

export type AspectInfo = {
  id: Aspect
  name: string
  size: [number, number]
  orientation: Orientation
}

export const ASPECTS: AspectInfo[] = [
  { id: '16:9', name: 'Landscape', size: [1920, 1080], orientation: 'landscape' },
  { id: '9:16', name: 'Vertical', size: [1080, 1920], orientation: 'portrait' },
  { id: '1:1', name: 'Square', size: [1080, 1080], orientation: 'square' },
  { id: '4:5', name: 'Portrait', size: [1080, 1350], orientation: 'portrait' },
  { id: '4:3', name: 'Classic', size: [1440, 1080], orientation: 'landscape' },
  { id: '3:4', name: 'Classic portrait', size: [1080, 1440], orientation: 'portrait' }
]

export const DEFAULT_ASPECT: Aspect = '16:9'

export function aspectInfo(a: Aspect): AspectInfo {
  return ASPECTS.find((i) => i.id === a) ?? ASPECTS[0]
}

export function sizeOf(a: Aspect): [number, number] {
  return aspectInfo(a).size
}

export function orientationOf(a: Aspect): Orientation {
  return aspectInfo(a).orientation
}

/** Height taller than width (4:5 counts): caption layout and the like. */
export function isPortrait(a: Aspect): boolean {
  const [w, h] = sizeOf(a)
  return h > w
}

/** The ratio a frame fits best: smallest |ln(w/h) - ln(ratio)| over ASPECTS. */
export function bestFit(width: number, height: number): Aspect {
  const r = Math.log(width / height)
  let best: Aspect = DEFAULT_ASPECT
  let dist = Infinity
  for (const i of ASPECTS) {
    const d = Math.abs(r - Math.log(i.size[0] / i.size[1]))
    if (d < dist) {
      dist = d
      best = i.id
    }
  }
  return best
}

/**
 * Saved values from before the ratios: landscape→16:9, portrait→9:16, square→1:1;
 * anything unknown → DEFAULT_ASPECT.
 */
export function normalizeAspect(v: unknown): Aspect {
  switch (v) {
    case 'landscape':
      return '16:9'
    case 'portrait':
      return '9:16'
    case 'square':
      return '1:1'
    default:
      return ASPECTS.some((i) => i.id === v) ? (v as Aspect) : DEFAULT_ASPECT
  }
}

/** The concrete ratio for a start-card choice. */
export function resolveAspect(
  choice: AspectChoice,
  footage?: { width: number; height: number } | null
): Aspect {
  if (choice !== 'auto') return choice
  return footage ? bestFit(footage.width, footage.height) : DEFAULT_ASPECT
}
