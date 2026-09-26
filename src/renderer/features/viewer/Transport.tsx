import {
  ChevronFirst,
  ChevronLast,
  Maximize2,
  Pause,
  Play,
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
import { useUi } from '../../stores/ui'

export function Transport({ onZoomFit }: { onZoomFit?: () => void }): ReactElement {
  const {
    playing,
    currentTime,
    duration,
    fps,
    muted,
    volume,
    togglePlay,
    step,
    seek,
    toggleMute,
    setVolume,
    ready
  } = usePlayer()
  const setGoto = useUi((s) => s.setGoto)

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-t border-b border-border bg-bg-subtle px-3">
      <Tip label="Go to start" shortcut="Home">
        <Button variant="icon" disabled={!ready} onClick={() => seek(0)} aria-label="Go to start">
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
          className="text-text"
        >
          {playing ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
        </Button>
      </Tip>
      <Tip label="Next frame" shortcut="→">
        <Button variant="icon" disabled={!ready} onClick={() => step(1)} aria-label="Next frame">
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

      <button
        type="button"
        className="timecode ml-3 rounded-[4px] px-1.5 py-0.5 text-text hover:bg-black/[0.05]"
        onClick={() => setGoto(true)}
        title="Go to timecode (⌘G)"
      >
        {timecode(currentTime, fps)}
      </button>
      <span className="timecode text-text-3">/ {timecode(duration, fps)}</span>

      <div className="ml-auto flex items-center gap-1">
        <Tip label={muted ? 'Unmute' : 'Mute'} shortcut="M">
          <Button variant="icon" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted || volume === 0 ? (
              <VolumeX size={16} strokeWidth={1.5} />
            ) : (
              <Volume2 size={16} strokeWidth={1.5} />
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
          className="volume w-20"
        />
        <Tip label="Zoom timeline to fit" shortcut="⌘0">
          <Button variant="icon" onClick={onZoomFit} aria-label="Zoom to fit">
            <Maximize2 size={15} strokeWidth={1.5} />
          </Button>
        </Tip>
      </div>
    </div>
  )
}
