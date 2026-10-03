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
import { bestFit, DEFAULT_ASPECT, normalizeAspect, orientationOf, sizeOf } from '../shared/aspect'
import { editGuide, videoType } from '../shared/edits'
import { BRIEF_ONLY, MOTION_GUIDE, REFERENCE_STUDY } from '../shared/motion'
import type {
  Aspect,
  CreateProgress,
  Project,
  RecentProject,
  StartArgs,
  StartEdit,
  StartKind
} from '../shared/types'
import { childEnv, HYPERFRAMES, probeMedia, run, runHyperframes, which } from './env'
import { fitComposition } from './composition-size'
import {
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
import {
  closingOffset,
  findTagById,
  findTags,
  insertIntoRoot,
  removeElement,
  replaceTag,
  setAttrs
} from './html'
import { Channels, broadcast } from './ipc'
import { studyReference } from './reference'
import { snapshot } from './hyperframes'
import { poster } from './media'
import { hasSecret } from './secrets'
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
    const p = JSON.parse(readFileSync(f, 'utf8')) as Project
    // old projects saved an orientation ('landscape'…) as the aspect
    p.aspect = normalizeAspect(p.aspect)
    // the folder it was read from: one renamed or moved in Finder, or copied from another Mac,
    // still names the place it was made in
    p.dir = dir
    return p
  } catch {
    return null
  }
}

/**
 * The agent notes `hyperframes init` scaffolds tell agents to run preview servers and `npm run`
 * scripts; Luca's own preview shows the video, so both note files are replaced with Luca's rules.
 */
export function writeProjectNotes(dir: string): void {
  const notes = `# Edited with Luca

This video is edited inside Luca. The person sees the preview in Luca itself: never start a preview or dev server, open a browser, window or URL, or run \`npm run dev\`, \`npm run check\`, \`hyperframes preview\`, \`play\`, \`present\` or \`publish\`. To look at a frame, run \`npx ${HYPERFRAMES} snapshot\`; to check an edit, run \`npx ${HYPERFRAMES} lint --json\`.

## Project

- \`index.html\` — the main composition (root timeline); \`compositions/\` holds sub-compositions referenced with \`data-composition-src\`
- Never edit anything in \`media/\` or \`renders/\`

## Key rules

1. Every timed element needs \`data-start\` and a duration; give timed visual elements \`class="clip"\`
2. Register one paused root timeline per composition: \`window.__timelines["composition-id"] = gsap.timeline({ paused: true })\`. Scene timelines added to the root must not be paused
3. Videos use \`muted\` with a separate \`<audio>\` element for the audio track
4. Only deterministic logic — no \`Date.now()\`, no \`Math.random()\`, no network fetches

If .luca/MOTION.md exists this video is motion style: read it before your first edit in a session and follow it. If .luca/TEMPLATE.md exists this video follows a template: read it before your first edit in a session and keep every edit in it. If .luca/REFERENCE.md exists, its shot list is the structure to follow.
`
  writeFileSync(join(dir, 'CLAUDE.md'), notes)
  writeFileSync(join(dir, 'AGENTS.md'), notes)
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

/** Footage (one video or more), a voiceover, or only the brief (no video or audio file). */
export function startKind(files: string[]): StartKind {
  const exts = files.map((f) => extname(f).toLowerCase())
  if (exts.some((e) => VIDEO_EXT.has(e))) return 'video'
  if (exts.some((e) => AUDIO_EXT.has(e))) return 'audio'
  return 'brief'
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
 * A new project from the person's footage (`hyperframes init --video` with the first video, the
 * others played back to back after it) or a voiceover (`--audio`); images added next to it wait
 * in media/. Videos a browser can't play (iPhone HEVC, 10-bit, HDR) are made ready first. A
 * voiceover next to footage with no sound of its own is the voice: it becomes the project's
 * source, so the words and captions follow it (it goes on the timeline once the project is
 * made). The edit picked on the start card goes in the brief and in .luca/EDIT.md.
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
  // the first video (or the voiceover), never an image that happened to be added before it
  const main = kind === 'video' ? videos[0] : audio
  const settings = getSettings()
  const fallbackName =
    args.edit?.notes?.trim().split(/\s+/).slice(0, 6).join(' ') || 'Untitled explainer'
  const name = (args.name?.trim() || (main ? basename(main, extname(main)) : fallbackName)).slice(
    0,
    80
  )
  const { dir, id } = uniqueDir(settings.projectsDir, slugify(name))
  // prepared videos wait next to the project, on the same disk, so moving them in is instant
  const staging = join(settings.projectsDir, `.${id}-preparing`)

  const extrasLine = (added: string[]): string =>
    ` The user also added ${added.length === 1 ? 'this file' : 'these files'}, in the order they added them: ${added.join(', ')}. Use ${added.length === 1 ? 'it' : 'them'} where ${added.length === 1 ? 'it fits' : 'they fit'} (images: a logo, screenshots or pictures of what is said; audio: the voiceover when the footage is silent, music under the voice otherwise).`

  try {
    report({ stage: 'preparing', message: 'Getting ready' })
    let source: string
    let brief: string
    if (kind === 'brief') {
      // words only: a blank composition; any images or music wait in media/
      const res = await runHyperframes(
        [
          'init',
          id,
          '--non-interactive',
          '--resolution',
          orientationOf(args.aspect),
          '--example',
          'blank'
        ],
        { cwd: settings.projectsDir, timeoutMs: 240_000 }
      )
      if (res.code !== 0 || !existsSync(join(dir, 'index.html'))) {
        throw new Error(
          `Couldn't set up the project (${res.code}): ${(res.stderr || res.stdout).trim().slice(-800)}`
        )
      }
      fitComposition(dir, args.aspect)
      writeProjectNotes(dir)
      source = ''
      brief = BRIEF_ONLY
      if (args.files.length) brief += extrasLine(await importExtras(dir, args.files, report))
    } else {
      const probes = await probeAll(videos)
      // footage without sound and a voiceover: the voiceover is what is said
      const voiceover = kind === 'video' && audio && !probes[0].audio ? audio : null
      // images (and a soundtrack next to footage that has its own sound) wait in media/
      const extras =
        kind === 'video' ? [...images, ...(audio && !voiceover ? [audio] : [])] : images
      const ready = await prepareAll(videos, probes, staging, report)
      const initFile = await safelyNamed(kind === 'video' ? ready[0] : main!, staging)
      const initArgs = ['init', id, '--non-interactive', '--resolution', orientationOf(args.aspect)]
      if (kind === 'video') initArgs.push('--video', initFile, '--skip-transcribe')
      else initArgs.push('--audio', initFile, '--skip-transcribe')
      report({
        stage: 'copying',
        message:
          kind === 'audio'
            ? 'Copying your voiceover'
            : videos.length > 1
              ? 'Copying your videos'
              : 'Copying your video'
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
      fitComposition(dir, args.aspect)
      writeProjectNotes(dir)

      // the file as it is in the project: init renames the footage it converts
      source = kind === 'video' ? findSource(dir) : basename(initFile)
      if (kind === 'video') {
        const clips = await placeClips(dir, source, videos, ready, probes, report)
        const voice = voiceover ? await importVoiceover(dir, voiceover, report) : null
        if (voice) source = basename(voice.src)
        brief = videoBrief(clips, args.aspect, voice)
      } else brief = await voiceoverBrief(dir, source, args.aspect)
      if (extras.length) brief += extrasLine(await importExtras(dir, extras, report))
    }
    // the edit picked on the start card: in the first request, and kept for later turns
    const edit: StartEdit = args.edit ?? {
      type: 'talking',
      style: 'motion',
      steps: videoType('talking').steps.motion
    }
    // a template is the look and the structure, in place of a style
    const template = videoType(edit.type).template
    if (edit.style === 'motion' && !template)
      writeFileSync(join(lucaDir(dir), 'MOTION.md'), MOTION_GUIDE + '\n')
    if (template) writeFileSync(join(lucaDir(dir), template.file), template.guide + '\n')
    if (edit.reference) {
      report({ stage: 'studying', message: 'Studying your reference' })
      const r = await studyReference(dir, edit.reference)
      brief += `\n\n${REFERENCE_STUDY(r.sheets, r.seconds)}`
    }
    const guide = editGuide(edit, {
      canTranscribe: kind !== 'brief' && hasSecret('assemblyai'),
      voiceOnly: kind !== 'video',
      hearNothing: kind === 'brief'
    })
    writeFileSync(join(lucaDir(dir), 'EDIT.md'), guide + '\n')
    brief += `\n\n${guide}`
    if (template) brief += `\n\n${template.guide}`

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

/**
 * The file init copies into the project, under a name a src can hold: init writes the file's name
 * into index.html as it is, where a browser reads `#` as the start of a fragment, `?` of a query,
 * `%` of an escape and `\` as `/`, and HyperFrames' checks end the path at a `'` ("Tom's
 * video.mp4" is reported missing on every lint, which Luca is told to fix and can't). Such a
 * file waits in `staging` under a safe name, like a prepared video.
 */
async function safelyNamed(file: string, staging: string): Promise<string> {
  const name = basename(file)
  if (!/[#?%"'\\]/.test(name)) return file
  mkdirSync(staging, { recursive: true })
  const out = join(staging, uniqueFile(staging, safeName(name)))
  await copyMedia(file, out)
  return out
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
      audio: !!probes[0].audio
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
 * and its own <audio>, same tracks); the root then lasts until the end of the last one. A video
 * with no sound gets no <audio>: one whose file has no sound in it fails the export.
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
  const silent = !clips[0].audio && findTagById(html, 'a-roll-audio')
  if (silent) html = removeElement(html, silent)
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

/** A voiceover that is the voice of silent footage, as put in the project. */
type Voice = { src: string; seconds: number }

/** Copy the voiceover for silent footage into media/, where it is the project's source. */
async function importVoiceover(dir: string, file: string, report: Report): Promise<Voice> {
  report({ stage: 'scaffolding', message: 'Adding your voiceover' })
  mkdirSync(join(dir, 'media'), { recursive: true })
  const src = mediaPath(dir, safeName(basename(file)))
  await copyMedia(file, join(dir, src))
  const seconds = await probeMedia(join(dir, src)).then(
    (m) => r2(m.duration),
    () => 0
  )
  return { src, seconds }
}

/**
 * What Luca is told about the footage: every clip in order, with its start, length, shape and
 * whether it has sound, and the voiceover that is its voice when it has none.
 */
function videoBrief(clips: PlacedClip[], aspect: Aspect, voice: Voice | null): string {
  const [w, h] = sizeOf(aspect)
  const shape = (c: PlacedClip): string => `${bestFit(c.width, c.height)} ${c.width}×${c.height}`
  const cropped = clips.some((c) => bestFit(c.width, c.height) !== aspect)
    ? ` Clips shaped differently from the ${w}×${h} frame fill it and are cropped at the edges.`
    : ''
  const last = clips[clips.length - 1]
  const total = r2(last.start + last.duration)
  const voiced = voice
    ? ` The user's voiceover (${voice.src}${voice.seconds > 0 ? `, ${voice.seconds}s` : ''}) is ${clips.length === 1 ? 'its' : 'their'} voice: it plays from 0 s as its own audio clip, and transcripts and captions follow it.${voice.seconds > total ? ' It runs on past the footage, so the video is as long as the voiceover: fill the rest with visuals that follow the words.' : ''} It is never cut: cutting the voice would pull it out of step with the picture, so skip any clean edit in the plan below and say in one sentence that they can trim pauses in the timeline.`
    : ''
  if (clips.length === 1) {
    const c = clips[0]
    return `This project starts from the user's video (the a-roll clip, ${c.src}): ${c.duration}s, ${shape(c)}, ${c.audio ? 'with its own sound' : 'with no sound'}, in a ${w}×${h} (${aspect}, ${orientationOf(aspect)}) video.${cropped}${voiced} Edit it as planned below.`
  }
  const list = clips
    .map(
      (c, i) =>
        `${i + 1}. #${c.id} (${c.src}): starts at ${c.start}s, ${c.duration}s long, ${shape(c)}${c.audio ? '' : ', no sound'}`
    )
    .join('\n')
  return (
    `This project starts from ${clips.length} videos the user added, played back to back in the order they added them; each is a clip, with its own audio clip (#<id>-audio) when it has sound:\n${list}\n` +
    `The whole video is ${total}s, ${w}×${h} (${aspect}, ${orientationOf(aspect)}).${cropped}${voiced || ' Transcripts, clean edits and captions follow the first clip only.'} Edit them as planned below.`
  )
}

/** What Luca is told about a voiceover: nothing is on screen yet, so every visual is Luca's. */
async function voiceoverBrief(dir: string, source: string, aspect: Aspect): Promise<string> {
  const [w, h] = sizeOf(aspect)
  // the composition is a placeholder until the voiceover goes on the timeline: ask the file
  const file = [join(dir, 'media', source), join(dir, source)].find((f) => existsSync(f))
  const length = file
    ? await probeMedia(file).then(
        (m) => m.duration,
        () => 0
      )
    : 0
  return `This project starts from the user's voiceover (${source}${length > 0 ? `, ${r2(length)}s` : ''}, in the timeline as audio) and nothing on screen yet, in a ${w}×${h} (${aspect}, ${orientationOf(aspect)}) video. Every visual is yours to make, following what is said. Edit it as planned below.`
}

/** Images, and a soundtrack next to footage: into media/, in the order they were added. */
async function importExtras(dir: string, files: string[], report: Report): Promise<string[]> {
  const images = files.filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
  const out = images.length ? await importImages(dir, images, report) : []
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
async function importImages(dir: string, files: string[], report: Report): Promise<string[]> {
  mkdirSync(join(dir, 'media'), { recursive: true })
  const out: string[] = []
  for (let i = 0; i < files.length; i++) {
    report({
      stage: 'scaffolding',
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
    stage: 'scaffolding',
    message: `Added ${files.length} image${files.length === 1 ? '' : 's'}`,
    progress: 1
  })
  return out
}

/** Whether the project starts from a video, which gives its card a picture of its own. */
const hasFootage = (p: Project): boolean => VIDEO_EXT.has(extname(p.source).toLowerCase())

/**
 * Projects without a source video (a voiceover, or an older project started from images or an
 * idea) get their card thumbnail from a snapshot of the composition, refreshed after Luca edits
 * it.
 */
export async function refreshCompositionPoster(p: Project): Promise<void> {
  if (hasFootage(p)) return
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
  if (hasFootage(p)) return
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
  // projects made before Luca wrote its own notes still tell agents to start a preview server
  try {
    if (readFileSync(join(dir, 'CLAUDE.md'), 'utf8').includes('hyperframes preview --background'))
      writeProjectNotes(dir)
  } catch {
    // no notes yet, or unreadable: leave them alone
  }
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
    return bestFit(w, h)
  } catch {
    return DEFAULT_ASPECT
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
    // saved before the ratios: 'landscape'… → a concrete aspect
    aspect: normalizeAspect(r.aspect),
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
