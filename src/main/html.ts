/**
 * Small, surgical edits to HyperFrames HTML. The files are the agent's and the user's source of
 * truth, so edits touch one tag or one block and leave every other byte as it was.
 */

/** One opening tag, quoted attribute values may contain `>`. */
const TAG = String.raw`<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(/?)>`

export type TagMatch = {
  name: string
  /** Offset of `<` and the offset just after `>`. */
  start: number
  end: number
  attrs: Record<string, string>
  raw: string
}

export function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

export function findTags(html: string, name?: string): TagMatch[] {
  const re = new RegExp(TAG, 'g')
  const out: TagMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (name && m[1].toLowerCase() !== name) continue
    out.push({
      name: m[1].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
      attrs: parseAttrs(m[2]),
      raw: m[0]
    })
  }
  return out
}

export function findTagById(html: string, id: string): TagMatch | null {
  return findTags(html).find((t) => t.attrs.id === id) ?? null
}

const escapeAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** Set (or with `null`, remove) attributes on one opening tag. */
export function setAttrs(tag: TagMatch, set: Record<string, string | null>): string {
  let raw = tag.raw
  for (const [k, v] of Object.entries(set)) {
    const re = new RegExp(`(\\s)${k}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+))?(?=[\\s/>])`, 'i')
    if (re.test(raw)) {
      raw = v === null ? raw.replace(re, '') : raw.replace(re, `$1${k}="${escapeAttr(v)}"`)
    } else if (v !== null) {
      raw = raw.replace(/\s*(\/?)>$/, ` ${k}="${escapeAttr(v)}"$1>`)
    }
  }
  return raw
}

export function parseStyle(style: string): [string, string][] {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':')
      return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()] as [string, string]
    })
    .filter(([k]) => k)
}

/** Merge CSS declarations into a tag's inline style (null removes one). */
export function withStyle(tag: TagMatch, set: Record<string, string | null>): string {
  const decls = parseStyle(tag.attrs.style ?? '')
  for (const [k, v] of Object.entries(set)) {
    const i = decls.findIndex(([name]) => name === k)
    if (v === null) {
      if (i >= 0) decls.splice(i, 1)
    } else if (i >= 0) decls[i] = [k, v]
    else decls.push([k, v])
  }
  const style = decls.map(([k, v]) => `${k}: ${v}`).join('; ')
  return setAttrs(tag, { style: style || null })
}

export function replaceTag(html: string, tag: TagMatch, raw: string): string {
  return html.slice(0, tag.start) + raw + html.slice(tag.end)
}

/** The offset of the `</name>` that closes the element opened by `tag`. */
export function closingOffset(html: string, tag: TagMatch): { start: number; end: number } | null {
  if (tag.raw.endsWith('/>')) return null
  const re = new RegExp(`<${tag.name}\\b[^>]*>|</${tag.name}\\s*>`, 'gi')
  re.lastIndex = tag.end
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) depth--
    else if (!m[0].endsWith('/>')) depth++
    if (depth === 0) return { start: m.index, end: m.index + m[0].length }
  }
  return null
}

/** Remove a whole element (opening tag through its closing tag) and the line it sat on. */
export function removeElement(html: string, tag: TagMatch): string {
  const close = closingOffset(html, tag)
  let a = tag.start
  let b = close ? close.end : tag.end
  while (a > 0 && (html[a - 1] === ' ' || html[a - 1] === '\t')) a--
  if (html[b] === '\n') b++
  return html.slice(0, a) + html.slice(b)
}

/** Append `fragment` as the last child of the root composition element. */
export function insertIntoRoot(html: string, fragment: string): string | null {
  const open = /<(div|section|main)\b[^>]*data-composition-id="[^"]+"[^>]*>/i.exec(html)
  if (!open) return null
  const tagName = open[1].toLowerCase()
  const re = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, 'gi')
  re.lastIndex = open.index + open[0].length
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) depth--
    else if (!m[0].endsWith('/>')) depth++
    if (depth === 0) {
      // keep the closing tag's indentation: insert at the start of its line
      const lineStart = html.lastIndexOf('\n', m.index - 1) + 1
      const at = html.slice(lineStart, m.index).trim() === '' ? lineStart : m.index
      return html.slice(0, at) + fragment + html.slice(at)
    }
  }
  return null
}

/** Put `block` in <head> in place of the element with `id`, or before </head>. */
export function upsertHeadBlock(html: string, id: string, block: string | null): string {
  const existing = findTagById(html, id)
  if (existing) {
    const close = closingOffset(html, existing)
    const a = existing.start
    const b = close ? close.end : existing.end
    return html.slice(0, a) + (block ?? '') + html.slice(b)
  }
  if (!block) return html
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `  ${block}\n  </head>`)
  return html.replace(/<body\b/i, (m) => `${block}\n${m}`)
}

/** Next free `data-track-index` above every track in the file. */
export function nextTrackIndex(html: string): number {
  let max = -1
  for (const m of html.matchAll(/data-track-index="(\d+)"/g)) max = Math.max(max, Number(m[1]))
  return max + 1
}
