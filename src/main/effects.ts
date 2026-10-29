import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import type { EffectItem, EffectPreviewResult, EffectsStatus, Project } from '../shared/types'
import { EFFECTS } from '../shared/effects'
import { childEnv, run, which } from './env'
import { footageVideos } from './color'
import { probeVideo } from './footage'
import { replaceTag, setAttrs, type TagMatch } from './html'
import { safeJoin } from './projects'
import { Channels, broadcast } from './ipc'
import { bundledResourcesDir } from './resources'
import { refreshStudio } from './studio'
import { checkpoint } from './versions'

type EffectClip = { out: string; effects: EffectItem[] }
type EffectsFile = { clips: Record<string, EffectClip> }
type MappedFootage = {
  tag: TagMatch
  base: string
  file: string
  timelineStart: number
  duration: number
  mediaStart: number
}
export type EffectStill = { fx: string; title: string; start: number; end: number; jpeg: string }
export type ApplyEffectsResult = {
  ok: true
  applied: { fx: string; title: string; start: number; end: number }[]
  output: string[]
  stills: EffectStill[]
}

const STATUS_MESSAGES: Record<EffectsStatus['state'], string> = {
  unknown: 'Effects are ready to set up.',
  installing: 'Setting up effects — one time, about 2 minutes.',
  ready: 'Effects are ready.',
  'needs-python':
    'Effects need Python 3.12. Install it from python.org (or `brew install python@3.12`), then open this menu again.',
  'needs-ffmpeg': 'Effects need ffmpeg and ffprobe. Install ffmpeg, then open this menu again.',
  error: 'Effects could not be set up. Please try again.'
}

let status: EffectsStatus = { state: 'unknown', message: STATUS_MESSAGES.unknown }
let setupPromise: Promise<EffectsStatus> | null = null
let previewRunning = false
let queuedPreview: {
  key: string
  work: () => Promise<EffectPreviewResult>
  resolve: (r: EffectPreviewResult) => void
} | null = null
const previewPromises = new Map<string, Promise<EffectPreviewResult>>()

const pythonPath = (venv: string): string =>
  process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
const effectsRoot = (): string => bundledResourcesDir('effects')
const pythonScript = (): string => join(effectsRoot(), 'scripts', 'fx.py')

function setStatus(next: EffectsStatus): EffectsStatus {
  status = next
  broadcast(Channels.effectsStatusPush, next)
  return next
}

export function effectsStatus(): EffectsStatus {
  return status
}

async function pythonVersion(path: string): Promise<number | null> {
  const env = await childEnv()
  const result = await run(
    path,
    ['-c', 'import sys; print(sys.version_info.major * 100 + sys.version_info.minor)'],
    { env, timeoutMs: 10_000 }
  )
  if (result.code !== 0) return null
  const version = Number(result.stdout.trim())
  return Number.isFinite(version) ? version : null
}

async function checkReady(venv: string): Promise<boolean> {
  const python = pythonPath(venv)
  if (!existsSync(python)) return false
  const env = await childEnv()
  const result = await run(python, ['-c', 'import mediapipe, cv2, PIL, numpy'], {
    env,
    timeoutMs: 30_000
  })
  return result.code === 0
}

async function installWithPython(python: string, venv: string): Promise<boolean> {
  const env = await childEnv()
  const create = await run(python, ['-m', 'venv', venv], { env, timeoutMs: 120_000 })
  if (create.code !== 0) return false
  const vpy = pythonPath(venv)
  const upgrade = await run(vpy, ['-m', 'pip', 'install', '-q', '--upgrade', 'pip'], {
    env,
    timeoutMs: 300_000
  })
  if (upgrade.code !== 0) return false
  const install = await run(
    vpy,
    ['-m', 'pip', 'install', '-q', '-r', join(effectsRoot(), 'requirements.txt')],
    { env, timeoutMs: 900_000 }
  )
  return install.code === 0
}

async function installWithUv(uv: string, venv: string): Promise<boolean> {
  const env = await childEnv()
  const create = await run(uv, ['venv', '-q', '-p', '3.12', venv], {
    env,
    timeoutMs: 300_000
  })
  if (create.code !== 0) return false
  const install = await run(
    uv,
    ['pip', 'install', '-q', '-p', pythonPath(venv), '-r', join(effectsRoot(), 'requirements.txt')],
    { env, timeoutMs: 900_000 }
  )
  return install.code === 0
}

async function setup(): Promise<EffectsStatus> {
  setStatus({ state: 'installing', message: STATUS_MESSAGES.installing })
  try {
    const ffmpeg = await which('ffmpeg')
    const ffprobe = await which('ffprobe')
    if (!ffmpeg || !ffprobe)
      return setStatus({ state: 'needs-ffmpeg', message: STATUS_MESSAGES['needs-ffmpeg'] })

    const venv = join(app.getPath('userData'), 'effects-venv')
    if (await checkReady(venv)) return setStatus({ state: 'ready', message: STATUS_MESSAGES.ready })
    const candidates: string[] = []
    for (const name of ['python3.12', 'python3.11', 'python3.13', 'python3.10', 'python3']) {
      const path = await which(name)
      if (path && !candidates.includes(path)) candidates.push(path)
    }
    let installed = false
    let foundPython = false
    for (const python of candidates) {
      const version = await pythonVersion(python).catch(() => null)
      if (version === null || version < 310) continue
      foundPython = true
      if (await installWithPython(python, venv)) {
        installed = true
        break
      }
      const uv = await which('uv')
      if (uv && (await installWithUv(uv, venv))) {
        installed = true
        break
      }
    }
    if (!installed) {
      const uv = await which('uv')
      if (uv && (await installWithUv(uv, venv))) installed = true
    }
    if (!installed) {
      if (!foundPython)
        return setStatus({ state: 'needs-python', message: STATUS_MESSAGES['needs-python'] })
      return setStatus({
        state: 'error',
        message: 'Effects could not be installed. Check your internet connection and try again.'
      })
    }
    if (!(await checkReady(venv)))
      return setStatus({
        state: 'error',
        message: 'Effects finished setting up but could not start. Please try again.'
      })
    return setStatus({ state: 'ready', message: STATUS_MESSAGES.ready })
  } catch {
    return setStatus({ state: 'error', message: STATUS_MESSAGES.error })
  }
}

export function setupEffects(): Promise<EffectsStatus> {
  if (status.state === 'ready') return Promise.resolve(status)
  if (!setupPromise) {
    setupPromise = setup().finally(() => {
      setupPromise = null
    })
  }
  return setupPromise
}

function normalizedSrc(src: string): string {
  return src.replace(/^\.\//, '').split(/[?#]/)[0]
}

function numberAttr(tag: TagMatch, key: string, fallback: number): number {
  const n = Number(tag.attrs[key])
  return Number.isFinite(n) ? n : fallback
}

function readEffectsFile(dir: string): EffectsFile {
  const file = join(dir, '.luca', 'effects.json')
  if (!existsSync(file)) return { clips: {} }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as EffectsFile
    return raw && raw.clips && typeof raw.clips === 'object' ? raw : { clips: {} }
  } catch {
    return { clips: {} }
  }
}

export function effectBaseForSrc(dir: string, src: string): string {
  const wanted = normalizedSrc(src)
  const clips = readEffectsFile(dir).clips
  return Object.entries(clips).find(([, clip]) => normalizedSrc(clip.out) === wanted)?.[0] ?? wanted
}

export function clearEffectsForBases(dir: string, bases: string[]): string[] {
  if (!bases.length) return []
  const file = join(dir, '.luca', 'effects.json')
  const state = readEffectsFile(dir)
  const removed: string[] = []
  for (const base of bases) {
    const clip = state.clips[base]
    if (!clip) continue
    for (const item of clip.effects) {
      const id = normalizeEffect(item.fx)
      const effect = EFFECTS.find((entry) => entry.id === id)
      if (effect && !removed.includes(effect.title)) removed.push(effect.title)
    }
    delete state.clips[base]
  }
  if (removed.length) writeFileSync(file, JSON.stringify(state, null, 2) + '\n')
  return removed
}

export function currentEffects(p: Pick<Project, 'dir'>): {
  applied: { fx: string; title: string; start: number; end: number }[]
  output: string[]
} {
  const clips = readEffectsFile(p.dir).clips
  const applied = Object.values(clips).flatMap((clip) =>
    clip.effects.map((item) => {
      const fx = normalizeEffect(item.fx)
      return { fx, title: effectTitle(fx), start: item.start, end: item.end }
    })
  )
  return { applied, output: Object.values(clips).map((clip) => clip.out) }
}

function normalizeEffect(name: string): string {
  const key = name.trim().toLowerCase().replace(/^\/+/, '')
  const direct = EFFECTS.find((effect) => effect.id === key)
  if (direct) return direct.id
  return EFFECTS.find((effect) => effect.aliases.includes(key))?.id ?? key
}

function mapFootage(p: Pick<Project, 'dir'>, time: number): MappedFootage | null {
  const html = readFileSync(join(p.dir, 'index.html'), 'utf8')
  const tags = footageVideos(html)
  if (!tags.length) return null
  const selected =
    tags.find((tag) => {
      const start = numberAttr(tag, 'data-start', 0)
      const duration = numberAttr(tag, 'data-duration', Number.POSITIVE_INFINITY)
      return start <= time && time < start + duration
    }) ?? tags[0]
  const src = normalizedSrc(selected.attrs.src ?? '')
  const base = effectBaseForSrc(p.dir, src)
  const baseFile = safeJoin(p.dir, base)
  const timelineStart = numberAttr(selected, 'data-start', 0)
  const mediaStart = numberAttr(selected, 'data-media-start', 0)
  return {
    tag: selected,
    base,
    file: baseFile,
    timelineStart,
    duration: numberAttr(selected, 'data-duration', Number.POSITIVE_INFINITY),
    mediaStart
  }
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

async function previewOutput(
  p: Pick<Project, 'dir'>,
  fx: string,
  at: number
): Promise<EffectPreviewResult> {
  let mapped: MappedFootage | null
  try {
    mapped = mapFootage(p, at)
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
  if (!mapped)
    return {
      ok: false,
      reason: 'no-footage',
      message: 'Effects need a video of you on camera in this project.'
    }
  const setupStatus = status.state === 'ready' ? status : await setupEffects()
  if (setupStatus.state !== 'ready')
    return { ok: false, reason: 'setup', message: setupStatus.message ?? STATUS_MESSAGES.error }
  const ffmpeg = await which('ffmpeg')
  const ffprobe = await which('ffprobe')
  if (!ffmpeg || !ffprobe)
    return {
      ok: false,
      reason: 'setup',
      message: STATUS_MESSAGES['needs-ffmpeg']
    }
  const probe = await probeVideo(mapped.file).catch(() => null)
  if (!probe) return { ok: false, reason: 'error', message: 'Luca could not read this video.' }
  const mediaAt = Math.max(0, at - mapped.timelineStart + mapped.mediaStart)
  const duration = Math.min(3, probe.duration)
  const start = Math.max(0, Math.min(mediaAt, Math.max(0, probe.duration - duration)))
  const rounded = Math.round(start * 2) / 2
  const cacheDir = join(app.getPath('userData'), 'effect-previews')
  mkdirSync(cacheDir, { recursive: true })
  const key = sha1(`${p.dir}${mapped.base}${statSync(mapped.file).mtimeMs}${rounded}${fx}`)
  const cacheFile = join(cacheDir, `${key}.mp4`)
  if (existsSync(cacheFile) && statSync(cacheFile).size > 0)
    return {
      ok: true,
      url: `data:video/mp4;base64,${(await readFile(cacheFile)).toString('base64')}`
    }

  const temp = await mkdtemp(join(tmpdir(), 'luca-effect-preview-'))
  try {
    const clip = join(temp, 'clip.mp4')
    const output = join(temp, 'preview.mp4')
    const env = await childEnv()
    const scale = probe.width <= probe.height ? 'scale=480:-2' : 'scale=-2:480'
    const cut = await run(
      ffmpeg,
      [
        '-y',
        '-v',
        'error',
        '-ss',
        String(start),
        '-i',
        mapped.file,
        '-t',
        String(duration),
        '-vf',
        scale,
        '-r',
        '15',
        '-an',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        clip
      ],
      { env, timeoutMs: 120_000 }
    )
    if (cut.code !== 0)
      return { ok: false, reason: 'error', message: 'Luca could not prepare this preview.' }
    const python = pythonPath(join(app.getPath('userData'), 'effects-venv'))
    const rendered = await run(
      python,
      [
        pythonScript(),
        fx,
        clip,
        output,
        '--start',
        '0',
        '--end',
        String(duration),
        '--width',
        '360'
      ],
      { env, timeoutMs: 900_000 }
    )
    if (rendered.code !== 0 || !existsSync(output))
      return { ok: false, reason: 'error', message: 'Luca could not make this preview.' }
    writeFileSync(cacheFile, readFileSync(output))
    const url = `data:video/mp4;base64,${readFileSync(cacheFile).toString('base64')}`
    return { ok: true, url }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function runPreviewJob(job: {
  key: string
  work: () => Promise<EffectPreviewResult>
  resolve: (r: EffectPreviewResult) => void
}): void {
  previewRunning = true
  void job
    .work()
    .then(job.resolve)
    .catch((error: unknown) =>
      job.resolve({
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    )
    .finally(() => {
      previewPromises.delete(job.key)
      previewRunning = false
      if (queuedPreview) {
        const next = queuedPreview
        queuedPreview = null
        runPreviewJob(next)
      }
    })
}

export function previewEffect(
  p: Pick<Project, 'dir'>,
  fx: string,
  at: number
): Promise<EffectPreviewResult> {
  const key = `${p.dir}:${fx}:${Math.round(at * 2) / 2}`
  const shared = previewPromises.get(key)
  if (shared) {
    if (queuedPreview && queuedPreview.key !== key) {
      queuedPreview.resolve({ ok: false, reason: 'error', message: 'superseded' })
      previewPromises.delete(queuedPreview.key)
      queuedPreview = null
    }
    return shared
  }
  let resolve!: (result: EffectPreviewResult) => void
  const promise = new Promise<EffectPreviewResult>((done) => {
    resolve = done
  })
  const job = { key, work: () => previewOutput(p, fx, at), resolve }
  previewPromises.set(key, promise)
  if (!previewRunning) runPreviewJob(job)
  else {
    if (queuedPreview) {
      queuedPreview.resolve({ ok: false, reason: 'error', message: 'superseded' })
      previewPromises.delete(queuedPreview.key)
    }
    queuedPreview = job
  }
  return promise
}

function effectTitle(fx: string): string {
  const id = normalizeEffect(fx)
  return EFFECTS.find((effect) => effect.id === id)?.title ?? id
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = old
    }
  }
  return row[b.length]
}

function validatedEffect(fx: string): string {
  const id = normalizeEffect(fx)
  if (EFFECTS.some((effect) => effect.id === id)) return id
  const nearest = EFFECTS.map((effect) => ({
    id: effect.id,
    score: distance(fx.toLowerCase(), effect.id)
  }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((entry) => entry.id)
  throw new Error(`Unknown effect "${fx}". Closest effects: ${nearest.join(', ')}.`)
}

function planItem(item: EffectItem, start: number, end: number): Record<string, unknown> {
  return {
    ...(item.options ?? {}),
    fx: validatedEffect(item.fx),
    start,
    end,
    ...(item.text ? { text: item.text } : {})
  }
}

type PlannedItem = { sourceItem: EffectItem; mapped: MappedFootage; start: number; end: number }

async function saveStill(
  ffmpeg: string,
  env: NodeJS.ProcessEnv,
  video: string,
  at: number,
  output: string
): Promise<string | null> {
  const result = await run(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-ss',
      String(Math.max(0, at)),
      '-i',
      video,
      '-frames:v',
      '1',
      '-vf',
      'scale=768:768:force_original_aspect_ratio=decrease',
      '-q:v',
      '2',
      output
    ],
    { env, timeoutMs: 60_000 }
  )
  if (result.code !== 0 || !existsSync(output)) return null
  return (await readFile(output)).toString('base64')
}

export async function applyEffects(
  p: Project,
  items: EffectItem[],
  signal?: AbortSignal
): Promise<ApplyEffectsResult> {
  const state = readEffectsFile(p.dir)
  const htmlFile = join(p.dir, 'index.html')
  const html = readFileSync(htmlFile, 'utf8')
  const tags = footageVideos(html)
  if (items.length && !tags.length)
    throw new Error('Effects need a video of you on camera in this project.')

  const grouped = new Map<string, PlannedItem[]>()
  for (const item of items) {
    const sourceItem = { ...item, fx: validatedEffect(item.fx) }
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end <= item.start)
      throw new Error(`"${item.fx}" needs an end time after its start time.`)
    const mapped = mapFootage(p, sourceItem.start)
    if (!mapped) throw new Error('Effects need a video of you on camera in this project.')
    const clipEnd = mapped.timelineStart + mapped.duration
    const timelineEnd = Math.min(sourceItem.end, clipEnd)
    const start = Math.max(0, sourceItem.start - mapped.timelineStart + mapped.mediaStart)
    const end = Math.min(
      sourceItem.end - mapped.timelineStart + mapped.mediaStart,
      timelineEnd - mapped.timelineStart + mapped.mediaStart
    )
    if (end <= start) throw new Error(`"${sourceItem.fx}" falls outside the selected video clip.`)
    const planned = { sourceItem, mapped, start, end }
    const list = grouped.get(mapped.base) ?? []
    list.push(planned)
    grouped.set(mapped.base, list)
  }

  const venv = join(app.getPath('userData'), 'effects-venv')
  let env: NodeJS.ProcessEnv = process.env
  let ffmpeg: string | null = null
  if (items.length) {
    env = await childEnv()
    ffmpeg = await which('ffmpeg')
    if (!ffmpeg) throw new Error(STATUS_MESSAGES['needs-ffmpeg'])
    if (status.state !== 'ready' && !(await checkReady(venv))) {
      const setupStatus = await setupEffects()
      if (setupStatus.state !== 'ready')
        throw new Error(setupStatus.message ?? STATUS_MESSAGES.error)
    }
  }

  const outputs = new Map<string, string>()
  const outputFiles: string[] = []
  const effectStills: EffectStill[] = []
  const temp = await mkdtemp(join(tmpdir(), 'luca-effects-plan-'))
  try {
    for (const [base, planned] of grouped) {
      if (signal?.aborted) throw new Error('Effects render stopped.')
      const basePath = safeJoin(p.dir, base)
      const probe = await probeVideo(basePath)
      if (!probe) throw new Error(`Luca could not read ${basename(base)} as a video.`)
      const plan = {
        effects: planned.map((entry) =>
          planItem(entry.sourceItem, entry.start, Math.min(entry.end, probe.duration))
        )
      }
      const planJson = JSON.stringify(plan)
      const hash = sha1(`${base}${planJson}`).slice(0, 8)
      const stem = basename(base, extname(base)).replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'video'
      const out = `media/effects-${stem}-${hash}.mp4`
      const outPath = safeJoin(p.dir, out)
      mkdirSync(join(p.dir, 'media'), { recursive: true })
      if (!existsSync(outPath) || statSync(outPath).size === 0) {
        const planFile = join(temp, `${hash}.json`)
        await writeFile(planFile, JSON.stringify(plan))
        let rendered
        try {
          rendered = await run(
            pythonPath(venv),
            [
              pythonScript(),
              '--plan',
              planFile,
              basePath,
              outPath,
              '--width',
              String(Math.min(probe.width, probe.height, 2160))
            ],
            { env, signal, timeoutMs: 30 * 60 * 1000 }
          )
        } catch (error) {
          rmSync(outPath, { force: true })
          throw error
        }
        if (signal?.aborted || rendered.code !== 0 || !existsSync(outPath)) {
          rmSync(outPath, { force: true })
          if (signal?.aborted) throw new Error('Effects render stopped.')
          throw new Error(
            `Luca could not render ${planned.map((entry) => entry.sourceItem.fx).join(', ')}.`
          )
        }
      }
      outputs.set(base, out)
      outputFiles.push(out)
      for (const entry of planned) {
        const normalized = validatedEffect(entry.sourceItem.fx)
        const effect = EFFECTS.find((value) => value.id === normalized)!
        const stillPath = join(temp, `${hash}-${effect.id}.jpg`)
        const middle = (entry.start + Math.min(entry.end, probe.duration)) / 2
        const jpeg = await saveStill(ffmpeg!, env, outPath, middle, stillPath)
        if (jpeg)
          effectStills.push({
            fx: normalized,
            title: effect.title,
            start: entry.sourceItem.start,
            end: entry.sourceItem.end,
            jpeg
          })
      }
    }

    const replacements = new Map<string, string>()
    const allBases = new Set([...Object.keys(state.clips), ...grouped.keys()])
    for (const base of allBases) {
      const old = state.clips[base]
      const next = outputs.get(base) ?? base
      replacements.set(normalizedSrc(base), next)
      if (old) replacements.set(normalizedSrc(old.out), next)
    }
    let updatedHtml = html
    for (const tag of tags.reverse()) {
      const src = normalizedSrc(tag.attrs.src ?? '')
      const replacement = replacements.get(src)
      if (replacement && replacement !== src)
        updatedHtml = replaceTag(updatedHtml, tag, setAttrs(tag, { src: replacement }))
    }
    writeFileSync(htmlFile, updatedHtml)

    const nextState: EffectsFile = { clips: {} }
    for (const [base, planned] of grouped) {
      const out = outputs.get(base)
      if (!out) continue
      nextState.clips[base] = {
        out,
        effects: planned.map((entry) => ({
          ...entry.sourceItem,
          fx: validatedEffect(entry.sourceItem.fx)
        }))
      }
    }
    mkdirSync(join(p.dir, '.luca'), { recursive: true })
    writeFileSync(join(p.dir, '.luca', 'effects.json'), JSON.stringify(nextState, null, 2) + '\n')
    refreshStudio(p)
    const titles = items.map((item) => effectTitle(validatedEffect(item.fx)))
    await checkpoint(p.dir, items.length ? `Effects: ${titles.join(', ')}` : 'Remove effects')
    return {
      ok: true,
      applied: items.map((item) => ({
        fx: validatedEffect(item.fx),
        title: effectTitle(validatedEffect(item.fx)),
        start: item.start,
        end: item.end
      })),
      output: outputFiles,
      stills: effectStills
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
