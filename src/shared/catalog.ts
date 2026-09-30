import type { CatalogItem, RemocnItem } from './types'

/**
 * One searchable library over the HyperFrames catalog (blocks + components), Remocn's
 * Remotion components and Luca's own footage treatments, for the agent's catalog_search tool.
 */

export type LibrarySource = 'hyperframes' | 'remocn' | 'luca'

export type LibraryCategory =
  | 'text'
  | 'captions'
  | 'overlays'
  | 'transitions'
  | 'effects'
  | 'data'
  | 'ui'
  | 'camera'
  | 'templates'
  | 'more'

export type LibraryItem = {
  source: LibrarySource
  name: string
  type: 'block' | 'component'
  title: string
  description: string
  tags: string[]
  category: LibraryCategory
  duration?: number
  remocn?: Pick<RemocnItem, 'category' | 'useFor' | 'avoidFor' | 'naturalLength' | 'docs' | 'vibe'>
}

export const CATEGORIES: { id: LibraryCategory; label: string }[] = [
  { id: 'text', label: 'Text & titles' },
  { id: 'captions', label: 'Captions' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'effects', label: 'Effects' },
  { id: 'data', label: 'Charts & numbers' },
  { id: 'ui', label: 'UI & devices' },
  { id: 'camera', label: 'Camera & 3D' },
  { id: 'templates', label: 'Templates' },
  { id: 'more', label: 'More' }
]

export const categoryLabel = (c: LibraryCategory): string =>
  CATEGORIES.find((x) => x.id === c)?.label ?? 'More'

// First matching rule wins, so the more specific groups come first.
const TAG_RULES: [LibraryCategory, string[]][] = [
  ['captions', ['captions', 'caption-style', 'karaoke', 'subtitles']],
  [
    'text',
    [
      'typography',
      'text',
      'text-effect',
      'text-effects',
      'text-treatment',
      'title-card',
      'kinetic-type',
      'headline',
      'type',
      'wordmark',
      'letters',
      'typing',
      'variable-font'
    ]
  ],
  [
    'transitions',
    ['transition', 'transition-primitive', 'wipe', 'match-cut', 'whip-pan', 'iris', 'bridge']
  ],
  [
    'overlays',
    [
      'lower-third',
      'overlay',
      'social-overlay',
      'annotation',
      'handwritten',
      'callout',
      'notification',
      'badge',
      'cta',
      'end-card'
    ]
  ],
  [
    'data',
    ['data', 'chart', 'stats', 'counter', 'data-viz', 'gauge', 'number', 'progress', 'rating']
  ],
  ['templates', ['showcase', 'ad-template']],
  [
    'ui',
    [
      'mock-ui',
      'ui-props',
      'ui-flow',
      'ui',
      'device',
      'product-demo',
      'chat',
      'cursor',
      'prop',
      'app',
      'browser',
      'phone',
      'mobile',
      'terminal',
      'code-animation',
      'social-proof',
      'testimonial'
    ]
  ],
  ['camera', ['camera', '3d', 'webgl', 'three-js', 'parallax', 'zoom', 'orbit', 'push-in']],
  [
    'effects',
    [
      'effect',
      'effects',
      'background',
      'shader',
      'texture',
      'grain',
      'vignette',
      'light',
      'particles',
      'glitch',
      'blur',
      'gradient',
      'confetti'
    ]
  ],
  ['templates', ['carousel', 'gallery', 'images']]
]

const REMOCN_CATEGORY: Record<string, LibraryCategory> = {
  typography: 'text',
  ui: 'ui',
  'ui blocks': 'ui',
  ai: 'ui',
  social: 'ui',
  shaders: 'effects',
  effects: 'effects',
  layout: 'overlays',
  templates: 'templates',
  compositions: 'templates'
}

export function categorize(name: string, tags: string[]): LibraryCategory {
  const set = new Set(tags.map((t) => t.toLowerCase()))
  if (name.startsWith('caption-')) return 'captions'
  for (const [cat, keys] of TAG_RULES) if (keys.some((k) => set.has(k))) return cat
  return 'more'
}

export function toLibrary(hf: CatalogItem[], remocn: RemocnItem[]): LibraryItem[] {
  const items: LibraryItem[] = hf.map((i) => ({
    source: 'hyperframes',
    name: i.name,
    type: i.type,
    title: i.title || i.name,
    description: i.description,
    tags: i.tags,
    category: categorize(i.name, i.tags),
    duration: i.duration
  }))
  for (const r of remocn) {
    items.push({
      source: 'remocn',
      name: r.name,
      type: 'component',
      title: r.title || titleCase(r.name),
      description: r.description || r.useFor,
      tags: [r.category.toLowerCase(), ...(r.vibe ? [r.vibe] : [])],
      category: REMOCN_CATEGORY[r.category.toLowerCase()] ?? 'more',
      remocn: {
        category: r.category,
        useFor: r.useFor,
        avoidFor: r.avoidFor,
        naturalLength: r.naturalLength,
        docs: r.docs,
        vibe: r.vibe
      }
    })
  }
  return items
}

const titleCase = (s: string): string =>
  s.replace(/(^|-)([a-z])/g, (_, sep: string, c: string) => (sep ? ' ' : '') + c.toUpperCase())

// ---------------------------------------------------------------------------------------------
// Search

/** Words people use for the same thing. Matches through a synonym score a little lower. */
const SYNONYMS: Record<string, string[]> = {
  text: ['typography', 'type', 'title', 'headline', 'words', 'letters', 'kinetic-type', 'typing'],
  type: ['typography', 'text', 'kinetic-type'],
  font: ['typography', 'type', 'variable-font'],
  title: ['headline', 'title-card', 'typography', 'text', 'titlecard'],
  heading: ['headline', 'title'],
  caption: ['captions', 'subtitle', 'caption-style', 'karaoke'],
  subtitle: ['caption', 'captions', 'caption-style'],
  transition: ['wipe', 'cut', 'match-cut', 'transition-primitive', 'whip', 'swap'],
  cut: ['match-cut', 'transition', 'hard-cut'],
  chart: ['data', 'graph', 'stats', 'data-viz'],
  graph: ['chart', 'data', 'stats'],
  number: ['counter', 'count', 'stats', 'numbers'],
  stats: ['data', 'chart', 'counter', 'number'],
  logo: ['brand', 'wordmark', 'sting', 'lockup'],
  brand: ['logo', 'wordmark'],
  background: ['bg', 'gradient', 'shader', 'aurora', 'mesh', 'grain', 'texture'],
  lower: ['lower-third'],
  third: ['lower-third'],
  name: ['lower-third', 'badge'],
  phone: ['mobile', 'device', 'iphone'],
  mobile: ['phone', 'device'],
  intro: ['opener', 'reveal', 'title-card', 'logo', 'intros-reveals'],
  outro: ['end-card', 'cta', 'close'],
  ending: ['end-card', 'outro', 'close'],
  zoom: ['camera', 'push-in', 'punch-in', 'focus'],
  glitch: ['rgb', 'cyber', 'distortion', 'chromatic'],
  social: ['tiktok', 'instagram', 'youtube', 'creator', 'social-proof'],
  arrow: ['hw-arrow', 'pointer', 'annotation'],
  highlight: ['marker', 'emphasis', 'spotlight'],
  emoji: ['emoji-pop'],
  countdown: ['timer', 'count'],
  quote: ['testimonial'],
  review: ['testimonial', 'rating', 'stars']
}

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'for',
  'with',
  'in',
  'on',
  'at',
  'my',
  'me',
  'i',
  'some',
  'add',
  'make',
  'put',
  'show',
  'want',
  'create',
  'use',
  'that',
  'this',
  'it',
  'please',
  'something',
  'could',
  'would',
  'need',
  'nice',
  'cool',
  'good',
  'give',
  'into',
  'onto',
  'your',
  'some',
  'kind',
  // everyday phrasing ("can you find captions for our video") and place words
  'can',
  'you',
  'we',
  'our',
  'us',
  'like',
  'find',
  'get',
  'let',
  'lets',
  'just',
  'also',
  'any',
  'all',
  'every',
  'each',
  'from',
  'over',
  'across',
  'is',
  'are',
  'be',
  'will',
  'should',
  'help',
  'how',
  'what',
  // the person's own material, not a kind of component ("captions for my clip")
  'video',
  'clip',
  'footage'
])

const stemOf = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)

/** Words after one of these say where something goes, not what it is: "captions to my demo". */
const PLACE_WORDS = new Set(['to', 'for', 'on', 'in', 'into', 'onto', 'over', 'across', 'at'])

type QueryWord = { w: string; context: boolean }

/** Search words minus filler, each marked as context when it follows a place word. */
function parseQuery(query: string): QueryWord[] {
  const tokens = query
    .toLowerCase()
    // contractions: "i'd", "let's", "don't" must not leave single letters behind
    .replace(/['’](s|d|t|ll|re|ve|m)\b/g, '')
    .split(/[^a-z0-9-]+/)
    .filter(Boolean)
  const out: QueryWord[] = []
  let context = false
  for (const w of tokens) {
    if (PLACE_WORDS.has(w)) context = true
    if (w.length > 1 && !STOPWORDS.has(w) && !STOPWORDS.has(stemOf(w))) out.push({ w, context })
  }
  // a query made only of filler searches for what was typed
  if (out.length === 0) return tokens.map((w) => ({ w, context: false }))
  // with nothing but context words, they are what the query is about
  if (out.every((q) => q.context)) return out.map((q) => ({ ...q, context: false }))
  return out
}

export function queryWords(query: string): string[] {
  return parseQuery(query).map((q) => q.w)
}

type Hay = { name: string; title: string; tags: string[]; category: string; body: string }

const hayCache = new WeakMap<LibraryItem, Hay>()
function hay(i: LibraryItem): Hay {
  let h = hayCache.get(i)
  if (!h) {
    h = {
      name: i.name.toLowerCase(),
      title: i.title.toLowerCase(),
      tags: i.tags.map((t) => t.toLowerCase()),
      category: `${i.category} ${categoryLabel(i.category).toLowerCase()}`,
      body: `${i.description} ${i.remocn?.useFor ?? ''}`.toLowerCase()
    }
    hayCache.set(i, h)
  }
  return h
}

const wordIn = (text: string, w: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${w.replace(/[-]/g, '\\-')}(e?s)?(?![a-z0-9])`).test(text)

/** `strong` limits matching to name, title and tags (used for synonyms, which are looser). */
function scoreTerm(h: Hay, t: string, strong = false): number {
  const nameWords = h.name.split('-')
  if (h.name === t) return 14
  if (nameWords.includes(t) || wordIn(h.title, t)) return 10
  if (h.tags.includes(t)) return 7
  if (strong) return 0
  if (h.name.includes(t) || h.title.includes(t)) return 6
  if (h.tags.some((x) => x.includes(t))) return 4
  if (h.category.includes(t)) return 4
  if (wordIn(h.body, t)) return 2.5
  if (t.length > 3 && h.body.includes(t)) return 1.5
  return 0
}

/** Own keys only: a word like "constructor" must not reach Object.prototype. */
const synonymsOf = (w: string): string[] => (Object.hasOwn(SYNONYMS, w) ? SYNONYMS[w] : [])

function scoreWord(h: Hay, w: string): number {
  const stem = stemOf(w)
  let best = Math.max(scoreTerm(h, w), stem !== w ? scoreTerm(h, stem) * 0.95 : 0)
  const syns = synonymsOf(stem).length ? synonymsOf(stem) : synonymsOf(w)
  for (const syn of syns) best = Math.max(best, scoreTerm(h, syn, true) * 0.6)
  return best
}

export type LibraryFilter = {
  source?: LibrarySource | 'all'
  type?: 'block' | 'component' | 'all'
  category?: LibraryCategory | 'all'
}

export function filterLibrary(items: LibraryItem[], f: LibraryFilter): LibraryItem[] {
  return items.filter(
    (i) =>
      (!f.source || f.source === 'all' || i.source === f.source) &&
      (!f.type || f.type === 'all' || i.type === f.type) &&
      (!f.category || f.category === 'all' || i.category === f.category)
  )
}

/** A match in the name, title, tags or category; description-only matches score lower. */
const STRONG = 4

/**
 * Rank items for a free-text query. Every word counts, but a match in an item's name, title,
 * tags or category (strong) weighs far more than one only in its description (weak), so filler
 * can't push out what the query is about. Words after "to", "for", "on"… say where it goes
 * ("captions to my product demo") and rank below the words before them, but only when those
 * clearly name something in the catalog ("turn on captions" is about captions). Nothing that
 * matches every word, or strongly matches a context word, is dropped, and an item whose title is
 * the whole query comes first. With no
 * query the input order is kept.
 */
export function searchLibrary(
  items: LibraryItem[],
  query: string,
  f: LibraryFilter = {}
): LibraryItem[] {
  const pool = filterLibrary(items, f)
  const parsed = parseQuery(query)
  if (parsed.length === 0) return pool
  const scored = pool.map((i) => {
    const h = hay(i)
    return { i, h, v: parsed.map((q) => scoreWord(h, q.w)) }
  })
  const specific =
    scored.filter((r) => parsed.some((q, k) => !q.context && r.v[k] >= STRONG)).length >= 3
  const words = specific ? parsed : parsed.map((q) => ({ ...q, context: false }))
  const heads = words.filter((q) => !q.context).length
  // the whole query as typed, filler included ("clip wipe" is the Clip Wipe caption)
  const typed = query.toLowerCase().trim().replace(/\s+/g, ' ')
  const phrase = typed.includes(' ') ? typed : null
  const rows = scored.map(({ i, h, v }) => {
    let head = 0
    let headHits = 0
    let ctx = 0
    let hits = 0
    let s = 0
    words.forEach((q, k) => {
      if (v[k] <= 0) return
      const unit = v[k] >= STRONG ? 1 : 0.35
      hits++
      if (q.context) {
        ctx += unit
        s += v[k] * 0.3
      } else {
        head += unit
        headHits++
        s += v[k]
      }
    })
    if (heads > 1 && headHits === heads) head += 0.5
    const all = hits === words.length
    if (phrase && (h.title.includes(phrase) || h.name.includes(phrase.replace(/ /g, '-'))))
      head += 2
    return { i, head, ctx, all, hits, s }
  })
  // with no strong match anywhere, description matches are all there is
  const anyStrong = rows.some((r) => r.head >= 1)
  return (
    rows
      // context-only matches stay, ranked after everything that matches the main words
      .filter((r) => (anyStrong ? r.head >= 1 || (r.all && r.head > 0) || r.ctx >= 1 : r.hits > 0))
      .sort(
        (a, b) =>
          b.head - a.head ||
          Number(b.all) - Number(a.all) ||
          b.ctx - a.ctx ||
          b.s - a.s ||
          a.i.title.localeCompare(b.i.title)
      )
      .map((r) => r.i)
  )
}
