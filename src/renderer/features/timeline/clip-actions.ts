import type { Clip } from '@shared/types'
import { toast } from 'sonner'
import { luca } from '../../lib/luca'
import { clock } from '../../lib/timecode'
import { useChat } from '../../stores/chat'
import { usePlayer } from '../../stores/player'
import { useTimeline } from '../../stores/timeline'
import { useUi } from '../../stores/ui'

export function findClip(ref: string | null | undefined): Clip | null {
  if (!ref) return null
  for (const t of useTimeline.getState().timeline?.tracks ?? [])
    for (const c of t.clips) if (c.ref === ref) return c
  return null
}

/** The clip a menu command is about: the one right-clicked, else the selected one. */
export function targetClip(arg?: unknown): Clip | null {
  const ref =
    arg && typeof arg === 'object' && 'clipId' in arg
      ? String((arg as { clipId: string }).clipId)
      : useTimeline.getState().selected
  return findClip(ref)
}

/** What a clip is called: the title Luca gave it, else its id made readable. */
export function clipName(c: Clip): string {
  return c.title?.trim() || c.label.replace(/^#/, '').replace(/[-_]+/g, ' ')
}

/** A video's own sound: an audio clip from the same file covering the same stretch. */
export function linkedAudio(c: Clip): Clip | null {
  if (c.kind !== 'video' || !c.src) return null
  for (const t of useTimeline.getState().timeline?.tracks ?? [])
    for (const a of t.clips)
      if (
        a.kind === 'audio' &&
        a.src === c.src &&
        Math.abs(a.start - c.start) < 0.05 &&
        Math.abs(a.end - c.end) < 0.05
      )
        return a
  return null
}

const undo = { label: 'Undo', onClick: () => void luca.history.undo() }

export async function deleteClip(c: Clip): Promise<void> {
  const audio = linkedAudio(c)
  const tl = useTimeline.getState()
  if (tl.selected === c.ref) tl.select(null)
  const ok = await tl.edit({ op: 'delete', ref: c.ref, ...(audio ? { with: [audio.ref] } : {}) })
  if (ok)
    toast(audio ? `Deleted ${clipName(c)} and its audio` : `Deleted ${clipName(c)}`, {
      action: undo
    })
}

export async function splitClip(c: Clip, at = usePlayer.getState().currentTime): Promise<void> {
  if (at <= c.start + 0.05 || at >= c.end - 0.05) {
    toast('Move the playhead inside the clip to split it')
    return
  }
  if (await useTimeline.getState().edit({ op: 'split', ref: c.ref, time: at }))
    toast(`Split ${clipName(c)} at ${clock(at)}`, { action: undo })
}

export async function trimToPlayhead(c: Clip, side: 'start' | 'end'): Promise<void> {
  const at = usePlayer.getState().currentTime
  if (at <= c.start + 0.05 || at >= c.end - 0.05) {
    toast('Move the playhead inside the clip to trim it')
    return
  }
  const ok = await useTimeline
    .getState()
    .edit(
      side === 'start' ? { op: 'trim', ref: c.ref, start: at } : { op: 'trim', ref: c.ref, end: at }
    )
  if (ok) toast(`Trimmed the ${side} of ${clipName(c)}`, { action: undo })
}

export function clipToChat(c: Clip): void {
  useChat.getState().addChip({
    kind: 'clip',
    clipId: c.id,
    track: c.track,
    start: c.start,
    end: c.end
  })
  if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
  requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
}
