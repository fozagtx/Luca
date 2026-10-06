import type { ApprovalMode, Project, RecentProject, Settings } from '@shared/types'
import { toast } from 'sonner'
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
  open: (dir: string) => Promise<void>
  close: () => Promise<void>
  refreshRecent: () => Promise<void>
  setApprovals: (mode: ApprovalMode) => Promise<void>
  setError: (e: string | null) => void
}

/** The broadcasts are listened to once, however often init runs (StrictMode runs effects twice). */
let listening = false
/** Counts project:opened broadcasts, so a slower read at start can't undo a newer one. */
let openedCount = 0

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
    // listen before asking, so a project opened meanwhile (from Finder, at launch) isn't missed
    if (!listening) {
      listening = true
      luca.project.onOpened((p) => {
        openedCount++
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
    }
    const seen = openedCount
    const [project, recent, settings] = await Promise.all([
      luca.project.current(),
      luca.project.recent(),
      luca.settings.get()
    ])
    set(openedCount === seen ? { project, recent, settings } : { recent, settings })
  },

  open: async (dir) => {
    set({ loading: true, error: null })
    try {
      const p = await luca.project.open(dir)
      // the broadcast usually got here first; changes since then keep their versions
      set((s) =>
        s.project?.id === p.id ? { project: p } : { project: p, version: 0, previewVersion: 0 }
      )
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
  setApprovals: async (mode) => set({ settings: await luca.settings.update({ approvals: mode }) }),
  setError: (error) => set({ error })
}))

export function errorMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  // Electron prefixes IPC errors with "Error invoking remote method 'x': Error: "
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** The Undo on a toast after an edit: takes back the last version, and says so if it can't. */
export const undoAction = {
  label: 'Undo',
  onClick: (): void =>
    void luca.history
      .undo()
      .catch((err: unknown) => toast.error('Couldn’t undo', { description: errorMessage(err) }))
}
