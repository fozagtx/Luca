import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
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
import { styleGuide } from '../shared/styles'
import { childEnv, run, runHyperframes, which } from './env'
import {
  aspectOf,
  AUDIO_EXT,
  convertImage,
  copyMedia,
  IMAGE_EXT,
  mediaPath,
  needsPreparing,
  prepareVideo,
  probeVideo,
  safeName,
  uniqueFile,
  VIDEO_EXT,
  WEB_IMAGE_EXT,
  type VideoProbe
} from './footage'
import { closingOffset, findTagById, findTags, insertIntoRoot, replaceTag, setAttrs } from './html'
import { Channels, broadcast } from './ipc'
import { snapshot } from './hyperframes'
import { poster } from './media'
import { getSettings, updateSettings } from './settings'

export { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, WEB_IMAGE_EXT }

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
  // made now (init takes an empty folder), so a second start at the same time can't pick it too
  mkdirSync(join(root, id))
  return { dir: join(root, id), id }
}

const RESOLUTION: Record<Aspect, string> = {
  landscape: 'landscape',
  portrait: 'portrait',
  square: 'square'
}

/** Composition pixels for each aspect ratio. */
export const SIZE: Record<Aspect, [number, number]> = {
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

const r2 = (n: number): number => Math.round(n * 100) / 100

/** One of the videos a project starts from, as placed on the timeline. */
type PlacedClip = {
  id: string
  /** Project-relative file. */
  src: string
  start: number
  duration: number
  /** Shape as shown (rotation applied). */
  width: number
  height: number
  audio: boolean
}

/**
 * A new project from anything: videos (`hyperframes init --video` with the first, the others
 * played back to back after it), an audio file (`--audio`), images (a blank project plus a
 * starter slideshow of the images) or nothing (the blank composition). Videos a browser can't
 * play (iPhone HEVC, 10-bit, HDR) are made ready first.
 */
export async function startProject(
  args: StartArgs,
  report: Report
): Promise<{ project: Project; kind: StartKind; brief: string }> {
  const kind = startKind(args.files)
  const ofType = (set: Set<string>): string[] =>
    args.files.filter((f) => set.has(extname(f).toLowerCase()))
  const videos = ofType(VIDEO_EXT)
  const images = ofType(IMAGE_EXT)
  const audio = ofType(AUDIO_EXT)[0] ?? null
  // the first video (or the audio), never an image that happened to be added before it
  const main = kind === 'video' ? videos[0] : kind === 'audio' ? audio : null
  // next to footage or a soundtrack, images (and a soundtrack next to footage) wait in media/
  const extras =
    kind === 'video' ? [...images, ...(audio ? [audio] : [])] : kind === 'audio' ? images : []
  const settings = getSettings()
  const fallback =
    kind === 'images'
      ? basename(images[0], extname(images[0]))
      : main
        ? basename(main, extname(main))
        : 'Untitled video'
  const name = (args.name?.trim() || fallback).slice(0, 80)
  const { dir, id } = uniqueDir(settings.projectsDir, slugify(name))
  // prepared videos wait next to the project, on the same disk, so moving them in is instant
  const staging = join(settings.projectsDir, `.${id}-preparing`)

  try {
    report({ stage: 'preparing', message: 'Getting ready' })
    const probes = await probeAll(videos)
    const ready = await prepareAll(videos, probes, staging, report)
    const initArgs = ['init', id, '--non-interactive', '--resolution', RESOLUTION[args.aspect]]
    if (kind === 'video') initArgs.push('--video', ready[0], '--skip-transcribe')
    else if (kind === 'audio') initArgs.push('--audio', main!, '--skip-transcribe')
    else initArgs.push('--example', 'blank')
    report({
      stage: kind === 'video' || kind === 'audio' ? 'copying' : 'scaffolding',
      message:
        kind === 'video'
          ? videos.length > 1
            ? 'Copying your videos'
            : 'Copying your video'
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
    // the file as it is in the project: init renames what it converts
    let source = main ? basename(main) : ''
    if (kind === 'images') {
      const added = await importImages(dir, images, report)
      const each = Math.max(2, Math.min(6, (args.duration ?? added.length * 3.5) / added.length))
      const total = writeSlideshow(dir, added, args.aspect, each)
      await imagePoster(dir, join(dir, added[0]), total)
      brief =
        added.length === 1
          ? `This project starts from ONE image the user added: ${added[0]}. index.html holds a simple starter (the image with a slow push-in, ${total}s). ` +
            'Turn it into a real HyperFrames video: plan 2–4 beats, animate the image with GSAP keyframes (camera moves, parallax or depth, masked reveals, light sweeps) and add the component(s) that fit best (catalog_search) or the ones the user attached. Replace the starter freely.'
          : `This project starts from ${added.length} images the user added, in order: ${added.join(', ')}. index.html holds a starter slideshow (#photo-1…#photo-${added.length}, ${each}s each, cross-fades, ${total}s). ` +
            'Turn it into a polished HyperFrames video: choose the best components for it with catalog_search (or use the ones the user attached), animate every shot with GSAP keyframes (camera moves, parallax, reveals, transitions between photos) and add titles or captions where they help. Replace the starter freely; keep the photos in this order unless the user asks otherwise.'
    } else if (kind === 'scratch') {
      const [w, h] = SIZE[args.aspect]
      brief =
        `This project starts empty: a blank ${w}×${h} composition with a placeholder title. Build the whole video from the user's description: pick components with catalog_search (or use the ones the user attached), give the scenes a real photo or short video background with background_search (or the one the user picked) instead of a gradient, write the scenes, then add GSAP keyframes, motion and transitions` +
        (args.duration ? `. Aim for about ${args.duration}s.` : '.')
    } else if (kind === 'audio') {
      brief =
        'This project starts from an audio track (in the timeline as audio). Build visuals that follow it: scenes, text and motion timed to the audio.'
    } else {
      source = findSource(dir)
      const clips = await placeClips(dir, source, videos, ready, probes, report)
      brief = videoBrief(clips, args.aspect)
    }
    if (extras.length) {
      const added = await importExtras(dir, extras, report)
      brief += ` The user also added ${added.length === 1 ? 'this file' : 'these files'}, in the order they added them: ${added.join(', ')}. Use ${added.length === 1 ? 'it' : 'them'} where ${added.length === 1 ? 'it fits' : 'they fit'} what the user asks for (images as cutaways, a logo or an intro; audio as music).`
    }
    // the look picked on the start steps: in the first request, and kept for later edits
    const guide = styleGuide(
      args.style,
      kind === 'images' || kind === 'scratch' ? args.duration : undefined
    )
    if (guide) {
      writeFileSync(join(lucaDir(dir), 'STYLE.md'), guide + '\n')
      brief += `\n\n${guide}`
    }

    const now = new Date().toISOString()
    const project: Project = {
      id,
      name,
      dir,
      aspect: args.aspect,
      source,
      createdAt: now,
      lastOpenedAt: now,
      look: null
    }
    writeProject(project)
    touchRecent(project)
    void ensurePoster(project)
    return { project, kind, brief }
  } catch (err) {
    // the folder is this call's own (uniqueDir made it): don't leave half a project behind
    rmSync(dir, { recursive: true, force: true })
    throw err
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Read every video first, so one Luca can't use stops the start before anything is made. */
function probeAll(videos: string[]): Promise<VideoProbe[]> {
  return Promise.all(
    videos.map(async (f) => {
      const p = await probeVideo(f)
      if (!p) throw new Error(`Luca can't read ${basename(f)} as a video`)
      return p
    })
  )
}

/** Each video as it goes into the project: itself, or a copy made ready to play in `staging`. */
async function prepareAll(
  videos: string[],
  probes: VideoProbe[],
  staging: string,
  report: Report
): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < videos.length; i++) {
    if (!needsPreparing(probes[i])) {
      out.push(videos[i])
      continue
    }
    mkdirSync(staging, { recursive: true })
    const message =
      videos.length === 1 ? 'Preparing your video' : `Preparing video ${i + 1} of ${videos.length}`
    const file = uniqueFile(staging, safeName(`${basename(videos[i], extname(videos[i]))}.mp4`))
    report({ stage: 'copying', message, progress: 0 })
    out.push(
      await prepareVideo(
        videos[i],
        join(staging, file),
        (progress) => report({ stage: 'copying', message, progress }),
        probes[i]
      )
    )
  }
  return out
}

/**
 * The first video is init's a-roll at 0 s; the others go into media/ and play back to back
 * after it. Returns every clip as placed.
 */
async function placeClips(
  dir: string,
  source: string,
  videos: string[],
  ready: string[],
  probes: VideoProbe[],
  report: Report
): Promise<PlacedClip[]> {
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  const first = Number(findTagById(html, 'a-roll')?.attrs['data-duration'])
  const clips: PlacedClip[] = [
    {
      id: 'a-roll',
      src: source,
      start: 0,
      duration: first || r2(probes[0].duration),
      width: probes[0].width,
      height: probes[0].height,
      audio: true
    }
  ]
  const media = join(dir, 'media')
  for (let i = 1; i < videos.length; i++) {
    report({ stage: 'scaffolding', message: `Adding clip ${i + 1} of ${videos.length}` })
    mkdirSync(media, { recursive: true })
    const rel = mediaPath(dir, safeName(basename(ready[i])))
    // a prepared copy is Luca's own and moves in; the person's original is copied
    const prepared = ready[i] !== videos[i]
    if (prepared) renameSync(ready[i], join(dir, rel))
    else await copyMedia(ready[i], join(dir, rel))
    const p = prepared ? ((await probeVideo(join(dir, rel))) ?? probes[i]) : probes[i]
    const prev = clips[clips.length - 1]
    clips.push({
      id: `a-roll-${i + 1}`,
      src: rel,
      start: r2(prev.start + prev.duration),
      duration: r2(p.duration),
      width: p.width,
      height: p.height,
      audio: !!p.audio
    })
  }
  writeClips(dir, clips)
  return clips
}

/**
 * Time the a-roll from 0 s (init leaves its <video> untimed, which lint reports as an error) and
 * write the clips after it right below it, with the markup `init` writes for it (a muted <video>
 * and its own <audio>, same tracks); the root then lasts until the end of the last one.
 */
function writeClips(dir: string, clips: PlacedClip[]): void {
  const file = join(dir, 'index.html')
  let html = readFileSync(file, 'utf8')
  const first = findTagById(html, 'a-roll')
  if (first && first.attrs['data-start'] === undefined)
    html = replaceTag(
      html,
      first,
      first.raw.replace(/(\s+)data-duration=/, '$1data-start="0"$1data-duration=')
    )
  if (clips.length > 1) {
    const anchor = findTagById(html, 'a-roll-audio') ?? findTagById(html, 'a-roll')
    const close = anchor ? closingOffset(html, anchor) : null
    const pad = anchor ? (/[ \t]*$/.exec(html.slice(0, anchor.start))?.[0] ?? '') : '      '
    const markup = clips
      .slice(1)
      .map((c) => clipMarkup(c, pad))
      .join('\n')
    if (close) html = html.slice(0, close.end) + '\n' + markup + html.slice(close.end)
    else html = insertIntoRoot(html, markup + '\n') ?? html
    const last = clips[clips.length - 1]
    const root = findTags(html).find((t) => t.attrs['data-composition-id'])
    if (root)
      html = replaceTag(
        html,
        root,
        setAttrs(root, { 'data-duration': String(r2(last.start + last.duration)) })
      )
  }
  writeFileSync(file, html)
}

function clipMarkup(c: PlacedClip, pad: string): string {
  const video = [
    '<video',
    `  id="${c.id}"`,
    '  class="clip"',
    `  src="${c.src}"`,
    '  muted',
    '  playsinline',
    `  data-start="${c.start}"`,
    `  data-duration="${c.duration}"`,
    '  data-track-index="0"',
    '  style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover"',
    '></video>'
  ]
  const audio = [
    '<audio',
    `  id="${c.id}-audio"`,
    `  src="${c.src}"`,
    `  data-start="${c.start}"`,
    `  data-duration="${c.duration}"`,
    '  data-track-index="2"',
    '  data-volume="1"',
    '></audio>'
  ]
  return [...video, ...(c.audio ? audio : [])].map((l) => pad + l).join('\n')
}

/** What Luca is told about the footage: every clip in order, with its start, length and shape. */
function videoBrief(clips: PlacedClip[], aspect: Aspect): string {
  const [w, h] = SIZE[aspect]
  const shape = (c: PlacedClip): string => `${aspectOf(c.width, c.height)} ${c.width}×${c.height}`
  const cropped = clips.some((c) => aspectOf(c.width, c.height) !== aspect)
    ? ` Clips shaped differently from the ${w}×${h} frame fill it and are cropped at the edges.`
    : ''
  if (clips.length === 1) {
    const c = clips[0]
    return `This project starts from the user's video (the a-roll clip, ${c.src}): ${c.duration}s, ${shape(c)}, in a ${w}×${h} ${aspect} video.${cropped} Edit it as they describe.`
  }
  const last = clips[clips.length - 1]
  const list = clips
    .map(
      (c, i) =>
        `${i + 1}. #${c.id} (${c.src}): starts at ${c.start}s, ${c.duration}s long, ${shape(c)}${c.audio ? '' : ', no sound'}`
    )
    .join('\n')
  return (
    `This project starts from ${clips.length} videos the user added, played back to back in the order they added them; each is a clip with its own audio clip (#<id>-audio):\n${list}\n` +
    `The whole video is ${r2(last.start + last.duration)}s, ${w}×${h} (${aspect}).${cropped} Transcripts, clean edits and captions follow the first clip only. Edit them as they describe.`
  )
}

/** Images and a soundtrack added next to the footage or audio: into media/, in order. */
async function importExtras(dir: string, files: string[], report: Report): Promise<string[]> {
  const images = files.filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
  const out = images.length ? await importImages(dir, images, report, 'scaffolding') : []
  for (const f of files.filter((f) => AUDIO_EXT.has(extname(f).toLowerCase()))) {
    report({ stage: 'scaffolding', message: 'Adding your audio' })
    mkdirSync(join(dir, 'media'), { recursive: true })
    const rel = mediaPath(dir, safeName(basename(f)))
    await copyMedia(f, join(dir, rel))
    out.push(rel)
  }
  return out
}

/** Copy images into media/ as image-01.jpg…, converting HEIC/TIFF so Chromium can show them. */
async function importImages(
  dir: string,
  files: string[],
  report: Report,
  stage: CreateProgress['stage'] = 'media'
): Promise<string[]> {
  mkdirSync(join(dir, 'media'), { recursive: true })
  const out: string[] = []
  for (let i = 0; i < files.length; i++) {
    report({
      stage,
      message: `Adding image ${i + 1} of ${files.length}`,
      progress: i / files.length
    })
    const src = files[i]
    const ext = extname(src).toLowerCase()
    const n = String(i + 1).padStart(2, '0')
    const rel = WEB_IMAGE_EXT.has(ext)
      ? `media/image-${n}${ext === '.jpeg' ? '.jpg' : ext}`
      : `media/image-${n}.jpg`
    if (WEB_IMAGE_EXT.has(ext)) copyFileSync(src, join(dir, rel))
    else await convertImage(src, join(dir, rel))
    out.push(rel)
  }
  report({
    stage,
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
    p = {
      id: basename(dir),
      name: basename(dir),
      dir,
      aspect: detectAspect(dir),
      source: findSource(dir),
      createdAt: now,
      lastOpenedAt: now,
      look: null
    }
  }
  // projects started from iPhone footage before Luca prepared it named the file init replaced
  // (IMG_1234.MOV for IMG_1234.mp4), which left transcription, clean edit and posters without it
  if (p.source && !['', 'media'].some((d) => existsSync(join(dir, d, p!.source))))
    p.source = findSource(dir) || p.source
  p.lastOpenedAt = new Date().toISOString()
  writeProject(p)
  touchRecent(p)
  void ensurePoster(p)
  return p
}

/** The a-roll's file at the project root, as init left it (converted footage is renamed .mp4). */
function findSource(dir: string): string {
  const videos = readdirSync(dir).filter((f) => VIDEO_EXT.has(extname(f).toLowerCase()))
  let src: string | undefined
  try {
    src = findTagById(readFileSync(join(dir, 'index.html'), 'utf8'), 'a-roll')?.attrs.src
  } catch {
    // no composition yet: take the video at the root
  }
  return videos.find((f) => f === src) ?? videos[0] ?? ''
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
