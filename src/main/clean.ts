import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CleanResult, CleanStatus, Cut, Edl, Project, Transcript } from '../shared/types'
import { activeAgent, agentFor } from './agent'
import { ffmpegProgress, probeMedia } from './env'
import { Channels, broadcast } from './ipc'
import { getSettings } from './settings'
import { extractAudio, isFiller, transcribe } from './transcribe'
import { checkpoint } from './versions'

const MAX_PAUSE = 0.6
const KEEP_PAUSE = 0.25
const PAD = 0.02
const MIN_KEPT = 0.1
const JOIN_FADE = 0.01

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

function mergeCuts(cuts: Cut[]): Cut[] {
  const sorted = [...cuts].sort((a, b) => a.start - b.start)
  const out: Cut[] = []
  for (const c of sorted) {
    const last = out[out.length - 1]
    if (last && c.start <= last.end) {
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

/** ffmpeg: trim kept segments, 10 ms audio fades at every join, concat, VideoToolbox H.264 + AAC. */
async function renderClean(
  source: string,
  segs: { start: number; end: number }[],
  bitrate: number,
  out: string,
  onProgress: (p: number) => void
): Promise<void> {
  const parts: string[] = []
  const labels: string[] = []
  segs.forEach((s, i) => {
    const len = s.end - s.start
    parts.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`)
    parts.push(
      `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${JOIN_FADE},afade=t=out:st=${Math.max(0, len - JOIN_FADE)}:d=${JOIN_FADE}[a${i}]`
    )
    labels.push(`[v${i}][a${i}]`)
  })
  parts.push(`${labels.join('')}concat=n=${segs.length}:v=1:a=1[v][a]`)
  const kbps = bitrate > 0 ? Math.max(1000, Math.round(bitrate / 1000)) : 8000
  const args = [
    '-y',
    '-v',
    'error',
    '-i',
    source,
    '-filter_complex',
    parts.join(';'),
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'h264_videotoolbox',
    '-b:v',
    `${kbps}k`,
    '-pix_fmt',
    'yuv420p',
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

function relink(p: Project, cleanRel: string, duration: number): void {
  const indexFile = join(p.dir, 'index.html')
  let html = readFileSync(indexFile, 'utf8')
  const escaped = p.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<(video|audio)\\b[^>]*src="(?:media/)?${escaped}"[^>]*>`, 'g')
  const prev = readEdl(p.dir)
  const prevClean = /media\/clean-[0-9a-f]+\.mp4/
  const target = (tag: string): string =>
    tag
      .replace(/src="[^"]*"/, `src="${cleanRel}"`)
      .replace(/data-duration="[^"]*"/, `data-duration="${duration}"`)
  html = html.replace(re, target)
  if (prev) {
    html = html.replace(
      new RegExp(`<(video|audio)\\b[^>]*src="${prevClean.source}"[^>]*>`, 'g'),
      target
    )
  }
  html = html.replace(
    /(<div[^>]*data-composition-id="[^"]+"[^>]*data-duration=")[^"]*(")/,
    `$1${duration}$2`
  )
  writeFileSync(indexFile, html)
}

/** Steps 7–10 of the spec: validate, ffmpeg apply (cached by hash), remap captions, relink. */
export async function applyEdl(p: Project, edl: Edl): Promise<CleanResult> {
  const source = sourcePath(p)
  if (!source) throw new Error(`Source ${p.source} not found`)
  const { duration, bitrate } = await probe(source)
  const err = validateEdl(edl, duration)
  if (err) throw new Error(`Invalid edl.json: ${err}`)
  const cuts = mergeCuts(edl.cuts)
  const hash = createHash('sha1')
    .update(JSON.stringify(cuts))
    .update(p.source)
    .digest('hex')
    .slice(0, 10)
  const cleanRel = `media/clean-${hash}.mp4`
  const out = join(p.dir, cleanRel)
  mkdirSync(join(p.dir, 'media'), { recursive: true })
  setStatus({ stage: 'applying', message: `${cuts.length} cuts`, progress: 0 })
  if (!existsSync(out) || statSync(out).size === 0) {
    const segs = keptSegments(cuts, duration)
    if (!segs.length) throw new Error('The EDL cuts the whole clip')
    await renderClean(source, segs, bitrate, out, (progress) =>
      setStatus({ stage: 'applying', message: `${cuts.length} cuts`, progress })
    )
  }
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
  relink(p, cleanRel, newDuration)
  await checkpoint(p.dir, `Clean edit: ${cuts.length} cuts`)
  setStatus({ stage: 'done', message: `${cuts.length} cuts · ${cleanRel}` })
  return { cuts: cuts.length, cleanFile: cleanRel }
}

/** The full pipeline (spec steps 2–10). Step 11 (auto edit) is left to the user's next turn. */
export async function runCleanEdit(p: Project): Promise<void> {
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
    if (readEdl(p.dir) && existsSync(join(p.dir, 'transcript.json'))) {
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
