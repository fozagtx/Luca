/**
 * Runs inside an Electron utilityProcess so a renderer crash can't take the window down.
 * Speaks a tiny message protocol with export.ts over process.parentPort.
 */
import type { RenderJob } from '@hyperframes/producer'

export type WorkerIn =
  | {
      type: 'start'
      projectDir: string
      outputPath: string
      quality: 'draft' | 'high'
      workers: number
    }
  | { type: 'cancel' }
export type WorkerOut =
  | { type: 'progress'; progress: number; stage: string }
  | { type: 'done'; outputPath: string }
  | { type: 'error'; error: string }
  | { type: 'cancelled' }

const port = process.parentPort
const post = (m: WorkerOut): void => port.postMessage(m)
const abort = new AbortController()

port.on('message', (e: { data: WorkerIn }) => {
  const msg = e.data
  if (msg.type === 'cancel') abort.abort()
  if (msg.type === 'start') void start(msg)
})

async function start(msg: Extract<WorkerIn, { type: 'start' }>): Promise<void> {
  try {
    const producer = await import('@hyperframes/producer')
    const job = producer.createRenderJob({
      fps: 30,
      quality: msg.quality,
      workers: msg.workers,
      useGpu: true,
      strictness: 'best-effort'
    })
    const onProgress = (j: RenderJob, stage: string): void =>
      post({ type: 'progress', progress: j.progress / 100, stage: stage || j.currentStage })
    await producer.executeRenderJob(job, msg.projectDir, msg.outputPath, onProgress, abort.signal)
    if (job.status === 'cancelled') post({ type: 'cancelled' })
    else if (job.status === 'failed') post({ type: 'error', error: job.error ?? 'Render failed' })
    else post({ type: 'done', outputPath: msg.outputPath })
  } catch (err) {
    if (abort.signal.aborted) post({ type: 'cancelled' })
    else post({ type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
