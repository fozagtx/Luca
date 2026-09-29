import { luca } from '../../lib/luca'

/**
 * Voice samples, one at a time for the whole app: a single audio element plays whichever voice
 * was pressed last. Main fetches the sample (the page's security policy blocks remote audio), so
 * this plays bytes from a blob: URL and gives the URL back as soon as the sample is over.
 */
export type PreviewState = {
  /** The voice whose sample is playing. */
  playing: string | null
  /** The voice whose sample is being fetched. */
  loading: string | null
  /** A voice whose sample could not be played; clears itself so the button can be tried again. */
  failed: string | null
}

let state: PreviewState = { playing: null, loading: null, failed: null }
const listeners = new Set<() => void>()

let audio: HTMLAudioElement | null = null
let objectUrl: string | null = null
/** Bumped whenever the current sample stops mattering, so a late answer can tell it is stale. */
let turn = 0
let failTimer: ReturnType<typeof setTimeout> | undefined

/** Samples heard already, so pressing play again does not fetch again (the blob, never its URL). */
const heard = new Map<string, Blob>()
const HEARD_MAX = 8
const FAIL_RESET_MS = 6000

const set = (next: Partial<PreviewState>): void => {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export const previewState = (): PreviewState => state
export const subscribePreview = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** False while offline or right after this voice's sample failed. */
export function canPreview(voiceId: string): boolean {
  return navigator.onLine !== false && state.failed !== voiceId
}

function element(): HTMLAudioElement {
  if (audio) return audio
  const a = new Audio()
  a.preload = 'auto'
  a.addEventListener('ended', () => {
    release()
    set({ playing: null })
  })
  a.addEventListener('error', () => {
    // a source taken away on purpose is not a failure
    if (state.playing) fail(state.playing)
  })
  // back online, a sample that failed for lack of a connection is worth another try
  window.addEventListener('online', () => set({ failed: null }))
  audio = a
  return a
}

/** Stops the sample and gives its blob: URL back. */
function release(): void {
  turn++
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}

function fail(voiceId: string): void {
  release()
  set({ playing: null, loading: null, failed: voiceId })
  clearTimeout(failTimer)
  failTimer = setTimeout(() => {
    if (state.failed === voiceId) set({ failed: null })
  }, FAIL_RESET_MS)
}

async function sample(voiceId: string): Promise<Blob | null> {
  const known = heard.get(voiceId)
  if (known) return known
  try {
    const res = await luca.ai33.voicePreview(voiceId)
    if (!res.ok || res.bytes.byteLength === 0) return null
    // a copy: the bytes cross IPC as a view onto a buffer this side does not own
    const blob = new Blob([new Uint8Array(res.bytes)], {
      type: res.mime.startsWith('audio/') ? res.mime : 'audio/mpeg'
    })
    heard.set(voiceId, blob)
    if (heard.size > HEARD_MAX) heard.delete(heard.keys().next().value as string)
    return blob
  } catch {
    return null
  }
}

/** Stop whatever is playing (the picker closing, the row it belongs to going away). */
export function stopPreview(): void {
  release()
  set({ playing: null, loading: null })
}

/** Play this voice's sample, or stop it when it is already the one playing. */
export async function togglePreview(voiceId: string): Promise<void> {
  if (state.playing === voiceId || state.loading === voiceId) {
    stopPreview()
    return
  }
  release()
  const mine = turn
  set({ playing: null, loading: voiceId, failed: null })
  const blob = await sample(voiceId)
  if (mine !== turn) return
  if (!blob) {
    fail(voiceId)
    return
  }
  const a = element()
  objectUrl = URL.createObjectURL(blob)
  a.src = objectUrl
  set({ loading: null, playing: voiceId })
  try {
    await a.play()
  } catch {
    if (mine === turn) fail(voiceId)
  }
}
