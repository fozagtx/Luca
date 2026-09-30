import { DEFAULT_ASPECT } from '@shared/aspect'
import type { Aspect, BrollItem, BrollMedia, Chip } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { errorMessage, useProject } from './project'

type BrollStore = {
  /** null until checked. */
  hasKey: boolean | null
  /** What was searched for; empty until the first search. */
  query: string
  media: BrollMedia
  items: BrollItem[] | null
  /** Query, media and orientation the items belong to. */
  shown: string | null
  page: number
  hasMore: boolean
  loading: boolean
  error: string | null
  checkKey: () => Promise<boolean>
  /** Rejects with a plain message when Pexels refuses the key. */
  saveKey: (key: string) => Promise<void>
  setQuery: (q: string) => void
  setMedia: (m: BrollMedia) => void
  /** Load the grid for the current query and media (no-op when it already shows them). */
  search: (orientation: Aspect, opts?: { more?: boolean; force?: boolean }) => Promise<void>
}

let seq = 0

/** Pexels search for the B-roll tab; it outlives the tab, so going back finds the same results. */
export const useBroll = create<BrollStore>((set, get) => ({
  hasKey: null,
  query: '',
  media: 'photo',
  items: null,
  shown: null,
  page: 1,
  hasMore: false,
  loading: false,
  error: null,

  checkKey: async () => {
    const hasKey = await luca.broll.hasKey().catch(() => false)
    set({ hasKey })
    return hasKey
  },
  saveKey: async (key) => {
    try {
      const hasKey = await luca.broll.setKey(key)
      set({ hasKey, shown: null, error: null })
    } catch (err) {
      throw new Error(errorMessage(err))
    }
  },
  setQuery: (query) => set({ query: query.trim() }),
  setMedia: (media) => set({ media }),

  search: async (orientation, opts) => {
    const { query, media, shown, items, page, hasMore, loading } = get()
    // nothing searched yet (or the search was cleared): the tab says what B-roll is for instead
    if (!query) {
      ++seq
      set({ items: null, shown: null, loading: false, error: null })
      return
    }
    const key = `${query}|${media}|${orientation}`
    if (opts?.more) {
      if (loading || !hasMore || shown !== key) return
    } else if (!opts?.force && shown === key && items) return
    const id = ++seq
    const next = opts?.more ? page + 1 : 1
    set({ loading: true, error: null, ...(opts?.more ? {} : { shown: key, items: null }) })
    try {
      const res = await luca.broll.search({ query, media, orientation, page: next })
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
  }
}))

/** B-roll comes in the open project's shape, so it fills the frame as a cutaway. */
export function useBrollOrientation(): Aspect {
  return useProject((s) => s.project?.aspect ?? DEFAULT_ASPECT)
}

export function brollChip(b: BrollItem): Extract<Chip, { kind: 'broll' }> {
  return {
    kind: 'broll',
    id: b.id,
    media: b.media,
    title: b.title,
    thumb: b.thumb,
    ...(b.duration ? { duration: b.duration } : {})
  }
}
