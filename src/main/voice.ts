import { AssemblyAI, type StreamingTranscriber, type TurnEvent } from 'assemblyai'
import { systemPreferences } from 'electron'
import type { VoiceEvent } from '../shared/types'
import { Channels, broadcast } from './ipc'
import { getSecret } from './secrets'
import { getSettings } from './settings'

/** Universal-3.5 Pro Streaming: multilingual with native code-switching. */
const SPEECH_MODEL = 'universal-3-5-pro'
/** Words the recognizer should expect when someone talks to Luca about a video. */
const KEYTERMS = ['Luca', 'B-roll', 'lower third', 'kinetic title', 'jump cut', 'voiceover']
/** An unformatted end of turn is usually followed by its formatted text within a few hundred ms. */
const FORMAT_GRACE_MS = 400
/** Audio that arrives while the socket is still opening; 200 chunks is about 10 s. */
const MAX_PENDING = 200
/** The renderer streams audio continuously (silence while muted); a gap this long means it is gone. */
const WATCHDOG_MS = 5000

type Grace = { timer: NodeJS.Timeout; text: string; language?: string }

type Session = {
  sid: number
  transcriber: StreamingTranscriber
  /** Resolves true once the socket is open; never rejects. */
  ready: Promise<boolean>
  error?: unknown
  open: boolean
  /** Stop or cancel has begun: late audio and close events are ignored. */
  ending: boolean
  /** Cancelled or failed: nothing more is delivered. */
  discard: boolean
  pending: ArrayBufferLike[]
  lastAudio: number
  watchdog: NodeJS.Timeout
  partials: Map<number, string>
  finals: Map<number, string>
  graces: Map<number, Grace>
}

let current: Session | null = null

const emit = (e: VoiceEvent): void => broadcast(Channels.voiceEvent, e)

export async function micAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true
  return systemPreferences.askForMediaAccess('microphone')
}

/**
 * Open an AssemblyAI Universal-Streaming session over WebSocket. The API key stays in the main
 * process; the renderer only streams PCM in and receives turn events back.
 */
export async function startVoice(args: { sid: number; sampleRate: number }): Promise<void> {
  const apiKey = getSecret('assemblyai')
  if (!apiKey) throw new Error('Add your AssemblyAI API key to use voice input.')
  void cancelVoice()

  const keyterms = [...new Set([...KEYTERMS, ...getSettings().keyterms])]
    .filter((t) => t.trim().length > 0 && t.length <= 50)
    .slice(0, 100)
  const transcriber = new AssemblyAI({ apiKey }).streaming.transcriber({
    speechModel: SPEECH_MODEL,
    sampleRate: args.sampleRate,
    formatTurns: true,
    keytermsPrompt: keyterms,
    connectTimeout: 5000
  })
  const s: Session = {
    sid: args.sid,
    transcriber,
    ready: Promise.resolve(false),
    open: false,
    ending: false,
    discard: false,
    pending: [],
    lastAudio: Date.now(),
    watchdog: setInterval(() => {
      if (!s.ending && Date.now() - s.lastAudio > WATCHDOG_MS)
        fail(s, 'no audio from the microphone')
    }, 1000),
    partials: new Map(),
    finals: new Map(),
    graces: new Map()
  }
  current = s

  transcriber.on('turn', (t) => onTurn(s, t))
  transcriber.on('error', (err) => fail(s, err.message))
  transcriber.on('close', (code, reason) => fail(s, reason || `Connection closed (${code})`))

  s.ready = transcriber.connect().then(
    () => {
      s.open = true
      if (s.discard) return true
      try {
        for (const chunk of s.pending.splice(0)) transcriber.sendAudio(chunk)
      } catch {
        // the socket dropped right after opening; the close listener reports it
      }
      return true
    },
    (err: unknown) => {
      s.error = err
      return false
    }
  )
  if (await s.ready) return
  clearInterval(s.watchdog)
  if (current === s) current = null
  if (s.discard) return
  const detail = s.error instanceof Error ? s.error.message : String(s.error)
  throw new Error(`Couldn't start AssemblyAI streaming: ${detail}`)
}

export function pushVoiceAudio(sid: number, pcm: ArrayBuffer | Uint8Array): void {
  const s = current
  if (!s || s.sid !== sid || s.ending) return
  s.lastAudio = Date.now()
  const buf =
    pcm instanceof Uint8Array
      ? pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
      : pcm
  if (!s.open) {
    if (s.pending.length < MAX_PENDING) s.pending.push(buf)
    return
  }
  try {
    s.transcriber.sendAudio(buf)
  } catch {
    // the socket is closing; the close listener reports why
  }
}

/** Finish the in-progress turn, end the session and return everything that was said. */
export async function stopVoice(sid: number): Promise<string> {
  const s = current
  if (!s || s.sid !== sid) return ''
  s.ending = true
  if (await s.ready) {
    try {
      s.transcriber.forceEndpoint()
      await s.transcriber.close(true, 3000)
    } catch {
      // already closed; keep whatever turns arrived
    }
  }
  settle(s)
  if (current === s) current = null
  return [...s.finals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, text]) => text)
    .filter(Boolean)
    .join(' ')
}

export async function cancelVoice(sid?: number): Promise<void> {
  const s = current
  if (!s || (sid !== undefined && s.sid !== sid)) return
  current = null
  s.ending = true
  s.discard = true
  clearInterval(s.watchdog)
  for (const g of s.graces.values()) clearTimeout(g.timer)
  s.graces.clear()
  if (await s.ready) await s.transcriber.close(false).catch(() => undefined)
}

function onTurn(s: Session, t: TurnEvent): void {
  if (s.discard || s.finals.has(t.turn_order)) return
  const order = t.turn_order
  const text = t.transcript.trim()
  if (!t.end_of_turn) {
    s.partials.set(order, text)
    emit({ type: 'partial', sid: s.sid, order, text })
    return
  }
  if (t.turn_is_formatted) {
    finalize(s, order, text, t.language_code)
    return
  }
  // Show the unformatted text now; settle on it only if the formatted turn doesn't follow.
  s.partials.set(order, text)
  emit({ type: 'partial', sid: s.sid, order, text })
  const prev = s.graces.get(order)
  if (prev) clearTimeout(prev.timer)
  s.graces.set(order, {
    text,
    language: t.language_code,
    timer: setTimeout(() => finalize(s, order, text, t.language_code), FORMAT_GRACE_MS)
  })
}

function finalize(s: Session, order: number, text: string, language?: string): void {
  const g = s.graces.get(order)
  if (g) clearTimeout(g.timer)
  s.graces.delete(order)
  s.partials.delete(order)
  if (s.finals.has(order)) return
  s.finals.set(order, text)
  emit({ type: 'final', sid: s.sid, order, text, ...(language ? { language } : {}) })
}

/** Turn everything still pending (grace periods, unfinished partials) into finals. */
function settle(s: Session): void {
  clearInterval(s.watchdog)
  for (const [order, g] of [...s.graces]) finalize(s, order, g.text, g.language)
  for (const [order, text] of [...s.partials]) finalize(s, order, text)
}

/** The server closed the session or it errored: report once and tear down. */
function fail(s: Session, reason: string): void {
  if (s.ending) return
  s.ending = true
  settle(s)
  s.discard = true
  if (current === s) current = null
  emit({ type: 'closed', sid: s.sid, reason })
  void s.ready.then(async (ok) => {
    if (ok) await s.transcriber.close(false).catch(() => undefined)
  })
}
