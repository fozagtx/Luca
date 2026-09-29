import { utilityProcess, type UtilityProcess } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExportOptions, ExportProgress, Project } from '../shared/types'
import { childEnv, run, which } from './env'
import {
  checkAudio,
  plainExportError,
  readProbe,
  type AudioProbe,
  type ExportPreflight
} from './export-preflight'
import { Channels, broadcast } from './ipc'
import type { WorkerIn, WorkerOut } from './render-worker'
import { getSettings } from './settings'

let child: UtilityProcess | null = null
/** Set while the sounds are being checked, so a second click can't start a second export. */
let checking = false
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

function projectHtml(dir: string): string | null {
  const file = join(dir, 'index.html')
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

/** Whether ffprobe finds sound in a file, and for how long; null when it isn't media at all. */
async function probeSound(file: string): Promise<AudioProbe | null> {
  const ffprobe = await which('ffprobe')
  if (!ffprobe) throw new Error('ffprobe not found')
  const r = await run(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,duration:format=duration',
      '-of',
      'json',
      ...['-protocol_whitelist', 'file'],
      resolve(file)
    ],
    { env: await childEnv(), timeoutMs: 20_000 }
  )
  // killed on the timeout: it never answered, which isn't the file's fault
  if (r.code === null) throw new Error('ffprobe timed out')
  return r.code === 0 ? readProbe(r.stdout) : null
}

/**
 * Before a render: the one thing that makes HyperFrames fail a whole export is a sound it can't
 * read, so a local `<audio>` that is missing or isn't audio stops here with a plain sentence.
 * Everything else it would clip or skip on its own is left to it (a warning, in the log only).
 */
export async function exportPreflight(p: Project): Promise<ExportPreflight> {
  try {
    const html = projectHtml(p.dir)
    if (html === null) return { ok: true, warnings: [] }
    const res = await checkAudio(html, p.dir, probeSound)
    for (const w of res.warnings) console.warn('[export]', w)
    return res
  } catch (err) {
    // a check that broke says nothing about the video, so it never keeps anyone from exporting
    console.warn('[export] sound check skipped:', err instanceof Error ? err.message : err)
    return { ok: true, warnings: [] }
  }
}

/** Renders index.html with @hyperframes/producer in a utilityProcess (parallel workers, GPU). */
export async function startExport(p: Project, opts: ExportOptions): Promise<void> {
  if (child || checking) throw new Error('An export is already running')
  checking = true
  try {
    const check = await exportPreflight(p)
    // no render, no progress bar: the export sheet shows the sentence where its errors go
    if (!check.ok) throw new Error(check.error)
  } finally {
    checking = false
  }
  mkdirSync(join(p.dir, 'renders'), { recursive: true })
  const safe = (opts.name.trim() || p.name).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)
  const outputPath = join(p.dir, 'renders', `${safe}-${stamp()}.mp4`)
  const env = await childEnv()
  const envRecord: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined) envRecord[k] = v

  push({ progress: 0, stage: 'Starting render', status: 'running', outputPath })
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
      push({ progress: m.progress, stage: m.stage, status: 'running', outputPath })
    else if (m.type === 'done') {
      push({ progress: 1, stage: 'Done', status: 'done', outputPath: m.outputPath })
      finish()
    } else if (m.type === 'error') {
      // the renderer's own words for a bad sound mean nothing to a creator; keep them in the log
      const error = plainExportError(m.error, projectHtml(p.dir))
      if (error !== m.error) console.warn('[render]', m.error.slice(0, 400))
      push({
        progress: last.progress,
        stage: 'Failed',
        status: 'error',
        error,
        outputPath
      })
      finish()
    } else if (m.type === 'cancelled') {
      push({ progress: last.progress, stage: 'Cancelled', status: 'cancelled', outputPath })
      finish()
    }
  })
  proc.on('exit', (code) => {
    if (child === proc && last.status === 'running') {
      push({
        progress: last.progress,
        stage: 'Failed',
        status: 'error',
        error: `Render worker exited with code ${code}`,
        outputPath
      })
    }
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
      if (last.status === 'running')
        push({ progress: last.progress, stage: 'Cancelled', status: 'cancelled' })
    }
  }, 10_000)
}
