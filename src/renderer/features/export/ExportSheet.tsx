import { sizeOf } from '@shared/aspect'
import type { ExportOptions, ExportProgress } from '@shared/types'
import { Play, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { AnimatedButton } from '../../components/ui/animated-button'
import { AnimatedNumber } from '../../components/ui/animated-number'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { CheckDraw, ProgressBar } from '../../components/ui/progress'
import { Sheet } from '../../components/ui/sheet'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { usePlayer } from '../../stores/player'
import { errorMessage, useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

const qualities: { id: ExportOptions['quality']; label: string; hint: string }[] = [
  { id: 'draft', label: 'Draft', hint: 'Fast, for review' },
  { id: 'looks', label: 'Final', hint: 'Best quality, for sharing' }
]

export function ExportSheet(): ReactElement {
  const open = useUi((s) => s.exportOpen)
  const setExport = useUi((s) => s.setExport)
  const project = useProject((s) => s.project)
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
    if (!project || starting) return
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
      open={open}
      onOpenChange={setExport}
      title="Export"
      description={project ? `renders/${(name || project.name).trim()}-<date>.mp4` : undefined}
      width={420}
      footer={
        <>
          <Button onClick={() => setExport(false)}>Cancel</Button>
          <AnimatedButton disabled={!project || starting} onClick={() => void start()}>
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

/** A finished export, playing in Luca from Luca's own server (never a file:// URL). */
type Watch = { url: string; name: string; path: string }

function watchOf(p: ExportProgress, projectId: string | undefined): Watch | null {
  if (p.status !== 'done' || !p.file || !p.outputPath || !projectId) return null
  if (p.projectId !== projectId) return null
  const file = p.file.split('/').map(encodeURIComponent).join('/')
  return {
    url: `/p/${encodeURIComponent(projectId)}/${file}`,
    name: p.file.split('/').pop() ?? p.file,
    path: p.outputPath
  }
}

/**
 * Thin progress bar under the toolbar with Cancel. A finished video opens to watch right away
 * (Play brings it back, next to Reveal in Finder); a failed one says why and offers Try again.
 */
export function ExportBar(): ReactElement | null {
  const [p, setP] = useState<ExportProgress | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [watching, setWatching] = useState<Watch | null>(null)
  const [retrying, setRetrying] = useState(false)
  const projectId = useProject((s) => s.project?.id)
  const running = useRef(false)
  useEffect(
    () =>
      luca.export.onProgress((next) => {
        setP(next)
        setDismissed(false)
        // rendered in the background: show it the moment it is done
        const done = running.current && next.status === 'done'
        running.current = next.status === 'running'
        const w = done ? watchOf(next, useProject.getState().project?.id) : null
        if (w) {
          usePlayer.getState().handle?.pause()
          setWatching(w)
        }
        if (next.status === 'error') console.warn('[luca] export failed', next.error)
      }),
    []
  )
  const retry = async (): Promise<void> => {
    if (!p?.options || retrying) return
    setRetrying(true)
    try {
      await luca.export.start(p.options)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRetrying(false)
    }
  }
  const watch = p ? watchOf(p, projectId) : null
  const sheet = <WatchSheet watch={watching} onClose={() => setWatching(null)} />
  if (!p || dismissed) return sheet
  if (p.status === 'running') {
    return (
      <div className="rise-in flex h-8 shrink-0 items-center gap-3 border-b border-border bg-bg-subtle px-3 text-[11px] text-text-2">
        <span className="step-spinner shrink-0" />
        <span className="shrink-0 font-medium text-text">Exporting</span>
        <ProgressBar value={p.progress} className="flex-1" />
        <span className="flex w-[220px] items-center gap-1.5 truncate">
          <AnimatedNumber
            value={p.progress * 100}
            format={(n) => `${Math.round(n)}%`}
            className="font-mono text-text"
          />
          <span className="truncate text-text-3">{p.stage}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => void luca.export.cancel()}>
          Cancel
        </Button>
        {sheet}
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
      <span className="min-w-0 flex-1 truncate">
        {p.status === 'done'
          ? `Exported ${p.outputPath?.split('/').slice(-2).join('/') ?? ''}`
          : p.status === 'cancelled'
            ? 'Export cancelled'
            : `Export failed. ${p.reason ?? 'The video couldn’t be rendered. Try again.'}`}
      </span>
      {watch ? (
        <Button size="sm" variant="ghost" onClick={() => setWatching(watch)}>
          <Play size={12} strokeWidth={2} />
          Play
        </Button>
      ) : null}
      {p.status === 'done' && p.outputPath ? (
        <Button size="sm" variant="ghost" onClick={() => void luca.export.reveal(p.outputPath!)}>
          Reveal in Finder
        </Button>
      ) : null}
      {p.status === 'error' && p.options ? (
        <Button size="sm" variant="ghost" loading={retrying} onClick={() => void retry()}>
          <RotateCcw size={12} strokeWidth={2} />
          Try again
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setDismissed(true)} aria-label="Dismiss">
        Dismiss
      </Button>
      {sheet}
    </div>
  )
}

/** The finished video in a sheet, sized to the video's shape, with the player's own controls. */
function WatchSheet({
  watch,
  onClose
}: {
  watch: Watch | null
  onClose: () => void
}): ReactElement {
  const aspect = useProject((s) => s.project?.aspect)
  const [w, h] = aspect ? sizeOf(aspect) : [16, 9]
  // the sheet hangs under the toolbar: leave room for its header and footer
  const width = Math.round(Math.min(760, Math.max(360, ((window.innerHeight - 240) * w) / h)))
  return (
    <Sheet
      open={!!watch}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Your video"
      description={watch?.name}
      width={width}
      footer={
        <>
          <Button onClick={() => watch && void luca.export.reveal(watch.path)}>
            Reveal in Finder
          </Button>
          <AnimatedButton onClick={onClose}>Done</AnimatedButton>
        </>
      }
    >
      {watch ? (
        <video
          key={watch.url}
          src={watch.url}
          controls
          autoPlay
          playsInline
          className="block max-h-[calc(100vh-240px)] w-full rounded-[6px] bg-black"
          style={{ aspectRatio: `${w} / ${h}` }}
        />
      ) : null}
    </Sheet>
  )
}
