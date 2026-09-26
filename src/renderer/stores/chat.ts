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
  send: (text: string, context: unknown) => Promise<void>
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
    set({ messages, state: status.state as AgentState, detail: status.detail })
  },

  send: async (text, context) => {
    const chips = get().chips
    set({ chips: [], draft: '', error: null })
    try {
      await luca.agent.send({ text, chips, context })
    } catch (err) {
      set({ error: String(err instanceof Error ? err.message : err), draft: text, chips })
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
