/**
 * The Studio look on a project: applying a scene plan (the composition, its host in index.html,
 * its fonts and paper texture, captions moved to fit), keeping it in step when the footage under
 * it changes, the speaker cut-out that lets the head rise out of the card, and logos for app
 * tiles.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { STUDIO_GUIDE } from '../../shared/studio'
import type { Project } from '../../shared/types'
import { fontFaceRules, installBundledFont, refreshCaptions } from '../captions'
import { childEnv, probeMedia, runHyperframes, which } from '../env'
import { findTags } from '../html'
import { lucaDir, safeJoin } from '../projects'
import { bundledResourcesDir } from '../resources'
import { checkpoint } from '../versions'
import { studioComposition, STUDIO_FILE, STUDIO_ID, type FootageClip } from './compose'
import { placeStudioHost, removeStudioHost, speakerClips } from './host'
import { studioGeometry } from './geometry'
import { imageSize } from './imagesize'
import { lookOf } from './look'
import { normalizePlan, planWarnings, type StudioPlan } from './schema'
import { readStudio, studioFile, type SavedStudio } from './zones'

export { readStudio } from './zones'
export { planSchema, type StudioPlan } from './schema'

const TEXTURE = 'media/studio/paper.jpg'

/** What the Studio look needs of a project: its folder, and the file it started from if any. */
type StudioProject = Pick<Project, 'dir'> & { source?: string | null }

function dims(html: string): { w: number; h: number; duration: number } {
  const root = findTags(html).find((t) => t.attrs['data-composition-id'] !== undefined)
  return {
    w: Number(root?.attrs['data-width'] ?? 1920) || 1920,
    h: Number(root?.attrs['data-height'] ?? 1080) || 1080,
    duration: Number(root?.attrs['data-duration'] ?? 0) || 0
  }
}

/** media/cutout-<name>.webm for a footage file: the person alone, made by speaker_cutout. */
export function cutoutPath(src: string): string {
  return `media/cutout-${basename(src, extname(src))}.webm`
}

function cutoutsFor(dir: string, clips: FootageClip[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of clips) {
    const cut = cutoutPath(c.src)
    if (existsSync(join(dir, cut))) out[c.src] = cut
  }
  return out
}

/** Changes exactly when what the composition mirrors does: the footage clips, size, cut-outs. */
function footagePrint(dir: string, html: string, source: string | null): string {
  const clips = speakerClips(html, source)
  return createHash('sha1')
    .update(JSON.stringify([clips, dims(html), cutoutsFor(dir, clips)]))
    .digest('hex')
    .slice(0, 16)
}

/**
 * The plan with every file it names checked: a logo that isn't in the project falls back to
 * letters on its tile (a broken image would render as nothing), and a missing picture is reported.
 */
function checkFiles(dir: string, plan: StudioPlan): { plan: StudioPlan; notes: string[] } {
  const notes: string[] = []
  const missing = (rel: string): boolean => {
    try {
      return !existsSync(safeJoin(dir, rel))
    } catch {
      return true
    }
  }
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix)
    if (!v || typeof v !== 'object') return v
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = fix(x)
    if (typeof out.logo === 'string' && missing(out.logo)) {
      notes.push(
        `${out.logo} isn't in the project: its tile shows letters instead. Get it with logo_add.`
      )
      delete out.logo
      delete out.tint
    }
    if (typeof out.image === 'string' && missing(out.image))
      notes.push(
        `${out.image} isn't in the project: that picture will be empty. Use a path that exists.`
      )
    return out
  }
  return { plan: fix(plan) as StudioPlan, notes }
}

/** The size of every picture and logo the plan names that is in the project. */
function imageSizes(dir: string, plan: unknown): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  const walk = (v: unknown, key?: string): void => {
    if (typeof v === 'string' && (key === 'image' || key === 'logo') && !(v in out)) {
      try {
        const size = imageSize(safeJoin(dir, v))
        if (size) out[v] = size
      } catch {
        // a path outside the project has no size
      }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x))
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k)
  }
  walk(plan)
  return out
}

/** The composition and index.html for a plan over the project as it is now. */
function build(
  p: StudioProject,
  plan: StudioPlan,
  html: string
): {
  comp: string
  index: string
  notes: string[]
  warnings: string[]
  popout: boolean
  side: boolean
} {
  const d = dims(html)
  if (!(d.duration > 0)) throw new Error('The video has no length yet.')
  // where the face is: the plan's word, else what the cut-out showed
  const face = plan.face ?? detectedFace(p.dir)
  const checked = checkFiles(p.dir, face ? { ...plan, face } : plan)
  const { plan: norm, notes: adjusted } = normalizePlan(checked.plan, d.duration)
  const notes = [...checked.notes, ...adjusted]
  const look = lookOf(norm.look)
  for (const family of look.bundled) installBundledFont(p.dir, family)
  if (look.texture) {
    const dest = join(p.dir, TEXTURE)
    if (!existsSync(dest)) {
      mkdirSync(join(p.dir, 'media', 'studio'), { recursive: true })
      copyFileSync(join(bundledResourcesDir('textures'), 'crumple.jpg'), dest)
    }
  }
  const footage = speakerClips(html, p.source ?? null)
  const cutouts = cutoutsFor(p.dir, footage)
  const comp = studioComposition(norm, {
    ...d,
    footage,
    cutouts,
    fontFaces: fontFaceRules(p.dir, look.bundled),
    texture: look.texture ? TEXTURE : null,
    images: imageSizes(p.dir, norm)
  })
  // as compose.ts decides: the head rises out of a card along the bottom, not a side card
  const popout =
    norm.popout &&
    footage.length > 0 &&
    footage.every((c) => !!cutouts[c.src]) &&
    look.id === 'paper' &&
    !studioGeometry(d.w, d.h).side
  return {
    comp,
    index: placeStudioHost(html, d.duration, p.source ?? null),
    notes,
    warnings: planWarnings(norm, d.duration),
    popout,
    side: studioGeometry(d.w, d.h).side
  }
}

function write(p: StudioProject, built: { comp: string; index: string }, saved: SavedStudio): void {
  mkdirSync(join(p.dir, 'compositions'), { recursive: true })
  writeFileSync(join(p.dir, STUDIO_FILE), built.comp)
  writeFileSync(join(p.dir, 'index.html'), built.index)
  mkdirSync(lucaDir(p.dir), { recursive: true })
  writeFileSync(studioFile(p.dir), JSON.stringify(saved, null, 2))
}

/**
 * Puts a scene plan on the video (or replaces the one there) and moves the captions to fit it.
 * `checkpoint: false` leaves the version to the caller (Luca's turn saves itself).
 */
export async function applyStudio(
  p: Project,
  plan: StudioPlan,
  opts: { checkpoint?: boolean } = {}
): Promise<{ notes: string[]; warnings: string[]; beats: number; popout: boolean; side: boolean }> {
  const html = readFileSync(join(p.dir, 'index.html'), 'utf8')
  const built = build(p, plan, html)
  // later turns read the guide from the project, whichever style it started in
  const guide = join(lucaDir(p.dir), 'STUDIO.md')
  if (!existsSync(guide)) {
    mkdirSync(lucaDir(p.dir), { recursive: true })
    writeFileSync(guide, STUDIO_GUIDE + '\n')
  }
  write(p, built, {
    plan,
    appliedAt: new Date().toISOString(),
    footage: footagePrint(p.dir, built.index, p.source)
  })
  try {
    refreshCaptions(p, { force: true })
  } catch (err) {
    console.warn('[studio] moving captions failed', err)
  }
  if (opts.checkpoint !== false) await checkpoint(p.dir, `Studio: ${plan.scenes.length} beats`)
  return {
    notes: built.notes,
    warnings: built.warnings,
    beats: plan.scenes.length,
    popout: built.popout,
    side: built.side
  }
}

/**
 * Rebuilds the composition when the footage under it changed (a clean edit, a trim, a split, a new
 * grade, a cut-out made) or the video's length did, in the plan last applied. A no-op otherwise.
 * Makes no version of its own. Returns whether anything changed.
 */
export function refreshStudio(p: StudioProject): boolean {
  const saved = readStudio(p.dir)
  if (!saved) return false
  const indexFile = join(p.dir, 'index.html')
  const html = readFileSync(indexFile, 'utf8')
  if (!html.includes(`id="${STUDIO_ID}"`)) return false
  const print = footagePrint(p.dir, html, p.source ?? null)
  if (saved.footage === print && existsSync(join(p.dir, STUDIO_FILE))) return false
  const built = build(p, saved.plan, html)
  write(p, built, { ...saved, footage: footagePrint(p.dir, built.index, p.source ?? null) })
  return true
}

export async function removeStudio(p: Project, opts: { checkpoint?: boolean } = {}): Promise<void> {
  const indexFile = join(p.dir, 'index.html')
  writeFileSync(indexFile, removeStudioHost(readFileSync(indexFile, 'utf8')))
  rmSync(join(p.dir, STUDIO_FILE), { force: true })
  rmSync(studioFile(p.dir), { force: true })
  try {
    refreshCaptions(p, { force: true })
  } catch (err) {
    console.warn('[studio] moving captions back failed', err)
  }
  if (opts.checkpoint !== false) await checkpoint(p.dir, 'Remove the Studio look')
}

// ------------------------------------------------------------------ the speaker cut-out

/**
 * The person alone, without their background, for every footage file the speaker plays: a
 * transparent video next to it (media/cutout-<name>.webm), made once by HyperFrames' local
 * background removal (a few minutes for a minute of video). Files already cut out are kept.
 */
export async function makeCutouts(
  p: Project,
  signal?: AbortSignal
): Promise<{ made: string[]; kept: string[]; face: { x: number; y: number } | null }> {
  const html = readFileSync(join(p.dir, 'index.html'), 'utf8')
  const files = [...new Set(speakerClips(html, p.source).map((c) => c.src))]
  if (!files.length) throw new Error('There is no footage of the speaker to cut out.')
  const made: string[] = []
  const kept: string[] = []
  for (const src of files) {
    const out = cutoutPath(src)
    const dest = join(p.dir, out)
    if (existsSync(dest) && statSync(dest).size > 0) {
      kept.push(out)
      continue
    }
    mkdirSync(join(p.dir, 'media'), { recursive: true })
    const part = `${out.replace(/\.webm$/, '')}.part.webm`
    const r = await runHyperframes(
      ['remove-background', src, '-o', part, '--quality', 'balanced', '--json'],
      { cwd: p.dir, timeoutMs: 60 * 60_000, signal }
    )
    if (r.code !== 0 || !existsSync(join(p.dir, part))) {
      rmSync(join(p.dir, part), { force: true })
      throw new Error(
        `Couldn't cut the speaker out of ${src}: ${(r.stderr || r.stdout).trim().slice(-400)}`
      )
    }
    copyFileSync(join(p.dir, part), dest)
    rmSync(join(p.dir, part), { force: true })
    made.push(out)
  }
  const face = await findFace(p.dir, cutoutPath(files[0])).catch(() => null)
  if (face)
    writeFileSync(speakerFile(p.dir), JSON.stringify({ face, from: cutoutPath(files[0]) }, null, 2))
  refreshStudio(p)
  return { made, kept, face }
}

// ------------------------------------------------------------------ where the face is

const speakerFile = (dir: string): string => join(lucaDir(dir), 'speaker.json')

/** The face position found in the speaker's cut-out, if one was found. */
export function detectedFace(dir: string): { x: number; y: number } | null {
  try {
    const v = JSON.parse(readFileSync(speakerFile(dir), 'utf8')) as {
      face?: { x: number; y: number }
    }
    return v.face && v.face.x >= 0 && v.face.x <= 1 && v.face.y >= 0 && v.face.y <= 1
      ? v.face
      : null
  } catch {
    return null
  }
}

/** One frame's alpha as a small grey grid: rows of `w` values 0–255. */
async function alphaGrid(file: string, at: number, w: number): Promise<Buffer | null> {
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  return new Promise((resolve) => {
    const out: Buffer[] = []
    // libvpx decodes VP9's alpha; FFmpeg's own VP9 decoder drops it
    const args = ['-v', 'error', '-c:v', 'libvpx-vp9', '-ss', String(at), '-i', file]
    args.push('-frames:v', '1', '-vf', `alphaextract,scale=${w}:-2`, '-f', 'rawvideo')
    args.push('-pix_fmt', 'gray', 'pipe:1')
    void childEnv().then(
      (env) => {
        const child = spawn(ffmpeg, args, { env })
        child.stdout.on('data', (d: Buffer) => out.push(d))
        child.on('error', () => resolve(null))
        child.on('close', (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null))
      },
      () => resolve(null)
    )
  })
}

/**
 * Where the face is in the footage (0–1), read off the cut-out at a few moments: the top of the
 * head, the head's width, and the face's center a little below the top. Null when the cut-out
 * doesn't look like one person (almost all of the frame, or almost none of it).
 */
export async function findFace(
  dir: string,
  cutout: string
): Promise<{ x: number; y: number } | null> {
  const file = join(dir, cutout)
  const seconds = await probeMedia(file).then(
    (m) => m.duration,
    () => 0
  )
  if (!(seconds > 0)) return null
  const W = 64
  const found: { x: number; y: number }[] = []
  for (const share of [0.25, 0.5, 0.75]) {
    const g = await alphaGrid(file, seconds * share, W)
    if (!g) continue
    const H = Math.floor(g.length / W)
    if (H < 8) continue
    const on = (x: number, y: number): boolean => g[y * W + x] > 128
    let covered = 0
    for (let i = 0; i < W * H; i++) if (g[i] > 128) covered++
    const coverage = covered / (W * H)
    if (coverage > 0.65 || coverage < 0.02) continue
    const rowWidth = (y: number): number => {
      let n = 0
      for (let x = 0; x < W; x++) if (on(x, y)) n++
      return n
    }
    let top = -1
    for (let y = 0; y < H && top < 0; y++) if (rowWidth(y) > W * 0.04) top = y
    if (top < 0 || top > H * 0.7) continue
    // the head is as wide as its widest row just under the top, and 1.3 times as tall
    let headW = 0
    for (let y = top; y < Math.min(H, top + Math.round(H * 0.2)); y++)
      headW = Math.max(headW, rowWidth(y))
    if (headW < 2) continue
    const headH = Math.max(2, Math.round(headW * 1.3))
    let sx = 0
    let n = 0
    for (let y = top; y < Math.min(H, top + headH); y++)
      for (let x = 0; x < W; x++)
        if (on(x, y)) {
          sx += x
          n++
        }
    if (!n) continue
    found.push({ x: sx / n / W, y: (top + headH * 0.55) / H })
  }
  if (!found.length) return null
  const mid = (vs: number[]): number => vs.sort((a, b) => a - b)[Math.floor(vs.length / 2)]
  const x = mid(found.map((f) => f.x))
  const y = mid(found.map((f) => f.y))
  return {
    x: Math.round(Math.min(0.85, Math.max(0.15, x)) * 1000) / 1000,
    y: Math.round(Math.min(0.7, Math.max(0.12, y)) * 1000) / 1000
  }
}

// ------------------------------------------------------------------ logos

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const slugOf = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'logo'

export type LogoResult = {
  path: string
  from: 'github' | 'simple-icons' | 'website'
  /** A one-color logo on a transparent background: draw it tinted on the tile. */
  tint: boolean
  /** The image itself, for the agent to look at. */
  preview: { data: string; mimeType: string } | null
}

async function grab(url: string): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length < 100 || bytes.length > 4_000_000) return null
    return { bytes, type }
  } catch {
    return null
  }
}

/**
 * A logo for an app tile, saved in media/logos/: the GitHub owner's avatar for an open-source
 * project (`github`: "ollama" or "ollama/ollama"), the brand's mark from Simple Icons (`brand`:
 * "openai", "midjourney"), or the website's icon (`site`: "ollama.com"), tried in that order.
 */
export async function addLogo(
  p: Project,
  q: { name: string; github?: string; brand?: string; site?: string }
): Promise<LogoResult> {
  const slug = slugOf(q.name)
  const dir = join(p.dir, 'media', 'logos')
  mkdirSync(dir, { recursive: true })
  const tries: { from: LogoResult['from']; url: string }[] = []
  if (q.github) {
    const owner = q.github.replace(/^https?:\/\/github\.com\//, '').split('/')[0]
    if (owner)
      tries.push({
        from: 'github',
        url: `https://github.com/${encodeURIComponent(owner)}.png?size=256`
      })
  }
  const brand = slugOf(q.brand ?? q.name).replace(/-/g, '')
  tries.push({ from: 'simple-icons', url: `https://cdn.simpleicons.org/${brand}/ffffff` })
  if (q.site) {
    const domain = q.site.replace(/^https?:\/\//, '').split('/')[0]
    tries.push({
      from: 'website',
      url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`
    })
  }
  for (const t of tries) {
    const got = await grab(t.url)
    if (!got) continue
    const svg =
      got.type.includes('svg') || got.bytes.subarray(0, 200).toString('utf8').includes('<svg')
    const png = got.type.includes('png') || got.bytes.subarray(1, 4).toString('ascii') === 'PNG'
    const jpg = got.type.includes('jpeg') || (got.bytes[0] === 0xff && got.bytes[1] === 0xd8)
    if (!svg && !png && !jpg) continue
    // Google answers an unknown site with a tiny default globe
    if (t.from === 'website' && got.bytes.length < 1500) continue
    const ext = svg ? '.svg' : png ? '.png' : '.jpg'
    const rel = `media/logos/${slug}${ext}`
    writeFileSync(join(p.dir, rel), got.bytes)
    return {
      path: rel,
      from: t.from,
      tint: t.from === 'simple-icons',
      preview: svg
        ? null
        : { data: got.bytes.toString('base64'), mimeType: png ? 'image/png' : 'image/jpeg' }
    }
  }
  throw new Error(
    `Couldn't find a logo for "${q.name}". Use letters on the tile instead (mark.mono), or ask the user to drop the logo in the chat.`
  )
}
