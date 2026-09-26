import type { VoiceEvent } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { MIC_SAMPLE_RATE, openMic, type Mic } from '../lib/mic'
import { cancelSpeech, onSpeaking, sentenceSplitter, speak } from '../lib/speech'
import { useChat } from './chat'
import { useProject } from './project'
import { useQueue } from './queue'
import { useUi } from './ui'

/**
 * `dictate` records one request; `converse` is the voice agent: speak, approve, Claude acts and
 * answers aloud. Either way what you said waits in the queue for your OK before Luca sees it.
 */
export type VoiceMode = 'dictate' | 'converse'

/**
 * connecting → listening. Dictation ends in finishing; voice mode cycles listening → thinking
 * (Claude is working) → speaking (the reply is read aloud) → listening.
 */
export type VoicePhase = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'finishing'

/** Dictation finishes, and voice mode ends, after this long with no speech or agent activity. */
const IDLE_MS = 2 * 60_000
/** Room echo of the reply can still reach the mic just after speech ends. */
const UNMUTE_DELAY_MS = 250

const MAC = luca.platform === 'darwin'
const MIC_DENIED = MAC
  ? 'Luca can’t use the microphone. Allow it in System Settings → Privacy & Security → Microphone.'
  : 'Luca can’t use the microphone. Allow microphone access for Luca in your system settings.'
const NO_SPEECH = MAC
  ? 'Didn’t catch anything. Check the input device in System Settings → Sound.'
  : 'Didn’t catch anything. Check your microphone input.'

type VoiceStore = {
  mode: VoiceMode | null
  phase: VoicePhase
  startedAt: number
  /** Finished turns of the current dictation (voice mode adds each one to the open request). */
  finals: string[]
  /** The turn being spoken right now. */
  partial: string
  error: string | null
  /** Voice was requested without an AssemblyAI key; the composer asks for one, then starts this mode. */
  needsKey: VoiceMode | null
  bound: boolean
  bind: () => void
  start: (mode: VoiceMode) => Promise<void>
  /** Dictation: stop and put the transcript in the queue for your OK. Voice mode: end it. */
  finish: () => Promise<void>
  cancel: () => void
  skipSpeech: () => void
  level: () => number
  dismiss: () => void
}

const OFF: Pick<VoiceStore, 'mode' | 'phase' | 'finals' | 'partial'> = {
  mode: null,
  phase: 'off',
  finals: [],
  partial: ''
}

/** Current session id; bumping it orphans the old session's events. */
let sid = 0
let mic: Mic | null = null
let idle: ReturnType<typeof setInterval> | null = null
let lastActivity = 0
let partialOrder = -1
let language: string | undefined
let agentBusy = false
let speaking = false
/** Only replies to turns that start while voice mode is on are read aloud. */
let speakTurn = false
const splitter = sentenceSplitter((s) => speak(s, language))

const touch = (): void => {
  lastActivity = Date.now()
}

export const useVoice = create<VoiceStore>((set, get) => ({
  ...OFF,
  startedAt: 0,
  error: null,
  needsKey: null,
  bound: false,

  bind: () => {
    if (get().bound) return
    set({ bound: true })
    luca.voice.onEvent(onVoiceEvent)
    luca.agent.onEvent((e) => {
      if (e.type === 'turn-start') {
        agentBusy = true
        speakTurn = get().mode === 'converse'
      } else if (e.type === 'turn-end') {
        agentBusy = false
        if (speakTurn) splitter.flush()
        speakTurn = false
      } else if (e.type === 'text-delta') {
        if (speakTurn) splitter.push(e.text)
      } else return
      touch()
      sync()
    })
    onSpeaking((on) => {
      speaking = on
      if (on) mic?.mute(true)
      else
        setTimeout(() => {
          if (!speaking) mic?.mute(false)
        }, UNMUTE_DELAY_MS)
      touch()
      sync()
    })
    // Never keep the mic open where its indicator can't be seen.
    useUi.subscribe((s, prev) => {
      if (prev.chatOpen && !s.chatOpen) get().cancel()
    })
    useProject.subscribe((s, prev) => {
      if (prev.project && s.project?.dir !== prev.project.dir) get().cancel()
    })
  },

  start: async (mode) => {
    get().bind()
    if (get().phase !== 'off') return
    if (!useUi.getState().chatOpen) useUi.getState().toggleChat()
    const id = ++sid
    set({ ...OFF, mode, phase: 'connecting', startedAt: Date.now(), error: null, needsKey: null })
    if (!(await luca.env.hasAssemblyAiKey())) {
      if (id === sid) set({ ...OFF, needsKey: mode })
      return
    }
    if (id !== sid) return
    cancelSpeech()
    language = undefined
    partialOrder = -1
    agentBusy = useChat.getState().state === 'working'
    speakTurn = false
    touch()
    try {
      if (!(await luca.voice.micAccess())) throw new Error(MIC_DENIED)
      if (id !== sid) return
      // The session connects while the mic opens; audio captured meanwhile is buffered in main.
      const session = luca.voice.start({ sid: id, sampleRate: MIC_SAMPLE_RATE })
      session.catch(() => undefined)
      const m = await openMic((pcm) => luca.voice.audio(id, pcm)).catch((err: unknown) => {
        void luca.voice.cancel(id)
        throw err
      })
      if (id !== sid) {
        m.close()
        return
      }
      mic = m
      await session
      if (id !== sid) return
      set({ phase: 'listening' })
      idle = setInterval(checkIdle, 5000)
      sync()
    } catch (err) {
      if (id !== sid) return
      sid++
      teardown()
      set({ ...OFF, error: describe(err) })
    }
  },

  finish: async () => {
    const { mode, phase } = get()
    if (mode === 'converse' || phase === 'connecting') return get().cancel()
    if (mode !== 'dictate' || phase !== 'listening') return
    const id = sid
    set({ phase: 'finishing' })
    mic?.close()
    mic = null
    let text = ''
    try {
      text = await luca.voice.stop(id)
    } catch {
      // fall back to the turns already shown
    }
    if (id !== sid) return
    const heard = text.trim() || [...get().finals, get().partial].filter(Boolean).join(' ').trim()
    teardown()
    set({ ...OFF })
    if (!heard) {
      set({ error: NO_SPEECH })
      return
    }
    useQueue.getState().review(heard, 'dictation')
  },

  cancel: () => {
    if (get().phase === 'off') return
    if (get().mode === 'converse') useQueue.getState().closeTake()
    const id = sid++
    teardown()
    void luca.voice.cancel(id)
    set({ ...OFF })
  },

  skipSpeech: () => {
    speakTurn = false
    splitter.reset()
    cancelSpeech()
  },

  level: () => mic?.level() ?? 0,

  dismiss: () => set({ error: null, needsKey: null })
}))

function onVoiceEvent(e: VoiceEvent): void {
  if (e.sid !== sid) return
  const s = useVoice.getState()
  if (s.phase === 'off') return
  if (e.type === 'closed') {
    sid++
    teardown()
    useVoice.setState({ ...OFF, error: `Voice input stopped: ${e.reason ?? 'connection closed'}` })
    return
  }
  if (e.text) touch()
  if (e.type === 'partial') {
    partialOrder = e.order
    useVoice.setState({ partial: e.text })
    return
  }
  if (e.language) language = e.language
  const partial = e.order === partialOrder ? '' : s.partial
  if (s.mode === 'dictate') {
    useVoice.setState({ finals: e.text ? [...s.finals, e.text] : s.finals, partial })
    return
  }
  useVoice.setState({ partial })
  if (!e.text) return
  // hands-free approval: a turn that is only "send it" or "scratch that" acts on the open request
  const queue = useQueue.getState()
  if (SEND.test(e.text) && queue.approveNext()) return
  if (DISCARD.test(e.text) && queue.discardTake()) return
  queue.hear(e.text)
}

const SEND =
  /^\W*(?:(?:ok(?:ay)?|yes|yeah|yep|great|perfect|good)\W+)?(?:send(?: it| that)?|go(?: ahead)?|approve(?: it| that)?|do it|submit(?: it)?|that's it|sounds good)(?: luca)?\W*$/i
const DISCARD =
  /^\W*(?:scratch that|cancel(?: that| it)?|discard(?: it| that)?|never ?mind|forget (?:it|that)|delete (?:it|that))\W*$/i

/** Voice mode's phase follows Claude's turn and the speech queue. */
function sync(): void {
  const { mode, phase } = useVoice.getState()
  if (mode !== 'converse' || !['listening', 'thinking', 'speaking'].includes(phase)) return
  const next: VoicePhase = speaking ? 'speaking' : agentBusy ? 'thinking' : 'listening'
  if (next !== phase) useVoice.setState({ phase: next })
}

function checkIdle(): void {
  const s = useVoice.getState()
  if (s.phase !== 'listening') {
    touch()
    return
  }
  if (Date.now() - lastActivity < IDLE_MS) return
  if (s.mode === 'dictate') {
    void s.finish()
    return
  }
  s.cancel()
  useVoice.setState({ error: 'Voice mode ended after two minutes of silence.' })
}

function teardown(): void {
  mic?.close()
  mic = null
  if (idle) clearInterval(idle)
  idle = null
  speakTurn = false
  splitter.reset()
  cancelSpeech()
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return MIC_DENIED
  if (err instanceof DOMException && err.name === 'NotFoundError')
    return 'No microphone found. Connect one and try again.'
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
