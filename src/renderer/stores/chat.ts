import type { AgentEvent, AgentState, ChatMessage, Chip, PermissionDecision } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { useProject } from './project'
import { useStart } from './start'

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
  /**
   * `keepDraft` leaves the composer text alone (queued and spoken requests). Without `chips` the
   * composer's chips go with the message; with them, the composer's chips stay put. Resolves
   * false when Luca couldn't take the message.
   */
  send: (
    text: string,
    context: unknown,
    opts?: { keepDraft?: boolean; chips?: Chip[] }
  ) => Promise<boolean>
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
   * that is empty or still exactly what an earlier fill wrote (dropping only chips that fill
   * added), but never words the person typed; the chip is attached either way. `add` names a
   * catalog item being added: adds in a row build one request ("Add A and B").
   */
  fillDraft: (text: string, chip?: Chip, add?: string) => void
  /** What the last fill wrote while the person hasn't changed it, and the chips it added. */
  auto: { draft: string; chips: string[]; adds?: string[] } | null
  signIn: () => Promise<void>
  retry: () => Promise<void>
}

const chipName = (c: Chip): string | undefined => (c.kind === 'catalog' ? c.name : undefined)

/** "A", "A and B", "A, B and C". */
const listOf = (xs: string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/** Replace the message with the same id (usually the last one) or add it; others keep identity. */
function upsert(messages: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const i = messages.findLastIndex((x) => x.id === m.id)
  return i < 0 ? [...messages, m] : messages.map((x, j) => (j === i ? m : x))
}

/** Streamed reply text, appended the way main builds the message it sends at the end. */
function appendText(messages: ChatMessage[], id: string, text: string): ChatMessage[] {
  const i = messages.findLastIndex((m) => m.id === id)
  if (i < 0) return messages
  const m = messages[i]
  const parts = [...(m.parts ?? [])]
  const last = parts[parts.length - 1]
  if (last?.type === 'text') parts[parts.length - 1] = { ...last, text: last.text + text }
  else parts.push({ type: 'text', text })
  const next = { ...m, text: m.text + text, parts }
  return messages.map((x, j) => (j === i ? next : x))
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
    luca.agent.onMessage((m) => set((s) => ({ messages: upsert(s.messages, m) })))
    luca.agent.onEvent((e: AgentEvent) => {
      if (e.type === 'status') set({ state: e.state, detail: e.detail })
      else if (e.type === 'text-delta')
        set((s) => ({ messages: appendText(s.messages, e.id, e.text) }))
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

  send: async (text, context, opts) => {
    // with nothing open, a message is an idea for a new video: start one from it
    if (!useProject.getState().project) {
      if (!opts?.keepDraft) set({ draft: '', error: null })
      const ok = await useStart.getState().create(text)
      if (!ok)
        set({ error: useStart.getState().error, ...(opts?.keepDraft ? {} : { draft: text }) })
      return ok
    }
    const own = opts?.chips
    const chips = own ?? get().chips
    set({
      error: null,
      ...(own ? {} : { chips: [] }),
      ...(opts?.keepDraft ? {} : { draft: '', auto: null })
    })
    try {
      await luca.agent.send({ text, chips, context })
      return true
    } catch (err) {
      const restore = !opts?.keepDraft || !get().draft.trim()
      set({
        error: String(err instanceof Error ? err.message : err),
        ...(own ? {} : { chips }),
        ...(restore && !own ? { draft: text } : {})
      })
      return false
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
  fillDraft: (text, chip, add) => {
    const { draft, auto, chips } = get()
    const attached = (cs: Chip[]): boolean =>
      !!chip && cs.some((c) => c.kind === 'catalog' && c.name === chipName(chip))
    const untouched = auto !== null && draft.trim() === auto.draft.trim()
    if (draft.trim() && !untouched) {
      // the person's own words stay; the item is still attached
      if (chip && !attached(chips)) set({ chips: [...chips, chip] })
      return
    }
    const adds = add
      ? [...new Set([...(untouched && auto?.adds ? auto.adds : []), add])]
      : undefined
    const building = !!adds && adds.length > 1
    // replacing an earlier fill takes back the chips it added, not ones the person attached
    let next =
      untouched && !building
        ? chips.filter((c) => !(c.kind === 'catalog' && auto.chips.includes(c.name)))
        : chips
    const owned = building && auto ? [...auto.chips] : []
    if (chip && !attached(next)) {
      next = [...next, chip]
      if (chip.kind === 'catalog') owned.push(chip.name)
    }
    const text2 = building ? `Add ${listOf(adds)} ` : text
    set({ draft: text2, chips: next, auto: { draft: text2, chips: owned, adds } })
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
