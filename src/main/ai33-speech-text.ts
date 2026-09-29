/**
 * The words of a voiceover, prepared and read back: split into the parts ai33 records one at a
 * time, dialogue turns, pronunciation rules, the hash that names each recorded part, and the
 * times of a script's words. Pure (no Electron, no files): the smoke script bundles this file.
 */
import { createHash } from 'node:crypto'
import type { Ai33Raw, Say, SpeechTiming } from '../shared/ai33'

/** The first part is a small price probe: at most this many characters, cut at a sentence end. */
export const PROBE_CHARS = 400
/** After the first part, paragraphs shorter than this are joined with the next one... */
export const PART_MERGE_MIN = 200
/** ...and a part is never longer than this (a longer paragraph is cut at a sentence end). */
export const PART_SPLIT_MAX = 2500
/** Silence after a paragraph end when the parts are joined; none inside a split paragraph. */
export const PART_GAP = 0.35

/** One part to record, and the silence to leave after it in the joined file. */
export type Piece = { text: string; gapAfter: number }

/** CRLF to LF, no byte-order mark, no blank ends. */
export const normalizeScript = (t: string): string =>
  t
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()

// ------------------------------------------------------------------------------ cutting

/** A sentence ends at . ! ? … followed by a space (so 3.5 and a.m. stay whole), or at 。！？ */
const SENTENCE_END = /(?:[.!?…]+["'”’»)\]]*(?=\s|$))|(?:[。！？]+[」』”’)\]]*)/gu
/** "Dr." and friends end no sentence. */
const ABBREVIATION = /(?:^|[\s(])(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|e\.g|i\.e)\.$/i
const BLANK_LINE = /\n[ \t]*\n/g
const CLAUSE_END = /[,;:—–、，；：](?=\s)/g

/** Where a sentence or a paragraph ends in `text`: the index just after it. */
function ends(text: string, limit: number): number[] {
  const out: number[] = []
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length
    if (end > limit) break
    if (m[0].startsWith('.') && ABBREVIATION.test(text.slice(0, end))) continue
    out.push(end)
  }
  for (const m of text.matchAll(BLANK_LINE)) if (m.index <= limit) out.push(m.index)
  return out
}

/**
 * The first at-most-`max` characters cut where a sentence ends (else at a comma or other clause
 * end, else at a space, else in the middle of a word), and what follows. `blank`: the cut fell
 * where a blank line follows, so a paragraph ended there.
 */
export function cutAt(text: string, max: number): { head: string; rest: string; blank: boolean } {
  if (text.length <= max) return { head: text.trim(), rest: '', blank: false }
  let cut = Math.max(0, ...ends(text, max))
  if (cut < 1) {
    for (const m of text.matchAll(CLAUSE_END)) {
      if (m.index + 1 > max) break
      cut = m.index + 1
    }
  }
  if (cut < 1) cut = text.lastIndexOf(' ', max)
  if (cut < 1) cut = text.lastIndexOf('\n', max)
  if (cut < 1) {
    cut = max
    // never between the halves of a character outside the BMP
    const c = text.charCodeAt(cut - 1)
    if (c >= 0xd800 && c <= 0xdbff) cut -= 1
  }
  const tail = text.slice(cut)
  return {
    head: text.slice(0, cut).trim(),
    rest: tail.trimStart(),
    blank: /^[ \t]*\n[ \t]*\n/.test(tail)
  }
}

type Unit = { text: string; endsPara: boolean }

/** Short paragraphs join the next one (a short last one, the one before it), however long that makes it. */
function mergeSmall(units: Unit[]): Unit[] {
  const groups: Unit[] = []
  for (const u of units) {
    const last = groups[groups.length - 1]
    if (last && last.text.length < PART_MERGE_MIN)
      groups[groups.length - 1] = { text: `${last.text}\n\n${u.text}`, endsPara: true }
    else groups.push(u)
  }
  const n = groups.length
  if (n >= 2 && groups[n - 1].text.length < PART_MERGE_MIN)
    groups.splice(n - 2, 2, {
      text: `${groups[n - 2].text}\n\n${groups[n - 1].text}`,
      endsPara: true
    })
  return groups
}

/**
 * A group as units of at most PART_SPLIT_MAX characters, cut at sentence ends (and never leaving
 * a sliver for the last one). A unit ends a paragraph only where a blank line follows the cut.
 */
function splitLong(group: Unit): Unit[] {
  const out: Unit[] = []
  let rest = group.text
  while (rest.length > PART_SPLIT_MAX) {
    const limit =
      rest.length - PART_SPLIT_MAX < PART_MERGE_MIN ? rest.length - PART_MERGE_MIN : PART_SPLIT_MAX
    const cut = cutAt(rest, limit)
    if (!cut.head || !cut.rest) break
    out.push({ text: cut.head, endsPara: cut.blank })
    rest = cut.rest
  }
  out.push({ text: rest, endsPara: group.endsPara })
  return out
}

/**
 * A script as the parts to record. The first is the price probe (at most PROBE_CHARS, cut at a
 * sentence end); the rest follow paragraph by paragraph: short paragraphs are joined, long
 * ones cut at sentence ends. A part that ends a paragraph gets a short silence after it.
 */
export function chunkScript(input: string): Piece[] {
  const text = normalizeScript(input)
  if (!text) return []
  if (text.length <= PROBE_CHARS) return [{ text, gapAfter: 0 }]
  const first = cutAt(text, PROBE_CHARS)
  const pieces: Piece[] = [{ text: first.head, gapAfter: first.blank ? PART_GAP : 0 }]
  const paragraphs = first.rest
    .split(/\n[ \t]*\n\s*/)
    .map((p) => ({ text: p.trim(), endsPara: true }))
    .filter((p) => p.text)
  for (const u of mergeSmall(paragraphs).flatMap(splitLong))
    pieces.push({ text: u.text, gapAfter: u.endsPara ? PART_GAP : 0 })
  pieces[pieces.length - 1].gapAfter = 0
  return pieces
}

// ------------------------------------------------------------------------------ dialogue

const LETTERS = 'ABC'
const LABEL = /^\s*([ABCabc])\s*>[ \t]?/

/** Whether any line starts with a speaker label (A> B> C>). */
export const hasSpeakerLabels = (text: string): boolean => /^\s*[ABCabc]\s*>/m.test(text)

/** The text with its speaker labels dropped. */
export const stripLabels = (text: string): string =>
  text
    .split('\n')
    .map((l) => l.replace(LABEL, ''))
    .join('\n')

/** One turn of a conversation: `speaker` is 0 for A, 1 for B, 2 for C. */
export type Turn = { speaker: number; text: string }

/** "A> line" turns; a line without a label continues the turn above it (the first belongs to A). */
export function parseDialogue(text: string): Turn[] {
  const turns: Turn[] = []
  for (const raw of normalizeScript(text).split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = LABEL.exec(raw)
    if (m)
      turns.push({
        speaker: LETTERS.indexOf(m[1].toUpperCase()),
        text: raw.slice(m[0].length).trim()
      })
    else if (turns.length) {
      const last = turns[turns.length - 1]
      last.text = last.text ? `${last.text} ${line}` : line
    } else turns.push({ speaker: 0, text: line })
  }
  return turns.filter((t) => t.text)
}

/** The highest speaker a conversation uses, as a count (2 when only A and B speak). */
export const speakersUsed = (turns: Turn[]): number =>
  turns.reduce((n, t) => Math.max(n, t.speaker + 1), 0)

const labelled = (t: Turn): string => `${LETTERS[t.speaker]}> ${t.text}`

/**
 * A conversation as the parts to record, on the same plan as a script but always ending at a
 * turn (a very long turn is cut at a sentence end and its label repeated). The silence between
 * parts is the pause between speakers, none inside a cut turn.
 */
export function chunkDialogue(turns: Turn[], pause: number): Piece[] {
  if (!turns.length) return []
  const whole = turns.map(labelled).join('\n')
  if (whole.length <= PROBE_CHARS) return [{ text: whole, gapAfter: 0 }]
  const queue = turns.map((t) => ({ ...t }))
  type Line = { text: string; complete: boolean }
  /** The next line of at most `max` characters; a turn that is longer is cut and its rest stays queued. */
  const take = (max: number): Line => {
    const t = queue[0]
    const label = `${LETTERS[t.speaker]}> `
    if (label.length + t.text.length <= max) {
      queue.shift()
      return { text: label + t.text, complete: true }
    }
    const cut = cutAt(t.text, Math.max(1, max - label.length))
    if (!cut.head || !cut.rest) {
      queue.shift()
      return { text: label + t.text, complete: true }
    }
    t.text = cut.rest
    return { text: label + cut.head, complete: false }
  }
  const lineLength = (t: Turn): number => `${LETTERS[t.speaker]}> `.length + t.text.length

  // the price probe: whole turns while they fit, else the start of the first
  const probe: Line[] = []
  let size = 0
  while (queue.length) {
    if (probe.length && size + 1 + lineLength(queue[0]) > PROBE_CHARS) break
    const line = take(PROBE_CHARS)
    probe.push(line)
    size += line.text.length + (probe.length > 1 ? 1 : 0)
    if (!line.complete) break
  }
  const pieces: Piece[] = [
    {
      text: probe.map((l) => l.text).join('\n'),
      gapAfter: probe[probe.length - 1].complete ? pause : 0
    }
  ]

  const rest: Line[] = []
  while (queue.length) rest.push(take(PART_SPLIT_MAX))
  const groups: { lines: string[]; size: number; complete: boolean }[] = []
  const join = (
    g: { lines: string[]; size: number; complete: boolean },
    l: { text: string; complete: boolean }
  ): { lines: string[]; size: number; complete: boolean } => ({
    lines: [...g.lines, l.text],
    size: g.size + 1 + l.text.length,
    complete: l.complete
  })
  for (const l of rest) {
    const last = groups[groups.length - 1]
    if (
      last &&
      last.size < PART_MERGE_MIN &&
      last.complete &&
      last.size + 1 + l.text.length <= PART_SPLIT_MAX
    )
      groups[groups.length - 1] = join(last, l)
    else groups.push({ lines: [l.text], size: l.text.length, complete: l.complete })
  }
  const n = groups.length
  if (
    n >= 2 &&
    groups[n - 1].size < PART_MERGE_MIN &&
    groups[n - 2].complete &&
    groups[n - 2].size + 1 + groups[n - 1].size <= PART_SPLIT_MAX
  ) {
    const merged = {
      lines: [...groups[n - 2].lines, ...groups[n - 1].lines],
      size: groups[n - 2].size + 1 + groups[n - 1].size,
      complete: groups[n - 1].complete
    }
    groups.splice(n - 2, 2, merged)
  }
  for (const g of groups)
    pieces.push({ text: g.lines.join('\n'), gapAfter: g.complete ? pause : 0 })
  pieces[pieces.length - 1].gapAfter = 0
  return pieces
}

// ------------------------------------------------------------------------------ words

const hasLetter = (s: string): boolean => /[\p{L}\p{N}]/u.test(s)
const UNSPACED = /^(?:zh|ja|th|lo|km|my|chinese|japanese|thai|lao|khmer|burmese)\b/i

/**
 * A script's words as whitespace tokens with their punctuation attached, like a transcript's
 * (speaker labels dropped; a lone dash or emoji joins the word next to it). Languages written
 * without spaces are split at word boundaries instead.
 */
export function wordsFromScript(text: string, language = ''): string[] {
  const body = stripLabels(normalizeScript(text))
  let raw: string[]
  if (UNSPACED.test(language.trim()) && typeof Intl.Segmenter === 'function') {
    raw = []
    let open = false
    for (const s of new Intl.Segmenter(language, { granularity: 'word' }).segment(body)) {
      if (s.isWordLike) {
        raw.push(s.segment)
        open = true
      } else if (!s.segment.trim()) open = false
      else if (open && raw.length) raw[raw.length - 1] += s.segment
      else raw.push(s.segment)
    }
  } else raw = body.split(/\s+/)
  const out: string[] = []
  let carry = ''
  for (const tok of raw) {
    if (!tok) continue
    if (!hasLetter(tok)) {
      if (out.length) out[out.length - 1] += tok
      else carry += tok
    } else {
      out.push(carry + tok)
      carry = ''
    }
  }
  return out
}

// ------------------------------------------------------------------------------ pronunciation

/** One pronunciation rule, in the shape ai33's dictionaries take. */
export type Rule = {
  from: string
  to: string
  matchType: 'word' | 'contains'
  caseSensitive: boolean
}

/** The words to say a certain way as clean rules: no blanks, no repeats, always in the same order. */
export function normalizeSay(say: Say[]): Rule[] {
  const seen = new Set<string>()
  const rules: Rule[] = []
  for (const s of say) {
    const from = s.word.trim()
    const to = s.as.trim()
    if (!from || !to || from === to) continue
    const matchType = s.wholeWord === false ? 'contains' : 'word'
    // "AI" or "Apple" is written that way on purpose ("ai" is a word in Italian, "apple" a fruit)
    const caseSensitive = /\p{Lu}/u.test(from)
    const key = `${matchType}:${caseSensitive ? from : from.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rules.push({ from, to, matchType, caseSensitive })
  }
  return rules.sort(
    (a, b) =>
      a.from.toLowerCase().localeCompare(b.from.toLowerCase()) ||
      a.matchType.localeCompare(b.matchType)
  )
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])'
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}_])'

const ruleSource = (r: Rule): string =>
  r.matchType === 'word'
    ? `${WORD_EDGE_BEFORE}${escapeRe(r.from)}${WORD_EDGE_AFTER}`
    : escapeRe(r.from)

/** The rules that occur in `text` (only these can change how a part sounds, so only these name its hash). */
export function rulesFor(text: string, rules: Rule[]): Rule[] {
  return rules.filter((r) => new RegExp(ruleSource(r), r.caseSensitive ? 'u' : 'iu').test(text))
}

const OPEN = String.fromCharCode(0xe000)
const CLOSE = String.fromCharCode(0xe001)

/**
 * The text with the rules applied (when ai33's dictionary can't do it): the longest match wins,
 * and what one rule writes is never matched by another.
 */
export function replaceLocal(text: string, rules: Rule[], labelledLines = false): string {
  if (!rules.length) return text
  const byLength = [...rules].sort((a, b) => b.from.length - a.from.length)
  const swap = (s: string): string => {
    let out = s
    byLength.forEach((r, i) => {
      out = out.replace(
        new RegExp(ruleSource(r), r.caseSensitive ? 'gu' : 'giu'),
        () => `${OPEN}${i}${CLOSE}`
      )
    })
    return out.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_m, i) => byLength[Number(i)].to)
  }
  return labelledLines
    ? text
        .split('\n')
        .map((l) => {
          const m = LABEL.exec(l)
          return m ? l.slice(0, m[0].length) + swap(l.slice(m[0].length)) : swap(l)
        })
        .join('\n')
    : swap(text)
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

/** A short name for a set of rules: the same words always give the same name. */
export const rulesHash8 = (rules: Rule[]): string =>
  sha256(JSON.stringify(rules.map((r) => [r.from, r.to, r.matchType, r.caseSensitive]))).slice(0, 8)

// ------------------------------------------------------------------------------ hashing

/** Everything that decides how a recorded part sounds; the same request names the same file. */
export type PartKey = {
  kind: 'speech' | 'dialogue'
  /** What is sent (the pronunciation replaced when it is done here, not by a dictionary). */
  text: string
  voices: { id: string; speed: number }[]
  /** The silence between speakers (dialogue only). */
  delay: number
  withTranscript: boolean
  /** The dictionary rules in effect, or null (none apply, or they are already in the text). */
  rules: Rule[] | null
  /** The text carries the pronunciation replacements itself. */
  local: boolean
}

export function partHash(k: PartKey): string {
  return sha256(
    JSON.stringify([
      1,
      k.kind,
      k.text,
      k.voices.map((v) => [v.id, v.speed]),
      k.delay,
      k.withTranscript,
      k.rules?.map((r) => [r.from, r.to, r.matchType, r.caseSensitive]) ?? null,
      k.local
    ])
  )
}

/** The hash of a whole recording: its parts' hashes and the silences between them. */
export const wholeHash = (partHashes: string[], gaps: number[]): string =>
  sha256(JSON.stringify([1, 'whole', partHashes, gaps.map((g) => g.toFixed(2))]))

// ------------------------------------------------------------------------------ timing ladder

/** A word of the script with its time in the recording, in seconds. */
export type Timed = { text: string; start: number; end: number }
type Heard = { text: string; start: number; end: number }

const r3 = (n: number): number => Math.round(n * 1000) / 1000

/** Below this many cells the alignment is exact; a bigger one is spread evenly. */
const ALIGN_CELLS = 4_000_000

const norm = (t: string): string =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '')

const same = (a: string, b: string): boolean =>
  a !== '' &&
  b !== '' &&
  (a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))))

/** For each word of `a`, the index of the word of `b` it lines up with (longest common run), or -1. */
export function alignWords(a: string[], b: string[]): number[] {
  const n = a.length
  const m = b.length
  const out = new Array<number>(n).fill(-1)
  if (!n || !m) return out
  if (n * m > ALIGN_CELLS) {
    for (let i = 0; i < n; i++)
      out[i] = Math.min(m - 1, Math.round((i * (m - 1)) / Math.max(1, n - 1)))
    return out
  }
  const x = a.map(norm)
  const y = b.map(norm)
  const w = m + 1
  const dp = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = same(x[i], y[j])
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (same(x[i], y[j])) out[i++] = j++
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
  return out
}

/** A word's share of the time: its letters, and a pause after a comma or a sentence end. */
function weight(token: string): { w: number; p: number } {
  const letters = [...token.replace(/[^\p{L}\p{N}]/gu, '')].length
  const p = /[.!?…。！？]["'”’»)\]]*$/u.test(token)
    ? 5
    : /[,;:—–、，；：]["'”’»)\]]*$/u.test(token)
      ? 2.5
      : 0
  return { w: 1 + letters, p }
}

/** The words spread over [from, to] by length, with room for the pauses. */
function spread(tokens: string[], from: number, to: number): Timed[] {
  const ws = tokens.map(weight)
  const total = ws.reduce((s, x, i) => s + x.w + (i < ws.length - 1 ? x.p : 0), 0)
  const unit = total > 0 ? Math.max(0, to - from) / total : 0
  let t = from
  return tokens.map((text, i) => {
    const start = t
    const end = start + ws[i].w * unit
    t = end + ws[i].p * unit
    return { text, start, end }
  })
}

/** Times in order and inside the recording, whatever the source did. */
function tidy(words: Timed[], seconds: number): Timed[] {
  let prev = 0
  return words.map((w) => {
    const start = Math.min(Math.max(w.start, prev, 0), seconds)
    const end = Math.min(Math.max(w.end, start), seconds)
    prev = start
    return { text: w.text, start: r3(start), end: r3(end) }
  })
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : null

const pick = (o: Ai33Raw, keys: string[]): unknown =>
  keys.map((k) => o[k]).find((v) => v !== undefined && v !== null)

function heardEntry(o: Ai33Raw): Heard | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const text = pick(o, ['text', 'word', 'token', 'value', 'content'])
  const start = num(pick(o, ['start', 'start_time', 'startTime', 'start_ms', 'startMs', 'begin']))
  const end = num(pick(o, ['end', 'end_time', 'endTime', 'end_ms', 'endMs', 'finish']))
  if (typeof text !== 'string' || start === null || end === null) return null
  return { text, start, end }
}

/** Times per character (ElevenLabs style) as times per word. */
function fromCharacters(o: Ai33Raw): Heard[] | null {
  const chars = o.characters
  const starts = o.character_start_times_seconds ?? o.character_start_times
  const ends = o.character_end_times_seconds ?? o.character_end_times
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return null
  if (!chars.length || chars.length !== starts.length || starts.length !== ends.length) return null
  const out: Heard[] = []
  let cur = ''
  let s = 0
  let e = 0
  const flush = (): void => {
    if (cur) out.push({ text: cur, start: s, end: e })
    cur = ''
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = String(chars[i])
    if (/^\s+$/.test(ch)) flush()
    else {
      if (!cur) s = num(starts[i]) ?? e
      cur += ch
      e = num(ends[i]) ?? e
    }
  }
  flush()
  return out.length ? out : null
}

/** The timed words wherever a transcript keeps them: words[], segments[].words[], a bare array. */
function findWords(node: unknown, depth = 0): Heard[] | null {
  if (!node || typeof node !== 'object' || depth > 5) return null
  if (Array.isArray(node)) {
    const inner = node.filter(
      (n: Ai33Raw) => n && typeof n === 'object' && Array.isArray(n.words)
    ) as Ai33Raw[]
    if (inner.length) {
      const all = inner.flatMap((n) => findWords(n.words, depth + 1) ?? [])
      return all.length ? all : null
    }
    const direct = node.map(heardEntry).filter((e): e is Heard => e !== null)
    if (direct.length && direct.length >= node.length * 0.8)
      return direct.filter((e) => e.text.trim())
    for (const item of node) {
      const found = findWords(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const o = node as Ai33Raw
  const chars = fromCharacters(o)
  if (chars) return chars
  const keys = Object.keys(o).sort((a, b) => (a === 'words' ? -1 : b === 'words' ? 1 : 0))
  for (const k of keys) {
    const found = findWords(o[k], depth + 1)
    if (found) return found
  }
  return null
}

const withinShare = (count: number, of: number): boolean => Math.abs(count - of) <= of * 0.15

/** Tier 1: ai33's own word times, laid over the script's words (its spelling wins). */
function fromWordTimes(tokens: string[], json: unknown, seconds: number): Timed[] | null {
  const found = findWords(json)
  if (!found?.length || !withinShare(found.length, tokens.length)) return null
  const last = found.reduce((m, h) => Math.max(m, h.end), 0)
  // milliseconds, not seconds: the last word ends far beyond the recording's length
  const k = last > Math.max(seconds * 20, 100) ? 0.001 : 1
  const heard = found.map((h) => ({ text: h.text, start: h.start * k, end: h.end * k }))
  let prev = -Infinity
  for (const h of heard) {
    if (h.end < h.start || h.start < prev - 0.001 || h.start < -0.05) return null
    prev = h.start
  }
  if (heard[heard.length - 1].end > seconds + 0.5 || heard[heard.length - 1].end <= heard[0].start)
    return null
  const pairs = alignWords(
    tokens,
    heard.map((h) => h.text)
  )
  const out: Timed[] = tokens.map((text, i) => ({
    text,
    start: pairs[i] >= 0 ? heard[pairs[i]].start : NaN,
    end: pairs[i] >= 0 ? heard[pairs[i]].end : NaN
  }))
  // words ai33 didn't give (a number spelled out, a joined word) share the time between their neighbours
  let i = 0
  while (i < out.length) {
    if (!Number.isNaN(out[i].start)) {
      i++
      continue
    }
    let k2 = i
    while (k2 < out.length && Number.isNaN(out[k2].start)) k2++
    const from = i > 0 ? out[i - 1].end : Math.min(heard[0].start, seconds)
    const to = k2 < out.length ? out[k2].start : seconds
    const filled = spread(
      out.slice(i, k2).map((w) => w.text),
      from,
      Math.max(from, to)
    )
    for (let x = i; x < k2; x++) out[x] = filled[x - i]
    i = k2
  }
  return tidy(out, seconds)
}

export type Cue = { start: number; end: number; text: string }

const STAMP = /(\d+):(\d\d):(\d\d)[,.](\d{1,3})/g

/** The cues of an SRT file (times in seconds), or none when it isn't one. */
export function parseSrt(srt: string): Cue[] {
  const cues: Cue[] = []
  for (const block of srt
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at < 0) continue
    const stamps = [...lines[at].matchAll(STAMP)].map(
      (m) =>
        Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
    )
    if (stamps.length < 2) continue
    const text = lines
      .slice(at + 1)
      .join(' ')
      .replace(/<[^>]*>|\{[^}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) cues.push({ start: stamps[0], end: stamps[1], text })
  }
  return cues
}

/** Tier 2: ai33's subtitles; each cue's time is shared among its words by their length. */
function fromCues(tokens: string[], srt: string, seconds: number): Timed[] | null {
  const cues = parseSrt(srt)
  if (!cues.length) return null
  let prev = -Infinity
  for (const c of cues) {
    if (c.end < c.start || c.start < prev - 0.001) return null
    prev = c.start
  }
  if (cues[cues.length - 1].end > seconds + 0.5) return null
  const heard = cues.flatMap((c, cue) => wordsFromScript(c.text).map((text) => ({ text, cue })))
  if (!withinShare(heard.length, tokens.length)) return null
  const pairs = alignWords(
    tokens,
    heard.map((h) => h.text)
  )
  // each word belongs to the cue it lined up with; the ones that didn't stay with the word before
  const cueOf = new Array<number>(tokens.length).fill(-1)
  let current = -1
  for (let i = 0; i < tokens.length; i++) {
    if (pairs[i] >= 0) current = heard[pairs[i]].cue
    cueOf[i] = current
  }
  const firstKnown = cueOf.find((c) => c >= 0) ?? 0
  const out: Timed[] = []
  let i = 0
  while (i < tokens.length) {
    const cue = cueOf[i] < 0 ? firstKnown : cueOf[i]
    let k = i
    while (k < tokens.length && (cueOf[k] < 0 ? firstKnown : cueOf[k]) === cue) k++
    out.push(...spread(tokens.slice(i, k), cues[cue].start, cues[cue].end))
    i = k
  }
  return tidy(out, seconds)
}

/** Where speech starts and ends in a recording (its leading and trailing silence trimmed). */
export type Region = { from: number; to: number }

export type LadderIn = {
  /** The part's own words: wordsFromScript of what was recorded. */
  tokens: string[]
  /** The recording's length. */
  seconds: number
  /** ai33's word timing (the parsed transcript file), when it gave one. */
  json?: unknown
  /** ai33's subtitles (SRT text), when it gave them. */
  srt?: string
  /** Asked only when neither timing is usable. */
  region?: () => Promise<Region | null>
}

/**
 * The time of every word of one recorded part, from the best source that checks out: ai33's word
 * times, else its subtitle cues, else the words spread over the speech by length. The tier says
 * which one, so a caption that drifts can be explained.
 */
export async function timingLadder(o: LadderIn): Promise<{ words: Timed[]; tier: SpeechTiming }> {
  if (!o.tokens.length) return { words: [], tier: 'proportional' }
  if (o.json !== undefined && o.json !== null) {
    const words = fromWordTimes(o.tokens, o.json, o.seconds)
    if (words) return { words, tier: 'words' }
  }
  if (o.srt) {
    const words = fromCues(o.tokens, o.srt, o.seconds)
    if (words) return { words, tier: 'cues' }
  }
  const region = (await o.region?.().catch(() => null)) ?? null
  const from = region ? Math.min(Math.max(0, region.from), o.seconds) : 0
  const to = region && region.to > from ? Math.min(region.to, o.seconds) : o.seconds
  return { words: tidy(spread(o.tokens, from, to), o.seconds), tier: 'proportional' }
}

/** The weakest timing among the parts is what the whole script can be trusted to. */
export function worstTier(tiers: SpeechTiming[]): SpeechTiming {
  const order: SpeechTiming[] = ['words', 'cues', 'proportional']
  return tiers.reduce<SpeechTiming>(
    (w, t) => (order.indexOf(t) > order.indexOf(w) ? t : w),
    'words'
  )
}
