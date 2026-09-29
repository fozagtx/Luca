/**
 * Starting a video from a script: record it as the voiceover before any project exists, then
 * write down that its words are exact once the project has been made.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  formatCredits,
  languageFor,
  type Grant,
  type PreparedScript,
  type Say,
  type TimedWord,
  type VoiceRef
} from '../shared/ai33'
import type { CreateProgress, StartArgs } from '../shared/types'
import { hasAi33Key, patchAi33Settings } from './ai33-account'
import { askViaWindow } from './ai33-ask'
import { getCredits } from './ai33-client'
import { makeSpeech, pickVoice, wordsFromScript } from './ai33-speech'
import { gateSpend, makeStartCtx, settleSpend } from './ai33-spend'
import { patchProjectAi33, writeScriptMeta } from './ai33-store'
import { probeMedia } from './env'
import { getSettings } from './settings'

/** The silence after a paragraph, as everywhere a script is recorded. */
const PARAGRAPH_PAUSE = 0.35

const STOPPED =
  'Stopped before the voiceover was ready. If ai33 still finishes it, it is saved and won’t be paid for twice.'
const NOT_ALL =
  'Stopped before the whole voiceover was recorded. The first part is saved, so trying again only pays for the rest.'

let current = new AbortController()

/**
 * The signal of the start that is beginning now: cancelStart() aborts it. Each start gets its own,
 * so a Cancel that arrives after one has finished never stops the next.
 */
export function startAbort(): AbortSignal {
  current = new AbortController()
  return current.signal
}

/** The person pressed Cancel on the start card: stop recording and delete the remote tasks. */
export function cancelStart(): void {
  // the recording cancels its jobs at ai33 when this fires (it is the Stop signal of the job runner)
  current.abort()
}

/** Ends a start the person cancelled: the project made so far is thrown away by the caller. */
export function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(STOPPED)
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000

/**
 * Record `args.script` into `<staging>/voiceover.mp3` (parts cached, two at a time) with its
 * words and times; reports the progress of the recording. Nothing is left behind when it fails
 * (the recorded parts stay cached, so trying again only pays for what is missing).
 */
export async function scriptToAudio(
  args: StartArgs,
  report: (p: CreateProgress) => void,
  signal: AbortSignal
): Promise<PreparedScript> {
  const script = args.script
  const text = script?.text.trim() ?? ''
  if (!script || !text) throw new Error('Paste your script first.')
  if (!hasAi33Key())
    throw new Error(
      'Connect ai33 first: Luca needs it to record your script. Your script is still here.'
    )

  const language = languageFor(script.language)?.id ?? 'en'
  const speed = script.speed ?? 1
  const say = (script.say ?? []).filter((s) => s.word.trim() && s.as.trim())
  report({ stage: 'voiceover' })

  // asks (the price of the rest of a long script) go to the start card: no chat exists yet
  const ctx = makeStartCtx((ask) => askViaWindow(ask, signal), signal)
  // set by confirmRest (a closure, so read through an object: TypeScript can't see it change)
  const state: { grant: Grant | null; refusal: 'declined' | { left: number } | null } = {
    grant: null,
    refusal: null
  }

  try {
    // named here (not left to makeSpeech) so the cost card can offer to play it
    const voice: VoiceRef = script.voice ?? (await pickVoice({ projectDir: null, language }))
    const result = await makeSpeech(
      {
        text,
        voice,
        language,
        speed,
        pause: PARAGRAPH_PAUSE,
        say,
        withTranscript: true,
        projectDir: null
      },
      {
        signal,
        stop: signal,
        onProgress: (p) =>
          report({
            stage: 'voiceover',
            message: p.note,
            progress: p.pct === null ? undefined : Math.max(0, Math.min(1, p.pct / 100))
          }),
        // part 1 is the price probe: the rest is asked about only when it is a lot
        confirmRest: async ({ credits, chars, parts }) => {
          const gate = await gateSpend(ctx, {
            kind: 'speech',
            units: chars,
            summary: 'Voiceover from a script',
            estimate: credits === null ? undefined : { credits, exact: false, basis: 'learned' },
            voice: { id: voice.id, name: voice.name },
            batch: parts,
            thing: 'the voiceover'
          })
          if (gate.go) {
            state.grant = gate.grant
            return true
          }
          const left = await getCredits().catch(() => null)
          state.refusal =
            left !== null && credits !== null && left < credits ? { left } : 'declined'
          return false
        },
        ask: ctx.ask,
        projectDir: null
      }
    )
    // a voiceover that stopped after its first part must never become a project
    if (state.refusal) throw new Error(NOT_ALL)
    if (state.grant) settleSpend(ctx, state.grant, restCredits(result))
    state.grant = null
    throwIfStopped(signal)
    return await toPrepared(result, { text, language, speed, say })
  } catch (err) {
    if (state.grant) settleSpend(ctx, state.grant, 0)
    throwIfStopped(signal)
    if (typeof state.refusal === 'object' && state.refusal)
      throw new Error(
        `You’re out of ai33 credits (${formatCredits(state.refusal.left)} left). Add credits with ai33, then press Record again. Your script is still here.`
      )
    // makeSpeech ends with its own error when the rest is declined: the plain one is this
    if (state.refusal) throw new Error(NOT_ALL)
    throw err
  }
}

type Recorded = Awaited<ReturnType<typeof makeSpeech>>

/**
 * What the parts after the first cost: the gate reserved only those, and what it learns about
 * prices is per character, so it must not be told about the probe as well.
 */
function restCredits(result: Recorded): number {
  const paid = (parts: Recorded['parts']): number =>
    parts.filter((p) => !p.cached).reduce((sum, p) => sum + p.chars, 0)
  const all = paid(result.parts)
  return all > 0 ? Math.round((result.credits * paid(result.parts.slice(1))) / all) : 0
}

/** The recording as a file in a folder of its own, checked, with the words the project starts from. */
async function toPrepared(
  result: Recorded,
  o: { text: string; language: string; speed: number; say: Say[] }
): Promise<PreparedScript> {
  // next to the projects, on the same disk, so init and the clean-up after it are cheap
  const projects = getSettings().projectsDir
  mkdirSync(projects, { recursive: true })
  const staging = mkdtempSync(join(projects, '.script-'))
  try {
    const audioFile = join(staging, 'voiceover.mp3')
    copyFileSync(result.file, audioFile)
    const seconds = await probeMedia(audioFile).then(
      (m) => r3(m.duration),
      () => 0
    )
    if (!(seconds > 0))
      throw new Error(
        `ai33 sent back a voiceover Luca couldn’t use. It used ${formatCredits(result.credits)} credits and is kept, so it won’t be paid for twice.`
      )
    const timed = result.words?.length
      ? { words: result.words, timing: result.timing ?? 'proportional' }
      : { words: spreadWords(o.text, o.language, seconds), timing: 'proportional' as const }
    return {
      audioFile,
      staging,
      text: o.text,
      words: timed.words,
      timing: timed.timing,
      voice: result.voice,
      language: o.language,
      speed: o.speed,
      say: o.say,
      dictionaryId: result.dictionaryId,
      parts: result.parts.map((p) => ({ hash: p.hash, start: p.start, end: p.end })),
      seconds,
      credits: result.credits,
      left: result.left
    }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    throw err
  }
}

/**
 * The script's words spread over the recording by their length, for when the recording came back
 * with no timing at all (the words are still exactly the script's).
 */
function spreadWords(text: string, language: string, seconds: number): TimedWord[] {
  const tokens = wordsFromScript(text, language)
  const weights = tokens.map((t) => t.length + 1)
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let at = 0
  return tokens.map((word, i) => {
    const start = at
    at += (weights[i] / total) * seconds
    return { id: `w${i + 1}`, text: word, start: r3(start), end: r3(at) }
  })
}

/**
 * After the project is made: transcript.json and .luca/transcript.original.json from the script's
 * words, .luca/script.json, .luca/SCRIPT.md and .luca/ai33.json.
 */
export async function finishScriptStart(dir: string, prepared: PreparedScript): Promise<void> {
  mkdirSync(join(dir, '.luca'), { recursive: true })
  // the same file a transcription writes, so captions, B-roll timing and the Transcript tab read it
  const json = JSON.stringify({ words: prepared.words }, null, 2)
  writeFileSync(join(dir, 'transcript.json'), json)
  writeFileSync(join(dir, '.luca', 'transcript.original.json'), json)
  writeScriptMeta(dir, {
    origin: 'script',
    language: prepared.language,
    voice: prepared.voice,
    speed: prepared.speed,
    timing: prepared.timing,
    parts: prepared.parts,
    createdAt: new Date().toISOString()
  })
  writeFileSync(join(dir, '.luca', 'SCRIPT.md'), scriptMarkdown(prepared))
  patchProjectAi33(dir, {
    voice: prepared.voice,
    speed: prepared.speed,
    ...(prepared.say.length ? { say: prepared.say } : {}),
    ...(prepared.dictionaryId !== null ? { dictionaryId: prepared.dictionaryId } : {})
  })
  rememberVoice(prepared.language, prepared.voice)
}

/** The voice picked for a language is the one offered first next time (a courtesy: never fails a start). */
function rememberVoice(language: string, voice: VoiceRef): void {
  try {
    const last = getSettings().ai33?.lastVoice ?? {}
    patchAi33Settings({ lastVoice: { ...last, [language]: voice } })
  } catch {
    // remembering is not worth failing a start for
  }
}

/** What Luca reads to know the script (the transcript has the same words, with their times). */
function scriptMarkdown(p: PreparedScript): string {
  const name = languageFor(p.language)?.name ?? p.language
  const out = [
    '# The script',
    `The voiceover was recorded from this text, word for word, in ${p.voice.name}’s voice (${name}). Its words and times are in transcript.json.`,
    ''
  ]
  if (p.say.length)
    out.push(
      'Said differently from how they are written (the captions keep the written words):',
      ...p.say.map((s) => `- ${s.word}: ${s.as}`),
      ''
    )
  out.push('---', '', p.text, '')
  return out.join('\n')
}
