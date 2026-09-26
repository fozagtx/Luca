import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { RemocnItem } from '../shared/types'
import { childEnv, run, which } from './env'
import { readTimeline } from './hyperframes'
import { appDataDir } from './settings'

const DAY = 24 * 60 * 60 * 1000
const INDEX_URL = 'https://remocn.dev/llms-components.txt'
/** Transitions and filters wrap scenes; rendered alone as an overlay they have nothing to act on. */
const HIDDEN_CATEGORIES = new Set(['transitions', 'filters'])

export function studioDir(): string {
  return join(appDataDir(), 'remocn-studio')
}

export type StudioStatus = { ready: boolean; step?: string; error?: string }

let setupRunning: Promise<{ ok: boolean; error?: string }> | null = null
let setupStep = ''

export function studioStatus(): StudioStatus {
  if (setupRunning) return { ready: false, step: setupStep }
  const dir = studioDir()
  if (!existsSync(join(dir, 'package.json'))) return { ready: false, step: 'not set up' }
  if (!existsSync(join(dir, 'node_modules', 'remotion')))
    return { ready: false, step: 'dependencies missing' }
  const components = join(dir, 'components.json')
  if (!existsSync(components) || !readFileSync(components, 'utf8').includes('remocn.dev'))
    return { ready: false, step: 'shadcn registry missing' }
  return { ready: true }
}

async function npx(
  args: string[],
  opts: { cwd: string; timeoutMs?: number; env?: Record<string, string> }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = await childEnv({ CI: '1', NO_COLOR: '1', ...(opts.env ?? {}) })
  const bin = (await which('npx')) ?? 'npx'
  return run(bin, ['--yes', ...args], { cwd: opts.cwd, env, timeoutMs: opts.timeoutMs ?? 600_000 })
}

function fail(step: string, r: { stdout: string; stderr: string }): { ok: false; error: string } {
  return { ok: false, error: `${step}: ${(r.stderr || r.stdout).trim().slice(-800)}` }
}

/**
 * One-time studio setup (spec: create-video blank + Tailwind, shadcn init with the remocn
 * registry, Remotion's browser, the remocn skill). Idempotent; safe to re-run after a failure.
 */
export function setupStudio(): Promise<{ ok: boolean; error?: string }> {
  if (setupRunning) return setupRunning
  setupRunning = (async () => {
    const dir = studioDir()
    const parent = dirname(dir)
    mkdirSync(parent, { recursive: true })
    if (!existsSync(join(dir, 'package.json'))) {
      setupStep = 'Creating Remotion workspace'
      const r = await npx(['create-video@latest', '--yes', '--blank', basename(dir)], {
        cwd: parent,
        timeoutMs: 900_000
      })
      if (r.code !== 0 || !existsSync(join(dir, 'package.json'))) return fail('create-video', r)
    }
    if (!existsSync(join(dir, 'node_modules', 'remotion'))) {
      setupStep = 'Installing dependencies'
      const npm = (await which('npm')) ?? 'npm'
      const env = await childEnv({ CI: '1' })
      const r = await run(npm, ['install', '--no-audit', '--no-fund'], {
        cwd: dir,
        env,
        timeoutMs: 900_000
      })
      if (r.code !== 0) return fail('npm install', r)
    }
    const components = join(dir, 'components.json')
    if (!existsSync(components)) {
      setupStep = 'Initialising shadcn'
      const r = await npx(
        ['shadcn@latest', 'init', '--yes', '--defaults', '--base-color', 'neutral'],
        {
          cwd: dir
        }
      )
      if (r.code !== 0 || !existsSync(components)) return fail('shadcn init', r)
    }
    const cfg = JSON.parse(readFileSync(components, 'utf8')) as {
      registries?: Record<string, string>
    }
    if (cfg.registries?.['@remocn'] !== 'https://remocn.dev/r/{name}.json') {
      cfg.registries = { ...(cfg.registries ?? {}), '@remocn': 'https://remocn.dev/r/{name}.json' }
      writeFileSync(components, JSON.stringify(cfg, null, 2) + '\n')
    }
    setupStep = 'Downloading Remotion browser'
    const b = await npx(['remotion', 'browser', 'ensure'], { cwd: dir })
    if (b.code !== 0) return fail('remotion browser ensure', b)
    setupStep = 'Installing remocn skill'
    const s = await npx(['skills', 'add', 'Remocn/remocn', '--yes'], {
      cwd: dir,
      timeoutMs: 300_000
    })
    if (s.code !== 0) return fail('skills add', s)
    mkdirSync(join(dir, 'src', 'clips'), { recursive: true })
    writeRoot(dir)
    return { ok: true }
  })().finally(() => {
    setupRunning = null
    setupStep = ''
  })
  return setupRunning
}

// ---------------------------------------------------------------------------------------------
// Catalog

export async function remocnCatalog(refresh = false): Promise<RemocnItem[]> {
  const cacheFile = join(appDataDir(), 'remocn-catalog.json')
  if (!refresh && existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < DAY) {
    try {
      return JSON.parse(readFileSync(cacheFile, 'utf8')) as RemocnItem[]
    } catch {
      // refetch
    }
  }
  try {
    const res = await fetch(INDEX_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const items = parseIndex(await res.text())
    writeFileSync(cacheFile, JSON.stringify(items))
    return items
  } catch (err) {
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8')) as RemocnItem[]
    throw new Error(`Could not load the remocn index: ${String(err)}`)
  }
}

export function parseIndex(text: string): RemocnItem[] {
  const items: RemocnItem[] = []
  let category = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('## ')) {
      category = line.slice(3).trim()
      continue
    }
    if (!line.startsWith('|') || !category) continue
    const cells = line.split('|').map((c) => c.trim())
    // leading/trailing empties from the outer pipes
    const cols = cells.slice(1, -1)
    if (cols.length < 8 || cols[0] === 'Component' || /^-+$/.test(cols[0])) continue
    const name = cols[0].replace(/`/g, '')
    if (!name) continue
    if (HIDDEN_CATEGORIES.has(category.toLowerCase())) continue
    const docs = /\((https?:[^)]+)\)/.exec(cols[7] ?? '')?.[1] ?? ''
    items.push({
      name,
      category,
      useFor: cols[1],
      avoidFor: cols[2],
      naturalLength: cols[3],
      docs: docs.replace(/\.md$/, '')
    })
  }
  return items
}

// ---------------------------------------------------------------------------------------------
// Tools

export async function installComponent(
  name: string
): Promise<{ ok: boolean; importPath?: string; docs?: string; error?: string }> {
  const st = studioStatus()
  if (!st.ready) return { ok: false, error: `Remocn studio is not ready (${st.step}).` }
  const dir = studioDir()
  const target = join(dir, 'components', 'remocn', `${name}.tsx`)
  if (!existsSync(target)) {
    const r = await npx(['shadcn@latest', 'add', `@remocn/${name}`, '--yes', '--overwrite'], {
      cwd: dir,
      timeoutMs: 300_000
    })
    if (r.code !== 0) return fail(`shadcn add @remocn/${name}`, r)
  }
  const items = await remocnCatalog().catch((): RemocnItem[] => [])
  const item = items.find((i) => i.name === name)
  return {
    ok: true,
    importPath: existsSync(target) ? `@/components/remocn/${name}` : `@/components/remocn/${name}`,
    docs: item?.docs ?? `https://remocn.dev/docs/${name}`
  }
}

type PlacedClip = { clipId: string; hash: string; file: string; start: number; track: number }

function placedFile(projectDir: string): string {
  return join(projectDir, '.luca', 'remocn.json')
}
function readPlaced(projectDir: string): PlacedClip[] {
  const f = placedFile(projectDir)
  if (!existsSync(f)) return []
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as PlacedClip[]
  } catch {
    return []
  }
}

/** Regenerate the studio's Root.tsx from every wrapper in src/clips. */
function writeRoot(dir: string, size?: { width: number; height: number; fps: number }): void {
  const clipsDir = join(dir, 'src', 'clips')
  mkdirSync(clipsDir, { recursive: true })
  const ids = readdirSync(clipsDir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => f.slice(0, -4))
  const w = size?.width ?? 1920
  const h = size?.height ?? 1080
  const fps = size?.fps ?? 30
  const imports = ids
    .map((id, i) => `import Clip${i}, { durationInFrames as d${i} } from './clips/${id}';`)
    .join('\n')
  const comps = ids
    .map(
      (id, i) =>
        `      <Composition id=${JSON.stringify(id)} component={Clip${i}} durationInFrames={d${i}} fps={${fps}} width={${w}} height={${h}} />`
    )
    .join('\n')
  const src = `import React from 'react';
import { Composition } from 'remotion';
${imports}

export const RemotionRoot: React.FC = () => {
  return (
    <>
${comps}
    </>
  );
};
`
  writeFileSync(join(dir, 'src', 'Root.tsx'), src)
  const index = join(dir, 'src', 'index.ts')
  if (!existsSync(index) || !readFileSync(index, 'utf8').includes('RemotionRoot')) {
    writeFileSync(
      index,
      `import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\n\nregisterRoot(RemotionRoot);\n`
    )
  }
}

/**
 * Render the project's wrapper `remocn/<clipId>.tsx` to a transparent WebM (reused by hash) and
 * insert or update the clip in index.html.
 */
export async function placeComponent(
  projectDir: string,
  args: { clipId: string; start: number; track?: number }
): Promise<{ ok: boolean; file?: string; reused?: boolean; error?: string }> {
  const st = studioStatus()
  if (!st.ready) return { ok: false, error: `Remocn studio is not ready (${st.step}).` }
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(args.clipId))
    return { ok: false, error: 'clipId must be alphanumeric with dashes' }
  const wrapper = join(projectDir, 'remocn', `${args.clipId}.tsx`)
  if (!existsSync(wrapper)) return { ok: false, error: `Missing wrapper ${wrapper}` }
  const source = readFileSync(wrapper, 'utf8')
  if (!/export\s+const\s+durationInFrames/.test(source))
    return { ok: false, error: 'Wrapper must `export const durationInFrames`' }

  const tl = await readTimeline(projectDir)
  const fps = tl.fps || 30
  const hash = createHash('sha1')
    .update(source)
    .update(`${tl.width}x${tl.height}@${fps}`)
    .digest('hex')
    .slice(0, 10)
  const outName = `${args.clipId}-${hash}.webm`
  const outDir = join(projectDir, 'media', 'remocn')
  const out = join(outDir, outName)
  mkdirSync(outDir, { recursive: true })

  const dir = studioDir()
  copyFileSync(wrapper, join(dir, 'src', 'clips', `${args.clipId}.tsx`))
  writeRoot(dir, { width: tl.width, height: tl.height, fps })

  let reused = true
  if (!existsSync(out)) {
    reused = false
    const r = await npx(
      [
        'remotion',
        'render',
        'src/index.ts',
        args.clipId,
        out,
        '--codec=vp8',
        '--image-format=png',
        '--pixel-format=yuva420p',
        '--log=error'
      ],
      { cwd: dir, timeoutMs: 900_000 }
    )
    if (r.code !== 0 || !existsSync(out)) return fail('remotion render', r)
  }

  // duration from the wrapper's export, evaluated by Remotion's compositions listing when it is
  // not a literal
  let frames = Number(/durationInFrames\s*=\s*(\d+)/.exec(source)?.[1])
  if (!Number.isFinite(frames) || frames <= 0) {
    const r = await npx(['remotion', 'compositions', 'src/index.ts', '--quiet'], { cwd: dir })
    const line = r.stdout.split('\n').find((l) => l.trim().startsWith(args.clipId))
    frames = Number(line?.trim().split(/\s+/)[1]) || fps * 3
  }
  const duration = Math.round((frames / fps) * 1000) / 1000
  const track = args.track ?? overlayTrack(tl)

  const indexFile = join(projectDir, 'index.html')
  let html = readFileSync(indexFile, 'utf8')
  const tag = `<video id="remocn-${args.clipId}" class="clip remocn" src="media/remocn/${outName}" data-start="${args.start}" data-duration="${duration}" data-track-index="${track}" muted playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none"></video>`
  const existing = new RegExp(`<video[^>]*id="remocn-${args.clipId}"[^>]*>\\s*</video>`)
  if (existing.test(html)) html = html.replace(existing, tag)
  else {
    const inserted = insertIntoRoot(html, `      ${tag}\n`)
    if (!inserted) return { ok: false, error: 'Could not find the root composition in index.html' }
    html = inserted
  }
  writeFileSync(indexFile, html)

  const placed = readPlaced(projectDir).filter((p) => p.clipId !== args.clipId)
  placed.push({
    clipId: args.clipId,
    hash,
    file: `media/remocn/${outName}`,
    start: args.start,
    track
  })
  mkdirSync(dirname(placedFile(projectDir)), { recursive: true })
  writeFileSync(placedFile(projectDir), JSON.stringify(placed, null, 2))
  return { ok: true, file: `media/remocn/${outName}`, reused }
}

function overlayTrack(tl: { tracks: { index: number; kind: string }[] }): number {
  const video = tl.tracks.filter((t) => t.kind === 'video').map((t) => t.index)
  const base = video.length ? Math.max(...video) + 1 : 1
  const used = new Set(tl.tracks.map((t) => t.index))
  let i = base
  while (used.has(i) && tl.tracks.find((t) => t.index === i)?.kind === 'audio') i++
  return i
}

/** Append `fragment` as the last child of the root composition element. */
function insertIntoRoot(html: string, fragment: string): string | null {
  const open = /<(div|section|main)\b[^>]*data-composition-id="[^"]+"[^>]*>/i.exec(html)
  if (!open) return null
  const tagName = open[1].toLowerCase()
  const re = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, 'gi')
  re.lastIndex = open.index + open[0].length
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) depth--
    else if (!m[0].endsWith('/>')) depth++
    if (depth === 0) return html.slice(0, m.index) + fragment + html.slice(m.index)
  }
  return null
}
