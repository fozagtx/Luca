/**
 * Where the Studio composition meets index.html: which clips are the speaker's footage (mirrored
 * inside the composition, so the footage it frames plays exactly what the a-roll plays), and the
 * host clip that places the composition over the a-roll, under everything added on top of it.
 */
import { basename } from 'node:path'
import { findTagById, findTags, removeElement, replaceTag, setAttrs, type TagMatch } from '../html'
import { STUDIO_FILE, STUDIO_ID, type FootageClip } from './compose'

const CLEAN_MASTER = /(^|\/)media\/clean-[0-9a-f]+\.mp4$/

const num = (v: string | undefined, fallback = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * index.html with every <template>'s contents blanked and offsets kept: a treatment's slot (the
 * a-roll's own file, inert until the treatment clones it) is neither the speaker's footage nor a
 * place to put the host.
 */
const outsideTemplates = (html: string): string =>
  html.replace(
    /(<template\b[^>]*>)([\s\S]*?)(<\/template>)/gi,
    (_m, open: string, body: string, close: string) => open + ' '.repeat(body.length) + close
  )

const srcOf = (t: TagMatch): string => (t.attrs.src ?? '').replace(/^\.\//, '').split(/[?#]/)[0]

/**
 * The speaker's footage as index.html plays it: the a-roll clips (and every piece of them after
 * splits), the clean master once a clean edit replaced the source, or clips of the file the
 * project started from. Each with its timing and color grade.
 */
export function speakerClips(
  html: string,
  source: string | null
): (FootageClip & { grading?: string })[] {
  const root = findTags(html).find((t) => t.attrs['data-composition-id'] !== undefined)
  const total = num(root?.attrs['data-duration'])
  return findTags(outsideTemplates(html), 'video')
    .filter((t) => {
      const src = srcOf(t)
      if (!src) return false
      return (
        /^a-roll/.test(t.attrs.id ?? '') ||
        CLEAN_MASTER.test(src) ||
        (!!source && basename(src) === basename(source))
      )
    })
    .map((t) => {
      const start = num(t.attrs['data-start'])
      const rate = num(t.attrs['data-playback-rate'], 1) || 1
      return {
        src: srcOf(t),
        start,
        duration: num(t.attrs['data-duration']) || Math.max(0, total - start),
        mediaStart: num(t.attrs['data-media-start']),
        ...(rate !== 1 ? { rate } : {}),
        ...(t.attrs['data-color-grading'] ? { grading: t.attrs['data-color-grading'] } : {})
      }
    })
    .filter((c) => c.duration > 0)
    .sort((a, b) => a.start - b.start)
}

/** The host clip: the whole video, over the a-roll. */
function hostTag(duration: number, track: number): string {
  return `<div id="${STUDIO_ID}" class="clip" data-composition-id="${STUDIO_ID}" data-composition-src="${STUDIO_FILE}" data-start="0" data-duration="${Math.round(duration * 1000) / 1000}" data-track-index="${track}" style="position: absolute; inset: 0"></div>`
}

/**
 * index.html with the Studio host in place: updated if it's there, else inserted right after the
 * speaker's clips, so the a-roll is under it and everything else in the file stays on top.
 */
export function placeStudioHost(html: string, duration: number, source: string | null): string {
  const host = findTagById(outsideTemplates(html), STUDIO_ID)
  if (host)
    return replaceTag(
      html,
      host,
      setAttrs(host, {
        'data-start': '0',
        'data-duration': String(Math.round(duration * 1000) / 1000)
      })
    )
  const speaker = new Set(speakerClips(html, source).map((c) => c.src))
  // after the last tag of the a-roll (its audio included), at that tag's indentation
  const anchors = findTags(outsideTemplates(html)).filter(
    (t) =>
      /^a-roll/.test(t.attrs.id ?? '') ||
      ((t.name === 'video' || t.name === 'audio') && speaker.has(srcOf(t)))
  )
  const last = anchors[anchors.length - 1]
  const tracks = [...html.matchAll(/data-track-index="(\d+)"/g)].map((m) => Number(m[1]))
  const track = tracks.length ? Math.max(...tracks) + 1 : 1
  const tag = hostTag(duration, track)
  if (last) {
    const close = html.indexOf(`</${last.name}>`, last.end)
    const end = close >= 0 && !last.raw.endsWith('/>') ? close + `</${last.name}>`.length : last.end
    const lineStart = html.lastIndexOf('\n', last.start - 1) + 1
    const indent = /^[ \t]*/.exec(html.slice(lineStart, last.start))?.[0] ?? '      '
    return `${html.slice(0, end)}\n${indent}${tag}${html.slice(end)}`
  }
  const open = /<(div|section|main)\b[^>]*data-composition-id="[^"]+"[^>]*>/i.exec(html)
  if (!open) throw new Error('Could not find the main composition in index.html')
  const at = open.index + open[0].length
  return `${html.slice(0, at)}\n      ${tag}${html.slice(at)}`
}

export function removeStudioHost(html: string): string {
  const host = findTagById(html, STUDIO_ID)
  return host ? removeElement(html, host) : html
}
