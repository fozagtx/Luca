import type {
  AgentEvent,
  AgentState,
  ChatMessage,
  Chip,
  MediaInput,
  MediaKind,
  PermissionDecision
} from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { errorMessage, useProject } from './project'
import { attachmentOf, NO_FOOTAGE, useStart } from './start'

/** A file on its way into the project for the chat; videos can take a moment to get ready. */
export type PendingMedia = { id: number; name: string; media: MediaKind; progress?: number }

type ChatStore = {
  messages: ChatMessage[]
  state: AgentState
  detail?: string
  chips: Chip[]
  /** Files being added to the project; they become chips when they are in. */
  attaching: PendingMedia[]
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
  /**
   * Add files to the open project (dropped, pasted or picked: a File or a path) and attach each
   * as a chip once it is in. Only videos, audio and images are taken.
   */
  attach: (files: (File | string)[]) => Promise<void>
  removeChip: (i: number) => void
  clearChips: () => void
  /** Typing: the draft is now the person's own words. */
  setDraft: (d: string) => void
  /**
   * Fill the box on the person's behalf (a suggestion, a B-roll pick). Replaces a draft that is
   * empty or still exactly what an earlier fill wrote (dropping only chips that fill added), but
   * never words the person typed; the chip is attached either way.
   */
  fillDraft: (text: string, chip?: Chip) => void
  /** What the last fill wrote while the person hasn't changed it, and the chips it added. */
  auto: { draft: string; chips: string[] } | null
  signIn: () => Promise<void>
  retry: () => Promise<void>
}

/** Chips a fill can attach and later take back: B-roll picks. */
const chipName = (c: Chip): string | undefined => (c.kind === 'broll' ? c.id : undefined)

let attachSeq = 0
/** Files go into the project one at a time: preparing two videos at once only slows both. */
let attachQueue: Promise<void> = Promise.resolve()
/** The pending file main is working on, the one its progress events are about. */
let attachingNow = -1
let progressBound = false

/** A dropped or pasted file as main takes it: its path, or a clipboard picture's bytes. */
async function mediaInput(file: File | string): Promise<MediaInput | null> {
  if (typeof file === 'string') return { path: file }
  const path = luca.project.pathForFile(file)
  if (path) return { path }
  if (!file.type.startsWith('image/')) return null
  return { name: file.name || 'image.png', data: await file.arrayBuffer() }
}

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
  attaching: [],
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
      set({ projectDir: dir, chips: [], attaching: [], draft: '', auto: null, error: null })
  },

  load: async () => {
    const [messages, status] = await Promise.all([luca.agent.history(), luca.agent.state()])
    set({ messages, state: status.state as AgentState, detail: status.detail })
  },

  send: async (text, context, opts) => {
    // with nothing open, a message (typed or spoken) is notes for the footage on the start card,
    // and Luca starts editing it right away
    if (!useProject.getState().project) {
      const start = useStart.getState()
      // a typed or spoken message with no media is the brief itself; nothing at all can't start
      if (!text.trim() && !start.files.length) {
        set({ error: NO_FOOTAGE })
        return false
      }
      if (!opts?.keepDraft) set({ draft: '', auto: null, error: null })
      // a failed start keeps the words, in the notes on the start card; a request sent again
      // after one (queued or spoken) is in them already
      const words = text.trim()
      const notes = start.edit.notes?.trim() ?? ''
      if (notes !== words && !notes.endsWith(`\n\n${words}`)) start.addNotes(text)
      const spoken = !!(context as { voice?: boolean } | null)?.voice
      const ok = await start.create({ spoken })
      if (!ok) set({ error: useStart.getState().error })
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
  attach: async (files) => {
    if (!progressBound) {
      progressBound = true
      luca.project.onMediaProgress(({ progress }) =>
        set((s) => ({
          attaching: s.attaching.map((a) => (a.id === attachingNow ? { ...a, progress } : a))
        }))
      )
    }
    const dir = get().projectDir
    const inputs = (await Promise.all(files.map(mediaInput))).filter((f) => f !== null)
    const usable = inputs.flatMap((input) => {
      const media = 'path' in input ? attachmentOf(input.path)?.kind : 'image'
      if (!media) return []
      const name = 'path' in input ? (input.path.split('/').pop() ?? input.path) : 'Pasted image'
      return [{ input, pending: { id: ++attachSeq, name, media } }]
    })
    if (usable.length < files.length)
      set({ error: 'Luca can add videos, audio and images. Other files were left out.' })
    if (!usable.length) return
    set((s) => ({ attaching: [...s.attaching, ...usable.map((u) => u.pending)] }))
    for (const { input, pending } of usable) {
      attachQueue = attachQueue.then(async () => {
        try {
          // the project changed meanwhile: this file isn't for the one open now
          if (get().projectDir !== dir) return
          attachingNow = pending.id
          const chip = await luca.project.addMedia(input)
          if (get().projectDir === dir) set((s) => ({ chips: [...s.chips, chip] }))
        } catch (err) {
          if (get().projectDir === dir)
            set({ error: `Couldn't add ${pending.name}: ${errorMessage(err)}` })
        } finally {
          set((s) => ({ attaching: s.attaching.filter((a) => a.id !== pending.id) }))
        }
      })
    }
    await attachQueue
  },
  removeChip: (i) => set((s) => ({ chips: s.chips.filter((_, j) => j !== i) })),
  clearChips: () => set({ chips: [] }),
  setDraft: (draft) => set({ draft, auto: null }),
  fillDraft: (text, chip) => {
    const { draft, auto, chips } = get()
    const name = chip && chipName(chip)
    const attached = (cs: Chip[]): boolean => !!name && cs.some((c) => chipName(c) === name)
    const untouched = auto !== null && draft.trim() === auto.draft.trim()
    if (draft.trim() && !untouched) {
      // the person's own words stay; the item is still attached
      if (chip && !attached(chips)) set({ chips: [...chips, chip] })
      return
    }
    // replacing an earlier fill takes back the chips it added, not ones the person attached
    let next = untouched ? chips.filter((c) => !auto.chips.includes(chipName(c) ?? '')) : chips
    const owned: string[] = []
    if (chip && !attached(next)) {
      next = [...next, chip]
      if (name) owned.push(name)
    }
    set({ draft: text, chips: next, auto: { draft: text, chips: owned } })
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
