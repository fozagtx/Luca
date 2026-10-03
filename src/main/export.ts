import { utilityProcess, type UtilityProcess } from 'electron'
import { mkdirSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import type { ExportOptions, ExportProgress, Project } from '../shared/types'
import { childEnv } from './env'
import { Channels, broadcast, notifyInBackground } from './ipc'
import type { WorkerIn, WorkerOut } from './render-worker'
import { getSettings } from './settings'

let child: UtilityProcess | null = null
let last: ExportProgress = { progress: 0, stage: '', status: 'done' }

function push(p: ExportProgress): void {
  last = p
  broadcast(Channels.exportProgress, p)
}

export function exportProgress(): ExportProgress {
  return last
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/**
 * Parallel frame workers: the setting is the floor, and bigger Macs use more of the machine
 * (half the cores, about 4 GB of memory per worker after 4 GB of headroom, at most 6).
 */
function renderWorkers(): number {
  // about 4 GB each, after leaving 4 GB for macOS and everything else that is running
  const spare = Math.max(0, totalmem() - 4 * 2 ** 30)
  const fit = Math.min(Math.floor(cpus().length / 2), Math.floor(spare / 2 ** 32), 6)
  return Math.max(1, Math.min(8, Math.max(getSettings().renderWorkers || 2, fit)))
}

/** What stopped a render, in plain words (the renderer's own message stays in `error`). */
export function failureReason(error: string): string {
  const e = error.toLowerCase()
  if (/enospc|no space left/.test(e)) return 'The disk is full. Free some space and try again.'
  if (/enomem|out of memory|heap|allocation failed/.test(e))
    return 'The Mac ran out of memory. Close other apps or pick Draft, then try again.'
  if (/ffmpeg|ffprobe/.test(e) && /not found|enoent|spawn/.test(e))
    return 'FFmpeg is missing. Install it with brew install ffmpeg, then try again.'
  if (/script_failure|failed to load|err_internet|err_name|enotfound|fetch failed/.test(e))
    return 'Part of the video couldn’t load. Check the internet connection, then try again.'
  if (/chrom|browser|puppeteer|target closed|protocol error|websocket|exited with code/.test(e))
    return 'The renderer stopped unexpectedly. Try again; Draft asks less of the Mac.'
  if (/timed? ?out|timeout/.test(e)) return 'A frame took too long to render. Try again.'
  if (/no such file|enoent|not found/.test(e))
    return 'A file the video uses is missing. Ask Luca to check the clips, then try again.'
  return 'The video couldn’t be rendered. Try again.'
}

/** Renders index.html with @hyperframes/producer in a utilityProcess (parallel workers, GPU). */
export async function startExport(p: Project, opts: ExportOptions): Promise<void> {
  if (child) throw new Error('An export is already running')
  mkdirSync(join(p.dir, 'renders'), { recursive: true })
  const safe = (opts.name.trim() || p.name).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)
  const outputPath = join(p.dir, 'renders', `${safe}-${stamp()}.mp4`)
  const env = await childEnv()
  const envRecord: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined) envRecord[k] = v

  // every update says where the video goes, enough to watch it in Luca or to ask for it again
  const about = {
    outputPath,
    projectId: p.id,
    file: relative(p.dir, outputPath).split(sep).join('/'),
    options: opts
  }
  const failed = (error: string): void =>
    push({
      ...about,
      progress: last.progress,
      stage: 'Failed',
      status: 'error',
      error,
      reason: failureReason(error)
    })
  push({ ...about, progress: 0, stage: 'Starting render', status: 'running' })
  child = utilityProcess.fork(join(__dirname, 'render-worker.js'), [], {
    env: envRecord,
    serviceName: 'luca-render',
    stdio: 'pipe'
  })
  const proc = child
  proc.stderr?.on('data', (d: Buffer) => {
    const s = d.toString().trim()
    if (s) console.warn('[render]', s.slice(0, 400))
  })
  proc.on('message', (m: WorkerOut) => {
    if (m.type === 'progress')
      push({ ...about, progress: m.progress, stage: m.stage, status: 'running' })
    else if (m.type === 'done') {
      push({ ...about, progress: 1, stage: 'Done', status: 'done' })
      notifyInBackground('Your video is ready', `${basename(outputPath)}: watch it in Luca.`)
      finish()
    } else if (m.type === 'error') {
      failed(m.error)
      notifyInBackground('The export didn’t finish', failureReason(m.error))
      finish()
    } else if (m.type === 'cancelled') {
      push({ ...about, progress: last.progress, stage: 'Cancelled', status: 'cancelled' })
      finish()
    }
  })
  proc.on('exit', (code) => {
    if (child === proc && last.status === 'running')
      failed(`Render worker exited with code ${code}`)
    if (child === proc) child = null
  })
  const start: WorkerIn = {
    type: 'start',
    projectDir: p.dir,
    outputPath,
    quality: opts.quality === 'draft' ? 'draft' : 'high',
    workers: renderWorkers()
  }
  proc.postMessage(start)
}

function finish(): void {
  const proc = child
  child = null
  setTimeout(() => proc?.kill(), 500)
}

export function cancelExport(): void {
  if (!child) return
  const msg: WorkerIn = { type: 'cancel' }
  child.postMessage(msg)
  const proc = child
  setTimeout(() => {
    if (child === proc) {
      proc.kill()
      child = null
      if (last.status === 'running') push({ ...last, stage: 'Cancelled', status: 'cancelled' })
    }
  }, 10_000)
}
