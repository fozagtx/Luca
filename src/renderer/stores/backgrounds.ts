import type { Aspect, Background, BackgroundMedia, Chip } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { errorMessage, useProject } from './project'
import { useStart } from './start'

export type BackgroundFilter = 'all' | BackgroundMedia

/** Starting points that suit product demos and explainers; the first one opens the panel. */
export const TOPICS: { label: string; query: string }[] = [
  { label: 'Abstract', query: 'abstract background' },
  { label: 'Tech', query: 'technology abstract' },
  { label: 'Bokeh', query: 'bokeh lights' },
  { label: 'Particles', query: 'particles' },
  { label: 'Minimal', query: 'minimal texture' },
  { label: 'Workspace', query: 'desk workspace' },
  { label: 'Office', query: 'modern office' },
  { label: 'City', query: 'city night' },
  { label: 'Nature', query: 'nature landscape' },
  { label: 'Sky', query: 'clouds sky' },
  { label: 'Ocean', query: 'ocean waves' },
  { label: 'Space', query: 'space stars' },
  { label: 'Smoke', query: 'smoke' },
  { label: 'Paper', query: 'paper texture' }
]

type BackgroundsStore = {
  /** null until checked. */
  hasKey: boolean | null
  /** The search the grid shows (a topic's words or what was typed and entered). */
  query: string
  media: BackgroundFilter
  items: Background[] | null
  /** Query, filter and orientation the items belong to. */
  shown: string | null
  page: number
  hasMore: boolean
  loading: boolean
  error: string | null
  /** What plays behind the home screen. */
  home: Background | null
  checkKey: () => Promise<boolean>
  /** Rejects with a plain message when Pexels refuses the key. */
  saveKey: (key: string) => Promise<void>
  setQuery: (q: string) => void
  setMedia: (m: BackgroundFilter) => void
  /** Load the grid for the current query and filter (no-op when it already shows them). */
  search: (orientation: Aspect, opts?: { more?: boolean; force?: boolean }) => Promise<void>
  loadHome: (shuffle?: boolean) => Promise<void>
}

let seq = 0
let homeSeq = 0

export const useBackgrounds = create<BackgroundsStore>((set, get) => ({
  hasKey: null,
  query: TOPICS[0].query,
  media: 'all',
  items: null,
  shown: null,
  page: 1,
  hasMore: false,
  loading: false,
  error: null,
  home: null,

  checkKey: async () => {
    const hasKey = await luca.backgrounds.hasKey().catch(() => false)
    set({ hasKey })
    return hasKey
  },
  saveKey: async (key) => {
    try {
      const hasKey = await luca.backgrounds.setKey(key)
      set({ hasKey, shown: null, error: null })
    } catch (err) {
      throw new Error(errorMessage(err))
    }
  },
  setQuery: (query) => set({ query: query.trim() || TOPICS[0].query }),
  setMedia: (media) => set({ media }),

  search: async (orientation, opts) => {
    const { query, media, shown, items, page, hasMore, loading } = get()
    const key = `${query}|${media}|${orientation}`
    if (opts?.more) {
      if (loading || !hasMore || shown !== key) return
    } else if (!opts?.force && shown === key && items) return
    const id = ++seq
    const next = opts?.more ? page + 1 : 1
    set({ loading: true, error: null, ...(opts?.more ? {} : { shown: key, items: null }) })
    try {
      const res = await luca.backgrounds.search({ query, media, orientation, page: next })
      if (id !== seq) return
      const have = opts?.more ? (get().items ?? []) : []
      const ids = new Set(have.map((b) => b.id))
      set({
        items: [...have, ...res.items.filter((b) => !ids.has(b.id))],
        page: res.page,
        hasMore: res.hasMore,
        loading: false
      })
    } catch (err) {
      if (id !== seq) return
      // a failed first page leaves nothing to show; a failed "more" keeps what's there
      set({ loading: false, error: errorMessage(err), ...(opts?.more ? {} : { shown: null }) })
    }
  },

  loadHome: async (shuffle) => {
    const id = ++homeSeq
    try {
      const home = await luca.backgrounds.home(shuffle ? { shuffle: true } : undefined)
      if (id === homeSeq && (home || !shuffle)) set({ home })
    } catch {
      // the home screen simply stays as it is
    }
  }
}))

/** The shape backgrounds should have: the open project's, else the one chosen on the start card. */
export function useBackgroundOrientation(): Aspect {
  const project = useProject((s) => s.project?.aspect)
  const start = useStart((s) => s.aspect)
  return project ?? start
}

export function backgroundChip(b: Background): Extract<Chip, { kind: 'background' }> {
  return {
    kind: 'background',
    id: b.id,
    media: b.media,
    title: b.title,
    thumb: b.thumb,
    ...(b.duration ? { duration: b.duration } : {})
  }
}
