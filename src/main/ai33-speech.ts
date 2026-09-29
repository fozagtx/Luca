/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * Speech: choosing and listing voices, and recording words as one voiceover (in parts, cached
 * by request, joined into one file) for both the speech_generate tool and the script start.
 */
import type {
  Ai33Preview,
  Ai33VoicePage,
  Ai33VoiceQuery,
  Say,
  SpeechReq,
  SpeechResult,
  VoiceRef
} from '../shared/ai33'
import type { ProgressFn, SpendCtx } from './ai33-ctx'

export type PickVoiceOpts = {
  /** The project's own voice is used first; null when the script is starting one. */
  projectDir: string | null
  language?: string
  /** "calm", "warm", "deep". */
  style?: string
}

/**
 * The voice to use when none was chosen: the project's, else the last used for the language, else
 * a Studio narration voice for it (skipping a service that is overloaded), else a Standard one.
 */
export function pickVoice(_o: PickVoiceOpts): Promise<VoiceRef> {
  throw new Error('not implemented')
}

/** Voices to choose from (10 minutes cached), by tier, language, gender and words. */
export function listVoices(_q: Ai33VoiceQuery): Promise<Ai33VoicePage> {
  throw new Error('not implemented')
}

/** A voice's sample as bytes (https only, at most 2 MB), for the renderer to play. */
export function voicePreview(_voiceId: string): Promise<Ai33Preview> {
  throw new Error('not implemented')
}

export type SpeechCtx = {
  signal: AbortSignal
  /** Aborted only by Stop: cancel the jobs at ai33 too. */
  stop?: AbortSignal
  onProgress?: ProgressFn
  /**
   * After the first part (a price probe) is recorded: whether to go on with the rest, which
   * needs the person's OK when it is a lot (the chat's gate, or the start card's confirm).
   */
  confirmRest?: (o: { credits: number | null; chars: number; parts: number }) => Promise<boolean>
  ask?: SpendCtx['ask']
  projectDir: string | null
}

/**
 * Record `req.text` as one file: parts of a sentence-aligned size, two at a time, each cached by
 * its request; joined with a short gap after a paragraph. With `withTranscript`, the words come
 * back timed (from ai33's own timing when it gives some).
 */
export function makeSpeech(_req: SpeechReq, _c: SpeechCtx): Promise<SpeechResult> {
  throw new Error('not implemented')
}

/**
 * The pronunciation dictionary for these words on the person's ai33 account (one per unique set,
 * reused by name), or null when there are none or it can't be made (the caller then applies the
 * replacements to the text itself).
 */
export function ensureDictionary(_projectDir: string | null, _say: Say[]): Promise<number | null> {
  throw new Error('not implemented')
}

/** A script's words as whitespace tokens with their punctuation (speaker labels "A>" dropped). */
export function wordsFromScript(_text: string, _language: string): string[] {
  throw new Error('not implemented')
}
