import type { AgentEvent, AgentState, ChatMessage, Chip, PermissionDecision } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'

type ChatStore = {
  messages: ChatMessage[]
  state: AgentState
  detail?: string
  chips: Chip[]
  draft: string
  error: string | null
  bound: boolean
  bind: () => void
  load: () => Promise<void>
  /** `keepDraft` leaves the composer text alone (voice turns); chips are always consumed. */
  send: (text: string, context: unknown, opts?: { keepDraft?: boolean }) => Promise<void>
  stop: () => Promise<void>
  decide: (id: string, decision: PermissionDecision) => Promise<void>
  addChip: (c: Chip) => void
  removeChip: (i: number) => void
  clearChips: () => void
  setDraft: (d: string) => void
  signIn: () => Promise<void>
  retry: () => Promise<void>
}

export const useChat = create<ChatStore>((set, get) => ({
  messages: [],
  state: 'idle',
  chips: [],
  draft: '',
  error: null,
  bound: false,

  bind: () => {
    if (get().bound) return
    set({ bound: true })
    luca.agent.onHistory((messages) => set({ messages }))
    luca.agent.onEvent((e: AgentEvent) => {
      if (e.type === 'status') set({ state: e.state, detail: e.detail })
    })
  },

  load: async () => {
    const [messages, status] = await Promise.all([luca.agent.history(), luca.agent.state()])
    set({
      messages,
      state: status.state as AgentState,
      detail: status.detail,
      chips: [],
      error: null
    })
  },

  send: async (text, context, opts) => {
    const chips = get().chips
    set(opts?.keepDraft ? { chips: [], error: null } : { chips: [], draft: '', error: null })
    try {
      await luca.agent.send({ text, chips, context })
    } catch (err) {
      const restore = !opts?.keepDraft || !get().draft.trim()
      set({
        error: String(err instanceof Error ? err.message : err),
        chips,
        ...(restore ? { draft: text } : {})
      })
    }
  },
  stop: () => luca.agent.interrupt(),
  decide: (id, decision) => luca.agent.permission({ id, decision }),
  addChip: (c) => set((s) => ({ chips: [...s.chips, c] })),
  removeChip: (i) => set((s) => ({ chips: s.chips.filter((_, j) => j !== i) })),
  clearChips: () => set({ chips: [] }),
  setDraft: (draft) => set({ draft }),
  signIn: async () => {
    await luca.env.openClaudeLogin()
  },
  retry: async () => {
    set({ state: 'starting', detail: undefined })
    await luca.agent.restart()
    await get().load()
  }
}))
