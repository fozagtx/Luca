import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { ElementTransform, Project, TimelineEdit } from '../shared/types'
import { parseJsonOutput, run, runHyperframes, which } from './env'
import { findTagById, replaceTag, setAttrs, withStyle } from './html'

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

/**
 * 640px poster frame at ~10% into the source → .luca/cache/poster.jpg, plus the source
 * duration → .luca/cache/poster.json. Generated once per source; used by recent-project cards.
 */
export async function poster(p: Project): Promise<{ duration: number } | null> {
  return once(`poster:${p.dir}`, async () => {
    const out = cacheDir(p.dir, '')
    const src = sourcePath(p)
    if (!src) return null
    const jpg = join(out, 'poster.jpg')
    const meta = join(out, 'poster.json')
    const sig = `${src}:${statSync(src).mtimeMs}`
    if (existsSync(jpg) && existsSync(meta)) {
      try {
        const m = JSON.parse(readFileSync(meta, 'utf8')) as { sig: string; duration: number }
        if (m.sig === sig) return { duration: m.duration }
      } catch {
        /* regenerate */
      }
    }
    const ffprobe = await which('ffprobe')
    const ffmpeg = await which('ffmpeg')
    if (!ffprobe || !ffmpeg) throw new Error('ffmpeg not found')
    const pr = await run(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', src],
      { timeoutMs: 30_000 }
    )
    const duration = Number(
      (JSON.parse(pr.stdout || '{}') as { format?: { duration?: string } }).format?.duration ?? 0
    )
    const at = Math.min(Math.max(duration * 0.1, 0.5), Math.max(duration - 0.1, 0))
    await run(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        at.toFixed(2),
        '-i',
        src,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '4',
        jpg
      ],
      { timeoutMs: 60_000 }
    )
    writeFileSync(meta, JSON.stringify({ sig, duration }))
    return { duration }
  })
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
  if (edit.op === 'mute') return muteClips(dir, edit.refs, edit.muted)
  if (edit.op === 'delete' && edit.with?.length) {
    // a video and its own audio go together, in one checkpoint
    for (const ref of [edit.ref, ...edit.with]) {
      const res = await applyEdit(dir, { op: 'delete', ref })
      if (!res.ok) return res
    }
    return { ok: true }
  }
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

/**
 * Track mute: `data-volume="0"` on each clip in index.html, remembering the previous level in
 * `data-luca-volume` so unmuting restores it exactly.
 */
function muteClips(dir: string, refs: string[], muted: boolean): { ok: boolean; error?: string } {
  const file = join(dir, 'index.html')
  let html = readFileSync(file, 'utf8')
  for (const ref of refs) {
    const tag = findTagById(html, ref.replace(/^#/, ''))
    if (!tag) continue
    const prev = tag.attrs['data-volume']
    const raw = muted
      ? setAttrs(tag, {
          'data-volume': '0',
          'data-luca-volume':
            prev !== undefined && prev !== '0' ? prev : (tag.attrs['data-luca-volume'] ?? null)
        })
      : setAttrs(tag, {
          'data-volume': tag.attrs['data-luca-volume'] ?? '1',
          'data-luca-volume': null
        })
    html = replaceTag(html, tag, raw)
  }
  writeFileSync(file, html)
  return { ok: true }
}

const num = (n: number, digits: number): string =>
  String(Math.round(n * 10 ** digits) / 10 ** digits)

/**
 * Move/resize an element on the canvas by writing CSS `translate`, `scale` and
 * `transform-origin` on its tag. Those compose with GSAP's `transform`, so animations keep
 * working on top of the new position and size.
 */
export async function applyTransform(
  dir: string,
  t: ElementTransform
): Promise<{ ok: boolean; error?: string }> {
  if (!/\.html$/i.test(t.file) || /^(media|renders)\//.test(t.file))
    return { ok: false, error: 'Only composition files can be edited' }
  const abs = resolve(dir, t.file)
  const rel = relative(resolve(dir), abs)
  if (!rel || rel.startsWith('..'))
    return { ok: false, error: 'That element is outside the project' }
  if (!existsSync(abs)) return { ok: false, error: `${t.file} was not found` }
  const html = readFileSync(abs, 'utf8')
  const tag = findTagById(html, t.id)
  if (!tag) return { ok: false, error: `Couldn't find #${t.id} in ${t.file}` }
  const [x, y] = t.translate
  const moved = Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5
  const scaled = Math.abs(t.scale - 1) >= 0.002
  const raw = withStyle(tag, {
    translate: moved ? `${num(x, 1)}px ${num(y, 1)}px` : null,
    scale: scaled ? num(t.scale, 3) : null,
    'transform-origin':
      scaled && t.origin ? `${num(t.origin[0], 1)}px ${num(t.origin[1], 1)}px` : null
  })
  writeFileSync(abs, replaceTag(html, tag, raw))
  return { ok: true }
}

export function editLabel(edit: TimelineEdit): string {
  if (edit.op === 'mute') return edit.muted ? 'Edit: mute track' : 'Edit: unmute track'
  const name = edit.ref.replace(/^#/, '')
  switch (edit.op) {
    case 'move':
      return `Edit: move ${name}`
    case 'trim':
      return `Edit: trim ${name}`
    case 'split':
      return `Edit: split ${name}`
    case 'delete':
      return edit.with?.length ? `Edit: delete ${name} and its audio` : `Edit: delete ${name}`
  }
}
