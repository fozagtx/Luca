import type { Theme } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'

export type SidebarTab = 'inspiration' | 'catalog' | 'transcript' | 'looks' | 'backgrounds'

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
  /** macOS fullscreen: the traffic lights are gone, so the toolbar drops its inset. */
  fullscreen: boolean
  captionsOpen: boolean
  shortcutsOpen: boolean
  /** The background picker sheet. */
  backgroundsOpen: boolean
  theme: Theme
  setTheme: (t: Theme, persist?: boolean) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleChat: () => void
  setSidebar: (open: boolean) => void
  setChat: (open: boolean) => void
  setFullscreen: (fullscreen: boolean) => void
  setCaptions: (open: boolean) => void
  setShortcuts: (open: boolean) => void
  setBackgrounds: (open: boolean) => void
  setTab: (t: SidebarTab) => void
  setPalette: (open: boolean) => void
  setHistory: (open: boolean) => void
  setExport: (open: boolean) => void
  setSettings: (open: boolean) => void
  setNewProject: (v: { file: string } | null) => void
  setGoto: (open: boolean) => void
  setWindowActive: (a: boolean) => void
}

export const useUi = create<UiStore>((set, get) => ({
  // hidden until asked for (⇧⌘S): new videos get their look from the start steps instead
  sidebarOpen: false,
  chatOpen: true,
  tab: 'inspiration',
  paletteOpen: false,
  historyOpen: false,
  exportOpen: false,
  settingsOpen: false,
  newProject: null,
  gotoOpen: false,
  windowActive: true,
  fullscreen: false,
  captionsOpen: false,
  shortcutsOpen: false,
  backgroundsOpen: false,
  theme: 'light',
  setTheme: (theme, persist = true) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
    if (persist) void luca.settings.update({ theme })
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  setChat: (chatOpen) => set({ chatOpen }),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  setCaptions: (captionsOpen) => set({ captionsOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  setBackgrounds: (backgroundsOpen) => set({ backgroundsOpen }),
  setTab: (tab) => set({ tab, sidebarOpen: true }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setHistory: (historyOpen) => set({ historyOpen }),
  setExport: (exportOpen) => set({ exportOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setNewProject: (newProject) => set({ newProject }),
  setGoto: (gotoOpen) => set({ gotoOpen }),
  setWindowActive: (windowActive) => set({ windowActive })
}))
