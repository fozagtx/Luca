import { create } from 'zustand'
import type { LibraryCategory, LibrarySource } from '../../shared/catalog'
import type { CatalogItem, RemocnItem } from '../../shared/types'
import { luca } from '../lib/luca'

export type CatalogSource = LibrarySource | 'all'
export type StudioStatus = { ready: boolean; step?: string; error?: string }

/**
 * Catalog data and browsing state. Kept outside the tab because the sidebar remounts whenever
 * the chat panel is shown or hidden, and a remount must not reset the search or reload.
 */
type CatalogStore = {
  hf: CatalogItem[] | null
  rc: RemocnItem[] | null
  error: string | null
  busy: boolean
  studio: StudioStatus | null
  query: string
  source: CatalogSource
  category: LibraryCategory | 'all'
  /** Someone picked a Remocn item while its studio isn't set up: show the setup card. */
  wantsRemocn: boolean
  /** The one-time Remocn setup is running (it outlives the tab, which remounts). */
  settingUp: boolean
  setupError: string | null
  setupRemocn: () => Promise<void>
  /** Load both catalogs once; `refresh` refetches. */
  load: (refresh?: boolean) => Promise<void>
  refreshStudio: () => Promise<void>
  setQuery: (q: string) => void
  setSource: (s: CatalogSource) => void
  setCategory: (c: LibraryCategory | 'all') => void
  noteRemocnUse: () => void
}

let inflight: Promise<void> | null = null

export const useCatalog = create<CatalogStore>((set, get) => ({
  hf: null,
  rc: null,
  error: null,
  busy: false,
  studio: null,
  query: '',
  source: 'all',
  category: 'all',
  wantsRemocn: false,
  settingUp: false,
  setupError: null,

  load: (refresh = false) => {
    if (!refresh && get().hf && get().rc) return Promise.resolve()
    if (inflight && !refresh) return inflight
    inflight = (async () => {
      set({ busy: true, error: null })
      const [a, b] = await Promise.allSettled([
        luca.catalog.list({ refresh }),
        luca.catalog.remocn({ refresh })
      ])
      set((s) => ({
        hf: a.status === 'fulfilled' ? a.value : (s.hf ?? []),
        rc: b.status === 'fulfilled' ? b.value : (s.rc ?? []),
        error:
          a.status === 'rejected' && b.status === 'rejected'
            ? a.reason instanceof Error
              ? a.reason.message
              : String(a.reason)
            : null,
        busy: false
      }))
    })().finally(() => {
      inflight = null
    })
    return inflight
  },

  refreshStudio: async () => {
    const studio = await luca.catalog
      .remocnStudioStatus()
      .catch((): StudioStatus => ({ ready: false }))
    set((s) => ({ studio, wantsRemocn: studio.ready ? false : s.wantsRemocn }))
  },

  setupRemocn: async () => {
    if (get().settingUp) return
    set({ settingUp: true, setupError: null })
    // show each step as it happens
    const poll = setInterval(() => void get().refreshStudio(), 1500)
    try {
      const r = await luca.catalog.remocnSetup()
      if (!r.ok) set({ setupError: r.error ?? 'Setup failed' })
    } catch (e) {
      set({ setupError: e instanceof Error ? e.message : String(e) })
    } finally {
      clearInterval(poll)
      set({ settingUp: false })
      await get().refreshStudio()
    }
  },

  setQuery: (query) => set({ query }),
  setSource: (source) => set({ source }),
  setCategory: (category) => set({ category }),
  noteRemocnUse: () => {
    const st = get().studio
    if (st && !st.ready) set({ wantsRemocn: true })
  }
}))
