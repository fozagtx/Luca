import type { Chip } from '../../../shared/types'

/** id → data-* attributes → nth-of-type path, scoped to the composition document. */
function selectorFor(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  for (const a of Array.from(el.attributes)) {
    if (
      a.name.startsWith('data-') &&
      a.value &&
      !/^data-(start|duration|end|track-index)$/.test(a.name)
    ) {
      return `${el.tagName.toLowerCase()}[${a.name}="${a.value.replace(/"/g, '\\"')}"]`
    }
  }
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== cur.ownerDocument.body && parts.length < 6) {
    const tag = cur.tagName.toLowerCase()
    if (cur.id) {
      parts.unshift(`#${CSS.escape(cur.id)}`)
      break
    }
    const parent: Element | null = cur.parentElement
    const idx = parent
      ? Array.from(parent.children)
          .filter((c) => c.tagName === cur!.tagName)
          .indexOf(cur) + 1
      : 1
    parts.unshift(`${tag}:nth-of-type(${idx})`)
    cur = parent
  }
  return parts.join(' > ')
}

function compositionOf(el: Element): { file: string; id: string } {
  const comp = el.closest('[data-composition-src]')
  const root = el.closest('[data-composition-id]')
  return {
    file: comp?.getAttribute('data-composition-src') ?? 'index.html',
    id: root?.getAttribute('data-composition-id') ?? comp?.id ?? 'main'
  }
}

function trimmedHtml(el: Element, max = 1200): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('script, style').forEach((n) => n.remove())
  let html = clone.outerHTML.replace(/\s+/g, ' ')
  if (html.length > max) html = html.slice(0, max) + '…'
  return html
}

/** The reference Luca gets for an element picked on the preview. */
export function elementChip(el: Element, time: number): Extract<Chip, { kind: 'element' }> {
  const { file, id } = compositionOf(el)
  return {
    kind: 'element',
    selector: selectorFor(el),
    file,
    compositionId: id,
    time,
    html: trimmedHtml(el),
    label: elementLabel(el)
  }
}

/** What someone sees in the video: its words, else what kind of thing it is. */
export function elementLabel(el: Element): string {
  const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (words) return `“${words.length > 28 ? `${words.slice(0, 27)}…` : words}”`
  const tag = el.tagName.toLowerCase()
  if (tag === 'img' || tag === 'picture') return 'Image'
  if (tag === 'video') return 'Video'
  if (tag === 'svg' || el.closest('svg')) return 'Graphic'
  if (tag === 'canvas') return 'Animation'
  return 'This part'
}
