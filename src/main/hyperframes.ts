import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CatalogItem, Clip, ClipKind, Timeline, Track } from '../shared/types'
import { parseJsonOutput, runHyperframes } from './env'
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
      remocn: typeof row.src === 'string' && row.src.startsWith('media/remocn/')
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

export async function snapshot(dir: string, at: number, out: string): Promise<boolean> {
  mkdirSync(join(out, '..'), { recursive: true })
  const res = await runHyperframes(
    ['snapshot', 'index.html', '--at', String(at), '--output', out],
    {
      cwd: dir,
      timeoutMs: 90_000
    }
  )
  return res.code === 0 && existsSync(out)
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

export async function catalog(opts: { refresh?: boolean; cwd: string }): Promise<CatalogItem[]> {
  const cacheFile = join(appDataDir(), 'catalog.json')
  if (!opts.refresh && existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < DAY) {
    try {
      return JSON.parse(readFileSync(cacheFile, 'utf8')) as CatalogItem[]
    } catch {
      // refetch
    }
  }
  const res = await runHyperframes(['catalog', '--json'], { cwd: opts.cwd, timeoutMs: 90_000 })
  if (res.code !== 0) {
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8')) as CatalogItem[]
    throw new Error(`hyperframes catalog failed: ${(res.stderr || res.stdout).slice(-400)}`)
  }
  const data = parseJsonOutput<HfCatalog>(res.stdout)
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
  writeFileSync(cacheFile, JSON.stringify(items))
  return items
}
