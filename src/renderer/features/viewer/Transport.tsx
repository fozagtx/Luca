import {
  ChevronFirst,
  ChevronLast,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { timecode } from '../../lib/timecode'
import { usePlayer } from '../../stores/player'
import { useTimeline } from '../../stores/timeline'
import { useUi } from '../../stores/ui'
import { PlayheadTimecode } from './PlayheadTimecode'

export function Transport(): ReactElement {
  const playing = usePlayer((s) => s.playing)
  const duration = usePlayer((s) => s.duration)
  const fps = usePlayer((s) => s.fps)
  const muted = usePlayer((s) => s.muted)
  const volume = usePlayer((s) => s.volume)
  const ready = usePlayer((s) => s.ready)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const step = usePlayer((s) => s.step)
  const seek = usePlayer((s) => s.seek)
  const toggleMute = usePlayer((s) => s.toggleMute)
  const setVolume = usePlayer((s) => s.setVolume)
  const setGoto = useUi((s) => s.setGoto)
  const zoom = useTimeline((s) => s.zoom)
  const zoomBy = useTimeline((s) => s.zoomBy)
  const zoomToFit = useTimeline((s) => s.zoomToFit)
  const hasTimeline = useTimeline((s) => s.timeline !== null)

  return (
    <div className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-border bg-panel px-3">
      <div className="flex items-center gap-1">
        <Tip label={muted ? 'Unmute' : 'Mute'} shortcut="M">
          <Button variant="icon" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted || volume === 0 ? (
              <VolumeX size={15} strokeWidth={1.5} />
            ) : (
              <Volume2 size={15} strokeWidth={1.5} />
            )}
          </Button>
        </Tip>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={muted ? 0 : volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="volume w-14"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="dock">
          <Tip label="Go to start" shortcut="Home">
            <Button
              variant="icon"
              disabled={!ready}
              onClick={() => seek(0)}
              aria-label="Go to start"
            >
              <ChevronFirst size={16} strokeWidth={1.5} />
            </Button>
          </Tip>
          <Tip label="Previous frame" shortcut="←">
            <Button
              variant="icon"
              disabled={!ready}
              onClick={() => step(-1)}
              aria-label="Previous frame"
            >
              <SkipBack size={15} strokeWidth={1.5} />
            </Button>
          </Tip>
          <Tip label={playing ? 'Pause' : 'Play'} shortcut="Space">
            <Button
              variant="icon"
              disabled={!ready}
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              className="bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
            >
              {playing ? (
                <Pause size={16} strokeWidth={1.75} />
              ) : (
                <Play size={16} strokeWidth={1.75} />
              )}
            </Button>
          </Tip>
          <Tip label="Next frame" shortcut="→">
            <Button
              variant="icon"
              disabled={!ready}
              onClick={() => step(1)}
              aria-label="Next frame"
            >
              <SkipForward size={15} strokeWidth={1.5} />
            </Button>
          </Tip>
          <Tip label="Go to end" shortcut="End">
            <Button
              variant="icon"
              disabled={!ready}
              onClick={() => seek(duration)}
              aria-label="Go to end"
            >
              <ChevronLast size={16} strokeWidth={1.5} />
            </Button>
          </Tip>
        </div>

        <div className="flex items-baseline gap-1">
          <Tip label="Go to timecode" shortcut="⌘G">
            <button
              type="button"
              className="timecode rounded-[4px] px-1.5 py-0.5 text-text hover:bg-hover"
              onClick={() => setGoto(true)}
            >
              <PlayheadTimecode />
            </button>
          </Tip>
          <span className="timecode text-text-3">/ {timecode(duration, fps)}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-0.5">
        <Tip label="Zoom out" shortcut="⌘−">
          <Button
            variant="icon"
            disabled={!hasTimeline}
            onClick={() => zoomBy(0.8)}
            aria-label="Zoom out"
          >
            <Minus size={14} strokeWidth={1.75} />
          </Button>
        </Tip>
        <span className="w-12 text-center font-mono text-[10px] tabular-nums text-text-3">
          {Math.round(zoom)}px/s
        </span>
        <Tip label="Zoom in" shortcut="⌘+">
          <Button
            variant="icon"
            disabled={!hasTimeline}
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
          >
            <Plus size={14} strokeWidth={1.75} />
          </Button>
        </Tip>
        <Tip label="Zoom to fit" shortcut="⌘0">
          <Button
            variant="icon"
            disabled={!hasTimeline}
            onClick={() => zoomToFit(duration)}
            aria-label="Zoom to fit"
          >
            <Maximize2 size={14} strokeWidth={1.5} />
          </Button>
        </Tip>
      </div>
    </div>
  )
}
