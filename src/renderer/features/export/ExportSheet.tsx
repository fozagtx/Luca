import type { ExportOptions, ExportProgress } from '@shared/types'
import { useEffect, useState, type ReactElement } from 'react'
import { create } from 'zustand'
import { AnimatedButton } from '../../components/ui/animated-button'
import { AnimatedNumber } from '../../components/ui/animated-number'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { CheckDraw, ProgressBar } from '../../components/ui/progress'
import { Sheet } from '../../components/ui/sheet'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { errorMessage, useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

const qualities: { id: ExportOptions['quality']; label: string; hint: string }[] = [
  { id: 'draft', label: 'Draft', hint: 'Fast, for review' },
  { id: 'looks', label: 'Final', hint: 'Best quality, for sharing' }
]

/** The last export's progress, shared by the bar under the toolbar and the sheet. */
const useExportProgress = create<{ progress: ExportProgress | null }>(() => ({ progress: null }))

/** The file name main writes: the name made safe for Finder, then the date and time. */
function fileName(name: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `${name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}-${stamp}.mp4`
}

export function ExportSheet(): ReactElement {
  const open = useUi((s) => s.exportOpen)
  const setExport = useUi((s) => s.setExport)
  const project = useProject((s) => s.project)
  // closing or switching the project closes it, so it doesn't pop open over the next one
  const projectId = project?.id ?? null
  useEffect(() => useUi.getState().setExport(false), [projectId])
  const running = useExportProgress((s) => s.progress?.status === 'running')
  const [name, setName] = useState('')
  const [quality, setQuality] = useState<ExportOptions['quality']>('looks')
  const [freeMB, setFreeMB] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setName(project?.name ?? '')
      setError(null)
      void luca.export
        .freeMemoryMB()
        .then(setFreeMB)
        .catch(() => setFreeMB(null))
    }, 0)
    return () => clearTimeout(t)
  }, [open, project])

  const start = async (): Promise<void> => {
    if (!project || starting || running) return
    setStarting(true)
    try {
      await luca.export.start({ name: name.trim() || project.name, quality, format: 'mp4' })
      setExport(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <Sheet
      // there is nothing to export without a project (⌘E on Home)
      open={open && !!project}
      onOpenChange={setExport}
      title="Export"
      description="An MP4 of the whole video, rendered in the background."
      width={420}
      footer={
        <>
          <Button onClick={() => setExport(false)}>Cancel</Button>
          <AnimatedButton disabled={!project || starting || running} onClick={() => void start()}>
            {starting ? <span className="btn-spinner" /> : null}
            {starting ? 'Starting…' : 'Export MP4'}
          </AnimatedButton>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-text-2">File name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {project ? (
            <span className="truncate text-[11px] text-text-3" title="In the project folder">
              renders/{fileName(name.trim() || project.name)}
            </span>
          ) : null}
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-text-2">Quality</span>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {qualities.map((q) => (
              <button
                key={q.id}
                type="button"
                role="radio"
                aria-checked={quality === q.id}
                onClick={() => setQuality(q.id)}
                className={cn(
                  'flex flex-col items-start rounded-[6px] border px-3 py-2 text-left transition-colors',
                  quality === q.id
                    ? 'border-accent bg-accent/[0.05]'
                    : 'border-border hover:bg-hover'
                )}
              >
                <span className="text-[12px] font-medium text-text">{q.label}</span>
                <span className="text-[11px] text-text-3">{q.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="text-[11px] text-text-3">
          {/* no worker count: main picks it from this Mac's cores and memory as the render starts */}
          Format MP4 (H.264, VideoToolbox)
          {freeMB !== null ? ` · ${Math.round(freeMB / 1024)} GB memory` : ''}
        </div>
        {running ? (
          <div className="rounded-[6px] bg-bg-muted px-3 py-2 text-[12px] text-text-2">
            An export is running. This one can start when it’s done (or cancelled).
          </div>
        ) : null}
        {error && (
          <div className="selectable rounded-[6px] bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

/** Thin progress bar under the toolbar with Cancel, then a toast offering Reveal in Finder. */
export function ExportBar(): ReactElement | null {
  const p = useExportProgress((s) => s.progress)
  const [dismissed, setDismissed] = useState(false)
  /** Cancel was clicked; the render stops at its next frame, which can take a moment. */
  const [cancelling, setCancelling] = useState(false)
  const setExport = useUi((s) => s.setExport)
  const dir = useProject((s) => s.project?.dir ?? null)
  const hasProject = dir !== null
  // another project (or Home, where App says when an export ends) starts without the last one's
  // finished or failed export; one still running keeps its bar
  useEffect(
    () =>
      useExportProgress.setState((s) =>
        s.progress?.status === 'running' ? s : { progress: null }
      ),
    [dir]
  )
  useEffect(
    () =>
      luca.export.onProgress((next) => {
        useExportProgress.setState({ progress: next })
        setDismissed(false)
        if (next.status !== 'running') setCancelling(false)
      }),
    []
  )
  if (!p || dismissed) return null
  if (p.status === 'running') {
    const progress = Number.isFinite(p.progress) ? Math.max(0, Math.min(1, p.progress)) : 0
    return (
      <div className="rise-in flex h-8 shrink-0 items-center gap-3 border-b border-border bg-bg-subtle px-3 text-[11px] text-text-2">
        <span className="step-spinner shrink-0" />
        <span className="shrink-0 font-medium text-text">
          {cancelling ? 'Cancelling' : 'Exporting'}
        </span>
        <ProgressBar value={progress} className="flex-1" />
        <span className="flex w-[220px] items-center gap-1.5 truncate">
          <AnimatedNumber
            value={progress * 100}
            format={(n) => `${Math.round(n)}%`}
            className="font-mono text-text"
          />
          <span className="truncate text-text-3" title={p.stage}>
            {p.stage}
          </span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          loading={cancelling}
          onClick={() => {
            setCancelling(true)
            void luca.export.cancel().catch(() => setCancelling(false))
          }}
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>
    )
  }
  return (
    <div
      className={cn(
        'rise-in flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px]',
        p.status === 'error' ? 'bg-danger/10 text-danger' : 'bg-bg-subtle text-text-2'
      )}
    >
      {p.status === 'done' ? (
        <span className="pop-in flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-white">
          <CheckDraw className="size-3" />
        </span>
      ) : null}
      {(() => {
        const text =
          p.status === 'done'
            ? `Exported ${p.outputPath?.split('/').slice(-2).join('/') ?? ''}`
            : p.status === 'cancelled'
              ? 'Export cancelled'
              : `Export failed: ${p.error ?? 'unknown error'}`
        // the whole message on hover: a render error is often longer than the bar
        return (
          <span className="min-w-0 flex-1 truncate select-text" title={text} role="status">
            {text}
          </span>
        )
      })()}
      {p.status === 'done' && p.outputPath ? (
        <Button size="sm" variant="ghost" onClick={() => void luca.export.reveal(p.outputPath!)}>
          Reveal in Finder
        </Button>
      ) : null}
      {p.status !== 'done' && hasProject ? (
        <Button size="sm" variant="ghost" onClick={() => setExport(true)}>
          Export again
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setDismissed(true)} aria-label="Dismiss">
        Dismiss
      </Button>
    </div>
  )
}
