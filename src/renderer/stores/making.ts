import type { StartKind } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { useChat } from './chat'
import { useProject } from './project'
import { useTimeline } from './timeline'

/** What the first edit starts from: footage, a voiceover, or a script recorded on the start card. */
export type MakingKind = StartKind | 'script'

/** Luca's first edit of the footage from the start card: from the first request until that turn ends. */
export type Making = {
  projectId: string
  kind: MakingKind
  since: number
  /** The footage's length in seconds, once known (the timeline tells when the start card can't). */
  length: number | null
  /** The first guess for footage this long, before what past edits took (see `guessSeconds`). */
  guess: number
  /** A fixed allowance in seconds on top of the learned time (music takes as long as ai33 takes). */
  extra: number
  /** How long it should take, in seconds (see `expectedSeconds`), the allowance included. */
  expected: number
  /** Luca's turn has begun (the request can go in while Luca is still starting up). */
  started: boolean
  /** When Luca started checking or rendering the edit, the last steps of it. */
  finishingSince?: number
  /** The person chose to watch Luca edit instead of the veil over it. */
  peek: boolean
}

type MakingStore = {
  making: Making | null
  /**
   * `length`: the footage's length in seconds, or null when the start card doesn't know it.
   * `extraSeconds`: work that takes a fixed time however long the video is (making music); it is
   * added to the estimate and kept out of what past edits teach.
   */
  begin: (
    projectId: string,
    kind: MakingKind,
    length: number | null,
    opts?: { extraSeconds?: number }
  ) => void
  cancel: () => void
  setPeek: (peek: boolean) => void
}

/** Making music takes about this long at ai33, whatever the video's length. */
export const MAKING_MUSIC_EXTRA_SECONDS = 150

/** A first guess in seconds for a minute of footage, before this Mac has edited any. */
const GUESS: Record<MakingKind, number> = { video: 150, audio: 240, brief: 300, script: 200 }
/**
 * More for every minute after the first: transcribing, cutting and captioning a 10-minute video
 * takes far longer than a 30-second clip, and a voiceover needs every visual made. A script
 * comes with its words and times, so there is nothing to transcribe or cut.
 */
const PER_MINUTE: Record<MakingKind, number> = { video: 45, audio: 75, brief: 0, script: 70 }
/** How long past edits took next to their first guess (2 = twice as long), per kind. */
const TIMES_KEY = 'luca.edit-times'

function pastRatios(): Partial<Record<MakingKind, number[]>> {
  try {
    return JSON.parse(localStorage.getItem(TIMES_KEY) ?? '{}') as Partial<
      Record<MakingKind, number[]>
    >
  } catch {
    return {}
  }
}

function remember(kind: MakingKind, ratio: number): void {
  try {
    const all = pastRatios()
    all[kind] = [...(all[kind] ?? []), Math.round(ratio * 100) / 100].slice(-5)
    localStorage.setItem(TIMES_KEY, JSON.stringify(all))
  } catch {
    // only the estimate is lost
  }
}

/** The first guess for editing this much footage, in seconds; a minute when the length is unknown. */
export function guessSeconds(kind: MakingKind, length: number | null): number {
  const minutes = Math.min(30, (length ?? 60) / 60)
  return GUESS[kind] + PER_MINUTE[kind] * Math.max(0, minutes - 1)
}

/** How long the first edit takes: the guess, scaled by the median of the last few edits. */
export function expectedSeconds(kind: MakingKind, guess: number): number {
  const xs = [1, ...(pastRatios()[kind] ?? [])].sort((a, b) => a - b)
  const mid = xs.length >> 1
  return guess * (xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2)
}

/** Checking and rendering come last: once they start, the edit is under a minute from done. */
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
      // the fixed allowance is not part of the ratio, and a quick edit doesn't teach "instant"
      if (!e.isError)
        remember(m.kind, Math.max(30, (Date.now() - m.since) / 1000 - m.extra) / m.guess)
      useMaking.setState({ making: null })
    }
  })
  // a voiceover's length (or footage the start card couldn't read): from the timeline's first load
  useTimeline.subscribe((s) => {
    const m = useMaking.getState().making
    const length = s.timeline?.duration
    if (!m || m.length !== null || !length) return
    const guess = guessSeconds(m.kind, length)
    update({ length, guess, expected: expectedSeconds(m.kind, guess) + m.extra })
  })
  // Home, or another project: this one's edit isn't on screen any more
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
  begin: (projectId, kind, length, opts) => {
    bind()
    const guess = guessSeconds(kind, length)
    const extra = Math.max(0, opts?.extraSeconds ?? 0)
    set({
      making: {
        projectId,
        kind,
        since: Date.now(),
        length,
        guess,
        extra,
        expected: expectedSeconds(kind, guess) + extra,
        started: false,
        peek: false
      }
    })
  },
  cancel: () => set({ making: null }),
  setPeek: (peek) => set((s) => (s.making ? { making: { ...s.making, peek } } : {}))
}))
