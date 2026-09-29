import type { Ai33Voice, Ai33VoiceTier } from '@shared/ai33'
import type { ChatContentPart } from '@shared/types'

type ToolPart = Extract<ChatContentPart, { type: 'tool' }>

/** Luca's tools that spend ai33 credits or read the account (their names as the agent sees them). */
const AI33_TOOLS = new Set(
  [
    'speech_generate',
    'voice_search',
    'music_generate',
    'sfx_generate',
    'audio_place',
    'ai33_status'
  ].map((t) => `mcp__luca__${t}`)
)
export const isAi33Tool = (name: string): boolean => AI33_TOOLS.has(name)

/** The ones that make something and take a while: their running step shows how far along it is. */
const JOB_TOOLS = new Set(
  ['speech_generate', 'music_generate', 'sfx_generate'].map((t) => `mcp__luca__${t}`)
)
export const isJobTool = (name: string): boolean => JOB_TOOLS.has(name)

/** A tool's answer starts with one line of JSON (its result); whatever follows is for Luca. */
export const firstLine = (detail: string | undefined): string => (detail ?? '').split('\n', 1)[0]

function resultOf(p: ToolPart): Record<string, unknown> | null {
  try {
    const r: unknown = JSON.parse(firstLine(p.detail))
    return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The tool finished at its wait budget: the job carries on at ai33 and a notice follows. */
export const isStillWorking = (p: ToolPart): boolean => {
  const r = resultOf(p)
  return r?.ok === true && r.working === true
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const TIERS: Ai33VoiceTier[] = ['studio', 'standard', 'yours']

/**
 * The voices a finished voice_search step found (the first few: the list stays short in a chat),
 * an empty list when it found none, and null for any other step or an answer that can't be read.
 */
export function voicesOf(p: ToolPart): Ai33Voice[] | null {
  if (p.name !== 'mcp__luca__voice_search' || p.status !== 'done') return null
  const r = resultOf(p)
  if (r?.ok !== true || !Array.isArray(r.voices)) return null
  const voices: Ai33Voice[] = []
  for (const raw of r.voices as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const v = raw as Record<string, unknown>
    if (typeof v.id !== 'string' || !v.id || typeof v.name !== 'string' || !v.name) continue
    const gender = text(v.gender).toLowerCase()
    voices.push({
      id: v.id,
      name: v.name,
      about: text(v.about),
      tier: TIERS.find((t) => t === v.tier) ?? 'studio',
      language: text(v.language),
      gender: gender === 'female' ? 'Female' : gender === 'male' ? 'Male' : null,
      previewable: v.previewable !== false
    })
    if (voices.length === 4) break
  }
  return voices
}

const count = (placed: unknown): number =>
  Array.isArray(placed) ? placed.length : placed && typeof placed === 'object' ? 1 : 0

/** "A", "A and B", "A, B and C". */
const listOf = (xs: string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/**
 * What a finished turn put on the timeline, read from its ai33 steps ("music and a sound
 * effect"), or null when nothing was placed.
 */
export function addedSummary(parts: ChatContentPart[]): string | null {
  const made = { voice: 0, music: 0, sfx: 0, sound: 0 }
  for (const p of parts) {
    if (p.type !== 'tool' || p.status !== 'done') continue
    const r = resultOf(p)
    if (r?.ok !== true) continue
    const n = count(r.placed)
    if (!n) continue
    if (p.name === 'mcp__luca__speech_generate') made.voice += n
    else if (p.name === 'mcp__luca__music_generate') made.music += n
    else if (p.name === 'mcp__luca__sfx_generate') made.sfx += n
    else if (p.name === 'mcp__luca__audio_place') made.sound += n
  }
  const what: string[] = []
  if (made.voice) what.push(made.voice === 1 ? 'a voiceover' : `${made.voice} voiceovers`)
  if (made.music) what.push('music')
  if (made.sfx) what.push(made.sfx === 1 ? 'a sound effect' : `${made.sfx} sound effects`)
  if (made.sound) what.push(made.sound === 1 ? 'a sound' : `${made.sound} sounds`)
  return what.length ? listOf(what) : null
}
