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
  /** Project the draft and chips belong to. */
  projectDir: string | null
  bind: () => void
  /** Clear the draft and chips when the open project changes (called from App, always mounted). */
  setProject: (dir: string | null) => void
  /** Load history. Leaves the draft and chips alone: the panel remounts whenever it is shown. */
  load: () => Promise<void>
  send: (text: string, context: unknown) => Promise<void>
  /** Send a past request again, with its chips and context, leaving the draft alone (Try again). */
  resend: (request: ChatMessage) => Promise<void>
  stop: () => Promise<void>
  decide: (id: string, decision: PermissionDecision) => Promise<void>
  addChip: (c: Chip) => void
  removeChip: (i: number) => void
  clearChips: () => void
  /** Typing: the draft is now the person's own words. */
  setDraft: (d: string) => void
  /**
   * Fill the box on the person's behalf (an idea, a catalog card, a suggestion). Replaces a draft
   * that is empty or still exactly what an earlier fill wrote (dropping that fill's chip), but
   * never words the person typed; the chip is attached either way.
   */
  fillDraft: (text: string, chip?: Chip) => void
  /** What the last fill wrote, while the person hasn't changed it. */
  auto: { draft: string; chip?: string } | null
  signIn: () => Promise<void>
  retry: () => Promise<void>
}

export const useChat = create<ChatStore>((set, get) => ({
  messages: [],
  state: 'idle',
  chips: [],
  draft: '',
  auto: null,
  error: null,
  bound: false,
  projectDir: null,

  bind: () => {
    if (get().bound) return
    set({ bound: true })
    luca.agent.onHistory((messages) => set({ messages }))
    luca.agent.onEvent((e: AgentEvent) => {
      if (e.type === 'status') set({ state: e.state, detail: e.detail })
    })
  },

  setProject: (dir) => {
    if (get().projectDir !== dir)
      set({ projectDir: dir, chips: [], draft: '', auto: null, error: null })
  },

  load: async () => {
    const [messages, status] = await Promise.all([luca.agent.history(), luca.agent.state()])
    set({ messages, state: status.state as AgentState, detail: status.detail })
  },

  send: async (text, context) => {
    const chips = get().chips
    set({ chips: [], draft: '', auto: null, error: null })
    try {
      await luca.agent.send({ text, chips, context })
    } catch (err) {
      set({ error: String(err instanceof Error ? err.message : err), draft: text, chips })
    }
  },
  resend: async (request) => {
    set({ error: null })
    try {
      await luca.agent.send({
        text: request.text,
        chips: request.chips ?? [],
        context: request.context ?? {}
      })
    } catch (err) {
      set({ error: String(err instanceof Error ? err.message : err) })
    }
  },
  stop: () => luca.agent.interrupt(),
  decide: (id, decision) => luca.agent.permission({ id, decision }),
  addChip: (c) => set((s) => ({ chips: [...s.chips, c] })),
  removeChip: (i) => set((s) => ({ chips: s.chips.filter((_, j) => j !== i) })),
  clearChips: () => set({ chips: [] }),
  setDraft: (draft) => set({ draft, auto: null }),
  fillDraft: (text, chip) => {
    const { draft, auto, chips } = get()
    const replaceable = !draft.trim() || (auto !== null && draft.trim() === auto.draft.trim())
    let next = chips
    if (replaceable && auto?.chip)
      next = next.filter((c) => !(c.kind === 'catalog' && c.name === auto.chip))
    if (
      chip &&
      !next.some((c) => c.kind === 'catalog' && chip.kind === 'catalog' && c.name === chip.name)
    )
      next = [...next, chip]
    if (replaceable)
      set({
        draft: text,
        chips: next,
        auto: { draft: text, chip: chip?.kind === 'catalog' ? chip.name : undefined }
      })
    else set({ chips: next })
  },
  signIn: async () => {
    await luca.env.openClaudeLogin()
  },
  retry: async () => {
    set({ state: 'starting', detail: undefined, error: null })
    await luca.agent.restart()
    await get().load()
  }
}))
