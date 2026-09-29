/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * Starting a video from a script: record it as the voiceover before any project exists, then
 * write down that its words are exact once the project has been made.
 */
import type { PreparedScript } from '../shared/ai33'
import type { CreateProgress, StartArgs } from '../shared/types'

/**
 * Record `args.script` into `<staging>/voiceover.mp3` (parts cached, two at a time) with its
 * words and times; reports the progress of the recording.
 */
export function scriptToAudio(
  _args: StartArgs,
  _report: (p: CreateProgress) => void,
  _signal: AbortSignal
): Promise<PreparedScript> {
  throw new Error('not implemented')
}

/**
 * After the project is made: transcript.json and .luca/transcript.original.json from the script's
 * words, .luca/script.json, .luca/SCRIPT.md and .luca/ai33.json.
 */
export function finishScriptStart(_dir: string, _prepared: PreparedScript): Promise<void> {
  throw new Error('not implemented')
}

/** The person pressed Cancel on the start card: stop recording and delete the remote tasks. */
export function cancelStart(): void {
  throw new Error('not implemented')
}

/** Aborted by cancelStart (a fresh signal for each start). */
export function startAbort(): AbortSignal {
  throw new Error('not implemented')
}
