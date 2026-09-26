import type { ReactElement } from 'react'
import { timecode } from '../../lib/timecode'
import { usePlayer } from '../../stores/player'

/**
 * The playhead as a timecode. It changes on every frame of playback, so it subscribes on its own
 * and its parent (the transport, the timeline) doesn't re-render with it.
 */
export function PlayheadTimecode(): ReactElement {
  const currentTime = usePlayer((s) => s.currentTime)
  const fps = usePlayer((s) => s.fps)
  return <>{timecode(currentTime, fps)}</>
}
