import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  formatCredits,
  formatSpan,
  type Ai33Estimate,
  type Grant,
  type Placed,
  type Say,
  type SpendReq,
  type SpeechReq,
  type SpeechResult,
  type VoiceRef
} from '../../shared/ai33'
import type { Project } from '../../shared/types'
import { Ai33Error, getCredits } from '../ai33-client'
import type { Ai33Ctx, Ai33Tool } from '../ai33-ctx'
import {
  makeSpeech,
  previewSpeech,
  SpeechDeclined,
  SpeechPartError,
  SpeechStillWorking,
  voiceHealth
} from '../ai33-speech'
import {
  hasSpeakerLabels,
  normalizeScript,
  parseDialogue,
  speakersUsed,
  wordsFromScript
} from '../ai33-speech-text'
import {
  gateSpendWith,
  holdSpend,
  lostRecently,
  mayHaveBeenCharged,
  precheckSpend,
  settleSpend,
  voiceLabel
} from '../ai33-spend'
import { patchProjectAi33, readProjectAi33 } from '../ai33-store'
import { listVoices, pickVoice, resolveVoice } from '../ai33-voices'
import { findSaved, importGenerated, placeAudio, probeAudio, projectHasVoice } from '../place'
import { readProject } from '../projects'
import {
  fail,
  guarded,
  okJson,
  OVERLOADED,
  SPEND_DECLINED,
  STILL_WORKING,
  type Guard
} from './common'

/** The longest text one call records: what `text` allows, so a file is no way round the limit. */
const MAX_CHARS = 60_000
/** Credits left below this: Luca is told to mention it once. */
const LOW_BALANCE = 1000

const SPEECH_DESCRIPTION =
  'Record words as speech: a voiceover from a script, a spoken line, or a conversation between voices. Spends the user’s ai33 credits and takes a minute or two. Generates, saves and PLACES the clip on the timeline itself; you cannot hear it, so never describe how it sounds. Use only when the user asks for a voiceover, a line read aloud or a second voice, or the edit plan names it. Never to read your own replies aloud. One take per request; a different voice or speed is a new paid take, only when asked. Say in one short line what you are recording before you call. It never changes the words or captions of the video: they still follow the original recording.'

const SEARCH_DESCRIPTION =
  'Find voices to choose from by language, gender and kind. Free and read-only. Use only when the user asks to hear, browse or change the voice, or describes a voice and lets you pick; otherwise speech_generate picks. After it, say one short line and stop so they can listen and choose. Do not describe how a voice sounds.'

const AT_REQUIRED =
  'There is already a voice in this video. Give this line a start time (at) so it doesn’t talk over it.'

const CAPTIONS_STAY =
  'Captions and transcript still follow the original recording, not this voice; the original audio keeps playing, so tell the user they can mute the original row if they want only this voice. You cannot hear it: report the length only.'

const VOICES_TELL =
  'Offer at most three by name and one word each. Say they can hear them in the list below.'
const NO_VOICES_TELL =
  'No voices matched. Say so in one short sentence and offer to try fewer words or another language.'

const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const r2 = (n: number): number => Math.round(n * 100) / 100
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** A refusal before anything was made: said plainly, with the fact that nothing was charged. */
const nothing = (what: string): CallToolResult =>
  fail(`${what} Nothing was made and nothing was charged.`)

// ------------------------------------------------------------------------------ the request

type Args = {
  text?: string
  file?: string
  voice?: string
  style?: string
  language?: string
  speed: number
  speakers?: { voice: string; speed?: number }[]
  pause: number
  say?: { word: string; as: string; wholeWord: boolean }[]
  at?: number
  name?: string
  place: boolean
}

/** What a request needs, checked before anything is asked of ai33 or paid for. */
type Ready = {
  project: Project
  text: string
  dialogue: boolean
  speakers?: { voice: VoiceRef; speed?: number }[]
  voice: VoiceRef | null
  say: Say[]
}

const unknownVoice = (id: string): CallToolResult =>
  nothing(`“${id}” isn’t a voice Luca knows. Call voice_search to find one, then use its id.`)

const tooLong = (): CallToolResult =>
  nothing(
    `That is more than ${MAX_CHARS.toLocaleString('en-US')} characters, which is too much for one recording. Record it in parts.`
  )

/** The words in a project file: inside the project, .md or .txt, never under media/. */
function wordsFromFile(dir: string, file: string): { text: string } | { refused: CallToolResult } {
  const abs = resolve(dir, file)
  const rel = relative(dir, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    return { refused: nothing('That file isn’t inside this project.') }
  if (rel.split(sep)[0] === 'media')
    return { refused: nothing('Files under media/ can’t be read aloud from here.') }
  if (!/\.(md|txt)$/i.test(rel))
    return { refused: nothing('Only a .md or .txt file can be read aloud from a project file.') }
  if (!existsSync(abs)) return { refused: nothing(`There is no file at ${rel}.`) }
  try {
    // a link out of the project is no way round the rules above
    const inside = relative(realpathSync(dir), realpathSync(abs))
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('outside')
    // far more than the limit below allows in any language: not worth reading
    if (statSync(abs).size > MAX_CHARS * 4) return { refused: tooLong() }
    return { text: readFileSync(abs, 'utf8') }
  } catch {
    return { refused: nothing(`Luca couldn’t read ${rel}.`) }
  }
}

/** The project's words to say a certain way, with this call's on top (a word given again is replaced). */
function mergeSay(dir: string, given: Args['say']): Say[] {
  const mine = readProjectAi33(dir).say ?? []
  if (!given?.length) return mine
  const ours = new Set(given.map((s) => s.word.trim().toLowerCase()))
  return [...mine.filter((s) => !ours.has(s.word.trim().toLowerCase())), ...given]
}

function prepare(projectDir: string, a: Args): { ready: Ready } | { refused: CallToolResult } {
  const hasText = typeof a.text === 'string' && a.text.trim() !== ''
  if (hasText === (a.file !== undefined))
    return {
      refused: nothing('Give the words as text or as a project file (exactly one of the two).')
    }
  const project = readProject(projectDir)
  if (!project) return { refused: fail('No project is open.') }
  let text = a.text ?? ''
  if (a.file !== undefined) {
    const read = wordsFromFile(projectDir, a.file)
    if ('refused' in read) return read
    text = read.text
  }
  text = normalizeScript(text)
  if (!text) return { refused: nothing('There are no words to record.') }
  if (text.length > MAX_CHARS) return { refused: tooLong() }

  const dialogue = !!a.speakers
  if (dialogue && !hasSpeakerLabels(text))
    return {
      refused: nothing(
        'A conversation needs one line per turn, starting with A> for the first voice, B> for the second and C> for a third.'
      )
    }
  if (!dialogue && hasSpeakerLabels(text))
    return {
      refused: nothing(
        'The text has A> and B> labels but no speakers. Give speakers (two or three voices), or take the labels out.'
      )
    }
  let speakers: Ready['speakers']
  if (a.speakers) {
    const used = speakersUsed(parseDialogue(text))
    if (used > a.speakers.length)
      return {
        refused: nothing(
          `The text uses the label ${'ABC'[used - 1]}> but only ${a.speakers.length} voices were given.`
        )
      }
    speakers = []
    for (const s of a.speakers) {
      const v = resolveVoice(s.voice)
      if (!v) return { refused: unknownVoice(s.voice) }
      speakers.push({ voice: v, speed: s.speed })
    }
  }
  let voice: VoiceRef | null = null
  if (!dialogue && a.voice) {
    voice = resolveVoice(a.voice)
    if (!voice) return { refused: unknownVoice(a.voice) }
  }

  // a second voice over the first would talk over it: it has to say where it starts
  if (a.place && a.at === undefined && projectHasVoice(project))
    return { refused: fail(AT_REQUIRED) }

  return { ready: { project, text, dialogue, speakers, voice, say: mergeSay(projectDir, a.say) } }
}

// ------------------------------------------------------------------------------ recording it

/** The spend gate's answer for this call, kept where the callback and the catch can both see it. */
type Gate = {
  grant: Grant | null
  refused: CallToolResult | null
  /** What was already spent (the first part) when the rest was asked about. */
  paid: number
}

/** A few of the words, for the saved file's name. */
function slugFrom(name: string | undefined, text: string): string {
  const said = (name?.trim() || text.split(/\s+/).slice(0, 5).join(' ')).trim()
  return /[a-z0-9]/i.test(said.normalize('NFKD')) ? said : 'voiceover'
}

const titleFor = (a: Args, dialogue: boolean): string =>
  a.name?.trim() || (dialogue ? 'Conversation' : a.at !== undefined ? 'Voice line' : 'Voiceover')

/** How much of the text was read, so a long one can be checked to have been read whole. */
function readBack(text: string, language?: string): Record<string, unknown> {
  const words = wordsFromScript(text, language ?? '')
  return {
    chars: text.length,
    words: words.length,
    first: words.slice(0, 6).join(' '),
    last: words.slice(-6).join(' ')
  }
}

function tellFor(o: {
  dialogue: boolean
  voice: VoiceRef
  seconds: number
  credits: number
  left: number | null
  reused: boolean
}): string {
  const used = o.reused ? 'no credits used' : `used ${formatCredits(o.credits)} credits`
  const left = o.left === null ? '' : `, ${formatCredits(o.left)} left`
  return [
    `Tell the user in two short lines what you recorded${o.dialogue ? '' : ` in ${voiceLabel(o.voice.name)}’s voice`}, where it plays and how long it is (${formatSpan(o.seconds)}), the credits clause (${used}${left}) and one next step, for example “Want a different voice? I can show a few to listen to.”`,
    'You cannot hear it: never say how it sounds.',
    o.left !== null && o.left < LOW_BALANCE ? 'Credits are running low: mention it once.' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

async function generate(
  ctx: Ai33Ctx,
  projectDir: string,
  a: Args,
  ready: Ready,
  g: Guard
): Promise<CallToolResult> {
  const { project, text, dialogue } = ready
  const voice =
    ready.voice ??
    (dialogue ? null : await pickVoice({ projectDir, language: a.language, style: a.style }))
  const heard = ready.speakers ? ready.speakers[0].voice : (voice as VoiceRef)
  const ids = ready.speakers ? ready.speakers.map((s) => s.voice.id) : [heard.id]
  const req: SpeechReq = {
    text,
    voice,
    style: a.style,
    language: a.language,
    speed: a.speed,
    speakers: ready.speakers,
    pause: a.pause,
    say: ready.say,
    withTranscript: false,
    projectDir
  }
  const preview = await previewSpeech(req)

  // the same words in the same voice are saved in this project already: nothing to ask or pay
  let saved: { rel: string; abs: string; seconds: number } | null = null
  for (const hash of preview.hashes) {
    const rel = findSaved(projectDir, 'speech', hash)[0]
    if (!rel) continue
    try {
      saved = {
        rel,
        abs: join(projectDir, rel),
        seconds: (await probeAudio(join(projectDir, rel))).seconds
      }
      break
    } catch {
      // unreadable: it is made again below
    }
  }

  const gate: Gate = { grant: null, refused: null, paid: 0 }
  // an identical part was sent a moment ago and ai33 never answered: it may have been charged
  const again = !saved && preview.uncachedHashes.some(lostRecently)
  const spendReq = (units: number, estimate?: Ai33Estimate): SpendReq => ({
    kind: dialogue ? 'dialogue' : 'speech',
    units,
    summary: `${dialogue ? 'Conversation' : 'Voiceover'}, ${formatCredits(units)} characters`,
    estimate,
    voice: dialogue ? null : { id: heard.id, name: heard.name },
    ...(a.at !== undefined && !dialogue ? { thing: 'the line' } : {})
  })
  const ask = async (units: number, estimate?: Ai33Estimate): Promise<boolean> => {
    const r = await gateSpendWith(ctx, spendReq(units, estimate), { again })
    if (r.go) gate.grant = r.grant
    else gate.refused = r.result
    return gate.grant !== null
  }

  let made: SpeechResult | null = null
  let file = saved
  if (!saved) {
    if (preview.uncachedParts > 0 && (await voiceHealth(ids)) === 'overloaded')
      return fail(OVERLOADED)
    // one part left to record is asked about now, and so is a repeat of one that may have been
    // charged; more are asked about once the first shows what they cost
    const upfront = preview.uncachedParts <= 1 || again
    if (preview.uncachedParts > 0 && upfront && !(await ask(preview.uncachedChars)))
      return gate.refused as CallToolResult
    // that first part is paid before anything can be asked, so the caps and the balance are
    // checked first (no card: a card needs the price it shows)
    if (!upfront && preview.firstChars > 0) {
      const first = await precheckSpend(ctx, spendReq(preview.firstChars))
      if (!first.go) return first.result
    }
    try {
      made = await makeSpeech(req, {
        signal: g.signal,
        stop: g.stop,
        onProgress: g.progress,
        projectDir,
        ...(upfront
          ? {}
          : {
              confirmRest: (o) => {
                gate.paid = o.paid
                return ask(
                  o.chars,
                  o.credits === null
                    ? undefined
                    : { credits: o.credits, exact: false, basis: 'learned' }
                )
              }
            })
      })
    } catch (err) {
      if (gate.grant) {
        // a part still recording at ai33, or one that may have been charged, keeps its estimate and
        // its place in the caps (settling at 0 would free it for a retry); anything else settles at what it used
        const used = Math.max(0, ((err as { credits?: number }).credits ?? 0) - gate.paid)
        const wrapped = err instanceof SpeechPartError ? err.cause : err
        if (err instanceof SpeechStillWorking) holdSpend(ctx, gate.grant)
        else if (used === 0 && mayHaveBeenCharged(wrapped)) holdSpend(ctx, gate.grant)
        else settleSpend(ctx, gate.grant, used)
      }
      if (err instanceof SpeechDeclined)
        return gate.refused ?? okJson({ ok: false, declined: true, tell: SPEND_DECLINED })
      if (err instanceof SpeechStillWorking)
        return okJson({
          ok: true,
          kind: 'speech',
          working: true,
          task: err.jobId,
          credits: err.credits,
          tell: `${STILL_WORKING} Do not start it again; when the user asks, call ai33_status.`
        })
      throw err
    }
    if (gate.grant) settleSpend(ctx, gate.grant, Math.max(0, made.credits - gate.paid))

    // a copy goes into the project (which uses it up); the joined file stays for next time
    const tmp = join(dirname(made.file), `to-project-${randomUUID()}.mp3`)
    try {
      copyFileSync(made.file, tmp)
      const put = await importGenerated(project, 'speech', tmp, {
        slug: slugFrom(a.name, text),
        hash: made.hash,
        prompt: text
      })
      file = { rel: put.rel, abs: put.abs, seconds: put.seconds ?? made.seconds }
    } catch (err) {
      throw new Ai33Error(
        'unusable',
        `${message(err)} The voiceover was recorded${made.credits ? ` (${formatCredits(made.credits)} credits)` : ''} and is kept, so asking again won’t be paid for twice.`,
        { charged: true }
      )
    } finally {
      rmSync(tmp, { force: true })
    }
  }
  const out = file as { rel: string; abs: string; seconds: number }
  const credits = made?.credits ?? 0
  const reused = made ? made.reused : true
  const left = made ? made.left : await getCredits().catch(() => null)

  let placed: Placed | null = null
  if (a.place) {
    try {
      placed = await placeAudio(project, {
        file: out.rel,
        role: 'voice',
        start: a.at ?? 0,
        extendRoot: true,
        title: titleFor(a, dialogue)
      })
    } catch (err) {
      throw new Ai33Error(
        'unusable',
        `The voiceover is saved as ${out.rel} but couldn’t be put on the timeline: ${message(err)}`,
        { charged: credits > 0 }
      )
    }
  }

  // the next line in this video starts from the same voice, and keeps its pronunciations
  try {
    const patch: Parameters<typeof patchProjectAi33>[1] = {}
    if (!dialogue && readProjectAi33(projectDir).voice?.id !== heard.id) patch.voice = heard
    if (a.say?.length) patch.say = ready.say
    if (Object.keys(patch).length) patchProjectAi33(projectDir, patch)
  } catch {
    // the recording is placed; a project file that can't be written is no reason to fail it
  }

  return okJson({
    ok: true,
    kind: 'speech',
    files: [out.rel],
    seconds: r2(out.seconds),
    credits,
    left,
    reused,
    placed,
    readBack: readBack(text, a.language),
    tell: tellFor({ dialogue, voice: heard, seconds: out.seconds, credits, left, reused }),
    ...(placed
      ? {
          place: `It is on the voice row from ${clock(placed.start)} to ${clock(placed.end)} at full level. ${CAPTIONS_STAY}`
        }
      : {})
  })
}

// ------------------------------------------------------------------------------ the tools

const speedRange = z.number().min(0.5).max(1.5)

/** speech_generate (a voiceover, a line or a conversation) and voice_search, for the ai33 MCP server (mcp-ai33.ts). */
export function speechTools(ctx: Ai33Ctx, projectDir: string): Ai33Tool[] {
  return [
    tool(
      'speech_generate',
      SPEECH_DESCRIPTION,
      {
        text: z
          .string()
          .min(1)
          .max(60000)
          .optional()
          .describe(
            'the words, read exactly as written; for a conversation, one line per turn starting with "A> ", "B> " or "C> "'
          ),
        file: z
          .string()
          .optional()
          .describe(
            'instead of text: a project file (.md or .txt, not under media/) holding the words, read here so long text does not have to pass through you'
          ),
        voice: z
          .string()
          .optional()
          .describe('an id from voice_search; omit to use the project’s voice, else one is picked'),
        style: z
          .string()
          .max(80)
          .optional()
          .describe('only when voice is omitted: "calm", "warm", "deep"'),
        language: z
          .string()
          .max(40)
          .optional()
          .describe('"Spanish" or "es-ES"; English when omitted'),
        speed: speedRange.default(1),
        speakers: z
          .array(z.object({ voice: z.string(), speed: speedRange.optional() }))
          .min(2)
          .max(3)
          .optional()
          .describe(
            'two or three voices for a conversation: A> is the first, B> the second, C> the third'
          ),
        pause: z
          .number()
          .min(0)
          .max(5)
          .default(0.4)
          .describe('seconds of silence between speakers (a conversation only)'),
        say: z
          .array(
            z.object({
              word: z.string().max(60),
              as: z.string().max(80),
              wholeWord: z.boolean().default(true)
            })
          )
          .max(30)
          .optional()
          .describe(
            'names, brands and acronyms to say a certain way: word as written in the text, as how it should sound. Only the voice changes, never the words or captions'
          ),
        at: z
          .number()
          .min(0)
          .optional()
          .describe(
            'where it starts on the timeline, in seconds; 0 when omitted, but required once the video already has a voice'
          ),
        name: z.string().max(60).optional().describe('a short name for the clip'),
        place: z
          .boolean()
          .default(true)
          .describe('false to only save it, not put it on the timeline')
      },
      async (args, extra) => {
        // refused before asking for a key or spending anything
        const prepared = prepare(projectDir, args as Args)
        if ('refused' in prepared) return prepared.refused
        return guarded(ctx, 'speech_generate', extra, (g) =>
          generate(ctx, projectDir, args as Args, prepared.ready, g)
        )
      },
      {
        searchHint: 'record a voiceover, narration, a spoken line or a conversation from text',
        alwaysLoad: true
      }
    ),
    tool(
      'voice_search',
      SEARCH_DESCRIPTION,
      {
        query: z.string().max(80).optional().describe('words to look for: a name, "warm", "news"'),
        language: z.string().max(40).optional().describe('"Spanish" or "es-ES"'),
        gender: z.enum(['female', 'male']).optional(),
        tier: z
          .enum(['studio', 'standard', 'yours'])
          .default('studio')
          .describe(
            'studio: the most natural voices; standard: simpler, more synthetic; yours: voices the user made'
          ),
        limit: z.number().int().min(1).max(12).default(8)
      },
      (args, extra) =>
        guarded(ctx, 'voice_search', extra, async () => {
          const page = await listVoices({
            tier: args.tier,
            query: args.query,
            language: args.language,
            gender: args.gender,
            limit: args.limit
          })
          const voices = page.voices.slice(0, args.limit).map((v) => ({
            id: v.id,
            name: v.name,
            about: v.about,
            tier: v.tier,
            language: v.language,
            gender: v.gender,
            previewable: v.previewable
          }))
          return okJson({
            ok: true,
            kind: 'voices',
            voices,
            tell: voices.length ? VOICES_TELL : NO_VOICES_TELL,
            ...(page.note ? { note: page.note } : {})
          })
        }),
      {
        annotations: { readOnlyHint: true },
        searchHint: 'find and compare voices to listen to and choose from'
      }
    )
  ]
}
