/**
 * The Studio scene plan: what Luca's agent writes (through studio_apply) to turn a talking video
 * into the Studio look, and what .luca/studio.json keeps. Times are timeline seconds, the ones
 * transcribe and clean_edit return. Every field past `scenes` has a default, so a plan can be as
 * small as a list of beats.
 */
import { z } from 'zod'

const at = z.number().min(0).describe('when it happens, in timeline seconds')
const text = (max: number): z.ZodString => z.string().trim().min(1).max(max)

/** An app, product or brand shown as a glass tile: a logo file, or letters when there is none. */
export const markSchema = z.object({
  label: text(40)
    .optional()
    .describe('its name, shown small under the tile where a kind shows names'),
  logo: z
    .string()
    .optional()
    .describe('project path of the logo image, e.g. media/logos/ollama.png from logo_add'),
  mono: text(3)
    .optional()
    .describe('1–3 letters drawn on the tile when there is no logo, e.g. "OI", "F5"'),
  tint: z
    .boolean()
    .optional()
    .describe(
      'draw the logo in one color (white on a dark tile): for a single-color logo on a transparent background'
    )
})

const lineSchema = z.object({
  text: text(48),
  weight: z.enum(['black', 'bold', 'medium', 'light']).optional().describe('default bold'),
  serif: z.boolean().optional().describe('the italic serif instead, for one emphatic word'),
  color: z.enum(['text', 'accent', 'alarm', 'dim']).optional()
})

export const graphicSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('title'),
    lines: z.array(lineSchema).min(1).max(3),
    at: at.optional(),
    strikeAt: at
      .optional()
      .describe('a line strikes the title through, e.g. "no API key" being crossed out')
  }),
  z.object({
    kind: z.literal('icons'),
    items: z
      .array(markSchema.extend({ at: at.optional() }))
      .min(1)
      .max(5),
    focus: z
      .boolean()
      .optional()
      .describe(
        'default true: every tile starts blurred and grey and snaps sharp at its `at`, the moment its name is said'
      ),
    cross: z
      .array(z.object({ index: z.number().int().min(0), at }))
      .optional()
      .describe('red X strokes over tiles: the paid tool being replaced'),
    light: z.boolean().optional().describe('light glass tiles (for colorful or dark logos)'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('app'),
    name: text(24).describe('the name, lowercase as the brand writes it: "ollama", "open webui"'),
    mark: markSchema,
    at: at.optional(),
    stat: z
      .object({
        value: text(12).describe('short: "180k", "50k", "4.9★"'),
        label: text(28).optional().describe('e.g. "GitHub stars"'),
        at: at.optional()
      })
      .optional(),
    lines: z
      .array(text(40))
      .max(2)
      .optional()
      .describe('what it is, in two short lines: ["a chat app", "on top of ollama"]'),
    linesAt: at.optional(),
    satellites: z
      .array(markSchema.extend({ at: at.optional() }))
      .max(6)
      .optional()
      .describe('smaller tiles that fly in around it: the models it runs, what it plugs into')
  }),
  z.object({
    kind: z.literal('list'),
    items: z
      .array(z.object({ text: text(32), at: at.optional() }))
      .min(1)
      .max(7),
    mark: z
      .enum(['github', 'check', 'number', 'dot', 'none'])
      .optional()
      .describe('default github'),
    blur: z.boolean().optional().describe('names blurred: a teaser before they are revealed'),
    highlight: z
      .object({ index: z.number().int().min(0), badge: text(6).optional(), at: at.optional() })
      .optional()
      .describe('one row in the accent color with a badge on the right, e.g. the bonus "+1"'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('window'),
    images: z
      .array(z.object({ image: z.string(), at: at.optional() }))
      .max(2)
      .optional()
      .describe('screenshots of the product (project paths), one or two stacked'),
    chat: z
      .object({
        title: text(24).optional(),
        greeting: text(60)
          .optional()
          .describe('the assistant’s first line, e.g. "How can I help you today?"'),
        prompt: text(60).describe('what the user types'),
        typeAt: at.optional(),
        reply: text(80).optional(),
        replyAt: at.optional()
      })
      .optional()
      .describe('a clean chat app drawn for you when there is no screenshot'),
    labels: z
      .array(z.object({ text: text(20), at }))
      .max(6)
      .optional()
      .describe(
        'a small white label under the window that steps through features: tools → masks → layers'
      ),
    boxes: z
      .array(
        z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().min(0.02).max(1),
          h: z.number().min(0.02).max(1),
          at
        })
      )
      .max(6)
      .optional()
      .describe('a highlight box moving over the first screenshot, in 0–1 of its width and height'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('wave'),
    cards: z
      .array(
        z.object({ label: text(24).optional(), accent: z.boolean().optional(), at: at.optional() })
      )
      .min(1)
      .max(3)
      .describe('audio cards; accent: the result (a cloned voice) in the accent color'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('price'),
    label: text(24).optional().describe('the paid tool, small above its price: "elevenlabs"'),
    from: text(10).optional().describe('what it costs: "$60"'),
    strikeAt: at.optional(),
    crossed: z
      .array(
        markSchema.extend({ at: at.optional().describe('crossed out on the word that names it') })
      )
      .max(3)
      .optional()
      .describe('paid tools shown as tiles and crossed out in red, instead of label and from'),
    tag: text(20).optional().describe('the free one, in a black tag above the new price: "f5-tts"'),
    to: text(10).describe('the new price: "$0"'),
    toAt: at.optional(),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('compare'),
    image: z.string().describe('project path of the image'),
    before: text(16).optional().describe('default "before"'),
    after: text(16).optional().describe('default "after"'),
    afterAt: at.describe('when it turns sharp and the tag flips to the accent'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('pills'),
    intro: text(40).optional().describe('small line above: "some of these want"'),
    items: z
      .array(z.object({ text: text(28), at: at.optional() }))
      .min(1)
      .max(4),
    joiner: text(8).optional().describe('tiny word between the pills: "or", "+"'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('number'),
    label: text(24).optional().describe('"monthly bill"'),
    strikeAt: at.optional().describe('the label gets struck through'),
    value: text(10).describe('"$0", "10×", "3 min"'),
    valueAt: at.optional(),
    sub: text(32).optional().describe('small line under it: "after that"'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('cta'),
    kicker: text(24).optional().describe('default "COMMENT BELOW"'),
    word: text(16).describe('the word typed into the box: "LOCAL"'),
    typeAt: at.optional(),
    sub: text(48).optional().describe('the promise, small: "and the link lands in your dms"'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('image'),
    image: z.string().describe('project path: B-roll from broll_add or one of the user’s images'),
    caption: text(32).optional(),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('quote'),
    text: text(90).describe('a line worth reading twice, in the italic serif'),
    by: text(32).optional(),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('rank'),
    rank: z.number().int().min(1).max(99),
    name: text(24),
    stat: text(24).optional().describe('"161.8k stars"'),
    mark: markSchema.optional(),
    value: text(16).optional().describe('a big number under the icon: "180,000"'),
    valueAt: at.optional().describe('when the number lands, on its word'),
    at: at.optional()
  }),
  z.object({
    kind: z.literal('terminal'),
    command: text(60).describe('typed after the prompt: "ollama run qwen3"'),
    typeAt: at.optional(),
    output: z.array(text(70)).max(4).optional(),
    outputAt: at.optional(),
    at: at.optional()
  })
])

export const bgSchema = z.enum(['paper', 'ink'])
export const speakerSchema = z.enum(['full', 'inset', 'none'])

export const sceneSchema = z.object({
  start: at.describe('when the beat starts, on a word'),
  end: at.describe('when it ends; the next beat or the face takes over'),
  bg: bgSchema
    .optional()
    .describe('paper (cream, default) or ink (dark); a hard cut when it changes'),
  speaker: speakerSchema
    .optional()
    .describe(
      'full: the face fills the frame; inset: the speaker in a card at the bottom (side in landscape) under the graphic; none: the graphic alone. Default by kind.'
    ),
  zoom: z.number().min(1).max(1.6).optional().describe('full only: punch-in, 1–1.6'),
  changes: z
    .array(
      z.object({
        at,
        bg: bgSchema.optional(),
        speaker: speakerSchema.optional()
      })
    )
    .max(4)
    .optional()
    .describe('switch the background or the speaker mid-beat while the graphic stays'),
  graphic: z
    .union([graphicSchema, z.array(graphicSchema).min(1).max(3)])
    .optional()
    .describe(
      'what the beat shows; a list of up to 3 stacks them top to bottom (the hook: a title over a row of icons)'
    )
})

export const planSchema = z.object({
  look: z
    .enum(['paper', 'serif'])
    .optional()
    .describe(
      'paper (default): cream and ink paper, wide grotesk; serif: flat white and black, heavy italic serif'
    ),
  accent: z.string().optional().describe('the highlight color, default lime #C8F23A'),
  texture: z.number().min(0).max(1).optional().describe('paper texture strength, default 1'),
  face: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .optional()
    .describe('where the face is in the footage, 0–1 (default x 0.5, y 0.38)'),
  popout: z
    .boolean()
    .optional()
    .describe(
      'default true: once speaker_cutout made the cut-out, the head rises out of the inset card'
    ),
  emphasis: z
    .array(z.string().trim().min(1).max(30))
    .max(40)
    .optional()
    .describe('words the captions show in the italic serif when they are said'),
  scenes: z.array(sceneSchema).max(120)
})

export type StudioMark = z.infer<typeof markSchema>
export type StudioGraphic = z.infer<typeof graphicSchema>
export type StudioKind = StudioGraphic['kind']
export type StudioBg = z.infer<typeof bgSchema>
export type StudioSpeaker = z.infer<typeof speakerSchema>
export type StudioScene = z.infer<typeof sceneSchema>
export type StudioPlan = z.infer<typeof planSchema>
export type GraphicOf<K extends StudioKind> = Extract<StudioGraphic, { kind: K }>

/** Where the speaker goes when a scene doesn't say: big statements share the frame, cards own it. */
const DEFAULT_SPEAKER: Record<StudioKind, StudioSpeaker> = {
  title: 'inset',
  icons: 'inset',
  app: 'none',
  list: 'none',
  window: 'inset',
  wave: 'inset',
  price: 'none',
  compare: 'none',
  pills: 'inset',
  number: 'none',
  cta: 'inset',
  image: 'none',
  quote: 'inset',
  rank: 'none',
  terminal: 'none'
}

/** One stretch of the timeline with one background and speaker position. */
export type Segment = {
  start: number
  end: number
  bg: StudioBg
  speaker: StudioSpeaker
  zoom: number
  /** Index into the normalized scenes, or -1 for the face between beats. */
  scene: number
}

export type NormalizedScene = Omit<StudioScene, 'bg' | 'speaker' | 'changes' | 'graphic'> & {
  bg: StudioBg
  speaker: StudioSpeaker
  changes: { at: number; bg: StudioBg; speaker: StudioSpeaker }[]
  /** Top to bottom; empty for the face alone. */
  graphics: StudioGraphic[]
}

export type NormalizedPlan = Omit<StudioPlan, 'scenes'> & {
  look: 'paper' | 'serif'
  accent: string
  texture: number
  face: { x: number; y: number }
  popout: boolean
  emphasis: string[]
  scenes: NormalizedScene[]
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** The shortest the face may show between two beats: less reads as a flash of two cuts. */
const MIN_FACE = 0.5

/**
 * Sorted, clipped to [0, duration], overlaps resolved (a later beat starts where the one before
 * it ends), beats under 0.2 s dropped, gaps too short for the face closed, defaults filled in.
 * Returns what was changed in plain words so the agent can see what Luca did to its plan.
 */
export function normalizePlan(
  plan: StudioPlan,
  duration: number
): { plan: NormalizedPlan; notes: string[] } {
  const notes: string[] = []
  const end = duration > 0 ? duration : Infinity
  const sorted = [...plan.scenes].sort((a, b) => a.start - b.start)
  const scenes: NormalizedScene[] = []
  for (const s of sorted) {
    let start = r3(Math.max(0, s.start))
    const stop = r3(Math.min(end, s.end))
    const last = scenes[scenes.length - 1]
    if (last && start < last.end) {
      if (start - last.start >= 0.2) {
        notes.push(`Beat at ${last.start}s now ends at ${start}s, where the next one starts.`)
        last.end = start
        // its changes were checked against the old end
        last.changes = last.changes.filter((c) => c.at < start - 0.05)
      } else {
        notes.push(
          `Beat at ${s.start}s started within 0.2 s of the one before; it now starts at ${last.end}s.`
        )
        start = last.end
      }
    }
    if (stop - start < 0.2) {
      notes.push(`Dropped a beat at ${s.start}s: shorter than 0.2 s once it fit the timeline.`)
      continue
    }
    // a beat that doesn't say keeps the background the one before it ended on
    const prevEnd = last?.changes[last.changes.length - 1] ?? last
    const bg = s.bg ?? prevEnd?.bg ?? 'paper'
    const graphics = s.graphic ? (Array.isArray(s.graphic) ? s.graphic : [s.graphic]) : []
    const speaker = s.speaker ?? (graphics.length ? DEFAULT_SPEAKER[graphics[0].kind] : 'full')
    let cur = { bg, speaker }
    const changes = (s.changes ?? [])
      .filter((c) => c.at > start && c.at < stop)
      .sort((a, b) => a.at - b.at)
      .map((c) => {
        cur = { bg: c.bg ?? cur.bg, speaker: c.speaker ?? cur.speaker }
        return { at: r3(c.at), ...cur }
      })
    const { graphic: _graphic, ...rest } = s
    void _graphic
    scenes.push({ ...rest, start, end: stop, bg, speaker, changes, graphics })
  }
  // the reference holds the picture through the pause between items and cuts on the next word:
  // a gap too short for the face goes to the beat before it
  if (scenes.length && scenes[0].start > 0 && scenes[0].start < MIN_FACE) {
    notes.push(`Beat at ${scenes[0].start}s now starts at 0s: the face would flash before it.`)
    scenes[0].start = 0
  }
  for (let i = 0; i + 1 < scenes.length; i++) {
    const gap = r3(scenes[i + 1].start - scenes[i].end)
    if (gap > 0 && gap < MIN_FACE) {
      notes.push(
        `Beat at ${scenes[i].start}s now runs to ${scenes[i + 1].start}s: a ${gap.toFixed(2)} s gap would flash the face.`
      )
      scenes[i].end = scenes[i + 1].start
    }
  }
  const accent = plan.accent && HEX.test(plan.accent.trim()) ? plan.accent.trim() : '#C8F23A'
  if (plan.accent && accent !== plan.accent.trim())
    notes.push(`Accent "${plan.accent}" isn't a hex color; kept lime.`)
  return {
    plan: {
      ...plan,
      look: plan.look ?? 'paper',
      accent,
      texture: plan.texture ?? 1,
      face: plan.face ?? { x: 0.5, y: 0.38 },
      popout: plan.popout ?? true,
      emphasis: (plan.emphasis ?? []).map((w) => w.toLowerCase()),
      scenes
    },
    notes
  }
}

/**
 * The plan as stretches of one background and speaker position, covering [0, duration] with no
 * gap: between beats the face fills the frame (each return a slightly different punch-in, so cuts
 * never land on the same framing).
 */
export function segments(plan: NormalizedPlan, duration: number): Segment[] {
  const out: Segment[] = []
  const zooms = [1, 1.12, 1.05, 1.16]
  let fullCount = 0
  let bg: StudioBg = plan.scenes[0]?.bg ?? 'paper'
  const push = (seg: Omit<Segment, 'zoom'> & { zoom?: number }): void => {
    if (seg.end - seg.start <= 0.001) return
    const zoom = seg.speaker === 'full' ? (seg.zoom ?? zooms[fullCount++ % zooms.length]) : 1
    const prev = out[out.length - 1]
    // a beat that keeps the face full continues the stretch before it at the same framing
    if (
      prev &&
      prev.speaker === seg.speaker &&
      prev.bg === seg.bg &&
      prev.end === seg.start &&
      seg.speaker !== 'full'
    ) {
      prev.end = seg.end
      return
    }
    out.push({ ...seg, zoom })
  }
  let t = 0
  plan.scenes.forEach((s, i) => {
    if (s.start > t) push({ start: t, end: s.start, bg, speaker: 'full', scene: -1 })
    const marks = [{ at: s.start, bg: s.bg, speaker: s.speaker }, ...s.changes]
    marks.forEach((m, j) => {
      const stop = Math.min(j + 1 < marks.length ? marks[j + 1].at : s.end, s.end)
      push({ start: m.at, end: stop, bg: m.bg, speaker: m.speaker, scene: i, zoom: s.zoom })
      bg = m.bg
    })
    t = s.end
  })
  if (duration > t) push({ start: t, end: duration, bg, speaker: 'full', scene: -1 })
  return out.map((s) => ({ ...s, start: r3(s.start), end: r3(s.end) }))
}

/** Plain-language checks the agent should act on: nothing here stops the plan from applying. */
export function planWarnings(plan: NormalizedPlan, duration: number): string[] {
  const out: string[] = []
  const covered = plan.scenes.reduce((n, s) => n + (s.end - s.start), 0)
  if (duration > 8 && covered / duration < 0.45)
    out.push(
      `Only ${Math.round((covered / duration) * 100)}% of the video has a beat: the Studio look changes the picture every 1.5–3 s, so plan more beats (the face alone between them is fine for 1–2 s).`
    )
  for (const s of plan.scenes) {
    const len = s.end - s.start
    if (len > 6 && !s.changes.length)
      out.push(
        `The beat at ${s.start}s holds one picture for ${len.toFixed(1)} s; split it or add a change.`
      )
    if (!s.graphics.length && s.speaker !== 'full')
      out.push(
        `The beat at ${s.start}s has no graphic but the speaker is ${s.speaker}: the frame will look empty.`
      )
    if (s.graphics.length && len < 0.8)
      out.push(
        `The beat at ${s.start}s lasts ${len.toFixed(2)} s: a graphic needs ~0.8 s to land and be read; merge it with a neighbour or lengthen it.`
      )
    if (s.graphics.length === 3 && s.speaker !== 'none')
      out.push(
        `The beat at ${s.start}s stacks three graphics above the speaker's card: at 1:1 or in a wide frame each gets under ~150 px, so split the beat.`
      )
    s.changes.forEach((c, j) => {
      const before = j ? s.changes[j - 1] : s
      if (c.bg === before.bg && c.speaker === before.speaker)
        out.push(
          `The change at ${c.at}s in the beat at ${s.start}s switches neither the background nor the speaker: give it a bg or a speaker.`
        )
    })
    for (const g of s.graphics) {
      for (const t of timesOf(g))
        if (t < s.start - 0.01 || t > s.end + 0.01)
          out.push(
            `A ${g.kind} at ${s.start}–${s.end}s has a moment at ${t}s, outside its beat: it won't show.`
          )
      for (const w of kindWarnings(g)) out.push(`The ${g.kind} at ${s.start}s ${w}.`)
    }
  }
  return out
}

/** Fields a graphic names that won't show, or show differently than asked. */
function kindWarnings(g: StudioGraphic): string[] {
  const out: string[] = []
  switch (g.kind) {
    case 'app':
      if (g.stat && g.lines?.length)
        out.push('shows the stat or the two lines, not both: the lines are dropped')
      break
    case 'price':
      if (g.crossed?.length && (g.label || g.from))
        out.push('has crossed tiles, so its label and from are ignored')
      break
    case 'icons':
      for (const c of g.cross ?? [])
        if (c.index >= g.items.length)
          out.push(`crosses tile ${c.index}, but it has ${g.items.length} (they count from 0)`)
      if (g.focus !== false && g.items.some((i) => i.label))
        out.push('has labels, which show only with focus: false')
      break
    case 'list':
      if (g.highlight && g.highlight.index >= g.items.length)
        out.push(
          `highlights row ${g.highlight.index}, but it has ${g.items.length} (they count from 0)`
        )
      break
    case 'window':
      if (!g.images?.length && !g.chat)
        out.push('has neither images nor a chat: it draws an empty chat app')
      if (g.boxes?.length && !g.images?.length)
        out.push('has boxes but no image: boxes move over the first screenshot only')
      break
  }
  return out
}

/** Every `at`-like time a graphic names, to check they fall inside its beat. */
function timesOf(g: StudioGraphic): number[] {
  const out: number[] = []
  const walk = (v: unknown, key?: string): void => {
    if (typeof v === 'number' && key && /(^at$|At$)/.test(key)) out.push(v)
    else if (Array.isArray(v)) v.forEach((x) => walk(x))
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k)
  }
  walk(g)
  return out
}
