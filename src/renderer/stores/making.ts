import type { StartKind } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { useChat } from './chat'
import { useProject } from './project'

/** A new video Luca is building from the start card: from the first request until that turn ends. */
export type Making = {
  projectId: string
  kind: StartKind
  since: number
  /** How long it should take, in seconds (see `expectedSeconds`). */
  expected: number
  /** Luca's turn has begun (the request can go in while Luca is still starting up). */
  started: boolean
  /** When Luca started checking or rendering the edit, the last steps of a build. */
  finishingSince?: number
  /** The person chose to watch the video build instead of the veil over it. */
  peek: boolean
}

type MakingStore = {
  making: Making | null
  begin: (projectId: string, kind: StartKind, length: number | null) => void
  cancel: () => void
  setPeek: (peek: boolean) => void
}

/** A first guess in seconds, before this Mac has made any videos like it. */
const GUESS: Record<StartKind, number> = { scratch: 180, images: 150, video: 120, audio: 180 }
const TIMES_KEY = 'luca.making-times'

function pastTimes(): Partial<Record<StartKind, number[]>> {
  try {
    return JSON.parse(localStorage.getItem(TIMES_KEY) ?? '{}') as Partial<
      Record<StartKind, number[]>
    >
  } catch {
    return {}
  }
}

function remember(kind: StartKind, seconds: number): void {
  try {
    const all = pastTimes()
    all[kind] = [...(all[kind] ?? []), Math.round(seconds)].slice(-5)
    localStorage.setItem(TIMES_KEY, JSON.stringify(all))
  } catch {
    // only the estimate is lost
  }
}

/** How long making this kind of video takes: the median of a guess and the last few makes. */
export function expectedSeconds(kind: StartKind, length: number | null): number {
  // longer videos take longer to write: +30 s at 30 s, +90 s at a minute
  const guess = GUESS[kind] + Math.min(120, Math.max(0, ((length ?? 15) - 15) * 2))
  const xs = [guess, ...(pastTimes()[kind] ?? [])].sort((a, b) => a - b)
  const mid = xs.length >> 1
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/** Checking and rendering come last: once they start, the build is under a minute from done. */
const FINISHING = 45

/** Seconds left from the estimate, or less once the last steps started; 0 or below = overdue. */
export function secondsLeft(m: Making, elapsed: number, finishingFor: number): number {
  const left = m.expected - elapsed
  return m.finishingSince ? Math.min(left, FINISHING - finishingFor) : left
}

/**
 * "About 3 minutes left", "About 1 minute left", "Less than a minute left", "Almost done";
 * `short` for tight spots: "About 3 min left", "Under a minute".
 */
export function timeLeftLabel(left: number, overdueFor: number, short = false): string {
  if (left <= 0)
    return overdueFor > 90
      ? short
        ? 'Longer than usual'
        : 'Taking a little longer than usual'
      : 'Almost done'
  if (left < 50) return short ? 'Under a minute' : 'Less than a minute left'
  const minutes = left < 100 ? 1 : Math.round(left / 60)
  return short
    ? `About ${minutes} min left`
    : `About ${minutes} minute${minutes === 1 ? '' : 's'} left`
}

let bound = false

function bind(): void {
  if (bound) return
  bound = true
  const update = (patch: Partial<Making>): void => {
    const m = useMaking.getState().making
    if (m) useMaking.setState({ making: { ...m, ...patch } })
  }
  luca.agent.onEvent((e) => {
    const m = useMaking.getState().making
    if (!m) return
    if (e.type === 'turn-start') update({ started: true })
    else if (
      e.type === 'tool' &&
      m.started &&
      !m.finishingSince &&
      (e.activity?.kind === 'check' || e.activity?.kind === 'render')
    )
      update({ finishingSince: Date.now() })
    else if (e.type === 'turn-end' && m.started) {
      if (!e.isError) remember(m.kind, (Date.now() - m.since) / 1000)
      useMaking.setState({ making: null })
    }
  })
  // Home, or another project: this one's build isn't on screen any more
  useProject.subscribe((s) => {
    const m = useMaking.getState().making
    if (m && s.project?.id !== m.projectId) useMaking.setState({ making: null })
  })
  // Luca can't run (signed out, missing, crashed): the chat says why, and nothing is being made
  useChat.subscribe((s, prev) => {
    if (s.state === prev.state) return
    if (s.state === 'needs-login' || s.state === 'missing-claude' || s.state === 'error')
      useMaking.setState({ making: null })
  })
}

export const useMaking = create<MakingStore>((set) => ({
  making: null,
  begin: (projectId, kind, length) => {
    bind()
    set({
      making: {
        projectId,
        kind,
        since: Date.now(),
        expected: expectedSeconds(kind, length),
        started: false,
        peek: false
      }
    })
  },
  cancel: () => set({ making: null }),
  setPeek: (peek) => set((s) => (s.making ? { making: { ...s.making, peek } } : {}))
}))
