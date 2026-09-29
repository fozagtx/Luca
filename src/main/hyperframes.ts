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
import type { CatalogItem, Timeline } from '../shared/types'
import bundled from './catalog/hyperframes.json'
import { parseJsonOutput, runHyperframes } from './env'
import { appDataDir } from './settings'
import { buildTimeline, type HfTimeline } from './timeline-read'

export async function readTimeline(dir: string): Promise<Timeline> {
  const res = await runHyperframes(['timeline', '--json'], { cwd: dir, timeoutMs: 60_000 })
  if (res.code !== 0)
    throw new Error(`hyperframes timeline failed: ${(res.stderr || res.stdout).slice(-600)}`)
  const data = parseJsonOutput<HfTimeline>(res.stdout)
  const html = existsSync(join(dir, 'index.html'))
    ? readFileSync(join(dir, 'index.html'), 'utf8')
    : ''
  return buildTimeline(data, html)
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
