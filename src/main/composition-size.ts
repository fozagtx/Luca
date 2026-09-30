import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sizeOf, type Aspect } from '../shared/aspect'

/**
 * A scaffolded index.html resized to a ratio `hyperframes init --resolution` has no preset for:
 * the frame size lives in four places (the <html> resolution marker, the viewport meta, the
 * html/body CSS and the root's data-width/data-height) and the renderer reads the root's. A spot
 * that isn't found means init stopped producing what we expect, so each throws by name.
 */
export function fitCompositionHtml(html: string, size: [number, number]): string {
  const [w, h] = size
  const tag = /(<html\b[^>]*?)\s*data-resolution="[^"]*"/
  if (!tag.test(html)) throw new Error('index.html: no data-resolution on <html>')
  html = html.replace(tag, `$1 data-composition-width="${w}" data-composition-height="${h}"`)

  const viewport = /content="width=\d+, height=\d+"/
  if (!viewport.test(html)) throw new Error('index.html: no viewport meta size')
  html = html.replace(viewport, `content="width=${w}, height=${h}"`)

  const block = /html,\s*body\s*\{[^}]*\}/
  const m = block.exec(html)
  if (!m) throw new Error('index.html: no html, body CSS block')
  let css = m[0]
  if (!/width:\s*\d+px/.test(css)) throw new Error('index.html: no width in html, body CSS')
  if (!/height:\s*\d+px/.test(css)) throw new Error('index.html: no height in html, body CSS')
  css = css.replace(/width:\s*\d+px/, `width: ${w}px`).replace(/height:\s*\d+px/, `height: ${h}px`)
  html = html.slice(0, m.index) + css + html.slice(m.index + m[0].length)

  if (!/data-width="\d+"/.test(html)) throw new Error('index.html: no root data-width')
  if (!/data-height="\d+"/.test(html)) throw new Error('index.html: no root data-height')
  return html
    .replace(/data-width="\d+"/, `data-width="${w}"`)
    .replace(/data-height="\d+"/, `data-height="${h}"`)
}

/**
 * Resize a freshly scaffolded composition to the project's aspect: a no-op when the preset
 * `init` used already matches (it is picked for the same orientation), else index.html is
 * rewritten in place.
 */
export function fitComposition(dir: string, aspect: Aspect): void {
  const file = join(dir, 'index.html')
  const html = readFileSync(file, 'utf8')
  const [w, h] = sizeOf(aspect)
  const curW = Number(/data-width="(\d+)"/.exec(html)?.[1])
  const curH = Number(/data-height="(\d+)"/.exec(html)?.[1])
  if (curW === w && curH === h) return
  writeFileSync(file, fitCompositionHtml(html, [w, h]))
}
