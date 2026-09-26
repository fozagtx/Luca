/**
 * Text-to-speech for voice mode: the system voices through the Web Speech API (offline on macOS).
 * To bring your own TTS, replace `speak` and `cancelSpeech`; voice mode only relies on these and
 * `onSpeaking`.
 */

/** Utterances are held until they finish: Chromium drops end events of collected ones. */
const live = new Set<SpeechSynthesisUtterance>()
const listeners = new Set<(speaking: boolean) => void>()

const notify = (): void => {
  for (const cb of listeners) cb(live.size > 0)
}

/** Queue `text` (markdown is fine). `lang` is a BCP 47 code such as "es" for a matching voice. */
export function speak(text: string, lang?: string): void {
  const clean = speakable(text)
  if (!clean || typeof speechSynthesis === 'undefined') return
  const u = new SpeechSynthesisUtterance(clean)
  const voiceLang = speechSynthesis.getVoices().find((v) => v.default)?.lang ?? ''
  if (lang && !voiceLang.toLowerCase().startsWith(lang.toLowerCase())) u.lang = lang
  const done = (): void => {
    if (live.delete(u) && live.size === 0) notify()
  }
  u.onend = done
  u.onerror = done
  live.add(u)
  if (live.size === 1) notify()
  speechSynthesis.speak(u)
}

export function cancelSpeech(): void {
  const was = live.size > 0
  live.clear()
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  if (was) notify()
}

export function onSpeaking(cb: (speaking: boolean) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Sentence end: ! ? … or a period not after a digit ("1. Item"), followed by whitespace. */
const SENTENCE_END = /(?:[!?…]|(?<!\d)\.)(?=\s)/

/**
 * Cuts streamed markdown into sentences as they complete, so speech can start before the reply
 * has finished. Fenced code blocks are skipped.
 */
export function sentenceSplitter(emit: (sentence: string) => void): {
  push: (text: string) => void
  flush: () => void
  reset: () => void
} {
  let buf = ''
  let fence = false
  const line = (l: string): void => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    else if (!fence) emit(l)
  }
  const drain = (): void => {
    for (;;) {
      const nl = buf.indexOf('\n')
      const end = fence ? -1 : buf.search(SENTENCE_END)
      if (end >= 0 && (nl < 0 || end < nl)) {
        emit(buf.slice(0, end + 1))
        buf = buf.slice(end + 1)
      } else if (nl >= 0) {
        line(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      } else return
    }
  }
  const reset = (): void => {
    buf = ''
    fence = false
  }
  return {
    push: (text) => {
      buf += text
      drain()
    },
    flush: () => {
      drain()
      if (buf) line(buf)
      reset()
    },
    reset
  }
}

/** Markdown → plain words worth reading aloud. */
export function speakable(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-*+•]|\d+[.)])\s+/, '')
    .replace(/^\s*([-*_])\1{2,}\s*$/, '')
    .replace(/(\*\*|\*|~~)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/[|*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
