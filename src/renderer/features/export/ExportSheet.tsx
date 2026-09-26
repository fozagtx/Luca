import type { ExportOptions, ExportProgress } from '@shared/types'
import { useEffect, useState, type ReactElement } from 'react'
import { AnimatedButton } from '../../components/ui/animated-button'
import { AnimatedNumber } from '../../components/ui/animated-number'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Sheet } from '../../components/ui/sheet'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { errorMessage, useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

const qualities: { id: ExportOptions['quality']; label: string; hint: string }[] = [
  { id: 'draft', label: 'Draft', hint: 'Fast, for review' },
  { id: 'looks', label: 'Final', hint: 'HyperFrames default, CRF 16' }
]

export function ExportSheet(): ReactElement {
  const open = useUi((s) => s.exportOpen)
  const setExport = useUi((s) => s.setExport)
  const project = useProject((s) => s.project)
  const [name, setName] = useState('')
  const [quality, setQuality] = useState<ExportOptions['quality']>('looks')
  const [freeMB, setFreeMB] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    if (!project) return
    try {
      await luca.export.start({ name: name.trim() || project.name, quality, format: 'mp4' })
      setExport(false)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setExport}
      title="Export"
      description={project ? `renders/${(name || project.name).trim()}-<date>.mp4` : undefined}
      width={420}
      footer={
        <>
          <Button onClick={() => setExport(false)}>Cancel</Button>
          <AnimatedButton disabled={!project} onClick={() => void start()}>
            Export MP4
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
          Format MP4 (H.264, VideoToolbox) · 2 render workers
          {freeMB !== null ? ` · ${Math.round(freeMB / 1024)} GB memory` : ''}
        </div>
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
  const [p, setP] = useState<ExportProgress | null>(null)
  const [dismissed, setDismissed] = useState(false)
  useEffect(
    () =>
      luca.export.onProgress((next) => {
        setP(next)
        setDismissed(false)
      }),
    []
  )
  if (!p || dismissed) return null
  if (p.status === 'running') {
    return (
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-bg-muted px-3 text-[11px] text-text-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${Math.max(2, Math.round(p.progress * 100))}%` }}
          />
        </div>
        <span className="flex w-[200px] items-center gap-1 truncate">
          <AnimatedNumber value={p.progress * 100} format={(n) => `${Math.round(n)}%`} />· {p.stage}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void luca.export.cancel()}>
          Cancel
        </Button>
      </div>
    )
  }
  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px]',
        p.status === 'error' ? 'bg-danger/10 text-danger' : 'bg-bg-muted text-text-2'
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {p.status === 'done'
          ? `Exported ${p.outputPath?.split('/').slice(-2).join('/') ?? ''}`
          : p.status === 'cancelled'
            ? 'Export cancelled'
            : `Export failed: ${p.error ?? 'unknown error'}`}
      </span>
      {p.status === 'done' && p.outputPath ? (
        <Button size="sm" variant="ghost" onClick={() => void luca.export.reveal(p.outputPath!)}>
          Reveal in Finder
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setDismissed(true)} aria-label="Dismiss">
        Dismiss
      </Button>
    </div>
  )
}
