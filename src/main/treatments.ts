/** Luca's own footage treatments: HyperFrames components that ship inside the app. */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  }
]

const DEFAULTS = JSON.stringify({
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
  const [w, h] = ctx.size
  const indexPath = join(dir, 'index.html')
  const aRollDuration = existsSync(indexPath)
    ? findTagById(readFileSync(indexPath, 'utf8'), 'a-roll')?.attrs['data-duration']
    : undefined
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
    `<div`,
    `  class="clip"`,
    `  data-composition-id="${t.name}"`,
    `  data-composition-src="compositions/components/${t.file}"`,
    `  data-variable-values='${DEFAULTS}'`,
    `  data-start="0"`,
    `  data-duration="4"`,
    `  data-width="${w}"`,
    `  data-height="${h}"`,
    `  style="position:absolute;inset:0"`,
    `>`,
    `</div>`,
    ``,
    ...slot,
    ``,
    `Use it for a hook, a cold open or one punch moment on the a-roll — a few seconds, never the whole video. Keep the face in the focus region (upper for a talking head); captions go on top of it.`
  ].join('\n')
}
