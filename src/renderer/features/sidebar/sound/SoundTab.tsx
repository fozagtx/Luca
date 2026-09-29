import { Volume2, VolumeX } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { soundClips, soundOf } from '../../../../shared/sound'
import type { Clip } from '../../../../shared/types'
import { Tip } from '../../../components/ui/tooltip'
import { cn } from '../../../lib/cn'
import { formatDuration } from '../../../lib/format'
import { useProject } from '../../../stores/project'
import { useTimeline } from '../../../stores/timeline'
import { EmptyPane } from '../EmptyPane'
import { PaneHead } from '../Sidebar'

const fmt = (t: number): string => formatDuration(Math.max(0, t))

/** Every sound on the timeline as a row: name, where it plays, a level slider and a mute. */
export function SoundTab(): ReactElement {
  const project = useProject((s) => s.project)
  const timeline = useTimeline((s) => s.timeline)
  const clips = timeline ? soundClips(timeline) : []
  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Sound" />
      {!project ? (
        <EmptyPane
          title="Add your video first"
          hint="Each sound on the timeline gets a level here once your video is in."
        />
      ) : clips.length === 0 ? (
        <EmptyPane
          title="No sounds yet"
          hint="Clips that make sound — footage, a voiceover, music, B-roll — appear here with their levels."
        />
      ) : (
        <div className="scroll flex flex-col gap-1 p-2">
          {clips.map((c) => (
            <SoundRow key={c.ref} clip={c} name={soundOf(c, project).name} />
          ))}
        </div>
      )}
    </div>
  )
}

function SoundRow({ clip, name }: { clip: Clip; name: string }): ReactElement {
  // the drag follows local state; the level is written to the timeline on release
  const [drag, setDrag] = useState<number | null>(null)
  const volume = clip.volume ?? 1
  const pct = drag ?? Math.round(volume * 100)
  const setVolume = (p: number): void => {
    void useTimeline.getState().edit({ op: 'volume', refs: [clip.ref], volume: p / 100 })
  }
  const toggleMute = (): void => {
    void useTimeline.getState().edit({ op: 'mute', refs: [clip.ref], muted: volume > 0 })
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-[8px] px-2 py-2 hover:bg-hover">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text">{name}</span>
        <span className="shrink-0 text-[10.5px] text-text-3 tabular-nums">
          {fmt(clip.start)}–{fmt(clip.end)}
        </span>
        <Tip label={volume > 0 ? 'Mute' : 'Unmute'} side="left">
          <button
            type="button"
            aria-label={volume > 0 ? `Mute ${name}` : `Unmute ${name}`}
            aria-pressed={volume === 0}
            onClick={toggleMute}
            className="icon-btn size-6"
          >
            {volume > 0 ? <Volume2 size={13} /> : <VolumeX size={13} />}
          </button>
        </Tip>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={pct}
          aria-label={`${name} level`}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => {
            if (drag !== null) {
              setVolume(drag)
              setDrag(null)
            }
          }}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setVolume(pct)
          }}
          className="volume min-w-0 flex-1"
        />
        <span
          className={cn(
            'w-9 shrink-0 text-right text-[10.5px] tabular-nums',
            pct === 0 ? 'text-text-3' : 'text-text-2'
          )}
        >
          {pct}%
        </span>
      </div>
    </div>
  )
}
