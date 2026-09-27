import { create } from 'zustand'
import { luca } from '../lib/luca'
import { errorMessage } from './project'

type GeminiStore = {
  /** null until checked. */
  hasKey: boolean | null
  checkKey: () => Promise<boolean>
  /** An empty key disconnects. Rejects with a plain message when Google refuses the key. */
  saveKey: (key: string) => Promise<void>
}

/** Gemini, which makes and edits video for Luca on the person's own API key. */
export const useGemini = create<GeminiStore>((set) => ({
  hasKey: null,
  checkKey: async () => {
    const hasKey = await luca.gemini.hasKey().catch(() => false)
    set({ hasKey })
    return hasKey
  },
  saveKey: async (key) => {
    try {
      set({ hasKey: await luca.gemini.setKey(key) })
    } catch (err) {
      throw new Error(errorMessage(err))
    }
  }
}))
