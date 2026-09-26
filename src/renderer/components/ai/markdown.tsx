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
          const List = b.kind
          return (
            <List key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  {inline(it)}
                  {j === b.items.length - 1 ? tail : null}
                </li>
              ))}
            </List>
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

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }

function parseBlocks(src: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  let list: Extract<Block, { items: string[] }> | null = null
  const flushPara = (): void => {
    if (para.length) out.push({ kind: 'p', text: para.join('\n') })
    para = []
  }
  const flushList = (): void => {
    if (list) out.push(list)
    list = null
  }
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      if (!list || list.kind !== kind) {
        flushList()
        list = kind === 'ul' ? { kind: 'ul', items: [] } : { kind: 'ol', items: [] }
      }
      list.items.push((ul ?? ol)![1])
    } else if (h) {
      flushPara()
      flushList()
      out.push({ kind: 'h', text: h[1] })
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return out
}

const INLINE =
  /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    if (m.index > last) out.push(text.slice(last, m.index))
    if (tok.startsWith('**') || tok.startsWith('__'))
      out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>)
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
