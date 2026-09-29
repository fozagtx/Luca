import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { placeWords } from '../shared/captions'
import type { CleanResult, CleanStatus, Cut, Edl, Project, Transcript } from '../shared/types'
import { activeAgent, agentFor } from './agent'
import { isScriptProject } from './ai33-store'
import { hasTranscript, refreshCaptions } from './captions'
import { speechClips } from './captions-html'
import { unescapeAttr } from './timeline-read'
import { ffmpegProgress, probeMedia } from './env'
import { AUDIO_EXT } from './footage'
import { closingOffset, findTagById, findTags, replaceTag, setAttrs, type TagMatch } from './html'
import { Channels, broadcast } from './ipc'
import { refitBeds } from './place'
import { insertAudio, rowFor } from './place-html'
import { hasSecret } from './secrets'
import { getSettings } from './settings'
import { extractAudio, isFiller, transcribe } from './transcribe'
import { checkpoint } from './versions'

const MAX_PAUSE = 0.6
const KEEP_PAUSE = 0.25
const PAD = 0.02
const MIN_KEPT = 0.1
const JOIN_FADE = 0.01
/** A clean master in the project, as clips on the timeline name it. */
const CLEAN_FILE = /^media\/clean-[0-9a-f]+\.mp4$/

let status: CleanStatus = { stage: 'idle' }
let task: CleanStatus['task'] = 'clean'
let lastPush = 0
export function cleanStatus(): CleanStatus {
  return status
}
/** Stage changes go out at once; progress within a stage at most every 100 ms. */
function setStatus(s: Omit<CleanStatus, 'task' | 'since'>): void {
  const now = Date.now()
  const sameStage = s.stage === status.stage
  status = { ...s, task, since: sameStage && status.since ? status.since : now }
  if (sameStage && s.progress !== 1 && now - lastPush < 100) return
  lastPush = now
  broadcast(Channels.cleanStatusPush, status)
}
const busy = (): boolean =>
  status.stage !== 'idle' && status.stage !== 'done' && status.stage !== 'error'

export function sourcePath(p: Project): string | null {
  // projects started from images or from scratch have no source
  if (!p.source) return null
  for (const f of [join(p.dir, 'media', p.source), join(p.dir, p.source)]) {
    if (existsSync(f)) return f
  }
  return null
}

/** The panel shows the original (pre-cut) words so cut spans can be shaded; falls back to transcript.json. */
export function readTranscript(dir: string): Transcript | null {
  const orig = join(dir, '.luca', 'transcript.original.json')
  const f = existsSync(orig) ? orig : join(dir, 'transcript.json')
  if (!existsSync(f)) return null
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Transcript | Transcript['words']
    const words = Array.isArray(raw) ? raw : raw.words
    return { words: words.map((w) => (isFiller(w.text) ? { ...w, filler: true } : w)) }
  } catch {
    return null
  }
}

export function readEdl(dir: string): Edl | null {
  const f = join(dir, 'edl.json')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as Edl
  } catch {
    return null
  }
}

/** Deterministic cut proposals: every filler ±20 ms, every pause over 0.6 s shortened to 0.25 s. */
export function cutCandidates(t: Transcript, duration: number): Cut[] {
  const cuts: Cut[] = []
  const words = t.words
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (isFiller(w.text)) {
      cuts.push({
        start: Math.max(0, w.start - PAD),
        end: Math.min(duration, w.end + PAD),
        reason: 'filler',
        text: w.text
      })
    }
    const next = words[i + 1]
    const gapEnd = next ? next.start : duration
    const gap = gapEnd - w.end
    if (gap > MAX_PAUSE) {
      cuts.push({
        start: w.end + KEEP_PAUSE / 2,
        end: gapEnd - KEEP_PAUSE / 2,
        reason: 'pause',
        text: `${gap.toFixed(2)}s pause`
      })
    }
  }
  return mergeCuts(cuts)
}

/** Overlapping cuts as one; with `gap`, also cuts that would leave less than that between them. */
function mergeCuts(cuts: Cut[], gap = 0): Cut[] {
  const sorted = [...cuts].sort((a, b) => a.start - b.start)
  const out: Cut[] = []
  for (const c of sorted) {
    const last = out[out.length - 1]
    if (last && (c.start <= last.end || c.start - last.end < gap)) {
      last.end = Math.max(last.end, c.end)
      if (last.reason !== c.reason) last.reason = last.reason === 'pause' ? c.reason : last.reason
      last.text = last.text === c.text ? last.text : `${last.text} ${c.text}`.trim()
    } else out.push({ ...c })
  }
  return out
}

export function validateEdl(edl: Edl, duration: number): string | null {
  if (edl.version !== 1) return 'edl.json version must be 1'
  if (!Array.isArray(edl.cuts)) return 'edl.json cuts must be an array'
  const sorted = [...edl.cuts].sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const c of sorted) {
    if (!(c.end > c.start)) return `cut ${c.start}–${c.end} has no length`
    if (c.start < 0 || c.end > duration + 0.01)
      return `cut ${c.start}–${c.end} is outside the clip (0–${duration})`
    if (c.start < cursor) return `cut at ${c.start} overlaps the previous cut`
    if (c.start - cursor > 0 && c.start - cursor < MIN_KEPT && cursor > 0)
      return `kept piece ${cursor}–${c.start} is shorter than ${MIN_KEPT}s`
    cursor = c.end
  }
  return null
}

function keptSegments(cuts: Cut[], duration: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let cursor = 0
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    if (c.start > cursor) out.push({ start: cursor, end: c.start })
    cursor = Math.max(cursor, c.end)
  }
  if (duration > cursor) out.push({ start: cursor, end: duration })
  return out
}

const probe = probeMedia

/**
 * ffmpeg: trim kept segments, 10 ms audio fades at every join, concat, VideoToolbox H.264 + AAC.
 * A voiceover (no picture) becomes an audio-only MP4, found and relinked like any clean master.
 */
async function renderClean(
  source: string,
  segs: { start: number; end: number }[],
  bitrate: number,
  out: string,
  onProgress: (p: number) => void,
  audioOnly = false
): Promise<void> {
  const parts: string[] = []
  const labels: string[] = []
  segs.forEach((s, i) => {
    const len = s.end - s.start
    if (!audioOnly) parts.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`)
    parts.push(
      `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${JOIN_FADE},afade=t=out:st=${Math.max(0, len - JOIN_FADE)}:d=${JOIN_FADE}[a${i}]`
    )
    labels.push(audioOnly ? `[a${i}]` : `[v${i}][a${i}]`)
  })
  parts.push(
    audioOnly
      ? `${labels.join('')}concat=n=${segs.length}:v=0:a=1[a]`
      : `${labels.join('')}concat=n=${segs.length}:v=1:a=1[v][a]`
  )
  const kbps = bitrate > 0 ? Math.max(1000, Math.round(bitrate / 1000)) : 8000
  const args = [
    '-y',
    '-v',
    'error',
    '-i',
    source,
    '-filter_complex',
    parts.join(';'),
    ...(audioOnly ? [] : ['-map', '[v]']),
    '-map',
    '[a]',
    ...(audioOnly ? [] : ['-c:v', 'h264_videotoolbox', '-b:v', `${kbps}k`, '-pix_fmt', 'yuv420p']),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    out
  ]
  const kept = segs.reduce((n, s) => n + (s.end - s.start), 0)
  const r = await ffmpegProgress(args, kept, onProgress, { timeoutMs: 3_600_000 })
  if (r.code !== 0 || !existsSync(out)) throw new Error(`ffmpeg failed: ${r.stderr.slice(-800)}`)
}

/** Each kept word moves back by the total cut before it; words inside a cut are dropped. */
export function remap(original: Transcript, cuts: Cut[]): Transcript {
  const sorted = [...cuts].sort((a, b) => a.start - b.start)
  const words = original.words
    .filter((w) => !sorted.some((c) => w.start >= c.start - 1e-3 && w.end <= c.end + 1e-3))
    .map((w) => {
      const shift = sorted
        .filter((c) => c.end <= w.start + 1e-3)
        .reduce((acc, c) => acc + (c.end - c.start), 0)
      return {
        ...w,
        start: Math.round((w.start - shift) * 1000) / 1000,
        end: Math.round((w.end - shift) * 1000) / 1000
      }
    })
  return { words }
}

/** The clean master's name for a set of cuts: rendering is cached by it. */
function cleanFileFor(cuts: Cut[], source: string): string {
  const hash = createHash('sha1').update(JSON.stringify(cuts)).update(source).digest('hex')
  return `media/clean-${hash.slice(0, 10)}.mp4`
}

/** Which cuts made the clean master that is on the timeline, recorded when it was applied. */
const appliedFile = (dir: string): string => join(dir, '.luca', 'clean-applied.json')

function cutsOf(p: Project, cleanRel: string): Cut[] | null {
  try {
    const a = JSON.parse(readFileSync(appliedFile(p.dir), 'utf8')) as { file: string; cuts: Cut[] }
    if (a.file === cleanRel) return a.cuts
  } catch {
    // projects cleaned before this was recorded: edl.json still holds its cuts unless redone
  }
  const edl = readEdl(p.dir)
  const cuts = edl ? mergeCuts(edl.cuts) : null
  return cuts && cleanFileFor(cuts, p.source) === cleanRel ? cuts : null
}

/** A moment in the source → the same moment in the clean master (a cut-out moment → where the cut is). */
function toClean(t: number, cuts: Cut[]): number {
  let out = t
  for (const c of cuts) if (t > c.start) out -= Math.min(t, c.end) - c.start
  return out
}

/** A moment in a clean master → the source; `end` picks the earlier side of a join. */
function toSource(t: number, cuts: Cut[], end: boolean): number {
  let clean = 0
  const segs = keptSegments(cuts, Number.POSITIVE_INFINITY)
  for (const s of segs) {
    const len = s.end - s.start
    if (t < clean + len || (end && t <= clean + len)) return s.start + (t - clean)
    clean += len
  }
  return segs.length ? segs[segs.length - 1].end : t
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Point every clip of the source (or of an earlier clean master) at the new clean master. Each
 * piece keeps the part of the video it showed, minus what was cut from it. Everything else on the
 * timeline follows the speech: a title inside a piece moves with the words under it, and clips
 * after a piece (chained footage, music, outros) move earlier by the time that piece lost, so the
 * video shortens by exactly the cuts.
 */
function relink(p: Project, cleanRel: string, cuts: Cut[], duration: number): void {
  const indexFile = join(p.dir, 'index.html')
  let html = readFileSync(indexFile, 'utf8')
  const tags = findTags(html)
  const root = tags.find((t) => t.attrs['data-composition-id'] !== undefined)
  // times inside a scene or group are its own, not the timeline's: only top-level clips move
  const holders = tags
    .filter(
      (t) =>
        t !== root &&
        (t.attrs['data-composition-id'] !== undefined || t.attrs['data-start'] !== undefined)
    )
    .map((t) => ({ from: t.end, to: closingOffset(html, t)?.start ?? t.end }))
  const topLevel = (t: TagMatch): boolean =>
    !holders.some((h) => t.start >= h.from && t.start < h.to)

  const sourceRels = new Set([p.source, `media/${p.source}`])
  type Piece = {
    tag: TagMatch
    start: number
    end: number
    mediaStart: number
    /** The cuts behind the file it plays now ([] for the source), null when unknown. */
    before: Cut[] | null
    newMediaStart: number
    newLength: number
  }
  const pieces: Piece[] = []
  for (const tag of tags) {
    if ((tag.name !== 'video' && tag.name !== 'audio') || !topLevel(tag)) continue
    // the parser hands back what is written: "Q&amp;A.mp3" is the source "Q&A.mp3"
    const src = unescapeAttr(tag.attrs.src ?? '')
    const isSource = sourceRels.has(src)
    if (!isSource && !CLEAN_FILE.test(src)) continue
    const before = isSource ? [] : cutsOf(p, src)
    const start = num(tag.attrs['data-start'], 0)
    const mediaStart = num(tag.attrs['data-media-start'], 0)
    const length = num(tag.attrs['data-duration'], duration)
    let newMediaStart = 0
    let newLength = duration
    if (before) {
      newMediaStart = toClean(toSource(mediaStart, before, false), cuts)
      const to = toClean(toSource(mediaStart + length, before, true), cuts)
      newLength = Math.max(0, Math.min(duration, to) - newMediaStart)
    }
    // an earlier master whose cuts weren't recorded (cleaned before they were) becomes the whole new one
    pieces.push({ tag, start, end: start + length, mediaStart, before, newMediaStart, newLength })
  }
  if (!pieces.length) return

  // a video and its own audio (even trimmed a little differently) are one stretch of time
  type Stretch = { start: number; end: number; rep: Piece; delta: number }
  const stretches: Stretch[] = []
  for (const x of [...pieces].sort((a, b) => a.start - b.start)) {
    const last = stretches[stretches.length - 1]
    if (last && x.start < last.end - 1e-3) {
      if (x.end > last.end) Object.assign(last, { end: x.end, rep: x })
    } else stretches.push({ start: x.start, end: x.end, rep: x, delta: 0 })
  }
  for (const s of stretches) s.delta = s.rep.newLength - (s.rep.end - s.rep.start)
  const lostBefore = (t: number): number =>
    stretches.reduce((acc, s) => (s.end <= t + 1e-3 ? acc + s.delta : acc), 0)
  /** Where a moment of the timeline goes: with the speech inside a piece, earlier after it. */
  const moved = (t: number): number => {
    const s = stretches.find((s) => t > s.start + 1e-3 && t < s.end - 1e-3)
    if (!s) return t + lostBefore(t)
    const r = s.rep
    const at = r.mediaStart + (t - r.start)
    const now = r.before ? toClean(toSource(at, r.before, false), cuts) : at
    return r.start + lostBefore(r.start) + Math.max(0, now - r.newMediaStart)
  }

  const edits = new Map<number, string>()
  for (const x of pieces) {
    const start = x.start + lostBefore(x.start)
    edits.set(
      x.tag.start,
      setAttrs(x.tag, {
        src: cleanRel,
        'data-duration': String(r3(x.newLength)),
        ...(start !== x.start ? { 'data-start': String(r3(start)) } : {}),
        ...(x.newMediaStart > 0 || x.tag.attrs['data-media-start'] !== undefined
          ? { 'data-media-start': String(r3(x.newMediaStart)) }
          : {})
      })
    )
  }
  for (const tag of tags) {
    if (edits.has(tag.start) || tag === root || !topLevel(tag)) continue
    if (tag.attrs['data-track-index'] === undefined || tag.attrs['data-start'] === undefined)
      continue
    const start = num(tag.attrs['data-start'], 0)
    const next = r3(Math.max(0, moved(start)))
    if (next !== start) edits.set(tag.start, setAttrs(tag, { 'data-start': String(next) }))
  }
  for (const tag of [...tags].sort((a, b) => b.start - a.start)) {
    const raw = edits.get(tag.start)
    if (raw !== undefined) html = replaceTag(html, tag, raw)
  }
  const total = stretches.reduce((acc, s) => acc + s.delta, 0)
  html = html.replace(
    /(<div[^>]*data-composition-id="[^"]+"[^>]*data-duration=")([^"]*)(")/,
    (_, a: string, d: string, b: string) => `${a}${r3(Math.max(0.1, num(d, duration) + total))}${b}`
  )
  writeFileSync(indexFile, html)
}

const readIndex = (dir: string): string => readFileSync(join(dir, 'index.html'), 'utf8')

/** A voiceover has no picture: its clean master is sound only. */
const isAudioOnly = (source: string): boolean => AUDIO_EXT.has(extname(source).toLowerCase())

/** The clean master the timeline plays, or null before a clean edit (or after it was undone). */
function cleanOnTimeline(html: string): string | null {
  const clip = [...findTags(html, 'video'), ...findTags(html, 'audio')].find((t) =>
    CLEAN_FILE.test(t.attrs.src ?? '')
  )
  return clip?.attrs.src ?? null
}

/**
 * A voiceover project starts with the recording next to an empty timeline (init leaves no clip for
 * it): put it on at 0 s, so its words, cuts and captions have somewhere to play, and make the
 * video at least as long. Does nothing for footage, or once any clip plays the recording.
 * Returns whether it was placed.
 */
export async function placeVoiceover(p: Project): Promise<boolean> {
  const source = sourcePath(p)
  if (!source || !isAudioOnly(source)) return false
  const indexFile = join(p.dir, 'index.html')
  const html = readFileSync(indexFile, 'utf8')
  if (speechClips(html, p.source).length) return false
  const duration = r3((await probe(source)).duration)
  if (!(duration > 0)) return false
  const id = findTagById(html, 'voiceover') ? 'luca-voiceover' : 'voiceover'
  const src = relative(p.dir, source).split(sep).join('/')
  let out: string
  try {
    // the same markup and row rules as every sound Luca places, so the timeline can name the row
    out = insertAudio(html, {
      file: src,
      role: 'voice',
      start: 0,
      row: rowFor(html, 'voice', 0, duration),
      duration,
      volume: 1,
      id,
      title: 'Voiceover',
      extendRoot: true
    }).html
  } catch {
    // no composition to put it in
    return false
  }
  writeFileSync(indexFile, out)
  return true
}

const OFF_TIMELINE = 'The original clip is no longer on the timeline, so there is nothing to cut.'

/**
 * Steps 7–10 of the spec: validate, ffmpeg apply (cached by hash), remap captions, relink.
 * `checkpoint: false` leaves the version to the caller, e.g. Luca's turn, which is saved as one
 * version when it ends; once `signal` stops that turn, the render is kept but nothing changes.
 */
export async function applyEdl(
  p: Project,
  edl: Edl,
  opts: { checkpoint?: boolean; signal?: AbortSignal } = {}
): Promise<CleanResult> {
  const source = sourcePath(p)
  if (!source) throw new Error(`Source ${p.source} not found`)
  const { duration, bitrate } = await probe(source)
  const err = validateEdl(edl, duration)
  if (err) throw new Error(`Invalid edl.json: ${err}`)
  // relinking needs a clip playing the recording; without one the cut would change nothing
  await placeVoiceover(p)
  if (!speechClips(readIndex(p.dir), p.source).length) throw new Error(OFF_TIMELINE)
  const cuts = mergeCuts(edl.cuts)
  const cleanRel = cleanFileFor(cuts, p.source)
  const out = join(p.dir, cleanRel)
  mkdirSync(join(p.dir, 'media'), { recursive: true })
  setStatus({ stage: 'applying', message: `${cuts.length} cuts`, progress: 0 })
  if (!existsSync(out) || statSync(out).size === 0) {
    const segs = keptSegments(cuts, duration)
    if (!segs.length) throw new Error('The EDL cuts the whole clip')
    await renderClean(
      source,
      segs,
      bitrate,
      out,
      (progress) => setStatus({ stage: 'applying', message: `${cuts.length} cuts`, progress }),
      isAudioOnly(source)
    )
  }
  if (opts.signal?.aborted) throw new Error('Stopped')
  const original =
    (existsSync(join(p.dir, '.luca', 'transcript.original.json'))
      ? (JSON.parse(
          readFileSync(join(p.dir, '.luca', 'transcript.original.json'), 'utf8')
        ) as Transcript)
      : null) ?? readTranscript(p.dir)
  if (original)
    writeFileSync(join(p.dir, 'transcript.json'), JSON.stringify(remap(original, cuts), null, 2))
  setStatus({ stage: 'relinking' })
  const newDuration = Math.round((await probe(out)).duration * 1000) / 1000
  writeFileSync(join(p.dir, 'edl.json'), JSON.stringify({ ...edl, cuts }, null, 2))
  relink(p, cleanRel, cuts, newDuration)
  writeFileSync(appliedFile(p.dir), JSON.stringify({ file: cleanRel, cuts }, null, 2))
  // music that now outlasts the shorter video is shortened with it, in the same version
  try {
    await refitBeds(p)
  } catch (err) {
    console.warn('[clean] fitting the music to the cut video failed', err)
  }
  // captions on the timeline follow the cut words; saved in the same version as the cut
  try {
    refreshCaptions(p)
  } catch (err) {
    console.warn('[clean] re-timing captions failed', err)
  }
  if (opts.checkpoint !== false) await checkpoint(p.dir, `Clean edit: ${cuts.length} cuts`)
  setStatus({ stage: 'done', message: `${cuts.length} cuts · ${cleanRel}` })
  return { cuts: cuts.length, cleanFile: cleanRel }
}

/** The full pipeline (spec steps 2–10). Step 11 (auto edit) is left to the user's next turn. */
export async function runCleanEdit(p: Project): Promise<void> {
  // a script's words are exact: there are no ums to cut, and nothing to send anywhere
  if (isScriptProject(p.dir))
    throw new Error('The words in this project are already exact, so there is nothing to cut.')
  if (busy()) throw new Error('A clean edit or transcription is already running')
  task = 'clean'
  try {
    const source = sourcePath(p)
    if (!source) throw new Error(`Source ${p.source} not found`)
    const transcript = await transcribeSource(p, source)
    setStatus({ stage: 'candidates' })
    const { duration } = await probe(source)
    const candidates = cutCandidates(transcript, duration)
    writeFileSync(join(p.dir, '.luca', 'cut-candidates.json'), JSON.stringify(candidates, null, 2))

    setStatus({ stage: 'reviewing', message: `${candidates.length} candidates` })
    const agent = activeAgent() ?? agentFor(p)
    let edl: Edl | null = null
    let feedback = ''
    for (let attempt = 0; attempt < 3 && !edl; attempt++) {
      const end = await agent.run({
        text:
          attempt === 0
            ? `Review the clean-edit cut list. \`.luca/cut-candidates.json\` holds ${candidates.length} deterministic cut candidates (fillers and long pauses) for \`${p.source}\` (${duration.toFixed(2)}s); \`transcript.json\` has word times. ` +
              'Add cuts for retakes and false starts (keep the last good take), drop any candidate that would change the meaning, and write `edl.json` at the project root:\n' +
              '```json\n{ "version": 1, "source": "' +
              p.source +
              '", "cuts": [ { "start": 3.42, "end": 3.81, "reason": "filler", "text": "um" } ] }\n```\n' +
              '`reason` is filler | pause | retake | false_start | manual; times are seconds in the source. Reply with one line summarising the cuts.'
            : `edl.json was rejected: ${feedback}. Fix edl.json and reply when done.`,
        chips: [],
        context: { cleanEdit: true }
      })
      if (end.isError) throw new Error(end.error ?? 'Claude turn failed')
      const candidate = readEdl(p.dir)
      if (!candidate) {
        feedback = 'edl.json was not written'
        continue
      }
      const err = validateEdl(candidate, duration)
      if (err) {
        feedback = err
        continue
      }
      edl = candidate
    }
    if (!edl) throw new Error(`Claude did not produce a valid edl.json (${feedback})`)
    await applyEdl(p, edl)
  } catch (err) {
    setStatus({ stage: 'error', message: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/** Extract the audio and transcribe it with AssemblyAI, reporting each stage's progress. */
async function transcribeSource(p: Project, source: string): Promise<Transcript> {
  setStatus({ stage: 'extracting', progress: 0 })
  const flac = await extractAudio(p.dir, source, (progress) =>
    setStatus({ stage: 'extracting', progress })
  )
  const keyterms = [...getSettings().keyterms, ...(readLookKeyterms(p) ?? [])]
  return transcribe(p.dir, flac, keyterms, (s) => setStatus(s))
}

/**
 * Transcribe only, for captions. After a clean edit the transcript already follows the clean
 * master (remapped), so there is nothing to do.
 */
export async function runTranscribeOnly(p: Project): Promise<void> {
  if (busy()) throw new Error('A clean edit or transcription is already running')
  task = 'transcribe'
  try {
    // a script's words are exact and already there; a cut video's follow the cuts
    if ((isScriptProject(p.dir) || readEdl(p.dir)) && existsSync(join(p.dir, 'transcript.json'))) {
      setStatus({ stage: 'done', message: 'Transcript ready' })
      return
    }
    const source = sourcePath(p)
    if (!source) throw new Error('This project has no video or audio to transcribe')
    const t = await transcribeSource(p, source)
    await checkpoint(p.dir, 'Transcribe audio')
    setStatus({ stage: 'done', message: `${t.words.length} words transcribed` })
  } catch (err) {
    setStatus({ stage: 'error', message: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

// ------------------------------------------------------------------ from Luca's own turn

type RefusedReason =
  'no-source' | 'no-key' | 'no-speech' | 'busy' | 'already-cut' | 'off-timeline' | 'script'

const REFUSED: Record<RefusedReason, string> = {
  'no-source': 'This project has no video or audio to transcribe',
  'no-key': 'AssemblyAI key missing. Add it in the Transcript tab first.',
  'no-speech': 'No speech was heard in this recording',
  busy: 'A clean edit or transcription is already running',
  'already-cut': 'A clean edit is already on the timeline',
  'off-timeline': OFF_TIMELINE,
  script: 'The words in this project are already exact, so there is nothing to transcribe or cut.'
}

/** Why Luca's transcribe or clean_edit didn't run; its tool tells Luca what to say about it. */
export class EditRefused extends Error {
  constructor(readonly reason: RefusedReason) {
    super(REFUSED[reason])
  }
}

/** A line of what is said: a sentence, or the words between two pauses. */
export type Phrase = { start: number; end: number; text: string }

/** What Luca hears: the words where they play now, as phrases. */
export type Heard = {
  words: number
  /** Length of the recording as it plays (the clean master once cut), s. */
  seconds: number
  phrases: Phrase[]
  /** False when no clip plays the recording: the times are then the recording's own. */
  onTimeline: boolean
  /** A clean edit is on the timeline: the times follow the cut video. */
  cut: boolean
  /** Before a clean edit, the recording is trimmed or moved on the timeline: its own times differ. */
  shifted: boolean
  /** The voiceover was put on the timeline just now. */
  placed: boolean
  /** The project started from several videos, and only the first one has words. */
  firstClipOnly: boolean
}

const PHRASE_PAUSE = 0.4
const PHRASE_WORDS = 18

/** Words as lines: a new one after a sentence ends, at a pause, or after a long run of words. */
function phrasesOf(words: { text: string; start: number; end: number }[]): Phrase[] {
  const out: Phrase[] = []
  let cur: typeof words = []
  words.forEach((w, i) => {
    cur.push(w)
    const next = words[i + 1]
    if (
      next &&
      !/[.!?…]["”’)]*$/.test(w.text) &&
      next.start - w.end < PHRASE_PAUSE &&
      cur.length < PHRASE_WORDS
    )
      return
    out.push({ start: cur[0].start, end: w.end, text: cur.map((x) => x.text).join(' ') })
    cur = []
  })
  return out
}

/** transcript.json as it is now (the clean master's times once cut). */
function currentWords(dir: string): Transcript['words'] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')) as
      Transcript | Transcript['words']
    return (Array.isArray(raw) ? raw : raw.words) ?? []
  } catch {
    return []
  }
}

async function heard(p: Project, placed: boolean): Promise<Heard> {
  const html = readIndex(p.dir)
  const clips = speechClips(html, p.source)
  const all = currentWords(p.dir)
  const words = clips.length ? placeWords(all, clips) : all
  const cut = cleanOnTimeline(html)
  const playing = cut ? join(p.dir, cut) : sourcePath(p)
  return {
    words: words.length,
    seconds: playing ? r3((await probe(playing)).duration) : 0,
    phrases: phrasesOf(words),
    onTimeline: clips.length > 0,
    cut: !!cut,
    shifted:
      !cut && clips.some((c) => Math.abs(c.start - c.mediaStart) > 0.01 || (c.rate ?? 1) !== 1),
    placed,
    // init's a-roll plays the first video; the others the person started from follow it
    firstClipOnly: findTags(html).some((t) => /^a-roll-\d+$/.test(t.attrs.id ?? ''))
  }
}

/**
 * Wait out a transcription the Transcript tab is running. A clean edit there can't be waited for:
 * it needs a turn of Luca's, and Luca's turn is waiting on this.
 */
async function whenFree(): Promise<void> {
  const until = Date.now() + 30 * 60_000
  while (busy() && task === 'transcribe' && Date.now() < until)
    await new Promise((r) => setTimeout(r, 500))
  if (busy()) throw new EditRefused('busy')
}

/**
 * Luca's transcribe: the words of the recording (a video or a voiceover) where they play on the
 * timeline, transcribing it first when there is no transcript yet (or with `force`), with the
 * same progress in the Transcript tab as its own Transcribe. Makes no version of its own: Luca's
 * turn is saved as one when it ends.
 */
export async function transcribeInTurn(p: Project, opts: { force?: boolean } = {}): Promise<Heard> {
  // the words are exact: reading them again is free, transcribing them again would only change them
  if (opts.force && isScriptProject(p.dir)) throw new EditRefused('script')
  const source = sourcePath(p)
  if (!source) throw new EditRefused('no-source')
  const placed = await placeVoiceover(p)
  const cut = cleanOnTimeline(readIndex(p.dir))
  // once cut, the words heard again are moved onto the cut video by the cuts that made it
  const cuts = cut ? cutsOf(p, cut) : []
  if (cuts && (opts.force || !hasTranscript(p.dir))) {
    if (!hasSecret('assemblyai')) throw new EditRefused('no-key')
    await whenFree()
    // the tab may have just transcribed it
    if (opts.force || !hasTranscript(p.dir)) {
      task = 'transcribe'
      try {
        const t = await transcribeSource(p, source)
        if (cuts.length)
          writeFileSync(join(p.dir, 'transcript.json'), JSON.stringify(remap(t, cuts), null, 2))
        setStatus({ stage: 'done', message: `${t.words.length} words transcribed` })
      } catch (err) {
        setStatus({ stage: 'error', message: err instanceof Error ? err.message : String(err) })
        throw err
      }
    }
  }
  if (!hasTranscript(p.dir)) throw new EditRefused('no-speech')
  return heard(p, placed)
}

/**
 * Luca's clean_edit, without a turn of its own (it runs inside Luca's): transcribe if needed,
 * cut every filler and long pause plus the retakes Luca found (`extra`, source seconds), and
 * apply it like the Transcript tab's clean edit. Makes no version of its own, and changes
 * nothing once `signal` stops Luca's turn. Returns the cuts made, the recording's length before,
 * and the words re-timed to the cut video.
 */
export async function cleanEditInTurn(
  p: Project,
  extra: Cut[],
  signal?: AbortSignal
): Promise<Heard & { cuts: Cut[]; removed: number; before: number }> {
  if (isScriptProject(p.dir)) throw new EditRefused('script')
  const source = sourcePath(p)
  if (!source) throw new EditRefused('no-source')
  if (cleanOnTimeline(readIndex(p.dir))) throw new EditRefused('already-cut')
  const placed = await placeVoiceover(p)
  if (!speechClips(readIndex(p.dir), p.source).length) throw new EditRefused('off-timeline')
  if (!readTranscript(p.dir)?.words.length && !hasSecret('assemblyai'))
    throw new EditRefused('no-key')
  await whenFree()
  task = 'clean'
  let cuts: Cut[] = []
  let before = 0
  try {
    let t = readTranscript(p.dir)
    if (!t?.words.length) t = await transcribeSource(p, source)
    if (!t.words.length) throw new EditRefused('no-speech')
    if (signal?.aborted) throw new Error('Stopped')
    setStatus({ stage: 'candidates' })
    before = r3((await probe(source)).duration)
    const inside = [...cutCandidates(t, before), ...extra]
      .map((c) => ({ ...c, start: r3(Math.max(0, c.start)), end: r3(Math.min(before, c.end)) }))
      .filter((c) => c.end - c.start > 0.01)
    // overlaps and slivers too short to keep become one cut, so the list is always valid
    cuts = mergeCuts(inside, MIN_KEPT)
    if (cuts.length)
      await applyEdl(p, { version: 1, source: p.source, cuts }, { checkpoint: false, signal })
    else setStatus({ stage: 'done', message: 'Nothing to cut' })
  } catch (err) {
    setStatus({ stage: 'error', message: err instanceof Error ? err.message : String(err) })
    throw err
  }
  const removed = r3(cuts.reduce((n, c) => n + (c.end - c.start), 0))
  return { ...(await heard(p, placed)), cuts, removed, before }
}

function readLookKeyterms(p: Project): string[] | null {
  if (!p.look) return null
  const f = join(p.dir, '.luca', 'look.json')
  if (!existsSync(f)) return null
  try {
    return (JSON.parse(readFileSync(f, 'utf8')) as { keyterms?: string[] }).keyterms ?? null
  } catch {
    return null
  }
}
