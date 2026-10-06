import type { Chip } from '@shared/types'
import { clock } from '../../lib/timecode'

/** A chip people see as a picture: an added image or video, a grabbed frame, a B-roll pick. */
export type Visual = {
  /** What the tile shows: the picture itself, or a video's poster. */
  src: string
  /** The small still made when it was added: shown while `src` loads, and in its place if it's gone. */
  thumb?: string
  /** The file the viewer plays (an added video). */
  play?: string
  video: boolean
  width?: number
  height?: number
  /** Seconds (videos). */
  duration?: number
  /** Project-relative file, for Show in Finder. */
  path?: string
  name: string
}

/**
 * A project file as the renderer loads it. Built when shown, never stored, so it follows the
 * open project; each part of the path is encoded (a # or ? in a name would cut the URL short).
 */
export function projectFile(projectId: string, rel: string): string {
  return `/p/${encodeURIComponent(projectId)}/${rel.split('/').map(encodeURIComponent).join('/')}`
}

/** How a chip shows as a picture, or null for one that stays a pill (audio, a clip, words…). */
export function visualOf(chip: Chip, projectId: string | null | undefined): Visual | null {
  switch (chip.kind) {
    case 'media': {
      if (chip.media === 'audio') return null
      const file = projectId ? projectFile(projectId, chip.path) : undefined
      const base = { name: chip.name, width: chip.width, height: chip.height, path: chip.path }
      if (chip.media === 'image') {
        const src = file ?? chip.thumb
        return src ? { ...base, src, thumb: chip.thumb, video: false } : null
      }
      // a video is shown by its poster; one without a picture stays a pill
      return chip.thumb
        ? { ...base, src: chip.thumb, play: file, video: true, duration: chip.duration }
        : null
    }
    case 'frame':
      return {
        name: `Frame at ${clock(chip.time)}`,
        src: `data:image/png;base64,${chip.png}`,
        video: false
      }
    case 'broll':
      return chip.thumb
        ? {
            name: chip.title,
            src: chip.thumb,
            video: chip.media === 'video',
            duration: chip.duration
          }
        : null
    default:
      return null
  }
}

/** What a chip is, for React keys: removing one must not hand its state to the next. */
function chipId(c: Chip): string {
  switch (c.kind) {
    case 'element':
      return `element:${c.selector}@${c.time}`
    case 'frame':
      return `frame:${c.time}:${c.png.length}:${c.png.slice(-24)}`
    case 'clip':
      return `clip:${c.clipId}@${c.start}`
    case 'transcript':
      return `transcript:${c.start}-${c.end}`
    case 'edit':
      return `edit:${c.label}`
    case 'broll':
      return `broll:${c.id}`
    case 'media':
      return `media:${c.path}`
    default:
      return (c as { kind: string }).kind
  }
}

/** A stable key for each chip in a list (the same chip twice gets a count). */
export function chipKeys(chips: Chip[]): string[] {
  const seen = new Map<string, number>()
  return chips.map((c) => {
    const id = chipId(c)
    const n = seen.get(id) ?? 0
    seen.set(id, n + 1)
    return n ? `${id}#${n}` : id
  })
}

/** Width and height of a tile showing a picture of this shape, inside `max`, never thinner than `min`. */
export function fitTile(
  ratio: number,
  max: { width: number; height: number },
  min: number
): { width: number; height: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  let width = max.width
  let height = width / r
  if (height > max.height) {
    height = max.height
    width = height * r
  }
  // a very tall or very wide picture is cropped rather than shown as a sliver
  return {
    width: Math.round(Math.min(max.width, Math.max(min, width))),
    height: Math.round(Math.min(max.height, Math.max(min, height)))
  }
}

// ------------------------------------------------------------------------------------ copy

/** The bytes of a data: URL (fetching one is against the page's connect-src). */
function dataBlob(url: string): Blob {
  const comma = url.indexOf(',')
  const head = url.slice(0, comma)
  const body = url.slice(comma + 1)
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream'
  const bytes = head.endsWith(';base64')
    ? Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(body))
  return new Blob([bytes], { type })
}

/** Draw a picture and export it as PNG (the one image type every app pastes). */
function drawPng(src: string, cors: boolean): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (cors) img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx || !canvas.width) {
        reject(new Error('Nothing to copy'))
        return
      }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Nothing to copy'))), 'image/png')
    }
    img.onerror = () => reject(new Error('The picture could not be loaded'))
    img.src = src
  })
}

async function pngOf(src: string): Promise<Blob> {
  let blob: Blob
  if (src.startsWith('data:')) blob = dataBlob(src)
  else if (new URL(src, location.href).origin === location.origin) {
    const res = await fetch(src)
    if (!res.ok) throw new Error('The picture could not be loaded')
    blob = await res.blob()
  }
  // a stock photo: its host lets it be drawn, but not fetched from here
  else return drawPng(src, true)
  if (blob.type === 'image/png') return blob
  const url = URL.createObjectURL(blob)
  try {
    return await drawPng(url, false)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Put a picture on the clipboard as a PNG. Rejects when it couldn't be read. */
export async function copyImage(src: string): Promise<void> {
  // the item takes the promise, so the clipboard is claimed while the click still counts
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(src) })])
}
