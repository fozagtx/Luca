import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { Project, TimelineEdit } from '../shared/types'
import { parseJsonOutput, run, runHyperframes, which } from './env'

const THUMB_INTERVAL = 1
const PEAKS_PER_SECOND = 100

function cacheDir(dir: string, sub: string): string {
  const d = join(dir, '.luca', 'cache', sub)
  mkdirSync(d, { recursive: true })
  return d
}

function sourcePath(p: Project): string | null {
  if (!p.source) return null
  for (const f of [join(p.dir, 'media', p.source), join(p.dir, p.source)]) {
    if (existsSync(f)) return f
  }
  return null
}

const inflight = new Map<string, Promise<unknown>>()
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key)
  if (hit) return hit as Promise<T>
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** One 160px JPEG per second in .luca/cache/thumbs/NNNN.jpg; generated once. */
export async function thumbnails(
  p: Project
): Promise<{ dir: string; count: number; interval: number }> {
  return once(`thumbs:${p.dir}`, async () => {
    const out = cacheDir(p.dir, 'thumbs')
    const src = sourcePath(p)
    if (!src) return { dir: '.luca/cache/thumbs', count: 0, interval: THUMB_INTERVAL }
    const stamp = join(out, '.source')
    const sig = `${src}:${statSync(src).mtimeMs}`
    const existing = readdirSync(out).filter((f) => /^\d{4}\.jpg$/.test(f))
    if (existing.length > 0 && existsSync(stamp) && readFileSync(stamp, 'utf8') === sig) {
      return { dir: '.luca/cache/thumbs', count: existing.length, interval: THUMB_INTERVAL }
    }
    const ffmpeg = await which('ffmpeg')
    if (!ffmpeg) throw new Error('ffmpeg not found')
    await run(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        src,
        '-vf',
        `fps=1/${THUMB_INTERVAL},scale=160:-2`,
        '-q:v',
        '5',
        join(out, '%04d.jpg')
      ],
      { timeoutMs: 120_000 }
    )
    writeFileSync(stamp, sig)
    const count = readdirSync(out).filter((f) => /^\d{4}\.jpg$/.test(f)).length
    return { dir: '.luca/cache/thumbs', count, interval: THUMB_INTERVAL }
  })
}

/** Mono 8 kHz PCM → 100 peaks/second (0..1) stored as uint8 in .luca/cache/peaks.bin. */
export async function peaks(p: Project): Promise<{ peaksPerSecond: number; peaks: number[] }> {
  return once(`peaks:${p.dir}`, async () => {
    const file = join(cacheDir(p.dir, ''), 'peaks.bin')
    const src = sourcePath(p)
    if (!src) return { peaksPerSecond: PEAKS_PER_SECOND, peaks: [] }
    const stamp = file + '.source'
    const sig = `${src}:${statSync(src).mtimeMs}`
    if (existsSync(file) && existsSync(stamp) && readFileSync(stamp, 'utf8') === sig) {
      return {
        peaksPerSecond: PEAKS_PER_SECOND,
        peaks: Array.from(readFileSync(file), (b) => b / 255)
      }
    }
    const ffmpeg = await which('ffmpeg')
    if (!ffmpeg) throw new Error('ffmpeg not found')
    const rate = 8000
    const raw = file + '.pcm'
    await run(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        src,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(rate),
        '-f',
        's16le',
        raw
      ],
      { timeoutMs: 120_000 }
    )
    const pcm = existsSync(raw) ? readFileSync(raw) : Buffer.alloc(0)
    if (existsSync(raw)) rmSync(raw)
    const samplesPerPeak = rate / PEAKS_PER_SECOND
    const total = Math.floor(pcm.length / 2)
    const out: number[] = []
    for (let i = 0; i < total; i += samplesPerPeak) {
      let max = 0
      const end = Math.min(total, i + samplesPerPeak)
      for (let j = i; j < end; j++) {
        const v = Math.abs(pcm.readInt16LE(j * 2))
        if (v > max) max = v
      }
      out.push(max / 32768)
    }
    writeFileSync(file, Buffer.from(out.map((v) => Math.round(v * 255))))
    writeFileSync(stamp, sig)
    return { peaksPerSecond: PEAKS_PER_SECOND, peaks: out }
  })
}

const fmt = (t: number): string => String(Math.round(t * 1000) / 1000)

/** Apply one clip edit through the HyperFrames CLI so the HTML stays the single source of truth. */
export async function applyEdit(
  dir: string,
  edit: TimelineEdit
): Promise<{ ok: boolean; error?: string }> {
  const args: string[] = ['timeline']
  switch (edit.op) {
    case 'move':
      args.push('move', edit.ref, fmt(edit.time), '--overwrite')
      break
    case 'trim':
      args.push('trim', edit.ref)
      if (edit.start !== undefined) args.push(`--start=${fmt(edit.start)}`)
      if (edit.end !== undefined) args.push(`--end=${fmt(edit.end)}`)
      break
    case 'split':
      args.push('split', edit.ref, fmt(edit.time))
      break
    case 'delete':
      args.push('delete', edit.ref)
      break
  }
  args.push('--json')
  const res = await runHyperframes(args, { cwd: dir, timeoutMs: 60_000 })
  let out: { ok?: boolean; reason?: string; fix?: string; error?: string } = {}
  try {
    out = parseJsonOutput(res.stdout)
  } catch {
    /* not JSON */
  }
  if (res.code !== 0 || out.ok === false) {
    const msg =
      out.reason ?? out.error ?? (res.stderr || res.stdout).trim().slice(-400) ?? 'Edit failed'
    return { ok: false, error: out.fix ? `${msg}. ${out.fix}` : msg }
  }
  return { ok: true }
}

export function editLabel(edit: TimelineEdit): string {
  const name = edit.ref.replace(/^#/, '')
  switch (edit.op) {
    case 'move':
      return `Edit: move ${name}`
    case 'trim':
      return `Edit: trim ${name}`
    case 'split':
      return `Edit: split ${name}`
    case 'delete':
      return `Edit: delete ${name}`
  }
}
