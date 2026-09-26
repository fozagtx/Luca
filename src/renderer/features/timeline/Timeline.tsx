import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css'
import './timeline.css'
import { Timeline as Editor, type TimelineState } from '@xzdarcy/react-timeline-editor'
import type { TimelineAction, TimelineRow } from '@xzdarcy/timeline-engine'
import { AudioLines, Captions, Film, Lock, Puzzle, Shapes, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react'
import type { Clip } from '../../../shared/types'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { catalogChip, hasCatalogDrag, readCatalogDrag, type CatalogDrag } from '../../lib/drag'
import { luca } from '../../lib/luca'
import { timecode } from '../../lib/timecode'
import { useChat } from '../../stores/chat'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useTimeline } from '../../stores/timeline'
import { useUi } from '../../stores/ui'
import {
  ROW_HEIGHT,
  STRIP_HEIGHT,
  STRIP_ROW,
  rulerStep,
  toRows,
  type RowMeta
} from './timeline-adapter'
import { Waveform } from './Waveform'

const LABEL_WIDTH = 120
const START_LEFT = 8

const KIND_LABEL: Record<RowMeta['kind'], string> = {
  strip: '',
  video: 'Video',
  block: 'Blocks',
  component: 'Components',
  caption: 'Captions',
  audio: 'Audio'
}

const KIND_ICON: Record<RowMeta['kind'], typeof Film> = {
  strip: Film,
  video: Film,
  block: Shapes,
  component: Puzzle,
  caption: Captions,
  audio: AudioLines
}

function TrackHead({ kind, height }: { kind: RowMeta['kind']; height: number }): ReactElement {
  const [muted, setMuted] = useState(false)
  const [locked, setLocked] = useState(false)
  const Icon = KIND_ICON[kind]
  if (kind === 'strip')
    return (
      <div className="luca-track-head luca-track-head-strip" style={{ height }}>
        <Film size={13} strokeWidth={1.75} className="shrink-0 text-text-3" />
        <span className="text-text-3">Frames</span>
      </div>
    )
  return (
    <div
      className={cn('luca-track-head group/head', locked && 'luca-track-head-locked')}
      style={{ height }}
    >
      <Icon size={13} strokeWidth={1.75} className={cn('shrink-0', `luca-track-icon-${kind}`)} />
      <span className="min-w-0 flex-1 truncate">{KIND_LABEL[kind]}</span>
      <div
        className="flex shrink-0 items-center gap-px opacity-0 transition-opacity group-hover/head:opacity-100 data-[on=true]:opacity-100"
        data-on={muted || locked}
      >
        <Tip label={muted ? 'Unmute' : 'Mute'} side="right">
          <button
            type="button"
            className={cn('luca-track-btn', muted && 'luca-track-btn-on')}
            aria-pressed={muted}
            aria-label="Mute track"
            onClick={() => setMuted((v) => !v)}
          >
            {muted ? <VolumeX size={11} strokeWidth={2} /> : <Volume2 size={11} strokeWidth={2} />}
          </button>
        </Tip>
        <Tip label={locked ? 'Unlock' : 'Lock'} side="right">
          <button
            type="button"
            className={cn('luca-track-btn', locked && 'luca-track-btn-on')}
            aria-pressed={locked}
            aria-label="Lock track"
            onClick={() => setLocked((v) => !v)}
          >
            <Lock size={11} strokeWidth={2} />
          </button>
        </Tip>
      </div>
    </div>
  )
}

export function Timeline(): ReactElement {
  const project = useProject((s) => s.project)
  const projectDir = project?.dir ?? null
  const version = useProject((s) => s.version)
  const { timeline, load, loadMedia, reset, error } = useTimeline()

  useEffect(() => {
    if (!projectDir) {
      reset()
      return
    }
    void load()
  }, [projectDir, version, load, reset])

  useEffect(() => {
    if (projectDir) void loadMedia()
  }, [projectDir, loadMedia])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-panel text-[12px] text-text-3">
        Open a project to see its timeline
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-panel">
      {timeline ? (
        <Tracks key={project.id} projectId={project.id} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-text-3">
          {error ?? 'Reading timeline…'}
        </div>
      )}
      {error && timeline ? (
        <div className="pointer-events-none absolute left-[104px] top-9 rounded-[6px] bg-danger px-2 py-1 text-[11px] text-white shadow-popover">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function Tracks({ projectId }: { projectId: string }): ReactElement {
  const timeline = useTimeline((s) => s.timeline)!
  const zoom = useTimeline((s) => s.zoom)
  const selected = useTimeline((s) => s.selected)
  const select = useTimeline((s) => s.select)
  const edit = useTimeline((s) => s.edit)
  const thumbs = useTimeline((s) => s.thumbs)
  const peaks = useTimeline((s) => s.peaks)
  const playerDuration = usePlayer((s) => s.duration)
  const currentTime = usePlayer((s) => s.currentTime)
  const fps = usePlayer((s) => s.fps)
  const seek = usePlayer((s) => s.seek)
  const ref = useRef<TimelineState>(null)
  const dragging = useRef(false)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const setViewportWidth = useTimeline((s) => s.setViewportWidth)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth))
    ro.observe(el)
    setViewportWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [setViewportWidth])

  const duration = Math.max(timeline.duration, playerDuration, 1)
  const { rows, meta, clips } = useMemo(() => toRows(timeline, duration), [timeline, duration])
  const { scale, splits } = rulerStep(zoom)

  // Player → cursor (skip while the user drags the cursor).
  useEffect(() => {
    if (!dragging.current) ref.current?.setTime(currentTime)
  }, [currentTime])

  const snapPoints = useMemo(() => {
    const pts = new Set<number>([0, duration, currentTime])
    for (const c of clips.values()) {
      pts.add(c.start)
      pts.add(c.end)
    }
    return [...pts]
  }, [clips, duration, currentTime])

  const dropTime = (e: DragEvent<HTMLDivElement>): number => {
    const area = e.currentTarget.querySelector<HTMLElement>('.timeline-editor-edit-area')
    const box = (area ?? e.currentTarget).getBoundingClientRect()
    const x = e.clientX - box.left - START_LEFT + (area?.scrollLeft ?? 0)
    const t = Math.max(0, Math.min(duration, x / zoom))
    return Math.round(t * fps) / fps
  }

  const placeCatalogItem = async (d: CatalogDrag, at: number): Promise<void> => {
    setDropError(null)
    const res = await luca.catalog.add(d.name)
    if (!res.ok) {
      setDropError(res.error ?? `Could not add ${d.name}`)
      setTimeout(() => setDropError(null), 6000)
      return
    }
    const chat = useChat.getState()
    chat.addChip(catalogChip(d))
    const tc = timecode(at, fps)
    const text =
      d.source === 'remocn'
        ? `Place remocn \`${d.name}\` at ${tc}.`
        : `Insert \`${d.name}\` at ${tc} on a new track. It is installed; the \`add\` snippet was:\n\n\`\`\`html\n${(res.snippet ?? '').trim()}\n\`\`\``
    if (!useUi.getState().chatOpen) useUi.getState().toggleChat()
    await chat.send(text, { time: at })
  }

  const snap = (t: number, self: Clip): number => {
    const tol = 6 / zoom
    let best = t
    let bestD = tol
    for (const p of snapPoints) {
      if (p === self.start || p === self.end) continue
      const d = Math.abs(p - t)
      if (d < bestD) {
        best = p
        bestD = d
      }
    }
    return best
  }

  const editorRows = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        actions: r.actions.map((a) => ({ ...a, selected: a.id === selected }))
      })),
    [rows, selected]
  )

  const renderAction = (action: TimelineAction, row: TimelineRow): ReactElement => {
    const m = meta.get(row.id)
    if (action.id === STRIP_ROW) return <Strip projectId={projectId} thumbs={thumbs} zoom={zoom} />
    const clip = clips.get(action.id)
    if (!clip || !m) return <div />
    return (
      <div
        className={cn(
          'luca-clip',
          `luca-clip-${clip.kind}`,
          action.selected && 'luca-clip-selected'
        )}
        title={`${clip.label} · ${timecode(clip.start, fps)} – ${timecode(clip.end, fps)}`}
      >
        {clip.kind === 'audio' && peaks && peaks.peaks.length > 0 ? (
          <Waveform
            peaks={peaks.peaks}
            peaksPerSecond={peaks.peaksPerSecond}
            start={clip.start}
            end={clip.end}
          />
        ) : null}
        <span className="luca-clip-label">
          {clip.remocn ? <span className="luca-clip-badge">R</span> : null}
          <span className="truncate">{clip.label}</span>
        </span>
        <span className="luca-clip-handle luca-clip-handle-l" />
        <span className="luca-clip-handle luca-clip-handle-r" />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="luca-track-heads shrink-0" style={{ width: LABEL_WIDTH }}>
        <div className="flex h-8 items-end border-b border-border px-2.5 pb-1 font-mono text-[10px] tabular-nums text-text-3">
          {timecode(currentTime, fps)}
        </div>
        <div style={{ height: 10 }} />
        {rows.map((r) => (
          <TrackHead key={r.id} kind={meta.get(r.id)!.kind} height={r.rowHeight ?? ROW_HEIGHT} />
        ))}
      </div>
      <div
        ref={viewportRef}
        className={cn('relative min-w-0 flex-1', dropAt !== null && 'bg-accent/5')}
        onDragOver={(e) => {
          if (!hasCatalogDrag(e.dataTransfer)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropAt(dropTime(e))
        }}
        onDragLeave={() => setDropAt(null)}
        onDrop={(e) => {
          const d = readCatalogDrag(e.dataTransfer)
          setDropAt(null)
          if (!d) return
          e.preventDefault()
          void placeCatalogItem(d, dropTime(e))
        }}
      >
        {dropAt !== null ? (
          <div className="pointer-events-none absolute top-0 right-2 z-10 rounded-[4px] bg-accent px-1.5 py-0.5 text-[10px] text-white">
            Insert at {timecode(dropAt, fps)}
          </div>
        ) : null}
        {dropError ? (
          <div className="absolute right-2 bottom-2 z-10 rounded-[4px] bg-danger px-1.5 py-0.5 text-[10px] text-white">
            {dropError}
          </div>
        ) : null}
        <Editor
          ref={ref}
          editorData={editorRows}
          effects={{}}
          scale={scale}
          scaleSplitCount={splits}
          scaleWidth={scale * zoom}
          startLeft={START_LEFT}
          rowHeight={ROW_HEIGHT}
          minScaleCount={Math.ceil(duration / scale) + 1}
          maxScaleCount={Math.ceil(duration / scale) + 1}
          autoScroll
          autoReRender={false}
          gridSnap={false}
          dragLine
          style={{ width: '100%', height: '100%' }}
          getActionRender={renderAction}
          getScaleRender={(s) => <span>{timecode(s, fps).replace(/:\d\d$/, '')}</span>}
          onClickTimeArea={(t) => {
            seek(Math.max(0, Math.min(duration, t)))
            return true
          }}
          onCursorDragStart={() => (dragging.current = true)}
          onCursorDrag={(t) => seek(Math.max(0, Math.min(duration, t)))}
          onCursorDragEnd={(t) => {
            dragging.current = false
            seek(Math.max(0, Math.min(duration, t)))
          }}
          onClickAction={(_, { action }) => {
            if (action.id !== STRIP_ROW) select(action.id)
          }}
          onClickRow={(e) => {
            if (!(e.target as HTMLElement).closest('.timeline-editor-action')) select(null)
          }}
          onActionMoving={({ action, start }) => {
            const clip = clips.get(action.id)
            if (!clip) return false
            const len = clip.end - clip.start
            const s = snap(start, clip)
            if (s !== start) {
              action.start = s
              action.end = s + len
            }
            return true
          }}
          onActionMoveEnd={({ action, start }) => {
            const clip = clips.get(action.id)
            if (!clip) return
            const t = Math.round(start * 1000) / 1000
            if (Math.abs(t - clip.start) < 1e-3) return
            void edit({ op: 'move', ref: clip.ref, time: Math.max(0, t) })
          }}
          onActionResizing={({ action, start, end, dir }) => {
            const clip = clips.get(action.id)
            if (!clip) return false
            if (dir === 'left') action.start = snap(start, clip)
            else action.end = snap(end, clip)
            return true
          }}
          onActionResizeEnd={({ action, start, end, dir }) => {
            const clip = clips.get(action.id)
            if (!clip) return
            const r = (n: number): number => Math.round(n * 1000) / 1000
            if (dir === 'left') {
              if (Math.abs(start - clip.start) < 1e-3) return
              void edit({ op: 'trim', ref: clip.ref, start: r(start) })
            } else {
              if (Math.abs(end - clip.end) < 1e-3) return
              void edit({ op: 'trim', ref: clip.ref, end: r(end) })
            }
          }}
        />
      </div>
    </div>
  )
}

function Strip({
  projectId,
  thumbs,
  zoom
}: {
  projectId: string
  thumbs: { dir: string; count: number; interval: number } | null
  zoom: number
}): ReactElement {
  if (!thumbs || thumbs.count === 0) return <div className="luca-strip" />
  const w = thumbs.interval * zoom
  const imgs: ReactElement[] = []
  for (let i = 0; i < thumbs.count; i++) {
    imgs.push(
      <img
        key={i}
        src={`/p/${encodeURIComponent(projectId)}/${thumbs.dir}/${String(i + 1).padStart(4, '0')}.jpg`}
        style={{ width: w, height: STRIP_HEIGHT }}
        className="block shrink-0 object-cover"
        draggable={false}
        alt=""
      />
    )
  }
  return <div className="luca-strip">{imgs}</div>
}
