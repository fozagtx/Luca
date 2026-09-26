import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CatalogItem, Clip, ClipKind, Timeline, Track } from '../shared/types'
import bundled from './catalog/hyperframes.json'
import { parseJsonOutput, runHyperframes } from './env'
import { findTags } from './html'
import { appDataDir } from './settings'

type HfRow = {
  id: string | null
  label: string | null
  kind: string
  trackKind: string
  start: number
  duration: number
  end: number
  absStart: number
  absEnd: number
  file: string
  trackIndex: number
  src: string | null
  ref: string
  elementId: string | null
  children?: HfRow[]
}

type HfTimeline = {
  timeline: {
    duration: number
    fps?: number
    width?: number
    height?: number
    tracks: { kind: string; rows: HfRow[] }[]
  }
}

function kindOf(row: HfRow): ClipKind {
  if (row.trackKind === 'video' || row.kind === 'video') return 'video'
  if (row.trackKind === 'audio' || row.kind === 'audio') return 'audio'
  if (row.trackKind === 'caption' || row.kind === 'caption' || /caption/i.test(row.id ?? ''))
    return 'caption'
  if (row.kind === 'composition' || row.kind === 'block') return 'block'
  return 'block'
}

export async function readTimeline(dir: string): Promise<Timeline> {
  const res = await runHyperframes(['timeline', '--json'], { cwd: dir, timeoutMs: 60_000 })
  if (res.code !== 0)
    throw new Error(`hyperframes timeline failed: ${(res.stderr || res.stdout).slice(-600)}`)
  const data = parseJsonOutput<HfTimeline>(res.stdout)
  const html = existsSync(join(dir, 'index.html'))
    ? readFileSync(join(dir, 'index.html'), 'utf8')
    : ''
  const width = data.timeline.width ?? Number(/data-width="(\d+)"/.exec(html)?.[1] ?? 1920)
  const height = data.timeline.height ?? Number(/data-height="(\d+)"/.exec(html)?.[1] ?? 1080)

  // clip volumes aren't in the CLI's JSON; read them from the tags
  const volumes = new Map<string, number>()
  for (const t of findTags(html))
    if (t.attrs.id && (t.name === 'video' || t.name === 'audio'))
      volumes.set(t.attrs.id, Number(t.attrs['data-volume'] ?? 1))
  const byIndex = new Map<number, Track>()
  const seen = new Set<string>()
  const visit = (row: HfRow): void => {
    if (
      row.file !== 'index.html' &&
      row.file !== undefined &&
      row.file !== null &&
      row.file !== ''
    ) {
      // nested rows belong to sub-compositions; only top-level index.html rows are timeline clips
    }
    const idx = row.trackIndex ?? 0
    const kind = kindOf(row)
    const track =
      byIndex.get(idx) ??
      (() => {
        const t: Track = { index: idx, kind, label: kind, clips: [] }
        byIndex.set(idx, t)
        return t
      })()
    const id = row.id ?? row.elementId ?? row.ref
    const key = `${row.file}:${row.ref}`
    if (seen.has(key)) return
    seen.add(key)
    const clip: Clip = {
      id,
      track: idx,
      kind,
      start: row.absStart,
      end: row.absEnd,
      file: row.file,
      label: row.label ?? id,
      src: row.src,
      ref: row.ref,
      remocn: typeof row.src === 'string' && row.src.startsWith('media/remocn/'),
      ...(row.elementId && volumes.has(row.elementId)
        ? { volume: volumes.get(row.elementId) }
        : volumes.has(id)
          ? { volume: volumes.get(id) }
          : {})
    }
    track.clips.push(clip)
    if (track.kind !== kind && kind === 'video') track.kind = 'video'
  }
  for (const t of data.timeline.tracks) {
    for (const row of t.rows) {
      if (row.file && row.file !== 'index.html') continue
      visit(row)
    }
  }
  const tracks = [...byIndex.values()].sort((a, b) => a.index - b.index)
  for (const t of tracks) {
    t.clips.sort((a, b) => a.start - b.start)
    t.label =
      t.kind === 'video'
        ? 'Video'
        : t.kind === 'audio'
          ? 'Audio'
          : t.kind === 'caption'
            ? 'Captions'
            : 'Graphics'
  }
  return { duration: data.timeline.duration, fps: data.timeline.fps ?? 30, width, height, tracks }
}

export async function lint(dir: string): Promise<{ ok: boolean; output: string }> {
  const res = await runHyperframes(['lint', '--json'], { cwd: dir, timeoutMs: 60_000 })
  return { ok: res.code === 0, output: res.stdout || res.stderr }
}

export async function addCatalogItem(
  dir: string,
  name: string
): Promise<{ ok: boolean; snippet?: string; error?: string }> {
  const res = await runHyperframes(['add', name, '--json'], { cwd: dir, timeoutMs: 120_000 })
  if (res.code !== 0) return { ok: false, error: (res.stderr || res.stdout).slice(-600) }
  try {
    const data = parseJsonOutput<{ snippet?: string; usage?: string }>(res.stdout)
    return { ok: true, snippet: data.snippet ?? data.usage }
  } catch {
    return { ok: true, snippet: res.stdout }
  }
}

/** One frame of the composition at `at` seconds, as a PNG at `out`. */
export async function snapshot(dir: string, at: number, out: string): Promise<boolean> {
  const frames = mkdtempSync(join(tmpdir(), 'luca-snapshot-'))
  try {
    // the CLI takes the project folder and writes frame-NN-at-<t>s.png into the --output folder;
    // `--describe false` switches off the CLI's own frame upload to an outside vision service,
    // which it otherwise does by default when that service's key is in the environment
    const res = await runHyperframes(
      ['snapshot', '.', '--at', String(at), '--no-end', '--output', frames, '--describe', 'false'],
      { cwd: dir, timeoutMs: 90_000 }
    )
    const frame = readdirSync(frames).find((f) => /^frame-.*\.png$/.test(f))
    if (res.code !== 0 || !frame) return false
    mkdirSync(dirname(out), { recursive: true })
    copyFileSync(join(frames, frame), out)
    return true
  } finally {
    rmSync(frames, { recursive: true, force: true })
  }
}

type HfCatalog = {
  blocks?: HfCatalogEntry[]
  components?: HfCatalogEntry[]
  items?: HfCatalogEntry[]
}
type HfCatalogEntry = {
  name: string
  type?: string
  title?: string
  description?: string
  tags?: string[]
  duration?: number
  dimensions?: { width: number; height: number }
  preview?: { video?: string; poster?: string }
  categories?: string[]
}

const DAY = 24 * 60 * 60 * 1000
const bundledCatalog = bundled as CatalogItem[]

function readCache(file: string): CatalogItem[] | null {
  try {
    const items = JSON.parse(readFileSync(file, 'utf8')) as CatalogItem[]
    return Array.isArray(items) && items.length > 0 ? items : null
  } catch {
    return null
  }
}

/**
 * The HyperFrames catalog: the daily cache, else `hyperframes catalog --json`, else the last
 * cache, else the copy bundled with Luca (captured from hyperframes@0.8.78) so the library is
 * never empty offline or when the CLI fails.
 */
export async function catalog(opts: { refresh?: boolean; cwd: string }): Promise<CatalogItem[]> {
  const cacheFile = join(appDataDir(), 'catalog.json')
  const fresh = existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < DAY
  if (!opts.refresh && fresh) {
    const cached = readCache(cacheFile)
    if (cached) return cached
  }
  const fallback = (): CatalogItem[] =>
    (existsSync(cacheFile) && readCache(cacheFile)) || bundledCatalog
  let res: Awaited<ReturnType<typeof runHyperframes>>
  try {
    res = await runHyperframes(['catalog', '--json'], { cwd: opts.cwd, timeoutMs: 90_000 })
  } catch {
    // the CLI could not start at all (e.g. no npx on PATH)
    return fallback()
  }
  if (res.code !== 0) return fallback()
  let raw: HfCatalog | HfCatalogEntry[]
  try {
    raw = parseJsonOutput<HfCatalog | HfCatalogEntry[]>(res.stdout)
  } catch {
    return fallback()
  }
  const data: HfCatalog = Array.isArray(raw) ? { items: raw } : raw
  const map = (e: HfCatalogEntry, fallback: 'block' | 'component'): CatalogItem => ({
    name: e.name,
    type: e.type?.includes('component')
      ? 'component'
      : e.type?.includes('block')
        ? 'block'
        : fallback,
    title: e.title ?? e.name,
    description: e.description ?? '',
    tags: e.tags ?? e.categories ?? [],
    duration: e.duration,
    dimensions: e.dimensions,
    preview: e.preview
  })
  const items = [
    ...(data.blocks ?? []).map((e) => map(e, 'block')),
    ...(data.components ?? []).map((e) => map(e, 'component')),
    ...(data.items ?? []).map((e) => map(e, 'block'))
  ]
  if (items.length === 0) return fallback()
  writeFileSync(cacheFile, JSON.stringify(items))
  return items
}
