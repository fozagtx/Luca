import type { ReactElement, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * The small slice of Markdown agent replies use (paragraphs, lists, headings, bold, italic,
 * inline code, links), rendered as React elements so nothing is injected as HTML.
 */
export function Markdown({
  text,
  className,
  trailing
}: {
  text: string
  className?: string
  /** Rendered inline after the last block, e.g. a streaming indicator. */
  trailing?: ReactNode
}): ReactElement {
  const blocks = parseBlocks(text)
  return (
    <div className={cn('prose-chat select-text', className)}>
      {blocks.map((b, i) => {
        const tail = i === blocks.length - 1 ? trailing : null
        if (b.kind === 'ul' || b.kind === 'ol') {
          const items = b.items.map((it, j) => (
            <li key={j}>
              {inline(it.text)}
              {it.sub.length > 0 ? (
                <ul>
                  {it.sub.map((x, k) => (
                    <li key={k}>{inline(x)}</li>
                  ))}
                </ul>
              ) : null}
              {j === b.items.length - 1 ? tail : null}
            </li>
          ))
          return b.kind === 'ol' ? (
            <ol key={i} start={b.start}>
              {items}
            </ol>
          ) : (
            <ul key={i}>{items}</ul>
          )
        }
        if (b.kind === 'h')
          return (
            <h4 key={i}>
              {inline(b.text)}
              {tail}
            </h4>
          )
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(b.text)}
            {tail}
          </p>
        )
      })}
      {blocks.length === 0 && trailing ? <p>{trailing}</p> : null}
    </div>
  )
}

type Item = { text: string; sub: string[] }
type List = { kind: 'ul'; items: Item[] } | { kind: 'ol'; items: Item[]; start: number }
type Block = { kind: 'p'; text: string } | { kind: 'h'; text: string } | List

function parseBlocks(src: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  let list: List | null = null
  // a blank line inside a list only ends it if what follows isn't more of the same list
  let gap = false
  const flushPara = (): void => {
    if (para.length) out.push({ kind: 'p', text: para.join('\n') })
    para = []
  }
  const flushList = (): void => {
    if (list) out.push(list)
    list = null
    gap = false
  }
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    const indented = /^\s{2,}\S/.test(raw)
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (!line.trim()) {
      flushPara()
      if (list) gap = true
      continue
    }
    const current = list as List | null
    // an indented bullet under an item belongs to that item
    if (current && indented && ul && current.items.length) {
      current.items[current.items.length - 1].sub.push(ul[1])
      gap = false
      continue
    }
    if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      if (!current || current.kind !== kind) {
        flushList()
        list = ol ? { kind: 'ol', items: [], start: Number(ol[1]) } : { kind: 'ul', items: [] }
      }
      ;(list as List).items.push({ text: ul ? ul[1] : ol![2], sub: [] })
      gap = false
    } else if (h) {
      flushPara()
      flushList()
      out.push({ kind: 'h', text: h[1] })
    } else if (current && indented && !gap) {
      const last = current.items[current.items.length - 1]
      last.text += ` ${line.trim()}`
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return out
}

// only * and ** mark emphasis: underscores appear in names (lower_third_classic) far more often
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*)/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    if (m.index > last) out.push(text.slice(last, m.index))
    if (tok.startsWith('**')) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k++}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok) ?? []
      out.push(
        /^https?:\/\//.test(href ?? '') ? (
          <a
            key={k++}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            {label}
          </a>
        ) : (
          label
        )
      )
    } else out.push(<em key={k++}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
