import type { Clip, ClipKind, Timeline, Track } from '../shared/types'
import { findTags } from './html'

/** One row of `hyperframes timeline --json`. */
export type HfRow = {
  id: string | null
  label: string | null
  kind: string
  trackKind: string
  start: number
  duration: number
  end: number
  absStart: number
  absEnd: number
  file: string
  trackIndex: number
  src: string | null
  ref: string
  elementId: string | null
  children?: HfRow[]
}

export type HfTimeline = {
  timeline: {
    duration: number
    fps?: number
    width?: number
    height?: number
    tracks: { kind: string; rows: HfRow[] }[]
  }
}

type Role = NonNullable<Clip['role']>

/** What a row of generated audio is called: by what it is, not by the kind of media. */
const ROLE_ROW: Record<Role, string> = {
  voice: 'Voiceover',
  music: 'Music',
  sfx: 'Sound effects'
}

const isRole = (v: string | undefined): v is Role => v === 'voice' || v === 'music' || v === 'sfx'

/** Attribute values come back as written to the file; undo what setAttrs escaped. */
export const unescapeAttr = (v: string): string =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function kindOf(row: HfRow): ClipKind {
  if (row.trackKind === 'video' || row.kind === 'video') return 'video'
  if (row.trackKind === 'audio' || row.kind === 'audio') return 'audio'
  if (row.trackKind === 'caption' || row.kind === 'caption' || /caption/i.test(row.id ?? ''))
    return 'caption'
  if (row.kind === 'composition' || row.kind === 'block') return 'block'
  return 'block'
}

/** A row's name: audio made for this video by what it is, everything else by its kind. */
function trackLabel(t: Track): string {
  if (t.kind === 'audio') {
    // one kind of sound per row. A clip without a role (a half the CLI split and didn't copy the
    // tag to) doesn't rename the row; two different roles on one row do
    const roles = new Set(t.clips.flatMap((c) => (c.role ? [c.role] : [])))
    const [only] = roles
    return roles.size === 1 && only ? ROLE_ROW[only] : 'Audio'
  }
  if (t.kind === 'video') return 'Video'
  if (t.kind === 'caption') return 'Captions'
  return 'Graphics'
}

/** The CLI's timeline plus what only index.html knows (volumes, trimmed starts, roles, titles). */
export function buildTimeline(data: HfTimeline, html: string): Timeline {
  const width = data.timeline.width ?? Number(/data-width="(\d+)"/.exec(html)?.[1] ?? 1920)
  const height = data.timeline.height ?? Number(/data-height="(\d+)"/.exec(html)?.[1] ?? 1080)

  // clip volumes and trimmed starts aren't in the CLI's JSON; read them from the tags
  const volumes = new Map<string, number>()
  const mediaStarts = new Map<string, number>()
  // what Luca wrote for the clips it made: which sound it is and the name to show
  const made = new Map<string, { role?: Role; title?: string }>()
  for (const t of findTags(html)) {
    const id = t.attrs.id
    if (!id) continue
    if (t.name === 'video' || t.name === 'audio') {
      volumes.set(id, Number(t.attrs['data-volume'] ?? 1))
      const ms = Number(t.attrs['data-media-start'])
      if (ms > 0) mediaStarts.set(id, ms)
    }
    const role = t.attrs['data-luca-role']?.trim().toLowerCase()
    const title = unescapeAttr(t.attrs['data-luca-title'] ?? '').trim()
    if (isRole(role) || title)
      made.set(id, { ...(isRole(role) ? { role } : {}), ...(title ? { title } : {}) })
  }
  const byIndex = new Map<number, Track>()
  const seen = new Set<string>()
  const visit = (row: HfRow): void => {
    const idx = row.trackIndex ?? 0
    const kind = kindOf(row)
    const track =
      byIndex.get(idx) ??
      (() => {
        const t: Track = { index: idx, kind, label: kind, clips: [] }
        byIndex.set(idx, t)
        return t
      })()
    const id = row.id ?? row.elementId ?? row.ref
    const key = `${row.file}:${row.ref}`
    if (seen.has(key)) return
    seen.add(key)
    const mine = (row.elementId ? made.get(row.elementId) : undefined) ?? made.get(id)
    const clip: Clip = {
      id,
      track: idx,
      kind,
      start: row.absStart,
      end: row.absEnd,
      file: row.file,
      label: mine?.title ?? row.label ?? id,
      src: row.src,
      ref: row.ref,
      remocn: typeof row.src === 'string' && row.src.startsWith('media/remocn/'),
      ...(row.elementId && volumes.has(row.elementId)
        ? { volume: volumes.get(row.elementId) }
        : volumes.has(id)
          ? { volume: volumes.get(id) }
          : {}),
      ...(mediaStarts.has(row.elementId ?? id)
        ? { mediaStart: mediaStarts.get(row.elementId ?? id) }
        : {}),
      // only sound has a role; the same attribute on anything else is ignored
      ...(kind === 'audio' && mine?.role ? { role: mine.role } : {}),
      ...(mine?.title ? { title: mine.title } : {})
    }
    track.clips.push(clip)
    if (track.kind !== kind && kind === 'video') track.kind = 'video'
  }
  for (const t of data.timeline.tracks) {
    for (const row of t.rows) {
      // nested rows belong to sub-compositions; only top-level index.html rows are timeline clips
      if (row.file && row.file !== 'index.html') continue
      visit(row)
    }
  }
  const tracks = [...byIndex.values()].sort((a, b) => a.index - b.index)
  for (const t of tracks) {
    t.clips.sort((a, b) => a.start - b.start)
    t.label = trackLabel(t)
  }
  return { duration: data.timeline.duration, fps: data.timeline.fps ?? 30, width, height, tracks }
}
