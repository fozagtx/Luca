import { utilityProcess, type UtilityProcess } from 'electron'
import { mkdirSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import type { ExportOptions, ExportProgress, Project } from '../shared/types'
import { childEnv } from './env'
import { Channels, broadcast } from './ipc'
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
 * (half the cores, about 4 GB of memory per worker, at most 6).
 */
function renderWorkers(): number {
  const fit = Math.min(Math.floor(cpus().length / 2), Math.floor(totalmem() / 2 ** 32), 6)
  return Math.max(1, Math.min(8, Math.max(getSettings().renderWorkers || 2, fit)))
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
      push({
        progress: last.progress,
        stage: 'Failed',
        status: 'error',
        error: m.error,
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
