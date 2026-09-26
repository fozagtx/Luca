import { create } from 'zustand'

export type SidebarTab = 'files' | 'catalog' | 'transcript' | 'looks'

type UiStore = {
  sidebarOpen: boolean
  chatOpen: boolean
  tab: SidebarTab
  paletteOpen: boolean
  historyOpen: boolean
  exportOpen: boolean
  settingsOpen: boolean
  newProject: { file: string } | null
  gotoOpen: boolean
  windowActive: boolean
  toggleSidebar: () => void
  toggleChat: () => void
  setTab: (t: SidebarTab) => void
  setPalette: (open: boolean) => void
  setHistory: (open: boolean) => void
  setExport: (open: boolean) => void
  setSettings: (open: boolean) => void
  setNewProject: (v: { file: string } | null) => void
  setGoto: (open: boolean) => void
  setWindowActive: (a: boolean) => void
}

export const useUi = create<UiStore>((set) => ({
  sidebarOpen: true,
  chatOpen: true,
  tab: 'files',
  paletteOpen: false,
  historyOpen: false,
  exportOpen: false,
  settingsOpen: false,
  newProject: null,
  gotoOpen: false,
  windowActive: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setTab: (tab) => set({ tab, sidebarOpen: true }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setHistory: (historyOpen) => set({ historyOpen }),
  setExport: (exportOpen) => set({ exportOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setNewProject: (newProject) => set({ newProject }),
  setGoto: (gotoOpen) => set({ gotoOpen }),
  setWindowActive: (windowActive) => set({ windowActive })
}))
