import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import type { Aspect, Project, RecentProject } from '../shared/types'
import { runHyperframes } from './env'
import { getSettings, updateSettings } from './settings'

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm'])
export const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'])

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  )
}

export function lucaDir(dir: string): string {
  const d = join(dir, '.luca')
  mkdirSync(d, { recursive: true })
  return d
}

export function readProject(dir: string): Project | null {
  const f = join(dir, '.luca', 'project.json')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as Project
  } catch {
    return null
  }
}

export function writeProject(p: Project): void {
  writeFileSync(join(lucaDir(p.dir), 'project.json'), JSON.stringify(p, null, 2))
}

function uniqueDir(root: string, slug: string): { dir: string; id: string } {
  mkdirSync(root, { recursive: true })
  let id = slug
  let n = 2
  while (existsSync(join(root, id))) id = `${slug}-${n++}`
  return { dir: join(root, id), id }
}

const RESOLUTION: Record<Aspect, string> = {
  landscape: 'landscape',
  portrait: 'portrait',
  square: 'square'
}

export async function createProject(args: {
  file: string
  name?: string
  aspect: Aspect
}): Promise<Project> {
  const ext = extname(args.file).toLowerCase()
  if (!VIDEO_EXT.has(ext)) throw new Error(`Unsupported video type: ${ext || 'unknown'}`)
  const settings = getSettings()
  const name = (args.name?.trim() || basename(args.file, extname(args.file))).slice(0, 80)
  const { dir, id } = uniqueDir(settings.projectsDir, slugify(name))

  const res = await runHyperframes(
    [
      'init',
      id,
      '--video',
      args.file,
      '--skip-transcribe',
      '--non-interactive',
      '--resolution',
      RESOLUTION[args.aspect]
    ],
    { cwd: settings.projectsDir, timeoutMs: 180_000 }
  )
  if (res.code !== 0 || !existsSync(join(dir, 'index.html'))) {
    throw new Error(
      `hyperframes init failed (${res.code}): ${(res.stderr || res.stdout).trim().slice(-800)}`
    )
  }

  const now = new Date().toISOString()
  const project: Project = {
    id,
    name,
    dir,
    aspect: args.aspect,
    source: basename(args.file),
    createdAt: now,
    lastOpenedAt: now,
    look: null
  }
  writeProject(project)
  touchRecent(project)
  return project
}

export function openProject(dir: string): Project {
  let p = readProject(dir)
  if (!p) {
    if (!existsSync(join(dir, 'index.html')) || !existsSync(join(dir, 'hyperframes.json'))) {
      throw new Error('Not a Luca / HyperFrames project folder')
    }
    const now = new Date().toISOString()
    const src = readdirSync(dir).find((f) => VIDEO_EXT.has(extname(f).toLowerCase())) ?? ''
    p = {
      id: basename(dir),
      name: basename(dir),
      dir,
      aspect: detectAspect(dir),
      source: src,
      createdAt: now,
      lastOpenedAt: now,
      look: null
    }
  }
  p.lastOpenedAt = new Date().toISOString()
  writeProject(p)
  touchRecent(p)
  return p
}

function detectAspect(dir: string): Aspect {
  try {
    const html = readFileSync(join(dir, 'index.html'), 'utf8')
    const w = Number(/data-width="(\d+)"/.exec(html)?.[1] ?? 1920)
    const h = Number(/data-height="(\d+)"/.exec(html)?.[1] ?? 1080)
    if (w === h) return 'square'
    return w > h ? 'landscape' : 'portrait'
  } catch {
    return 'landscape'
  }
}

function touchRecent(p: Project): void {
  const s = getSettings()
  const entry: RecentProject = {
    id: p.id,
    name: p.name,
    dir: p.dir,
    aspect: p.aspect,
    lastOpenedAt: p.lastOpenedAt,
    thumb: thumbFor(p.dir)
  }
  const rest = s.recentProjects.filter((r) => r.dir !== p.dir)
  updateSettings({ recentProjects: [entry, ...rest].slice(0, 12) })
}

function thumbFor(dir: string): string | null {
  const t = join(dir, '.luca', 'cache', 'thumbs', 'poster.jpg')
  if (!existsSync(t)) return null
  return `data:image/jpeg;base64,${readFileSync(t).toString('base64')}`
}

export function recentProjects(): RecentProject[] {
  const s = getSettings()
  const alive = s.recentProjects.filter((r) => existsSync(join(r.dir, 'index.html')))
  if (alive.length !== s.recentProjects.length) updateSettings({ recentProjects: alive })
  return alive.map((r) => ({ ...r, thumb: thumbFor(r.dir) }))
}

export type ProjectFile = { path: string; size: number; kind: 'html' | 'media' | 'json' | 'other' }

const SKIP_DIRS = new Set(['.git', '.luca', 'node_modules', 'renders'])

export function listFiles(dir: string): ProjectFile[] {
  const out: ProjectFile[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 4) return
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
      const abs = join(d, name)
      const st = statSync(abs)
      if (st.isDirectory()) {
        walk(abs, depth + 1)
        continue
      }
      const ext = extname(name).toLowerCase()
      const kind: ProjectFile['kind'] =
        ext === '.html'
          ? 'html'
          : VIDEO_EXT.has(ext) ||
              AUDIO_EXT.has(ext) ||
              ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
            ? 'media'
            : ext === '.json'
              ? 'json'
              : 'other'
      out.push({ path: relative(dir, abs), size: st.size, kind })
    }
  }
  walk(dir, 0)
  return out
}

export function safeJoin(dir: string, rel: string): string {
  const abs = join(dir, rel)
  const r = relative(dir, abs)
  if (r.startsWith('..') || r.includes(`..${'/'}`)) throw new Error('Path escapes project')
  return abs
}
