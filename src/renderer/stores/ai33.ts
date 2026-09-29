import { create } from 'zustand'
import { toast } from 'sonner'
import {
  AI33_NO_KEYCHAIN,
  type Ai33Ask,
  type Ai33HealthMap,
  type Ai33SetKeyResult
} from '@shared/ai33'
import { luca } from '../lib/luca'
import { errorMessage } from './project'

type Ai33Store = {
  /** null until checked. */
  hasKey: boolean | null
  /** Credits left; null when not connected, unreadable (offline) or not read yet. */
  credits: number | null
  /** False when the key is kept only until Luca quits (no Keychain). */
  persisted: boolean
  health: Ai33HealthMap
  /** Jobs running at ai33 right now. */
  running: number
  /**
   * A question main asks before a chat exists (a cost card on the start card); null when none.
   * Questions in a chat arrive as permission cards instead.
   */
  pendingAsk: { id: string; ask: Ai33Ask } | null
  checkKey: () => Promise<boolean>
  /** Read the account again: key, credits, health, running jobs. */
  refresh: () => Promise<void>
  /**
   * An empty key disconnects. Rejects with a plain message when ai33 refuses the key; resolves
   * with what to tell the person otherwise (a key saved without being checked, no Keychain).
   */
  saveKey: (key: string) => Promise<Ai33SetKeyResult>
  /** Answer the pending ask. */
  answerAsk: (decision: 'allow' | 'deny') => Promise<void>
}

/**
 * ai33 (voices, music, sound effects) on the person's own key. The renderer only ever
 * holds whether there is a key and what it can spend: the key stays in main.
 */
export const useAi33 = create<Ai33Store>((set, get) => ({
  hasKey: null,
  credits: null,
  persisted: true,
  health: { elevenlabs: 'unknown', minimax: 'unknown' },
  running: 0,
  pendingAsk: null,

  checkKey: async () => {
    const hasKey = await luca.ai33.hasKey().catch(() => false)
    set({ hasKey })
    return hasKey
  },
  refresh: async () => {
    try {
      const s = await luca.ai33.status()
      set({
        hasKey: s.connected,
        credits: s.credits,
        persisted: s.persisted,
        health: s.health,
        running: s.running
      })
    } catch {
      // keep what is shown; only a card that never heard from main falls back to "not connected"
      if (get().hasKey === null) set({ hasKey: false })
    }
  },
  saveKey: async (key) => {
    try {
      const res = await luca.ai33.setKey(key)
      set({
        hasKey: res.connected,
        credits: res.connected ? res.credits : null,
        persisted: res.persisted
      })
      // the key card folds or unmounts once connected, so a note that only it showed would be lost:
      // say it (or just that it worked) where it is seen and announced
      if (res.connected) {
        if (res.note || !res.persisted)
          toast(res.note ?? AI33_NO_KEYCHAIN, { id: 'ai33-connected', duration: 8000 })
        else toast('ai33 is connected', { id: 'ai33-connected' })
      }
      return res
    } catch (err) {
      throw new Error(errorMessage(err))
    }
  },
  answerAsk: async (decision) => {
    const pending = get().pendingAsk
    if (!pending) return
    set({ pendingAsk: null })
    await luca.ai33.askReply(pending.id, decision).catch(() => undefined)
  }
}))

// main's pushes go straight into the store, bound once when it is first imported
let bound = false
function bind(): void {
  if (bound) return
  bound = true
  luca.ai33.onAsk(({ id, ask }) => useAi33.setState({ pendingAsk: { id, ask } }))
  luca.ai33.onAskClosed((id) =>
    useAi33.setState((s) => (s.pendingAsk?.id === id ? { pendingAsk: null } : s))
  )
}
bind()
