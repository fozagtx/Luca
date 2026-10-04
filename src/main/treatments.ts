/** Luca's own footage treatments: HyperFrames components that ship inside the app. */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { installBundledFont } from './captions'
import { findTagById } from './html'
import { bundledResourcesDir } from './resources'

export type Treatment = {
  name: string
  title: string
  description: string
  tags: string[]
  /** File inside resources/components/ and compositions/components/. */
  file: string
}

export const LUCA_TREATMENTS: Treatment[] = [
  {
    name: 'mosaic-reveal',
    title: 'Mosaic reveal',
    description:
      'Shows the footage through a grid of cells — some intact, some black, some a displaced crop of the same frame — with hairline gridlines and scanlines. A face or product stays intact in the focus region. Use it for a hook, a cold open or one punch moment on the a-roll, never the whole video.',
    tags: ['treatment', 'footage', 'mosaic', 'grid', 'reveal', 'texture', 'effects'],
    file: 'mosaic-reveal.html'
  },
  {
    name: 'before-after',
    title: 'Before / after',
    description:
      'Two versions of a video side by side in rounded phone-shaped panels under bold BEFORE / AFTER labels, on a slowly drifting mesh gradient (sunset, ocean, lime or mono). For showing an edit against the raw footage, an old edit against a new one, or any two clips compared. Fills the frame; panels stack in a tall frame.',
    tags: ['treatment', 'comparison', 'before', 'after', 'split screen', 'side by side', 'promo'],
    file: 'before-after.html'
  }
]

/** The fonts a treatment's own file declares, copied into the project with it. */
const TREATMENT_FONTS: Record<string, string[]> = { 'before-after': ['Archivo Expanded'] }

const MOSAIC_DEFAULTS = JSON.stringify({
  cols: 8,
  rows: 5,
  black: 0.35,
  displaced: 0.3,
  seed: 7,
  focus: 'upper',
  gridlines: 'hairline',
  texture: 'scanlines',
  reveal: 'assemble',
  reveal_at: 0.3
})

/**
 * Copy a bundled treatment into <project>/compositions/components/ (overwriting — it is
 * Luca's own file) and return the placement snippet: the clip div, its media slot and
 * when to use it. `ctx` carries the project frame size and the a-roll's file (the bare
 * name at the project root, as `Project.source` stores it) so the snippet is ready to
 * paste.
 */
export function addTreatment(
  dir: string,
  name: string,
  ctx: { size: [number, number]; source: string | null }
): string {
  const t = LUCA_TREATMENTS.find((x) => x.name === name)
  if (!t) throw new Error(`Unknown treatment "${name}"`)
  const src = join(bundledResourcesDir('components'), t.file)
  const dest = join(dir, 'compositions', 'components', t.file)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  for (const family of TREATMENT_FONTS[t.name] ?? []) installBundledFont(dir, family)
  const indexPath = join(dir, 'index.html')
  const aRollDuration = existsSync(indexPath)
    ? findTagById(readFileSync(indexPath, 'utf8'), 'a-roll')?.attrs['data-duration']
    : undefined
  return t.name === 'before-after'
    ? beforeAfterSnippet(t, ctx, aRollDuration)
    : mosaicSnippet(t, ctx, aRollDuration)
}

function host(t: Treatment, size: [number, number], values: string, duration: string): string[] {
  const [w, h] = size
  return [
    `<div`,
    `  id="${t.name}"`,
    `  class="clip"`,
    `  data-composition-id="${t.name}"`,
    `  data-composition-src="compositions/components/${t.file}"`,
    `  data-variable-values='${values}'`,
    `  data-start="0"`,
    `  data-duration="${duration}"`,
    `  data-width="${w}"`,
    `  data-height="${h}"`,
    `  style="position:absolute;inset:0"`,
    `>`,
    `</div>`
  ]
}

function mosaicSnippet(
  t: Treatment,
  ctx: { size: [number, number]; source: string | null },
  aRollDuration: string | undefined
): string {
  const slot = ctx.source
    ? [
        `<!-- host-level slot: the a-roll itself. data-duration must stay the a-roll's so`,
        `     every cell keeps the same frame as the footage underneath. -->`,
        `<template data-slot="${t.name}-media">`,
        `  <video id="${t.name}-media" src="${ctx.source}" muted playsinline data-start="0" data-duration="${aRollDuration ?? '10'}"></video> <!-- the a-roll's data-duration -->`,
        `</template>`
      ]
    : [
        `<!-- host-level slot: a brief-only project has no a-roll — the mosaic needs an`,
        `     image or clip here (B-roll, a card image…). -->`,
        `<template data-slot="${t.name}-media">`,
        `  <img src="media/your-image.png" />`,
        `</template>`
      ]
  return [
    ...host(t, ctx.size, MOSAIC_DEFAULTS, '4'),
    ``,
    ...slot,
    ``,
    `Use it for a hook, a cold open or one punch moment on the a-roll — a few seconds, never the whole video. Keep the face in the focus region (upper for a talking head); captions go on top of it.`
  ].join('\n')
}

function beforeAfterSnippet(
  t: Treatment,
  ctx: { size: [number, number]; source: string | null },
  aRollDuration: string | undefined
): string {
  const length = aRollDuration ?? '10'
  const values = JSON.stringify({
    left_label: 'BEFORE',
    right_label: 'AFTER',
    panel: '9:16',
    palette: 'sunset',
    drift: 0.6,
    reveal: 'rise',
    reveal_at: 0
  })
  return [
    ...host(t, ctx.size, values, length),
    ``,
    `<!-- host-level slots: the two versions, muted and timed like clips (the same length as`,
    `     the comparison). Give the sound to one <audio> clip of the version people should hear. -->`,
    `<template data-slot="${t.name}-left">`,
    `  <video id="${t.name}-left" src="${ctx.source ?? 'media/before.mp4'}" muted playsinline data-start="0" data-duration="${length}"></video> <!-- the raw or older version -->`,
    `</template>`,
    `<template data-slot="${t.name}-right">`,
    `  <video id="${t.name}-right" src="media/after.mp4" muted playsinline data-start="0" data-duration="${length}"></video> <!-- the edited version: a file in the project, e.g. an export copied into media/ -->`,
    `</template>`,
    ``,
    `It fills the whole frame for the length of the comparison. Point the right slot at the edited version (copy an export from renders/ into media/ first; never play files from renders/), set panel to the versions' shape, and set labels or palette if the user asks.`
  ].join('\n')
}
