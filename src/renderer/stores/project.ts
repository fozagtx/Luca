import type { Project, RecentProject, Settings } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'

type ProjectStore = {
  project: Project | null
  recent: RecentProject[]
  settings: Settings | null
  /** Bumps on every project:changed broadcast. */
  version: number
  /** Bumps only when the composition may have changed; the player reloads with ?v=previewVersion. */
  previewVersion: number
  changedPaths: string[]
  loading: boolean
  error: string | null
  init: () => Promise<void>
  create: (args: {
    file: string
    name?: string
    aspect: Project['aspect']
    look?: string | null
  }) => Promise<void>
  open: (dir: string) => Promise<void>
  close: () => Promise<void>
  refreshRecent: () => Promise<void>
  setError: (e: string | null) => void
}

export const useProject = create<ProjectStore>((set, get) => ({
  project: null,
  recent: [],
  settings: null,
  version: 0,
  previewVersion: 0,
  changedPaths: [],
  loading: false,
  error: null,

  init: async () => {
    const [project, recent, settings] = await Promise.all([
      luca.project.current(),
      luca.project.recent(),
      luca.settings.get()
    ])
    set({ project, recent, settings })
    luca.project.onOpened((p) => {
      set({ project: p, version: 0, previewVersion: 0 })
      void get().refreshRecent()
    })
    luca.project.onRecentChanged(() => void get().refreshRecent())
    luca.project.onChanged((e) =>
      set({
        version: e.version,
        changedPaths: e.paths,
        ...(e.composition ? { previewVersion: e.version } : {})
      })
    )
  },

  create: async (args) => {
    set({ loading: true, error: null })
    try {
      const p = await luca.project.create(args)
      set({ project: p, version: 0, previewVersion: 0 })
    } catch (err) {
      set({ error: errorMessage(err) })
      throw err
    } finally {
      set({ loading: false })
    }
  },

  open: async (dir) => {
    set({ loading: true, error: null })
    try {
      const p = await luca.project.open(dir)
      set({ project: p, version: 0, previewVersion: 0 })
    } catch (err) {
      set({ error: errorMessage(err) })
      throw err
    } finally {
      set({ loading: false })
    }
  },

  close: async () => {
    await luca.project.close()
    set({ project: null, version: 0, previewVersion: 0 })
  },

  refreshRecent: async () => set({ recent: await luca.project.recent() }),
  setError: (error) => set({ error })
}))

export function errorMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  // Electron prefixes IPC errors with "Error invoking remote method 'x': Error: "
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
