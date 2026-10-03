/**
 * Lays out a Sunroom tutorial short (src/shared/short.ts) in index.html from the beats Luca chose:
 * the paper stage (a component that comes with Luca, over the footage), the speaker's moves on the
 * main timeline (punched in on full beats, lifted into the card on split ones), and one empty,
 * timed slot per graphic, each its own small composition Luca fills. Everything it writes is
 * marked and rewritten as a whole on the next call; the footage, its sound and the graphics Luca
 * built in the slots are never touched. Pure file work, so it runs outside the app too.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  checkBeats,
  DEFAULT_FACE,
  encodeBeats,
  resolveTheme,
  slotId,
  speakerStates,
  SUNROOM,
  themeCss,
  type ShortBeat,
  type ShortFace,
  type ShortFonts,
  type ShortPaletteInput,
  type ShortPlan,
  type ShortTheme
} from '../shared/short'
import { footageVideos } from './color'
import {
  closingOffset,
  findTagById,
  findTags,
  insertIntoRoot,
  nextTrackIndex,
  removeElement,
  replaceTag,
  setAttrs,
  upsertHeadBlock
} from './html'
import { bundledResourcesDir } from './resources'

export const STAGE_ID = 'sunroom-stage'
const STAGE_FILE = `compositions/components/${STAGE_ID}.html`
const KIT_ID = 'sunroom-kit'
const THEME_ID = 'sunroom-theme'
const SCRIPT_ID = 'sunroom-layout'
const BEATS_DIR = 'compositions/beats'
const PLAN_FILE = join('.luca', 'short.json')
const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js'

const START = '<!-- sunroom:start'
const END = '<!-- sunroom:end -->'
const BLOCK = /[ \t]*<!-- sunroom:start[\s\S]*?<!-- sunroom:end -->[ \t]*\n?/

type Word = { text: string; start: number; end: number }

/**
 * What Luca passes. Without beats the ones on the timeline stay (a new palette or fonts only);
 * without a palette or fonts the ones chosen before stay (the default for a first layout).
 */
export type ShortInput = {
  beats?: ShortBeat[]
  face?: Partial<ShortFace>
  palette?: ShortPaletteInput
  fonts?: ShortFonts
}

export type ShortSlot = {
  id: string
  /** Project-relative file of the slot's composition. */
  file: string
  beat: ShortBeat
  /** Its content box in composition px. */
  area: { top: number; height: number }
  /** What is said during the beat. */
  said: string
}

export type ShortResult =
  | {
      ok: true
      plan: ShortPlan
      slots: ShortSlot[]
      /** Slot files written now / already there and kept / no longer used. */
      created: string[]
      kept: string[]
      unused: string[]
      /** Kept slot files whose layout changed, so their content box moved. */
      moved: string[]
      notes: string[]
      warnings: string[]
      size: [number, number]
      theme: ShortTheme
      /** Only the palette or fonts changed: the beats on the timeline stayed as they were. */
      restyled: boolean
    }
  | { ok: false; error: string }

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/--/g, '–')

/** The root composition: its id, size and length. */
function rootOf(html: string): { id: string; w: number; h: number; duration: number } | null {
  const root = findTags(html).find((t) => t.attrs['data-composition-id'] !== undefined)
  if (!root) return null
  return {
    id: root.attrs['data-composition-id'],
    w: Number(root.attrs['data-width']) || 1080,
    h: Number(root.attrs['data-height']) || 1920,
    duration: Number(root.attrs['data-duration']) || 0
  }
}

/** A slot's content box: the paper above the caption in split, the whole frame otherwise. */
function areaOf(beat: ShortBeat, h: number): { top: number; height: number } {
  if (beat.layout === 'split') return { top: 0, height: Math.round(h * (SUNROOM.cardTop - 0.075)) }
  return { top: 0, height: h }
}

function said(words: Word[], beat: ShortBeat): string {
  return words
    .filter((w) => w.start >= beat.start - 0.05 && w.start < beat.end - 0.05)
    .map((w) => w.text)
    .join(' ')
}

/** The starter file of one slot: a sized, empty composition with its timeline registered. */
function slotFile(slot: ShortSlot, w: number, h: number): string {
  const { id, beat, area } = slot
  const len = r3(beat.end - beat.start)
  const where =
    beat.layout === 'split'
      ? `The speaker is in the card below; build the graphic inside #${id}-area, the paper above the caption line.`
      : beat.layout === 'graphic'
        ? `The speaker is hidden: the whole frame is paper. Build inside #${id}-area: a headline at the top, the graphic under it${beat.caption === false ? '' : ', and keep the caption band (about ' + Math.round(h * (SUNROOM.captionFloor.graphic - 0.06)) + '–' + Math.round(h * SUNROOM.captionFloor.graphic) + ' px down) clear'}.`
        : `The speaker fills the frame: put a sticker beside the head inside #${id}-area, never over the face or the caption line.`
  return `<!doctype html>
<!--
  Beat ${id.slice(5)} of the Sunroom short: ${beat.layout}, ${beat.start.toFixed(2)}–${beat.end.toFixed(2)} s on the timeline (${len.toFixed(2)} s).
  Said: “${esc(slot.said || '…')}”${beat.note ? `\n  Shows: ${esc(beat.note)}` : ''}
  ${where}
  Times in this file are seconds from the beat's start. The Sunroom kit's classes (sr-…) are ready
  to use: see .luca/TEMPLATE.md. Luca wrote this file once; it is yours, and re-applying the layout
  keeps it.
-->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Beat ${id.slice(5)}</title>
  </head>
  <body>
    <template id="${id}-template">
      <div data-composition-id="${id}" data-width="${w}" data-height="${h}" data-duration="${len}">
        <div
          id="${id}-area"
          class="sr-area"
          data-sunroom-area="${beat.layout}"
          style="top: ${area.top}px; height: ${area.height}px"
        ></div>

        <style>
          [data-composition-id='${id}'] {
            position: absolute;
            inset: 0;
          }
        </style>

        <script src="${GSAP}"></script>
        <script>
          ;(function () {
            var tl = gsap.timeline({ paused: true })
            window.__timelines['${id}'] = tl
          })()
        </script>
      </div>
    </template>
  </body>
</html>
`
}

/** A kept slot file brought in line with its beat: length, and the content box if the layout changed. */
function refreshSlotFile(text: string, slot: ShortSlot): { text: string; moved: boolean } {
  let out = text
  const root = findTags(out).find((t) => t.attrs['data-composition-id'] === slot.id)
  const len = String(r3(slot.beat.end - slot.beat.start))
  if (root && root.attrs['data-duration'] !== len)
    out = replaceTag(out, root, setAttrs(root, { 'data-duration': len }))
  const area = findTagById(out, `${slot.id}-area`)
  if (!area || area.attrs['data-sunroom-area'] === slot.beat.layout)
    return { text: out, moved: false }
  const style = (area.attrs.style ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^(top|height)\s*:/i.test(d))
  style.unshift(`top: ${slot.area.top}px`, `height: ${slot.area.height}px`)
  out = replaceTag(
    out,
    area,
    setAttrs(area, { 'data-sunroom-area': slot.beat.layout, style: style.join('; ') })
  )
  return { text: out, moved: true }
}

/** The main-timeline script that moves the footage on every beat. */
function layoutScript(
  rootId: string,
  sources: string[],
  states: ReturnType<typeof speakerStates>
): string {
  // by its file, or in the preview by the file an edit-friendly copy stands in for (server.ts)
  const selector = sources
    .map((s) => s.replace(/"/g, '\\"'))
    .map((s) => `video[src="${s}"], video[data-luca-src="${s}"]`)
    .join(', ')
  const rows = states.map((s) => [s.start, s.duration, s.x, s.y, s.scale, s.to, s.origin])
  return `<script id="${SCRIPT_ID}">
      // Sunroom: where the speaker is on every beat (filling the frame, in the card under the
      // paper, or hidden under it). Luca rebuilds this from the beats: change them with the
      // short_layout tool, not here. The footage and its sound play untouched.
      ;(function () {
        var tl = window.__timelines['${rootId}']
        var feet = document.querySelectorAll(${JSON.stringify(selector)})
        if (!tl || !feet.length) return
        // [start, duration, x, y, scale, scale at the end, transform origin]
        var S = ${JSON.stringify(rows)}
        S.forEach(function (s, i) {
          var at = { x: s[2], y: s[3], scale: s[4], transformOrigin: s[6] }
          if (i === 0) gsap.set(feet, at)
          else tl.set(feet, at, s[0])
          if (s[5] !== s[4]) tl.to(feet, { scale: s[5], duration: s[1], ease: 'none' }, s[0])
        })
      })()
    </script>`
}

/** Removes the script, kit and theme a previous call wrote into index.html (the block stays). */
function removeOwnTags(html: string): string {
  let out = html
  // whole lines, so writing them again leaves the file exactly as it was
  for (const id of [SCRIPT_ID, KIT_ID, THEME_ID]) {
    const tag = findTagById(out, id)
    if (tag) out = removeElement(out, tag)
  }
  return out
}

/** Removes everything a previous call wrote into index.html. */
export function removeShortLayout(html: string): string {
  return removeOwnTags(html.replace(BLOCK, ''))
}

/** The plan on the timeline now, if the project is a Sunroom short. */
export function readShortPlan(dir: string): ShortPlan | null {
  try {
    const plan = JSON.parse(readFileSync(join(dir, PLAN_FILE), 'utf8')) as ShortPlan
    return plan?.version === 1 && Array.isArray(plan.beats) ? plan : null
  } catch {
    return null
  }
}

/**
 * Writes the layout for `input` into the project at `dir`. `words` (timeline seconds) quote what
 * is said on each slot's beat. Returns the slots to fill, or an error Luca can act on.
 */
export function applyShortLayout(
  dir: string,
  input: ShortInput,
  opts: { words?: Word[] } = {}
): ShortResult {
  const indexFile = join(dir, 'index.html')
  let html = readFileSync(indexFile, 'utf8')
  const root = rootOf(html)
  if (!root) return { ok: false, error: 'Could not find the main composition in index.html.' }
  // the footage to move: every clip of the speaker's own videos, by file, so split pieces follow
  const sources = [
    ...new Set(footageVideos(html).map((t) => (t.attrs.src ?? '').split(/[?#]/)[0]))
  ].filter(Boolean)
  if (!sources.length)
    return {
      ok: false,
      error:
        'There is no footage of the speaker on the timeline: this layout moves the person talking between full frame, a card and off screen, so it needs their video.'
    }
  const previous = readShortPlan(dir)
  const restyled = !input.beats
  if (!input.beats && !previous)
    return {
      ok: false,
      error:
        'No beats yet: pass the beats, from 0 s to the end of the video. (Leaving them out keeps the ones already laid out, to change only the palette or fonts.)'
    }
  const checked = checkBeats(input.beats ?? previous!.beats, root.duration)
  if (!checked.ok) return checked
  const { beats } = checked
  const lastFace = previous?.face ?? DEFAULT_FACE
  const face: ShortFace = {
    x: Math.min(0.9, Math.max(0.1, input.face?.x ?? lastFace.x)),
    y: Math.min(0.9, Math.max(0.05, input.face?.y ?? lastFace.y))
  }
  // the palette and fonts stay until Luca passes new ones
  const palette = input.palette ?? previous?.palette
  const fonts = input.fonts ?? previous?.fonts
  const theme = resolveTheme(palette, fonts)
  const { w, h } = root
  const words = opts.words ?? []
  const warnings = [...checked.warnings]
  if (h <= w)
    warnings.push(
      'This video is not vertical: the Sunroom layout is made for 9:16 shorts, so the card and the paper will look stretched.'
    )

  // the stage and its kit, Luca's own files: always the version that comes with Luca
  const stageSrc = join(bundledResourcesDir('components'), `${STAGE_ID}.html`)
  mkdirSync(dirname(join(dir, STAGE_FILE)), { recursive: true })
  copyFileSync(stageSrc, join(dir, STAGE_FILE))
  const kit = readFileSync(join(bundledResourcesDir('components'), `${KIT_ID}.css`), 'utf8')

  // one slot per split and graphic beat, and per full beat that asked for a sticker
  const slots: ShortSlot[] = []
  beats.forEach((beat, i) => {
    if (beat.layout === 'full' && !beat.sticker) return
    const id = slotId(i)
    slots.push({
      id,
      file: `${BEATS_DIR}/${id}.html`,
      beat,
      area: areaOf(beat, h),
      said: said(words, beat)
    })
  })
  const created: string[] = []
  const kept: string[] = []
  const moved: string[] = []
  mkdirSync(join(dir, BEATS_DIR), { recursive: true })
  for (const slot of slots) {
    const file = join(dir, slot.file)
    if (existsSync(file)) {
      const before = readFileSync(file, 'utf8')
      const after = refreshSlotFile(before, slot)
      if (after.text !== before) writeFileSync(file, after.text)
      if (after.moved) moved.push(slot.id)
      kept.push(slot.id)
    } else {
      writeFileSync(file, slotFile(slot, w, h))
      created.push(slot.id)
    }
  }
  const used = new Set(slots.map((s) => s.id))
  const unused = (previous?.beats ?? [])
    .map((_, i) => slotId(i))
    .filter((id) => !used.has(id) && existsSync(join(dir, BEATS_DIR, `${id}.html`)))

  // index.html: last call's layout out, this one in
  // a block already there is rewritten where it is, on the timeline rows it had
  const lastTrack = Number(findTagById(html, STAGE_ID)?.attrs['data-track-index'])
  const track = Number.isFinite(lastTrack) ? lastTrack : nextTrackIndex(html.replace(BLOCK, ''))
  const pad = '      '
  const stageVars = JSON.stringify({
    beats: encodeBeats(beats),
    length: r3(root.duration),
    card: SUNROOM.cardTop,
    radius: SUNROOM.radius
  })
  const hosts = [
    `${START} — Luca's Sunroom layout: the paper over the footage and a slot for each beat's graphic. The short_layout tool rewrites this block; change the beats there. -->`,
    `<div id="${STAGE_ID}" class="clip" data-composition-id="${STAGE_ID}" data-composition-src="${STAGE_FILE}" data-variable-values='${stageVars}' data-start="0" data-duration="${r3(root.duration)}" data-track-index="${track}" data-width="${w}" data-height="${h}" style="position: absolute; inset: 0; z-index: 1; pointer-events: none"></div>`,
    ...slots.map(
      (s) =>
        `<div id="${s.id}" class="clip" data-composition-id="${s.id}" data-composition-src="${s.file}" data-start="${s.beat.start}" data-duration="${r3(s.beat.end - s.beat.start)}" data-track-index="${track + 1}" data-width="${w}" data-height="${h}" style="position: absolute; inset: 0; z-index: 2; pointer-events: none"></div>`
    ),
    END
  ]
  const block = hosts.map((l) => pad + l).join('\n') + '\n'
  const old = BLOCK.exec(html)
  const placed = old
    ? html.slice(0, old.index) + block + html.slice(old.index + old[0].length)
    : insertIntoRoot(html, block)
  if (!placed) return { ok: false, error: 'Could not find the main composition in index.html.' }
  html = placed
  const states = speakerStates(beats, { duration: root.duration, width: w, height: h, face })
  const script = layoutScript(root.id, sources, states)
  const lastScript = findTagById(html, SCRIPT_ID)
  const scriptEnd = lastScript && closingOffset(html, lastScript)
  if (lastScript && scriptEnd)
    html = html.slice(0, lastScript.start) + script + html.slice(scriptEnd.end)
  else
    html = /<\/body>/i.test(html)
      ? html.replace(/[ \t]*<\/body>/i, `    ${script}\n  </body>`)
      : `${html}\n${script}\n`
  const css = kit
    .trim()
    .split('\n')
    .map((l) => (l ? `      ${l}` : l))
    .join('\n')
  html = upsertHeadBlock(html, KIT_ID, `<style id="${KIT_ID}">\n${css}\n    </style>`)
  const tokens = themeCss(theme)
    .split('\n')
    .map((l) => `      ${l}`)
    .join('\n')
  html = upsertHeadBlock(
    html,
    THEME_ID,
    `<style id="${THEME_ID}">\n      /* Sunroom theme (${theme.preset} palette${palette && Object.keys(palette).some((k) => k !== 'preset') ? ', customized' : ''}): every color of the stage, the graphics and the captions. Change it with short_layout's palette and fonts. */\n${tokens}\n    </style>`
  )
  writeFileSync(indexFile, html)

  const plan: ShortPlan = {
    version: 1,
    beats,
    face,
    ...(palette ? { palette } : {}),
    ...(fonts ? { fonts } : {})
  }
  mkdirSync(join(dir, '.luca'), { recursive: true })
  writeFileSync(join(dir, PLAN_FILE), JSON.stringify(plan, null, 2))
  return {
    ok: true,
    plan,
    slots,
    created,
    kept,
    unused,
    moved,
    notes: [...checked.notes, ...theme.notes],
    warnings,
    size: [w, h],
    theme,
    restyled
  }
}

/** What Luca is told after laying the short out: the slots to fill, where, and what is said. */
export function shortGuide(res: Extract<ShortResult, { ok: true }>): string {
  const { beats } = res.plan
  const [, h] = res.size
  const count = (l: string): number => beats.filter((b) => b.layout === l).length
  const band = `${Math.round(h * (SUNROOM.captionFloor.graphic - 0.06))}–${Math.round(h * SUNROOM.captionFloor.graphic)} px`
  const lines = res.slots.map((s) => {
    const b = s.beat
    const where =
      b.layout === 'split'
        ? `the paper above the caption, ${s.area.height} px tall from the top`
        : b.layout === 'graphic'
          ? `the whole frame${b.caption === false ? ' (no caption: the headline says the words)' : `, caption band ${band} kept clear`}`
          : 'a sticker beside the head'
    return `- ${s.id} · ${b.layout} · ${b.start.toFixed(2)}–${b.end.toFixed(2)} s · ${where} · said: “${s.said || '…'}”${b.note ? ` · ${b.note}` : ''}`
  })
  const t = res.theme
  const palette = `Palette: ${t.preset} (paper ${t.colors.paper}, ink ${t.colors.ink}, accent ${t.colors.accent}, cards ${t.colors.card}); fonts ${t.fonts.sans} and ${t.fonts.serif} italic.`
  const colors =
    'Every color in a graphic comes from the theme: var(--sr-paper), var(--sr-ink), var(--sr-ink-soft), var(--sr-accent), var(--sr-on-accent), var(--sr-card), var(--sr-card-ink), var(--sr-line), and fonts var(--sr-sans), var(--sr-serif), var(--sr-mono). Never write a hex color in a beat: a new palette then recolors everything without touching the beats.'
  if (res.restyled)
    return [
      `Restyled the short: ${palette} The beats, the slots and their graphics are as they were; the paper, the graphics and the captions follow the new theme.`,
      colors,
      ...res.notes,
      ...res.warnings,
      'Snapshot a split and a graphic beat to check it reads well, then tell the user in a sentence.'
    ].join('\n')
  const out = [
    `Laid out ${beats.length} beats (${count('full')} full, ${count('split')} split, ${count('graphic')} graphic): the speaker and the paper change on every cut, the voice plays untouched. ${palette}`,
    res.slots.length
      ? `Build each slot's graphic in its file (compositions/beats/<id>.html), inside #<id>-area, with the Sunroom kit from .luca/TEMPLATE.md; times in a slot start at 0 at its beat. Items land on the words that name them (word time − beat start).`
      : 'No slots: every beat is full.',
    colors,
    ...lines
  ]
  if (res.kept.length)
    out.push(`Kept the graphics already in ${res.kept.join(', ')} (same beat numbers).`)
  if (res.moved.length)
    out.push(
      `${res.moved.join(', ')} changed layout: their content box moved, so check their graphics fit.`
    )
  if (res.unused.length)
    out.push(`No longer on the timeline: ${res.unused.map((id) => `${id}.html`).join(', ')}.`)
  out.push(...res.notes, ...res.warnings)
  out.push(
    `Then: captions_apply with style "${SUNROOM.captionStyle}" (they follow the layout by themselves) and emphasis words, lint, and snapshot a frame of each layout.`
  )
  return out.join('\n')
}
