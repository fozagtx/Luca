import { languageFor, type Ai33Voice, type Ai33VoiceTier } from '@shared/ai33'

/** The three kinds of voice, in the order they are listed, with what each means in plain words. */
export const TIERS: { id: Ai33VoiceTier; label: string; hint: string }[] = [
  { id: 'studio', label: 'Studio', hint: 'Studio voices sound the most natural.' },
  {
    id: 'standard',
    label: 'Standard',
    hint: 'Standard voices are simpler and sound more synthetic.'
  },
  { id: 'yours', label: 'Yours', hint: 'Voices you made on ai33.' }
]

export const tierOf = (id: Ai33VoiceTier): (typeof TIERS)[number] =>
  TIERS.find((t) => t.id === id) ?? TIERS[0]

/** One line about a voice: what ai33 says about it, else its gender and language. */
export function voiceLine(v: Ai33Voice): string {
  const about = v.about.trim()
  if (about) return about
  const language = languageFor(v.language)?.name ?? v.language
  return [v.gender, language].filter(Boolean).join(' · ')
}

/**
 * Why a voice can't be used for a script in this language, or null when it can. A Standard voice
 * reads one language; Studio voices and the ones you made read any.
 */
export function unusableReason(v: Ai33Voice, scriptLanguage?: string): string | null {
  if (v.tier !== 'standard' || !scriptLanguage) return null
  const theirs = languageFor(v.language)
  const wanted = languageFor(scriptLanguage)
  if (!theirs || !wanted || theirs.id === wanted.id) return null
  return `Reads ${theirs.name} only. Your script is in ${wanted.name}.`
}

/** What a voice's play button says when there is no sample to play. */
export const NO_SAMPLE = 'No sample to hear for this voice'
/** What a play button says when playing fails or there is no internet connection. */
export const CANT_PLAY = 'Can’t play right now'

type KeyLike = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  stopPropagation(): void
}

/**
 * Keeps a key press inside the control it was pressed on. The app's shortcuts sit on the window
 * and let Space, S, G and M through when a button is focused (Space would play the video instead
 * of the voice). Command and Control keep working, and Escape still reaches the popover.
 */
export function keepKeyLocal(e: KeyLike): void {
  if (e.metaKey || e.ctrlKey || e.key === 'Escape') return
  e.stopPropagation()
}
