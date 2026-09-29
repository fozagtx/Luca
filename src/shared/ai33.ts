/**
 * Everything the parts of the ai33 integration (voiceover, music, sound effects) agree on: the
 * types that cross between main, the agent's tools and the renderer, and the pure helpers both
 * sides use. No Electron, no Node: the smoke script bundles this file.
 */

/** ai33's answers are read tolerantly (a field may be missing or another type); callers coerce. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ai33Raw = any

/** Where people get an ai33 key and more credits (one constant, to confirm). */
export const AI33_URL = 'https://ai33.pro'

// ---- account and IPC

export type Ai33Health = 'good' | 'degraded' | 'overloaded' | 'unknown'
/** ai33 reports health for the two voice services behind Studio voices, sound effects and music. */
export type Ai33HealthMap = { elevenlabs: Ai33Health; minimax: Ai33Health }

/** What the renderer may know: never the key itself. */
export type Ai33Status = {
  connected: boolean
  credits: number | null
  health: Ai33HealthMap
  /** Jobs running at ai33 right now. */
  running: number
  /** False when the key is kept only until Luca quits (no Keychain). */
  persisted: boolean
}

/** `note`: a plain line to show under the connected state (AI33_UNCHECKED when ai33 was offline). */
export type Ai33SetKeyResult = {
  connected: boolean
  credits: number | null
  persisted: boolean
  /** False when ai33 could not be reached to check the key. */
  checked: boolean
  note?: string
}

/** The words for a key ai33 refused, one saved unchecked, and one kept only in memory. */
export const AI33_REJECTED =
  'ai33 didn’t accept that key. Check that you copied all of it. If it’s right, the account may be out of credits.'
export const AI33_UNCHECKED =
  'Saved. Couldn’t reach ai33 to check it, so Luca will test it the first time it’s used.'
export const AI33_NO_KEYCHAIN =
  'Luca couldn’t use the Keychain, so this key is kept only until you quit Luca.'

/** Studio = ElevenLabs and MiniMax voices, Standard = Edge, Kokoro (and Vbee), Yours = made on ai33. */
export type Ai33VoiceTier = 'studio' | 'standard' | 'yours'
export type Ai33Voice = {
  /** Opaque (prefixed by the service that owns it): only ever passed back to main. */
  id: string
  name: string
  about: string
  tier: Ai33VoiceTier
  language: string
  gender: 'Female' | 'Male' | null
  previewable: boolean
}
export type Ai33VoiceQuery = {
  tier: Ai33VoiceTier
  query?: string
  language?: string
  gender?: 'female' | 'male'
  page?: number
  limit?: number
}
export type Ai33VoicePage = { voices: Ai33Voice[]; hasMore: boolean; note?: string }
/** A voice's sample as bytes (the renderer plays it from a blob: URL; it never fetches anything). */
export type Ai33Preview =
  { ok: true; mime: string; bytes: Uint8Array } | { ok: false; message: string }
export type VoiceRef = { id: string; name: string; language?: string }

// ---- estimates and spend

export type Ai33Kind = 'speech' | 'dialogue' | 'music' | 'sfx'

/** Renderer-facing. */
export type Ai33EstimateReq =
  | { kind: 'speech'; chars: number; voiceId?: string }
  | { kind: 'music' }
  | { kind: 'sfx'; seconds: number | null; count?: number }
export type Ai33Estimate = {
  credits: number | null
  exact: boolean
  basis: 'formula' | 'price' | 'learned' | 'seed' | 'unknown'
}

export type SpendReq = {
  kind: Ai33Kind
  /** Characters (speech, dialogue), effects (sfx), 1 (music). */
  units: number
  /** At most 80 characters, for the ledger; never the script. */
  summary: string
  /** Precomputed; else estimate() derives it. */
  estimate?: Ai33Estimate
  /** Shown as "Hear {name}" on the card. */
  voice?: { id: string; name: string } | null
  /** Effects in a call, or parts remaining in a script. */
  batch?: number
  /** The card's wording: "music", "4 sound effects". */
  thing?: string
}
/** What gateSpend reserved; the tool settles it with what the job really used. */
export type Grant = { id: string; kind: Ai33Kind; reserved: number; preapproved: boolean }

// ---- asks (a permission part in the chat, or the start card's confirm)

export type Ai33Ask = {
  /** `connect`: needs an ai33 key; `spend`: a cost card. */
  kind: 'connect' | 'spend'
  title: string
  detail: string
  credits?: number | null
  exact?: boolean
  balance?: number | null
  /** Offers "Hear {name}" before agreeing. */
  voice?: { id: string; name: string } | null
  warn?: string
  /** Default 'Go ahead' / 'Not now'. */
  labels?: { allow: string; deny: string }
}

/** `action.request` is sent to Luca as if typed, when the person taps the button. */
export type Ai33Notice = {
  id: string
  kind: 'ready' | 'still-working'
  text: string
  projectId?: string
  action?: { label: string; request: string }
}

/** Where a running tool step is: `pct` is null while ai33 gives no progress. */
export type ToolProgress = { pct: number | null; note?: string; since: number }

// ---- speech

export type Say = { word: string; as: string; wholeWord?: boolean }
export type TimedWord = { id: string; text: string; start: number; end: number }
/** How exact a script's word times are, best first. */
export type SpeechTiming = 'words' | 'cues' | 'proportional'

export type SpeechReq = {
  /** Labelled "A> …" lines when speakers is set. */
  text: string
  /** Null: pickVoice(). */
  voice: VoiceRef | null
  style?: string
  language?: string
  speed: number
  speakers?: { voice: VoiceRef; speed?: number }[]
  pause: number
  say: Say[]
  /** True only for script starts. */
  withTranscript: boolean
  projectDir: string | null
  /** Record only the first part (the price probe). */
  firstPartOnly?: boolean
}
export type SpeechPart = {
  hash: string
  file: string
  seconds: number
  chars: number
  start: number
  end: number
  cached: boolean
}
export type SpeechResult = {
  /** Absolute: the joined mp3 (in staging or media/generated). */
  file: string
  seconds: number
  parts: SpeechPart[]
  /** Null unless withTranscript. */
  words: TimedWord[] | null
  timing: SpeechTiming | null
  voice: VoiceRef
  dictionaryId: number | null
  credits: number
  left: number | null
  reused: boolean
  hash: string
}

/** What the person pasted on the start card. */
export type StartScript = {
  text: string
  voice?: VoiceRef | null
  language?: string
  speed?: number
  say?: Say[]
}
/** A script recorded and ready to become a project. */
export type PreparedScript = {
  audioFile: string
  staging: string
  text: string
  words: TimedWord[]
  timing: SpeechTiming
  voice: VoiceRef
  language: string
  speed: number
  say: Say[]
  dictionaryId: number | null
  parts: { hash: string; start: number; end: number }[]
  seconds: number
  credits: number
  left: number | null
}

// ---- music, sound effects and placement

/** Where a clip went on the timeline. */
export type Placed = {
  id: string
  start: number
  end: number
  row: number
  volume?: number
  fadeIn?: number
  fadeOut?: number
  title?: string
}
export type MusicReq = {
  mood: string
  instrumental: boolean
  from: number
  to?: number
  level: 'quiet' | 'medium'
  place: boolean
}
export type MusicResult = {
  files: string[]
  seconds: number[]
  credits: number
  left: number | null
  reused: boolean
  fitted: 'trimmed' | 'joined' | 'exact'
  placed: Placed | null
  /** Set when ai33 was still working at the wait budget: the job carries on in the background. */
  working?: { jobId: string }
}
export type SfxReq = {
  effects: { what: string; at: number; seconds: number; loop: boolean; level: number }[]
  place: boolean
}
export type SfxResult = {
  placed: (Placed & { file: string; what: string })[]
  files: string[]
  credits: number
  left: number | null
}
export type PlaceAudio = {
  /** Project-relative. */
  file: string
  role: 'voice' | 'music' | 'sfx'
  start: number
  until?: number
  volume?: number
  fadeIn?: number
  fadeOut?: number
  mediaStart?: number
  id?: string
  title?: string
  /** A voice may run past the end of the video and extend it; music never does. */
  extendRoot?: boolean
  /** The id of a clip of the same role to take out; the new one keeps its place. */
  replaces?: string
}
/** A file made for this project (media/generated), for finding it again after an undo. */
export type SavedAsset = {
  file: string
  kind: 'speech' | 'music' | 'sfx'
  prompt: string
  seconds?: number
  placedId?: string
  jobId?: string
}

// ---- per-project files (read and written only through src/main/ai33-store.ts)

/** `.luca/ai33.json`: the choices that belong to this project. */
export type ProjectAi33 = {
  v?: 1
  voice?: VoiceRef
  speed?: number
  style?: string
  say?: Say[]
  dictionaryId?: number
  dictionaryHash?: string
  /** A record of what the first turn may make without asking (only 'music'); the spend policy keeps the real one in memory and never reads this back. */
  preapproved?: Ai33Kind[]
}
/** `.luca/script.json`: this project's words come from a script, so they are exact. */
export type ScriptMeta = {
  v?: 1
  origin: 'script'
  language: string
  voice?: VoiceRef
  speed?: number
  timing?: SpeechTiming
  parts?: { hash: string; start: number; end: number }[]
  createdAt: string
}

// ---- pure helpers and constants

/** 12480 → "12,480". */
export const formatCredits = (n: number): string => Math.round(n).toLocaleString('en-US')

/** 42 → "42 s", 165 → "2 min 45 s", 120 → "2 min". */
export function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

/**
 * The languages a script can be in: what captions can draw, and what whitespace splits into
 * words (no Chinese, Japanese or Thai). `vbee`: Vbee voices are offered for it.
 */
export type Language = { id: string; name: string; bcp47: string; vbee?: boolean }
export const LANGUAGES: Language[] = [
  { id: 'en', name: 'English', bcp47: 'en-US' },
  { id: 'es', name: 'Spanish', bcp47: 'es-ES' },
  { id: 'pt', name: 'Portuguese', bcp47: 'pt-BR' },
  { id: 'fr', name: 'French', bcp47: 'fr-FR' },
  { id: 'de', name: 'German', bcp47: 'de-DE' },
  { id: 'it', name: 'Italian', bcp47: 'it-IT' },
  { id: 'nl', name: 'Dutch', bcp47: 'nl-NL' },
  { id: 'pl', name: 'Polish', bcp47: 'pl-PL' },
  { id: 'tr', name: 'Turkish', bcp47: 'tr-TR' },
  { id: 'id', name: 'Indonesian', bcp47: 'id-ID' },
  { id: 'ro', name: 'Romanian', bcp47: 'ro-RO' },
  { id: 'sv', name: 'Swedish', bcp47: 'sv-SE' },
  { id: 'cs', name: 'Czech', bcp47: 'cs-CZ' },
  { id: 'vi', name: 'Vietnamese', bcp47: 'vi-VN', vbee: true }
]

/** A language from its name ("Spanish"), id ("es") or locale ("es-ES", "es_MX"), or null. */
export function languageFor(input: string | null | undefined): Language | null {
  const q = input?.trim().toLowerCase().replace('_', '-')
  if (!q) return null
  return (
    LANGUAGES.find(
      (l) => l.name.toLowerCase() === q || l.id === q || l.bcp47.toLowerCase() === q
    ) ??
    LANGUAGES.find((l) => l.id === q.split('-')[0]) ??
    null
  )
}

/** A narrator reads about this many words a minute. */
export const wordsPerMinute = 150

/** How long a script takes to read aloud, to the nearest 5 seconds (at least 5 when there are words). */
export function estimateSpoken(text: string): { words: number; seconds: number } {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (!words) return { words: 0, seconds: 0 }
  return { words, seconds: Math.max(5, Math.round(((words / wordsPerMinute) * 60) / 5) * 5) }
}
