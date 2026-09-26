import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import type {
  Aspect,
  CreateProgress,
  Project,
  RecentProject,
  StartArgs,
  StartKind
} from '../shared/types'
import { childEnv, run, runHyperframes, which } from './env'
import { Channels, broadcast } from './ipc'
import { snapshot } from './hyperframes'
import { poster } from './media'
import { getSettings, updateSettings } from './settings'

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm'])
export const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'])
/** Images Chromium shows as they are; others (HEIC, TIFF) are converted to JPEG on import. */
export const WEB_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])
export const IMAGE_EXT = new Set([...WEB_IMAGE_EXT, '.heic', '.heif', '.tif', '.tiff'])

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

const SIZE: Record<Aspect, [number, number]> = {
  landscape: [1920, 1080],
  portrait: [1080, 1920],
  square: [1080, 1080]
}

export function startKind(files: string[]): StartKind {
  const exts = files.map((f) => extname(f).toLowerCase())
  if (exts.some((e) => VIDEO_EXT.has(e))) return 'video'
  if (exts.some((e) => AUDIO_EXT.has(e))) return 'audio'
  if (exts.length && exts.every((e) => IMAGE_EXT.has(e))) return 'images'
  if (exts.length)
    throw new Error(`Luca can't start from ${exts.find((e) => !IMAGE_EXT.has(e))} files`)
  return 'scratch'
}

/** Keep a copy of the create call's progress so a late listener sees the current stage. */
type Report = (p: CreateProgress) => void

/**
 * A new project from anything: a video or audio file (`hyperframes init --video/--audio`), images
 * (a blank project plus a starter slideshow of the images) or nothing (the blank composition).
 */
export async function startProject(
  args: StartArgs,
  report: Report
): Promise<{ project: Project; kind: StartKind; brief: string }> {
  const kind = startKind(args.files)
  const main = kind === 'video' || kind === 'audio' ? args.files[0] : null
  const settings = getSettings()
  const fallback =
    kind === 'images'
      ? basename(args.files[0], extname(args.files[0]))
      : main
        ? basename(main, extname(main))
        : 'Untitled video'
  const name = (args.name?.trim() || fallback).slice(0, 80)
  const { dir, id } = uniqueDir(settings.projectsDir, slugify(name))

  report({ stage: 'preparing', message: 'Getting ready' })
  const initArgs = ['init', id, '--non-interactive', '--resolution', RESOLUTION[args.aspect]]
  if (kind === 'video') initArgs.push('--video', main!, '--skip-transcribe')
  else if (kind === 'audio') initArgs.push('--audio', main!, '--skip-transcribe')
  else initArgs.push('--example', 'blank')
  report({
    stage: kind === 'video' || kind === 'audio' ? 'copying' : 'scaffolding',
    message:
      kind === 'video'
        ? 'Copying your video'
        : kind === 'audio'
          ? 'Copying your audio'
          : 'Setting up a blank canvas'
  })
  const res = await runHyperframes(initArgs, {
    cwd: settings.projectsDir,
    timeoutMs: 240_000,
    onStdout: (text) => {
      // "Video: 1920x1080, 12.3s" — real steps, shown as they happen
      const line = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /^(Video|Audio):/.test(l))
      if (line) report({ stage: 'scaffolding', message: line })
    }
  })
  if (res.code !== 0 || !existsSync(join(dir, 'index.html'))) {
    throw new Error(
      `Couldn't set up the project (${res.code}): ${(res.stderr || res.stdout).trim().slice(-800)}`
    )
  }

  let brief = ''
  if (kind === 'images') {
    const images = await importImages(dir, args.files, report)
    const each = Math.max(2, Math.min(6, (args.duration ?? images.length * 3.5) / images.length))
    const total = writeSlideshow(dir, images, args.aspect, each)
    await imagePoster(dir, join(dir, images[0]), total)
    brief =
      images.length === 1
        ? `This project starts from ONE image the user added: ${images[0]}. index.html holds a simple starter (the image with a slow push-in, ${total}s). ` +
          'Turn it into a real HyperFrames video: plan 2–4 beats, animate the image with GSAP keyframes (camera moves, parallax or depth, masked reveals, light sweeps) and add the component(s) that fit best (catalog_search) or the ones the user attached. Replace the starter freely.'
        : `This project starts from ${images.length} images the user added, in order: ${images.join(', ')}. index.html holds a starter slideshow (#photo-1…#photo-${images.length}, ${each}s each, cross-fades, ${total}s). ` +
          'Turn it into a polished HyperFrames video: choose the best components for it with catalog_search (or use the ones the user attached), animate every shot with GSAP keyframes (camera moves, parallax, reveals, transitions between photos) and add titles or captions where they help. Replace the starter freely; keep the photos in this order unless the user asks otherwise.'
  } else if (kind === 'scratch') {
    const [w, h] = SIZE[args.aspect]
    brief =
      `This project starts empty: a blank ${w}×${h} composition with a placeholder title. Build the whole video from the user's description: pick components with catalog_search (or use the ones the user attached), write the scenes, then add GSAP keyframes, motion and transitions` +
      (args.duration ? `. Aim for about ${args.duration}s.` : '.')
  } else if (kind === 'audio') {
    brief =
      'This project starts from an audio track (in the timeline as audio). Build visuals that follow it: scenes, text and motion timed to the audio.'
  } else {
    brief = "This project starts from the user's video (the a-roll clip). Edit it as they describe."
  }

  const now = new Date().toISOString()
  const project: Project = {
    id,
    name,
    dir,
    aspect: args.aspect,
    source: main ? basename(main) : '',
    createdAt: now,
    lastOpenedAt: now,
    look: null
  }
  writeProject(project)
  touchRecent(project)
  void ensurePoster(project)
  return { project, kind, brief }
}

/** Copy images into media/ as image-01.jpg…, converting HEIC/TIFF so Chromium can show them. */
async function importImages(dir: string, files: string[], report: Report): Promise<string[]> {
  mkdirSync(join(dir, 'media'), { recursive: true })
  const out: string[] = []
  for (let i = 0; i < files.length; i++) {
    report({
      stage: 'media',
      message: `Adding image ${i + 1} of ${files.length}`,
      progress: i / files.length
    })
    const src = files[i]
    const ext = extname(src).toLowerCase()
    const n = String(i + 1).padStart(2, '0')
    if (WEB_IMAGE_EXT.has(ext)) {
      const rel = `media/image-${n}${ext === '.jpeg' ? '.jpg' : ext}`
      copyFileSync(src, join(dir, rel))
      out.push(rel)
      continue
    }
    const rel = `media/image-${n}.jpg`
    const sips = await which('sips')
    const ffmpeg = await which('ffmpeg')
    const r = sips
      ? await run(sips, ['-s', 'format', 'jpeg', src, '--out', join(dir, rel)], {
          timeoutMs: 60_000
        })
      : ffmpeg
        ? await run(ffmpeg, ['-y', '-v', 'error', '-i', src, join(dir, rel)], {
            env: await childEnv(),
            timeoutMs: 60_000
          })
        : null
    if (!r || r.code !== 0 || !existsSync(join(dir, rel)))
      throw new Error(`Couldn't convert ${basename(src)} to JPEG`)
    out.push(rel)
  }
  report({
    stage: 'media',
    message: `Added ${files.length} image${files.length === 1 ? '' : 's'}`,
    progress: 1
  })
  return out
}

/**
 * A working starter so the first frame shows the user's photos right away: every image full
 * frame with a slow push-in, cross-fading into the next on alternating tracks. Luca rebuilds it.
 */
function writeSlideshow(dir: string, images: string[], aspect: Aspect, each: number): number {
  const [w, h] = SIZE[aspect]
  const fade = images.length > 1 ? 0.6 : 0
  const step = each - fade
  const total = Math.round((step * images.length + fade) * 100) / 100
  const clips = images
    .map((src, i) => {
      const start = Math.round(i * step * 100) / 100
      return `      <img id="photo-${i + 1}" class="clip photo" src="${src}" alt="" data-start="${start}" data-duration="${each}" data-track-index="${i % 2}" />`
    })
    .join('\n')
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${w}, height=${h}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        width: ${w}px;
        height: ${h}px;
        overflow: hidden;
        background: #0a0a0a;
      }
      .photo {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${total}"
      data-width="${w}"
      data-height="${h}"
    >
${clips}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      // Starter made by Luca: a slow push-in on every photo, cross-fading into the next.
      const each = ${each};
      const fade = ${fade};
      document.querySelectorAll(".photo").forEach((el, i) => {
        const start = i * (each - fade);
        if (i > 0) tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: fade, ease: "power1.inOut" }, start);
        tl.fromTo(el, { scale: 1 }, { scale: 1.08, duration: each, ease: "none" }, start);
      });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`
  writeFileSync(join(dir, 'index.html'), html)
  return total
}

/** Poster and duration for projects without a source video (recent-project cards). */
export async function imagePoster(dir: string, image: string, duration: number): Promise<void> {
  const ffmpeg = await which('ffmpeg')
  const out = join(dir, '.luca', 'cache')
  mkdirSync(out, { recursive: true })
  if (ffmpeg) {
    await run(
      ffmpeg,
      [
        '-y',
        '-v',
        'error',
        '-i',
        image,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '4',
        join(out, 'poster.jpg')
      ],
      { env: await childEnv(), timeoutMs: 60_000 }
    ).catch(() => undefined)
  }
  writeFileSync(join(out, 'poster.json'), JSON.stringify({ sig: 'image', duration }))
}

/**
 * Projects without a source video (scratch, images) get their card thumbnail from a snapshot of
 * the composition, refreshed after Luca edits it.
 */
export async function refreshCompositionPoster(p: Project): Promise<void> {
  if (p.source) return
  const cache = join(p.dir, '.luca', 'cache')
  mkdirSync(cache, { recursive: true })
  let duration = 0
  try {
    duration = Number(
      /data-duration="([\d.]+)"/.exec(readFileSync(join(p.dir, 'index.html'), 'utf8'))?.[1] ?? 0
    )
  } catch {
    return
  }
  const png = join(cache, 'poster-snapshot.png')
  const ok = await snapshot(p.dir, Math.min(1.5, Math.max(0, duration / 3)), png).catch(() => false)
  const ffmpeg = await which('ffmpeg')
  if (ok && ffmpeg) {
    await run(
      ffmpeg,
      [
        '-y',
        '-v',
        'error',
        '-i',
        png,
        '-vf',
        'scale=640:-2',
        '-q:v',
        '4',
        join(cache, 'poster.jpg')
      ],
      { env: await childEnv(), timeoutMs: 60_000 }
    ).catch(() => undefined)
  }
  writeFileSync(join(cache, 'poster.json'), JSON.stringify({ sig: 'composition', duration }))
  touchRecent(p, duration)
  broadcast(Channels.projectRecentChanged, null)
}

const POSTER_DELAY_MS = 60_000
const posterPending = new Map<string, { p: Project; timer: NodeJS.Timeout }>()

/**
 * Refresh a composition poster once editing pauses: a snapshot runs a headless browser for
 * several seconds, too much to repeat after every agent turn for a thumbnail on the start screen.
 */
export function schedulePosterRefresh(p: Project): void {
  if (p.source) return
  cancelPosterRefresh(p.dir)
  const timer = setTimeout(() => {
    posterPending.delete(p.dir)
    void refreshCompositionPoster(p).catch(() => undefined)
  }, POSTER_DELAY_MS)
  posterPending.set(p.dir, { p, timer })
}

/** Refresh any pending posters now (leaving a project: its card is about to be on screen). */
export function flushPosterRefresh(): void {
  for (const { p } of [...posterPending.values()]) {
    cancelPosterRefresh(p.dir)
    void refreshCompositionPoster(p).catch(() => undefined)
  }
}

export function cancelPosterRefresh(dir: string): void {
  const pending = posterPending.get(dir)
  if (pending) clearTimeout(pending.timer)
  posterPending.delete(dir)
}

/** Remove from Recent; the project folder stays where it is. */
export function forgetRecent(dir: string): void {
  const s = getSettings()
  updateSettings({ recentProjects: s.recentProjects.filter((r) => r.dir !== dir) })
}

export function openProject(dir: string): Project {
  let p = readProject(dir)
  if (!p) {
    if (!existsSync(join(dir, 'index.html')) || !existsSync(join(dir, 'hyperframes.json'))) {
      throw new Error('This folder is not a Luca project')
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
  void ensurePoster(p)
  return p
}

async function ensurePoster(p: Project): Promise<void> {
  try {
    const r = await poster(p)
    if (r) {
      touchRecent(p, r.duration)
      broadcast(Channels.projectRecentChanged, null)
    }
  } catch (e) {
    console.warn('[luca] poster failed', e)
  }
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

function touchRecent(p: Project, duration?: number): void {
  const s = getSettings()
  const prev = s.recentProjects.find((r) => r.dir === p.dir)
  const entry: RecentProject = {
    id: p.id,
    name: p.name,
    dir: p.dir,
    aspect: p.aspect,
    lastOpenedAt: p.lastOpenedAt,
    duration: duration ?? prev?.duration ?? durationFor(p.dir),
    // read from the project's cache when listed; kept out of settings.json, which is rewritten often
    thumb: null
  }
  const rest = s.recentProjects.filter((r) => r.dir !== p.dir)
  updateSettings({ recentProjects: [entry, ...rest].slice(0, 12) })
}

function durationFor(dir: string): number | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, '.luca', 'cache', 'poster.json'), 'utf8')) as {
      duration?: number
    }
    return typeof m.duration === 'number' ? m.duration : null
  } catch {
    return null
  }
}

const thumbCache = new Map<string, { mtimeMs: number; url: string }>()

/** The poster as a data URL, re-read only when the file changes (Recent is listed often). */
function thumbFor(dir: string): string | null {
  const t = join(dir, '.luca', 'cache', 'poster.jpg')
  let mtimeMs: number
  try {
    mtimeMs = statSync(t).mtimeMs
  } catch {
    thumbCache.delete(t)
    return null
  }
  const hit = thumbCache.get(t)
  if (hit?.mtimeMs === mtimeMs) return hit.url
  const url = `data:image/jpeg;base64,${readFileSync(t).toString('base64')}`
  thumbCache.set(t, { mtimeMs, url })
  return url
}

const posterQueued = new Set<string>()

export function recentProjects(): RecentProject[] {
  const s = getSettings()
  const alive = s.recentProjects.filter((r) => existsSync(join(r.dir, 'index.html')))
  if (alive.length !== s.recentProjects.length) updateSettings({ recentProjects: alive })
  for (const r of alive) {
    if (!existsSync(join(r.dir, '.luca', 'cache', 'poster.jpg')) && !posterQueued.has(r.dir)) {
      posterQueued.add(r.dir)
      const p = readProject(r.dir)
      if (p) void ensurePoster(p)
    }
  }
  return alive.map((r) => ({
    ...r,
    thumb: thumbFor(r.dir),
    duration: r.duration ?? durationFor(r.dir)
  }))
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
