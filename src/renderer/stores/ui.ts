import type { Theme } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'

export type SidebarTab = 'transcript' | 'broll' | 'looks'

type UiStore = {
  sidebarOpen: boolean
  chatOpen: boolean
  tab: SidebarTab
  paletteOpen: boolean
  historyOpen: boolean
  exportOpen: boolean
  gotoOpen: boolean
  windowActive: boolean
  /** macOS fullscreen: the traffic lights are gone, so the toolbar drops its inset. */
  fullscreen: boolean
  captionsOpen: boolean
  colorOpen: boolean
  shortcutsOpen: boolean
  theme: Theme
  setTheme: (t: Theme, persist?: boolean) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleChat: () => void
  setSidebar: (open: boolean) => void
  setChat: (open: boolean) => void
  setFullscreen: (fullscreen: boolean) => void
  setCaptions: (open: boolean) => void
  setColor: (open: boolean) => void
  setShortcuts: (open: boolean) => void
  setTab: (t: SidebarTab) => void
  setPalette: (open: boolean) => void
  setHistory: (open: boolean) => void
  setExport: (open: boolean) => void
  setGoto: (open: boolean) => void
  setWindowActive: (a: boolean) => void
}

export const useUi = create<UiStore>((set, get) => ({
  // hidden until asked for (⇧⌘S): Luca makes the first edit from what was picked on the start card
  sidebarOpen: false,
  chatOpen: true,
  tab: 'transcript',
  paletteOpen: false,
  historyOpen: false,
  exportOpen: false,
  gotoOpen: false,
  windowActive: true,
  fullscreen: false,
  captionsOpen: false,
  colorOpen: false,
  shortcutsOpen: false,
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
  setColor: (colorOpen) => set({ colorOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  setTab: (tab) => set({ tab, sidebarOpen: true }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setHistory: (historyOpen) => set({ historyOpen }),
  setExport: (exportOpen) => set({ exportOpen }),
  setGoto: (gotoOpen) => set({ gotoOpen }),
  setWindowActive: (windowActive) => set({ windowActive })
}))
