import { AssemblyAI } from 'assemblyai'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Transcript, Word } from '../shared/types'
import { childEnv, run, which } from './env'
import { getSecret } from './secrets'

export const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'ah', 'hmm', 'mm', 'uhm', 'mhm'])

export function isFiller(text: string): boolean {
  return FILLERS.has(text.toLowerCase().replace(/[^a-z]/g, ''))
}

/** Mono 16 kHz FLAC of the source's audio at .luca/audio.flac (about a tenth of the video). */
export async function extractAudio(projectDir: string, source: string): Promise<string> {
  const out = join(projectDir, '.luca', 'audio.flac')
  mkdirSync(join(projectDir, '.luca'), { recursive: true })
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const r = await run(
    ffmpeg,
    ['-y', '-v', 'error', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', out],
    { env: await childEnv(), timeoutMs: 600_000 }
  )
  if (r.code !== 0 || !existsSync(out)) throw new Error(`ffmpeg audio extract failed: ${r.stderr}`)
  return out
}

/**
 * AssemblyAI upload + transcribe with disfluencies kept, raw response saved to
 * .luca/assemblyai.json, then the transcript is deleted from their servers.
 */
export async function transcribe(
  projectDir: string,
  audioFile: string,
  keyterms: string[],
  onStage: (stage: 'uploading' | 'transcribing') => void
): Promise<Transcript> {
  const apiKey = getSecret('assemblyai')
  if (!apiKey) throw new Error('AssemblyAI key missing. Add it in onboarding to run a clean edit.')
  const client = new AssemblyAI({ apiKey })
  onStage('uploading')
  const uploadUrl = await client.files.upload(audioFile)
  onStage('transcribing')
  const t = await client.transcripts.transcribe({
    audio: uploadUrl,
    speech_models: ['universal-3-5-pro', 'universal-2'],
    disfluencies: true,
    speaker_labels: true,
    ...(keyterms.length ? { keyterms_prompt: keyterms.slice(0, 200) } : {})
  })
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
