import { AssemblyAI } from 'assemblyai'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { CleanStatus, Transcript, Word } from '../shared/types'
import { ffmpegProgress, probeMedia } from './env'
import { getSecret } from './secrets'

export const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'ah', 'hmm', 'mm', 'uhm', 'mhm'])

export function isFiller(text: string): boolean {
  return FILLERS.has(text.toLowerCase().replace(/[^a-z]/g, ''))
}

export type StageReport = (s: Pick<CleanStatus, 'stage' | 'progress' | 'estimated'>) => void

/** Mono 16 kHz FLAC of the source's audio at .luca/audio.flac (about a tenth of the video). */
export async function extractAudio(
  projectDir: string,
  source: string,
  onProgress?: (p: number) => void
): Promise<string> {
  const out = join(projectDir, '.luca', 'audio.flac')
  mkdirSync(join(projectDir, '.luca'), { recursive: true })
  const { duration } = await probeMedia(source).catch(() => ({ duration: 0 }))
  const r = await ffmpegProgress(
    ['-y', '-v', 'error', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', out],
    duration,
    (p) => onProgress?.(p),
    { timeoutMs: 600_000 }
  )
  if (r.code !== 0 || !existsSync(out)) throw new Error(`ffmpeg audio extract failed: ${r.stderr}`)
  return out
}

/** Upload with progress measured from the bytes actually handed to the request body. */
async function upload(
  client: AssemblyAI,
  file: string,
  onProgress: (p: number) => void
): Promise<string> {
  const size = statSync(file).size
  let sent = 0
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      sent += chunk.length
      onProgress(size > 0 ? Math.min(0.99, sent / size) : 0)
      done(null, chunk)
    }
  })
  createReadStream(file).pipe(counter)
  try {
    const url = await client.files.upload(
      Readable.toWeb(counter) as unknown as Parameters<AssemblyAI['files']['upload']>[0]
    )
    onProgress(1)
    return url
  } catch (err) {
    // a streamed body the runtime refuses; the path upload has no progress but works
    if (sent === 0) return client.files.upload(file)
    throw err
  }
}

/**
 * AssemblyAI upload + transcribe with disfluencies kept, raw response saved to
 * .luca/assemblyai.json, then the transcript is deleted from their servers.
 *
 * AssemblyAI reports queued/processing but no percentage, so while it works the progress is an
 * estimate from the audio length (flagged `estimated`, shown with a "~").
 */
export async function transcribe(
  projectDir: string,
  audioFile: string,
  keyterms: string[],
  report: StageReport
): Promise<Transcript> {
  const apiKey = getSecret('assemblyai')
  if (!apiKey) throw new Error('AssemblyAI key missing. Add it in the Transcript tab first.')
  const client = new AssemblyAI({ apiKey })
  report({ stage: 'uploading', progress: 0 })
  const uploadUrl = await upload(client, audioFile, (p) =>
    report({ stage: 'uploading', progress: p })
  )
  report({ stage: 'transcribing', progress: 0, estimated: true })
  const { duration } = await probeMedia(audioFile).catch(() => ({ duration: 60 }))
  const queued = await client.transcripts.submit({
    audio: uploadUrl,
    speech_models: ['universal-3-5-pro', 'universal-2'],
    disfluencies: true,
    speaker_labels: true,
    ...(keyterms.length ? { keyterms_prompt: keyterms.slice(0, 200) } : {})
  })
  // typical turnaround is a fraction of the audio length; ease towards 95% and never claim done
  const expected = Math.max(8, duration * 0.3)
  const started = Date.now()
  let t = queued
  while (t.status !== 'completed' && t.status !== 'error') {
    await new Promise((r) => setTimeout(r, 1200))
    t = await client.transcripts.get(queued.id)
    const elapsed = (Date.now() - started) / 1000
    const p = t.status === 'queued' ? 0.04 : 0.95 * (1 - Math.exp(-elapsed / expected))
    report({ stage: 'transcribing', progress: p, estimated: true })
  }
  report({ stage: 'transcribing', progress: 1 })
  writeFileSync(join(projectDir, '.luca', 'assemblyai.json'), JSON.stringify(t, null, 2))
  try {
    await client.transcripts.delete(t.id)
  } catch {
    // best effort: the transcript is already on disk; deletion is privacy hygiene only
  }
  if (t.status === 'error') throw new Error(t.error ?? 'AssemblyAI transcription failed')
  const words: Word[] = (t.words ?? []).map((w, i) => ({
    id: `w${i + 1}`,
    text: w.text,
    start: w.start / 1000,
    end: w.end / 1000,
    ...(isFiller(w.text) ? { filler: true } : {})
  }))
  const transcript: Transcript = { words }
  const json = JSON.stringify(transcript, null, 2)
  writeFileSync(join(projectDir, 'transcript.json'), json)
  writeFileSync(join(projectDir, '.luca', 'transcript.original.json'), json)
  return transcript
}
