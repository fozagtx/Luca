/**
 * Voices: listing them (by tier, language, gender and words), choosing one when the person
 * hasn't, and fetching a sample to listen to. The voice library is ai33's; ids come back
 * already prefixed by the service that owns them and are only ever passed back to it.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  languageFor,
  type Ai33Preview,
  type Ai33Raw,
  type Ai33Voice,
  type Ai33VoicePage,
  type Ai33VoiceQuery,
  type Ai33VoiceTier,
  type VoiceRef
} from '../shared/ai33'
import { Ai33Error, dataDir, downloadTo, getHealth, request, toInt } from './ai33-client'
import { patchAi33Settings } from './ai33-account'
import { readProjectAi33 } from './ai33-store'
import { getSettings } from './settings'

/** How long a page of voices is kept before ai33 is asked again. */
const CACHE_MS = 10 * 60_000
/** A sample longer than this is not played; it is only ever a few seconds. */
export const PREVIEW_MAX_BYTES = 2_097_152
const PREVIEW_TIMEOUT_MS = 8_000
const CACHE_PAGES = 120
const KNOWN_VOICES = 4000

export const STUDIO_BUSY =
  'Studio voices are busy right now. Standard voices still work, or try again in a few minutes.'
const NO_PREVIEW: Ai33Preview = { ok: false, message: 'Can’t play right now' }

/** The services whose voices Luca uses, and which tier each belongs to. */
const TIER_OF: Record<string, Ai33VoiceTier> = {
  elevenlabs: 'studio',
  minimax: 'studio',
  edge: 'standard',
  kokoro: 'standard',
  vbee: 'standard',
  clone: 'yours'
}
const VOICE_ID = /^(elevenlabs|minimax|clone|edge|kokoro|vbee)_(.+)$/

/** The service a prefixed voice id belongs to ("elevenlabs_abc" is "elevenlabs"), or null. */
export const providerOf = (voiceId: string): string | null => VOICE_ID.exec(voiceId)?.[1] ?? null

type Listed = { voice: Ai33Voice; previewUrl: string | null }
type Page = { voices: Listed[]; hasMore: boolean }

/** Every voice seen this session, so an id can be turned back into a name and a sample. */
const known = new Map<string, Listed>()
const pages = new Map<string, { at: number; page: Page }>()

const refOf = (v: Ai33Voice): VoiceRef => ({
  id: v.id,
  name: v.name,
  ...(v.language ? { language: v.language } : {})
})

// ------------------------------------------------------------------------------ reading a voice

const words = (s: string): string =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The longest voice name, and the longest language tag, kept from what ai33 sends. */
const NAME_MAX = 40
const LANGUAGE_MAX = 30
const ID_MAX = 120

/**
 * A string from ai33 that reaches the model (a voice's name, its words): one line, no control or
 * invisible characters, at most `max` characters. A voice's name is whatever its maker typed.
 */
const plain = (text: unknown, max: number): string => {
  const flat = String(text ?? '')
    .replace(/\p{Cf}+/gu, '')
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? Array.from(flat).slice(0, max).join('').trimEnd() : flat
}

const title = (s: string): string => s.replace(/(^|\s)(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())

/** A name for people: "vi-VN-HoaiMyNeural" is "Hoai My", "af_bella" is "Bella". */
export function friendlyName(name: unknown, provider: string, id: string): string {
  let n = typeof name === 'string' ? plain(name, 200) : ''
  if (!n) n = plain(id.slice(provider.length + 1), 200)
  const edge = /^[a-z]{2,3}-[A-Z]{2}(?:-[a-z]+)?-([A-Za-z]+?)(?:Multilingual)?Neural$/.exec(n)
  if (edge) return plain(words(edge[1]), NAME_MAX)
  const kokoro = /^[a-z]{2}_([a-z]+)$/.exec(n)
  if (kokoro) return plain(title(kokoro[1]), NAME_MAX)
  return plain(/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(n) ? title(words(n)) : n, NAME_MAX)
}

const VENDORISH =
  /^(?:elevenlabs|eleven labs|minimax|edge|kokoro|vbee|fishaudio|clone|standard|premium|community|professional|generated|female|male|f|m)$/i
const LOCALE = /^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i

/** One plain line: a word or two about the voice, then its gender ("Warm · Female"). */
function aboutOf(raw: Ai33Raw, gender: Ai33Voice['gender']): string {
  const found: string[] = []
  const add = (v: unknown): void => {
    if (typeof v !== 'string') return
    for (const part of v.split(',')) {
      const t = plain(part, 31)
      if (t && t.length <= 30 && !VENDORISH.test(t) && !LOCALE.test(t)) found.push(t)
    }
  }
  for (const k of ['descriptive', 'use_case', 'accent', 'age']) add(raw?.[k])
  if (raw?.labels && typeof raw.labels === 'object')
    for (const k of ['descriptive', 'use_case', 'accent', 'age']) add(raw.labels[k])
  if (Array.isArray(raw?.tags)) for (const t of raw.tags) add(t)
  const seen = new Set<string>()
  const descs = found.filter((d) => !seen.has(d.toLowerCase()) && seen.add(d.toLowerCase()))
  if (!descs.length && typeof raw?.description === 'string') {
    const sentence = plain(raw.description, 200).split(/(?<=[.!?])\s/)[0]
    if (sentence && sentence.length <= 60) descs.push(sentence.replace(/[.!?]+$/, ''))
  }
  const first = descs
    .slice(0, 2)
    .map((d, i) => (i === 0 ? d.charAt(0).toUpperCase() + d.slice(1) : d.toLowerCase()))
  return [...first, gender].filter(Boolean).join(' · ')
}

const genderOf = (raw: Ai33Raw): Ai33Voice['gender'] => {
  const tags = Array.isArray(raw?.tags) ? raw.tags.map(String) : []
  const g = String(raw?.gender ?? tags.find((t: string) => /^(fe)?male$/i.test(t)) ?? '')
    .trim()
    .toLowerCase()
  return g === 'female' || g === 'f' ? 'Female' : g === 'male' || g === 'm' ? 'Male' : null
}

function normalize(raw: Ai33Raw, provider: string): Listed | null {
  const rawId = raw?.voice_id ?? raw?.id
  if (rawId === undefined || rawId === null || String(rawId).trim() === '') return null
  const s = String(rawId).trim()
  // an id is passed back to ai33 as it is, so one that isn't plain is dropped rather than cleaned
  if (s.length > ID_MAX || /\p{C}/u.test(s)) return null
  const id = s.startsWith(`${provider}_`) ? s : `${provider}_${s}`
  const gender = genderOf(raw)
  const locale = Array.isArray(raw?.tags)
    ? raw.tags.find((t: unknown) => typeof t === 'string' && /^[a-z]{2,3}-[A-Za-z]{2,4}$/.test(t))
    : undefined
  const language = plain(raw?.language ?? raw?.locale ?? locale ?? '', LANGUAGE_MAX)
  const preview = typeof raw?.preview_url === 'string' ? raw.preview_url.trim() : ''
  const previewUrl = /^https:\/\//i.test(preview) ? preview : null
  return {
    voice: {
      id,
      name: friendlyName(raw?.name, provider, id),
      about: aboutOf(raw, gender),
      tier: TIER_OF[provider] ?? 'standard',
      language,
      gender,
      previewable: previewUrl !== null
    },
    previewUrl
  }
}

// ------------------------------------------------------------------------------ asking ai33

/** The ways ai33 may spell a language, most likely first (its name, then locale code, then id). */
function languageTries(language: string | undefined): (string | undefined)[] {
  const raw = language?.trim()
  if (!raw) return [undefined]
  const l = languageFor(raw)
  return l ? [...new Set([l.name, l.bcp47, l.id])] : [raw]
}

type Ask = {
  search?: string
  language?: string
  gender?: 'female' | 'male'
  page: number
  size: number
  /** A soft filter: dropped when it leaves nothing. */
  useCase?: string
}

async function fetchPage(provider: string, a: Ask): Promise<Page> {
  const params = new URLSearchParams({ provider })
  if (a.search) params.set('search', a.search)
  if (a.language) params.set('language', a.language)
  if (a.gender) params.set('gender', a.gender === 'female' ? 'Female' : 'Male')
  if (a.useCase) params.set('use_case', a.useCase)
  if (provider === 'vbee') params.set('voice_ownership', 'vbee')
  params.set('page', String(a.page))
  params.set('page_size', String(a.size))
  const key = params.toString()
  const hit = pages.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.page

  const res = await request(`/v3/voices?${key}`, { method: 'GET' })
  const list: Ai33Raw[] = Array.isArray(res?.data)
    ? res.data
    : Array.isArray(res?.voices)
      ? res.voices
      : Array.isArray(res)
        ? res
        : []
  const voices = list.map((v) => normalize(v, provider)).filter((v): v is Listed => v !== null)
  const pg = res?.pagination
  const total = toInt(pg?.total)
  const hasMore =
    typeof pg?.has_more === 'boolean'
      ? pg.has_more
      : total !== null
        ? total > a.page * a.size
        : list.length >= a.size
  const page: Page = { voices, hasMore }

  for (const v of voices) known.set(v.voice.id, v)
  if (known.size > KNOWN_VOICES)
    for (const k of [...known.keys()].slice(0, known.size - KNOWN_VOICES)) known.delete(k)
  pages.set(key, { at: Date.now(), page })
  if (pages.size > CACHE_PAGES) pages.delete(pages.keys().next().value as string)
  return page
}

/** One service's page, trying the other spellings of the language when the first finds nothing. */
async function pageOf(
  provider: string,
  q: { query?: string; language?: string; gender?: 'female' | 'male'; page?: number },
  size: number,
  soft = false
): Promise<Page> {
  for (const language of languageTries(q.language)) {
    const ask: Ask = {
      search: q.query?.trim() || undefined,
      language,
      gender: q.gender,
      page: Math.max(1, q.page ?? 1),
      size
    }
    if (soft) {
      const narrow = await fetchPage(provider, { ...ask, useCase: 'narration' })
      if (narrow.voices.length) return narrow
    }
    const page = await fetchPage(provider, ask)
    if (page.voices.length) return page
  }
  return { voices: [], hasMore: false }
}

/** Studio is ElevenLabs and MiniMax, Standard is Edge and Kokoro (and Vbee for Vietnamese), Yours is clones. */
function providersFor(tier: Ai33VoiceTier, language: string | undefined): string[] {
  if (tier === 'studio') return ['elevenlabs', 'minimax']
  if (tier === 'yours') return ['clone']
  return languageFor(language)?.vbee ? ['edge', 'kokoro', 'vbee'] : ['edge', 'kokoro']
}

/** Lists alternate, so a short page shows every service. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}

/** Voices to choose from (10 minutes cached), by tier, language, gender and words. */
export async function listVoices(q: Ai33VoiceQuery): Promise<Ai33VoicePage> {
  const providers = providersFor(q.tier, q.language)
  const limit = Math.min(100, Math.max(1, Math.round(q.limit ?? 30)))
  const size = Math.ceil(limit / providers.length)
  // a voice someone made is theirs whatever language it speaks
  const ask = q.tier === 'yours' ? { ...q, language: undefined } : q
  const settled = await Promise.allSettled(providers.map((p) => pageOf(p, ask, size)))
  const ok = settled.filter((s): s is PromiseFulfilledResult<Page> => s.status === 'fulfilled')
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason
  const health = q.tier === 'studio' ? await getHealth().catch(() => null) : null
  const busy = health?.elevenlabs === 'overloaded' || health?.minimax === 'overloaded'
  return {
    voices: interleave(ok.map((s) => s.value.voices.map((v) => v.voice))),
    hasMore: ok.some((s) => s.value.hasMore),
    ...(busy ? { note: STUDIO_BUSY } : {})
  }
}

/** A voice from what a tool was given: an id from voice_search, or a name from its list. */
export function resolveVoice(input: string): VoiceRef | null {
  const s = input.trim()
  if (!s) return null
  const hit = known.get(s)
  if (hit) return refOf(hit.voice)
  const m = VOICE_ID.exec(s)
  if (m) return { id: s, name: friendlyName(undefined, m[1], s) }
  const named = [...known.values()].filter((v) => v.voice.name.toLowerCase() === s.toLowerCase())
  return named.length === 1 ? refOf(named[0].voice) : null
}

// ------------------------------------------------------------------------------ choosing one

export type PickVoiceOpts = {
  /** The project's own voice is used first; null when the script is starting one. */
  projectDir: string | null
  language?: string
  /** "calm", "warm", "deep". */
  style?: string
}

/** The key the last-used voice of a language is kept under. */
export const languageKey = (language: string | undefined): string =>
  languageFor(language)?.id ?? (language?.trim().toLowerCase() || 'en')

/** Whether a voice can be used for the language asked for (no language asked, or it isn't known). */
function speaks(voice: VoiceRef, language: string | undefined): boolean {
  const want = languageFor(language)?.id ?? language?.trim().toLowerCase().split(/[-_]/)[0]
  if (!want || !voice.language) return true
  const have =
    languageFor(voice.language)?.id ?? voice.language.trim().toLowerCase().split(/[-_]/)[0]
  return have === want
}

/**
 * The voice to use when none was chosen: the project's, else the last used for the language, else
 * a Studio narration voice for it (skipping a service that is overloaded), else a Standard one.
 */
export async function pickVoice(o: PickVoiceOpts): Promise<VoiceRef> {
  const mine = o.projectDir ? readProjectAi33(o.projectDir).voice : undefined
  if (mine?.id && speaks(mine, o.language)) return mine
  const last = getSettings().ai33?.lastVoice?.[languageKey(o.language)]
  if (last?.id && speaks(last, o.language)) return last

  const health = await getHealth().catch(() => null)
  const studio = (['elevenlabs', 'minimax'] as const).filter((p) => health?.[p] !== 'overloaded')
  const standard = providersFor('standard', o.language)
  let failure: unknown = null
  for (const provider of [...studio, ...standard]) {
    try {
      const style = o.style?.trim()
      let page = await pageOf(provider, { query: style, language: o.language }, 12, true)
      if (!page.voices.length && style)
        page = await pageOf(provider, { language: o.language }, 12, true)
      if (page.voices.length) return refOf(page.voices[0].voice)
    } catch (err) {
      failure = err
    }
  }
  if (failure) throw failure
  throw new Ai33Error(
    'validation',
    'Luca couldn’t find a voice for that language. Ask the user to choose one.',
    { charged: false }
  )
}

/** Remember the voice last used for a language: the next line in that language starts from it. */
export function rememberVoice(language: string | undefined, voice: VoiceRef): void {
  try {
    const key = languageKey(language)
    const last = getSettings().ai33?.lastVoice ?? {}
    if (last[key]?.id !== voice.id) patchAi33Settings({ lastVoice: { ...last, [key]: voice } })
  } catch {
    // a courtesy: the recording is already saved, so a settings file that can't be written is no reason to fail it
  }
}

// ------------------------------------------------------------------------------ samples

const previews = new Map<string, Ai33Preview>()

/** What kind of audio these bytes are, or null when they are not audio (a web page, an error). */
export function sniffAudio(b: Uint8Array): string | null {
  if (b.length < 12) return null
  const at = (from: number, to: number): string =>
    Buffer.from(b.subarray(from, to)).toString('latin1')
  if (at(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (at(0, 4) === 'RIFF' && at(8, 12) === 'WAVE') return 'audio/wav'
  if (at(0, 4) === 'OggS') return 'audio/ogg'
  if (at(0, 4) === 'fLaC') return 'audio/flac'
  if (at(4, 8) === 'ftyp') return 'audio/mp4'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm'
  return null
}

/** Where a voice's sample is: seen in a list this session, else looked up by its own id. */
async function previewUrlOf(voiceId: string): Promise<string | null> {
  const seen = known.get(voiceId)
  if (seen) return seen.previewUrl
  const provider = providerOf(voiceId)
  if (!provider) return null
  const page = await pageOf(provider, { query: voiceId.slice(provider.length + 1) }, 30)
  return (
    known.get(voiceId)?.previewUrl ??
    page.voices.find((v) => v.voice.id === voiceId)?.previewUrl ??
    null
  )
}

/** A voice's sample as bytes (https only, at most 2 MB), for the renderer to play. */
export async function voicePreview(voiceId: string): Promise<Ai33Preview> {
  const cached = previews.get(voiceId)
  if (cached) return cached
  const dest = join(
    dataDir(),
    'cache',
    'preview',
    `${createHash('sha1').update(voiceId).digest('hex')}.bin`
  )
  try {
    const url = await previewUrlOf(voiceId)
    if (!url || !/^https:\/\//i.test(url)) return NO_PREVIEW
    mkdirSync(dirname(dest), { recursive: true })
    await downloadTo(url, dest, {
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
      maxBytes: PREVIEW_MAX_BYTES
    })
    const bytes = readFileSync(dest)
    const mime = sniffAudio(bytes)
    if (!mime || bytes.length > PREVIEW_MAX_BYTES) return NO_PREVIEW
    const out: Ai33Preview = { ok: true, mime, bytes: new Uint8Array(bytes) }
    previews.set(voiceId, out)
    if (previews.size > 12) previews.delete(previews.keys().next().value as string)
    return out
  } catch {
    return NO_PREVIEW
  } finally {
    rmSync(dest, { force: true })
  }
}
