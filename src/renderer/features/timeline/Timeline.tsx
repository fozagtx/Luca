import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css'
import './timeline.css'
import { Timeline as Editor, type TimelineState } from '@xzdarcy/react-timeline-editor'
import type { TimelineAction, TimelineRow } from '@xzdarcy/timeline-engine'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  AudioLines,
  Captions,
  Film,
  Lock,
  LockOpen,
  MessageSquarePlus,
  Paintbrush,
  Puzzle,
  Scissors,
  Shapes,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, type ReactElement } from 'react'
import type { Clip, Timeline as TimelineData } from '../../../shared/types'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { clock, timecode } from '../../lib/timecode'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useTimeline, type Peaks, type Thumbs } from '../../stores/timeline'
import { useUi } from '../../stores/ui'
import { PlayheadTimecode } from '../viewer/PlayheadTimecode'
import {
  clipName,
  clipToChat,
  deleteClip,
  findClip,
  linkedAudio,
  splitClip,
  trimToPlayhead
} from './clip-actions'
import {
  ROW_HEIGHT,
  STRIP_HEIGHT,
  STRIP_ROW,
  rulerStep,
  toRows,
  type RowMeta
} from './timeline-adapter'
import { Waveform } from './Waveform'

const LABEL_WIDTH = 132
const START_LEFT = 8
/** What a press scrubs from: the ruler and the playhead (its head and line). */
const SCRUB_FROM = '.timeline-editor-time-area, .timeline-editor-cursor'
/** Px from either edge of the tracks where a held scrub scrolls the timeline. */
const SCRUB_EDGE = 16

const KIND_LABEL: Record<RowMeta['kind'], string> = {
  strip: '',
  video: 'Video',
  block: 'Graphics',
  component: 'Animations',
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

function TrackHead({
  meta,
  clips,
  height
}: {
  meta: RowMeta
  clips: Clip[]
  height: number
}): ReactElement {
  const locked = useTimeline((s) => s.locked.includes(meta.index))
  const toggleLock = useTimeline((s) => s.toggleLock)
  const edit = useTimeline((s) => s.edit)
  const Icon = KIND_ICON[meta.kind]
  if (meta.kind === 'strip')
    return (
      <div className="luca-track-head luca-track-head-strip" style={{ height }}>
        <Film size={13} strokeWidth={1.75} className="shrink-0 text-text-3" />
        <span className="text-text-3">Frames</span>
      </div>
    )
  const sound = meta.kind === 'video' || meta.kind === 'audio'
  const muted = sound && clips.length > 0 && clips.every((c) => c.volume === 0)
  return (
    <div
      className={cn('luca-track-head group/head', locked && 'luca-track-head-locked')}
      style={{ height }}
    >
      <Icon
        size={13}
        strokeWidth={1.75}
        className={cn('shrink-0', `luca-track-icon-${meta.kind}`)}
      />
      <span className="min-w-0 flex-1 truncate">{KIND_LABEL[meta.kind]}</span>
      <div
        className="luca-track-tools opacity-0 transition-opacity duration-150 group-hover/head:opacity-100 data-[on=true]:opacity-100"
        data-on={muted || locked}
      >
        {sound ? (
          <Tip label={muted ? 'Unmute track' : 'Mute track'} side="right">
            <button
              type="button"
              className={cn('luca-track-btn', muted && 'luca-track-btn-on')}
              aria-pressed={muted}
              aria-label={muted ? 'Unmute track' : 'Mute track'}
              onClick={() =>
                void edit({ op: 'mute', refs: clips.map((c) => c.ref), muted: !muted })
              }
            >
              {muted ? (
                <VolumeX size={12} strokeWidth={2} />
              ) : (
                <Volume2 size={12} strokeWidth={2} />
              )}
            </button>
          </Tip>
        ) : null}
        <Tip label={locked ? 'Unlock track' : 'Lock track (no moving or trimming)'} side="right">
          <button
            type="button"
            className={cn('luca-track-btn', locked && 'luca-track-btn-on')}
            aria-pressed={locked}
            aria-label={locked ? 'Unlock track' : 'Lock track'}
            onClick={() => toggleLock(meta.index)}
          >
            {locked ? <Lock size={12} strokeWidth={2} /> : <LockOpen size={12} strokeWidth={2} />}
          </button>
        </Tip>
      </div>
    </div>
  )
}

export function Timeline(): ReactElement {
  const project = useProject((s) => s.project)
  const projectDir = project?.dir ?? null
  const version = useProject((s) => s.previewVersion)
  const timeline = useTimeline((s) => s.timeline)
  const load = useTimeline((s) => s.load)
  const loadMedia = useTimeline((s) => s.loadMedia)
  const reset = useTimeline((s) => s.reset)
  const error = useTimeline((s) => s.error)

  // another project starts from nothing: no clips, frames or waveforms of the last one (the
  // panel only shows while a project is open, so closing one clears them on the way out)
  useEffect(() => {
    reset()
    return reset
  }, [projectDir, reset])

  useEffect(() => {
    if (projectDir) void load()
  }, [projectDir, version, load])

  useEffect(() => {
    if (timeline) void loadMedia(mediaNeeds(timeline))
  }, [timeline, loadMedia])

  // App only mounts the timeline while a project is open
  if (!project) return <div className="h-full bg-panel" />

  return (
    <div className="relative flex h-full flex-col bg-panel">
      <TimelineHead />
      {timeline ? (
        <Tracks key={project.id} projectId={project.id} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-text-3">
          {error ?? <span className="shimmer-text">Reading the timeline…</span>}
        </div>
      )}
      {error && timeline ? (
        <div className="fade-in pointer-events-none absolute bottom-3 left-1/2 z-20 max-w-[80%] -translate-x-1/2 truncate rounded-[8px] bg-danger px-2.5 py-1.5 text-[11px] text-white shadow-popover">
          {error}
        </div>
      ) : null}
    </div>
  )
}

/** Title, then either what you can do with the selected clip or the live move/trim readout. */
function TimelineHead(): ReactElement {
  const selected = useTimeline((s) => s.selected)
  const drag = useTimeline((s) => s.drag)
  const timeline = useTimeline((s) => s.timeline)
  const fps = usePlayer((s) => s.fps)
  const setCaptions = useUi((s) => s.setCaptions)
  // re-read on every timeline change so the chip follows edits to the clip
  const clip = timeline ? findClip(selected) : null
  const dragClip = drag ? findClip(drag.ref) : null
  const Icon = clip ? KIND_ICON[clip.kind] : Film
  const linked = clip ? linkedAudio(clip) : null

  const act = (
    label: string,
    icon: ReactElement,
    run: () => void,
    opts: { shortcut?: string; danger?: boolean; text?: string } = {}
  ): ReactElement => (
    <Tip label={label} shortcut={opts.shortcut}>
      <button
        type="button"
        onClick={run}
        aria-label={label}
        className={cn(
          'inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-[6px] px-1.5 text-[11.5px] font-medium transition-[background-color,color,transform] duration-150 active:scale-95',
          opts.danger
            ? 'text-danger hover:bg-danger/10'
            : 'text-text-2 hover:bg-hover hover:text-text'
        )}
      >
        {icon}
        {opts.text ? (
          <span className={opts.danger ? '' : 'hidden @[920px]:inline'}>{opts.text}</span>
        ) : null}
      </button>
    </Tip>
  )

  return (
    <div className="panel-head @container gap-1">
      <span className="panel-title mr-1">Timeline</span>
      {drag ? (
        <span className="rise-in flex min-w-0 items-center gap-2 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-fg">
          {drag.mode === 'move' ? 'Moving' : 'Trimming'} {dragClip ? clipName(dragClip) : ''}
          <span className="font-mono tabular-nums">
            {timecode(drag.start, fps)} – {timecode(drag.end, fps)}
          </span>
          <span className="font-mono text-secondary-fg/70 tabular-nums">
            {clock(Math.max(0, drag.end - drag.start))}
          </span>
        </span>
      ) : clip ? (
        <div key={clip.ref} className="rise-in flex min-w-0 flex-1 items-center gap-0.5">
          <span className="mr-1.5 flex max-w-[45%] min-w-[110px] shrink items-center gap-1.5 rounded-full border border-border bg-bg py-0.5 pr-2.5 pl-2 text-[11px] font-medium text-text">
            <Icon size={12} strokeWidth={1.9} className={`shrink-0 luca-track-icon-${clip.kind}`} />
            <span className="min-w-0 flex-1 truncate">{clipName(clip)}</span>
            <span className="shrink-0 font-mono text-[10.5px] font-normal text-text-3 tabular-nums">
              {clock(clip.end - clip.start)}
            </span>
          </span>
          {act('Split at playhead', <Scissors size={13} />, () => void splitClip(clip), {
            shortcut: 'S',
            text: 'Split'
          })}
          {act(
            'Trim start to playhead',
            <ArrowLeftToLine size={13} />,
            () => void trimToPlayhead(clip, 'start'),
            { shortcut: '[', text: 'Trim start' }
          )}
          {act(
            'Trim end to playhead',
            <ArrowRightToLine size={13} />,
            () => void trimToPlayhead(clip, 'end'),
            { shortcut: ']', text: 'Trim end' }
          )}
          {clip.kind === 'caption'
            ? act('Change the caption style', <Paintbrush size={13} />, () => setCaptions(true), {
                text: 'Style'
              })
            : null}
          {act(
            'Ask Luca about this clip',
            <MessageSquarePlus size={13} />,
            () => clipToChat(clip),
            {
              text: 'Ask Luca'
            }
          )}
          <span className="ml-auto" />
          {act(
            linked ? 'Delete this clip and its audio' : 'Delete this clip',
            <Trash2 size={13} />,
            () => void deleteClip(clip),
            { shortcut: '⌫', danger: true, text: 'Delete' }
          )}
        </div>
      ) : (
        <span className="truncate text-[11px] text-text-3">
          Drag along the ruler to scrub · click a clip to select it · drag its edges to trim ·
          right-click for more
        </span>
      )}
    </div>
  )
}

function Tracks({ projectId }: { projectId: string }): ReactElement {
  const timeline = useTimeline((s) => s.timeline)!
  const zoom = useTimeline((s) => s.zoom)
  const selected = useTimeline((s) => s.selected)
  const select = useTimeline((s) => s.select)
  const edit = useTimeline((s) => s.edit)
  const setDrag = useTimeline((s) => s.setDrag)
  const locked = useTimeline((s) => s.locked)
  const thumbs = useTimeline((s) => s.thumbs)
  const noThumbs = useTimeline((s) => s.noThumbs)
  const peaks = useTimeline((s) => s.peaks)
  const playerDuration = usePlayer((s) => s.duration)
  const fps = usePlayer((s) => s.fps)
  const ref = useRef<TimelineState>(null)
  const dragging = useRef(false)
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
  const stripClips = useMemo(() => footageClips(timeline), [timeline])
  const { scale, splits } = rulerStep(zoom)

  // Player → cursor (skip while the user drags the cursor), set directly on the editor: as a
  // render dependency the playhead re-rendered every track, clip and thumbnail on every frame.
  useEffect(() => {
    const follow = (t: number): void => {
      if (!dragging.current) ref.current?.setTime(t)
    }
    follow(usePlayer.getState().currentTime)
    return usePlayer.subscribe((s, prev) => {
      if (s.currentTime !== prev.currentTime) follow(s.currentTime)
    })
  }, [])

  // Scrubbing. Press anywhere on the ruler, or on the playhead, and the playhead jumps there and
  // follows the pointer frame by frame until you let go; held past either edge, the timeline
  // scrolls along. The editor itself only moved it on a click in the ruler or a drag that caught
  // its few-pixel line, so it took many tries to grab. Capture phase: before the editor's handlers.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    let stop: (() => void) | null = null

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !(e.target as Element).closest(SCRUB_FROM)) return
      e.preventDefault()
      e.stopPropagation()
      stop?.()
      const grid = el.querySelector<HTMLElement>(
        '.timeline-editor-edit-area .ReactVirtualized__Grid'
      )
      const maxScroll = grid ? Math.max(0, grid.scrollWidth - grid.clientWidth) : 0
      let scroll = grid?.scrollLeft ?? 0
      let x = e.clientX
      let last = -1
      let raf = 0
      const player = usePlayer.getState()
      const resume = player.playing
      if (resume) player.handle?.pause()
      dragging.current = true
      el.classList.add('luca-scrubbing')
      el.setPointerCapture(e.pointerId)

      const place = (): void => {
        const { zoom, timeline } = useTimeline.getState()
        const { fps, duration } = usePlayer.getState()
        const length = Math.max(timeline?.duration ?? 0, duration, 1)
        const raw = (x - el.getBoundingClientRect().left + scroll - START_LEFT) / zoom
        const t = Math.max(0, Math.min(length, Math.round(raw * fps) / fps))
        if (t === last) return
        last = t
        ref.current?.setTime(t)
        usePlayer.getState().seek(t)
      }
      const edgeScroll = (): void => {
        const r = el.getBoundingClientRect()
        const over =
          x < r.left + SCRUB_EDGE
            ? x - r.left - SCRUB_EDGE
            : x > r.right - SCRUB_EDGE
              ? x - r.right + SCRUB_EDGE
              : 0
        const next = Math.max(
          0,
          Math.min(maxScroll, scroll + Math.max(-24, Math.min(24, over / 4)))
        )
        if (next !== scroll) {
          scroll = next
          ref.current?.setScrollLeft(next)
          place()
        }
        raf = requestAnimationFrame(edgeScroll)
      }
      const onMove = (ev: PointerEvent): void => {
        x = ev.clientX
        place()
      }
      const end = (): void => {
        stop = null
        cancelAnimationFrame(raf)
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        el.removeEventListener('lostpointercapture', end)
        el.classList.remove('luca-scrubbing')
        dragging.current = false
        // the player has the last word (it clamps to its own length)
        ref.current?.setTime(usePlayer.getState().currentTime)
        if (resume) usePlayer.getState().handle?.play()
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
      el.addEventListener('lostpointercapture', end)
      stop = end
      place()
      raf = requestAnimationFrame(edgeScroll)
    }

    el.addEventListener('pointerdown', onDown, true)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      stop?.()
    }
  }, [])

  const snapPoints = useMemo(() => {
    const pts = new Set<number>([0, duration])
    for (const c of clips.values()) {
      pts.add(c.start)
      pts.add(c.end)
    }
    return [...pts]
  }, [clips, duration])

  const snap = (t: number, self: Clip): number => {
    const tol = 6 / zoom
    let best = t
    let bestD = tol
    const consider = (p: number): void => {
      if (p === self.start || p === self.end) return
      const d = Math.abs(p - t)
      if (d < bestD) {
        best = p
        bestD = d
      }
    }
    for (const p of snapPoints) consider(p)
    consider(usePlayer.getState().currentTime)
    return best
  }

  const editorRows = useMemo(
    () =>
      rows.map((r) => {
        const lock = locked.includes(meta.get(r.id)?.index ?? -2)
        return {
          ...r,
          actions: r.actions.map((a) =>
            a.id === STRIP_ROW
              ? a
              : { ...a, selected: a.id === selected, movable: !lock, flexible: !lock }
          )
        }
      }),
    [rows, selected, locked, meta]
  )

  const trackClips = (rowId: string): Clip[] =>
    (rows.find((r) => r.id === rowId)?.actions ?? [])
      .map((a) => clips.get(a.id))
      .filter((c): c is Clip => !!c)

  const renderAction = (action: TimelineAction, row: TimelineRow): ReactElement => {
    const m = meta.get(row.id)
    if (action.id === STRIP_ROW)
      return (
        <Strip
          projectId={projectId}
          clips={stripClips}
          thumbs={thumbs}
          noThumbs={noThumbs}
          zoom={zoom}
        />
      )
    const clip = clips.get(action.id)
    if (!clip || !m) return <div />
    return (
      <ClipFace
        clip={clip}
        selected={!!action.selected}
        locked={locked.includes(m.index)}
        peaks={clip.src ? peaks[clip.src] : undefined}
        fps={fps}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="luca-track-heads shrink-0" style={{ width: LABEL_WIDTH }}>
        <div className="flex h-8 items-end border-b border-border px-3 pb-1 font-mono text-[10.5px] text-text-2 tabular-nums">
          <PlayheadTimecode />
        </div>
        <div style={{ height: 10 }} />
        {rows.map((r) => (
          <TrackHead
            key={r.id}
            meta={meta.get(r.id)!}
            clips={trackClips(r.id)}
            height={r.rowHeight ?? ROW_HEIGHT}
          />
        ))}
      </div>
      <div ref={viewportRef} className="relative min-w-0 flex-1">
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
          getScaleRender={(s) => <ScaleLabel seconds={s} fps={fps} />}
          // scrubbing (above) already moved the playhead on the press
          onClickTimeArea={() => false}
          onClickAction={(_, { action }) => {
            if (action.id !== STRIP_ROW) select(action.id)
          }}
          onDoubleClickAction={(_, { action }) => {
            const clip = clips.get(action.id)
            if (clip?.kind === 'caption') useUi.getState().setCaptions(true)
          }}
          onContextMenuAction={(e, { action }) => {
            const clip = clips.get(action.id)
            if (!clip) return
            e.preventDefault()
            select(clip.ref)
            void luca.menu.popupClip({
              clipId: clip.ref,
              track: clip.track,
              start: clip.start,
              end: clip.end
            })
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
            setDrag({ ref: clip.ref, mode: 'move', start: action.start, end: action.start + len })
            return true
          }}
          onActionMoveEnd={({ action, start }) => {
            setDrag(null)
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
            setDrag({ ref: clip.ref, mode: 'trim', start: action.start, end: action.end })
            return true
          }}
          onActionResizeEnd={({ action, start, end, dir }) => {
            setDrag(null)
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

// The editor re-renders every clip and ruler label on each tick of its cursor (the playhead);
// memoized, the faces below are only rebuilt when what they show changes.

const ClipFace = memo(function ClipFace({
  clip,
  selected,
  locked,
  peaks,
  fps
}: {
  clip: Clip
  selected: boolean
  locked: boolean
  peaks: Peaks | undefined
  fps: number
}): ReactElement {
  return (
    <div
      className={cn(
        'luca-clip',
        `luca-clip-${clip.kind}`,
        selected && 'luca-clip-selected',
        clip.volume === 0 && 'luca-clip-muted',
        locked && 'luca-clip-locked'
      )}
      title={`${clip.label} · ${timecode(clip.start, fps)} – ${timecode(clip.end, fps)}`}
    >
      {clip.kind === 'audio' && peaks && peaks.peaks.length > 0 ? (
        <Waveform
          peaks={peaks.peaks}
          peaksPerSecond={peaks.peaksPerSecond}
          start={clip.mediaStart ?? 0}
          end={(clip.mediaStart ?? 0) + clip.end - clip.start}
        />
      ) : null}
      <span className="luca-clip-label">
        {clip.remocn ? (
          <span className="luca-clip-badge" title="Animation">
            <Sparkles size={8} strokeWidth={2.5} />
          </span>
        ) : null}
        {clip.volume === 0 ? <VolumeX size={10} strokeWidth={2.2} className="shrink-0" /> : null}
        <span className="truncate">{clip.label}</span>
      </span>
      <span className="luca-clip-handle luca-clip-handle-l" />
      <span className="luca-clip-handle luca-clip-handle-r" />
    </div>
  )
})

const ScaleLabel = memo(function ScaleLabel({
  seconds,
  fps
}: {
  seconds: number
  fps: number
}): ReactElement {
  return <span>{timecode(seconds, fps).replace(/:\d\d$/, '')}</span>
})

/** The footage clips the Frames row shows: every clip on the lowest video track. */
function footageClips(t: TimelineData): Clip[] {
  const track = t.tracks.filter((tr) => tr.kind === 'video').sort((a, b) => a.index - b.index)[0]
  return track ? track.clips.filter((c) => c.kind === 'video' && !!c.src) : []
}

/** Media files whose frames (footage) and waveforms (audio clips) the timeline shows. */
function mediaNeeds(t: TimelineData): { video: string[]; audio: string[] } {
  const audio = t.tracks.flatMap((tr) =>
    tr.clips.filter((c) => c.kind === 'audio' && !!c.src).map((c) => c.src!)
  )
  return {
    video: [...new Set(footageClips(t).map((c) => c.src!))],
    audio: [...new Set(audio)]
  }
}

/**
 * One <img> per second of each footage clip, laid out where the clip sits and starting where it
 * starts in its file; memoized so it only re-renders when zoom, clips or thumbs change. Until a
 * clip's frames are made it shows the frosted pending veil, and each frame sharpens in as it
 * loads.
 */
const Strip = memo(function Strip({
  projectId,
  clips,
  thumbs,
  noThumbs,
  zoom
}: {
  projectId: string
  clips: Clip[]
  thumbs: Record<string, Thumbs>
  noThumbs: Record<string, true>
  zoom: number
}): ReactElement {
  const pieces: ReactElement[] = []
  for (const c of clips) {
    const t = c.src ? thumbs[c.src] : undefined
    if (!t || t.count === 0) {
      if (c.src && noThumbs[c.src]) continue
      pieces.push(
        <div
          key={c.ref}
          className="absolute inset-y-0 overflow-hidden rounded-[6px]"
          style={{ left: c.start * zoom, width: (c.end - c.start) * zoom }}
        >
          <div className="media-pending" />
        </div>
      )
      continue
    }
    const from = c.mediaStart ?? 0
    const first = Math.floor(from / t.interval)
    const last = Math.min(t.count, Math.ceil((from + c.end - c.start) / t.interval))
    const w = t.interval * zoom
    const imgs: ReactElement[] = []
    for (let i = first; i < last; i++) {
      imgs.push(
        <img
          key={i}
          src={`/p/${encodeURIComponent(projectId)}/${t.dir}/${String(i + 1).padStart(4, '0')}.jpg`}
          style={{ width: w, height: STRIP_HEIGHT }}
          className="media-reveal block shrink-0 object-cover"
          // straight on the element: the strip doesn't re-render for every frame that lands
          onLoad={(e) => (e.currentTarget.dataset.loaded = '')}
          draggable={false}
          alt=""
        />
      )
    }
    pieces.push(
      <div
        key={c.ref}
        className="absolute inset-y-0 flex overflow-hidden"
        style={{ left: c.start * zoom, width: (c.end - c.start) * zoom }}
      >
        <div className="flex shrink-0" style={{ marginLeft: -(from - first * t.interval) * zoom }}>
          {imgs}
        </div>
      </div>
    )
  }
  return <div className="luca-strip relative">{pieces}</div>
})
