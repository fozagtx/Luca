import { Check, Copy } from 'lucide-react'
import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * The small slice of Markdown agent replies use (paragraphs, lists, headings, bold, italic,
 * inline code, links, code blocks, tables, rules), rendered as React elements so nothing is
 * injected as HTML. All of it can be selected and copied.
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
    // a long path or link wraps instead of pushing the chat sideways
    <div className={cn('prose-chat wrap-break-word select-text', className)}>
      {blocks.map((b, i) => {
        const tail = i === blocks.length - 1 ? trailing : null
        if (b.kind === 'code') return <CodeBlock key={i} text={b.text} trailing={tail} />
        if (b.kind === 'table')
          return (
            <div key={i}>
              <Table table={b} />
              {tail}
            </div>
          )
        if (b.kind === 'hr') return <hr key={i} className="border-border" />
        if (b.kind === 'ul' || b.kind === 'ol') {
          const items = b.items.map((it, j) => (
            <li key={j}>
              {inline(it.text)}
              {it.sub.length > 0 ? (
                it.subKind === 'ol' ? (
                  <ol start={it.subStart}>
                    {it.sub.map((x, k) => (
                      <li key={k}>{inline(x)}</li>
                    ))}
                  </ol>
                ) : (
                  <ul>
                    {it.sub.map((x, k) => (
                      <li key={k}>{inline(x)}</li>
                    ))}
                  </ul>
                )
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

type Item = { text: string; sub: string[]; subKind?: 'ul' | 'ol'; subStart?: number }
type List = { kind: 'ul'; items: Item[] } | { kind: 'ol'; items: Item[]; start: number }
type Align = 'left' | 'center' | 'right' | undefined
type TableBlock = { kind: 'table'; head: string[]; align: Align[]; rows: string[][] }
type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }
  | TableBlock
  | List

/** A fenced code block's first line: ``` or ~~~, maybe with a language. */
const FENCE = /^(\s*)(`{3,}|~{3,})/
/** A table's second line: | --- | :---: | */
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** The cells of a table row; a \| inside one is a literal bar. */
function cells(line: string): string[] {
  const row = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
  return row.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function parseBlocks(src: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  let list: List | null = null
  // the list's own indent: only deeper markers nest under the previous item
  let base = 0
  // the last list line was a nested item, so continuation text belongs to it
  let inSub = false
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
    inSub = false
  }
  const lines = src.replace(/\r/g, '').split('\n')
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]
    const line = raw.trimEnd()
    const ind = raw.length - raw.trimStart().length
    const fence = FENCE.exec(line)
    // ```like this``` on one line is inline code, not a block
    if (fence && !(fence[2][0] === '`' && line.slice(fence[0].length).includes('`'))) {
      // everything up to the closing fence (or the end, while it streams) is code, as written
      flushPara()
      flushList()
      const [, pad, mark] = fence
      const body: string[] = []
      for (n++; n < lines.length; n++) {
        const close = FENCE.exec(lines[n])
        if (
          close &&
          close[2][0] === mark[0] &&
          close[2].length >= mark.length &&
          !lines[n].slice(close[0].length).trim()
        )
          break
        body.push(lines[n].startsWith(pad) ? lines[n].slice(pad.length) : lines[n].trimStart())
      }
      out.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    if (line.includes('|') && TABLE_RULE.test(lines[n + 1] ?? '') && lines[n + 1].includes('|')) {
      flushPara()
      flushList()
      const head = cells(line)
      const align = cells(lines[n + 1]).map((c): Align =>
        c.startsWith(':') && c.endsWith(':')
          ? 'center'
          : c.endsWith(':')
            ? 'right'
            : c.startsWith(':')
              ? 'left'
              : undefined
      )
      const rows: string[][] = []
      for (n += 2; n < lines.length && lines[n].includes('|') && lines[n].trim(); n++)
        rows.push(cells(lines[n]))
      n--
      out.push({ kind: 'table', head, align, rows })
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara()
      flushList()
      out.push({ kind: 'hr' })
      continue
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (!line.trim()) {
      flushPara()
      if (list) gap = true
      continue
    }
    const current = list as List | null
    // a marker indented deeper than the list belongs to the item above it
    if (current && (ul || ol) && ind > base && current.items.length) {
      const item = current.items[current.items.length - 1]
      if (!item.subKind) {
        item.subKind = ul ? 'ul' : 'ol'
        if (ol) item.subStart = Number(ol[1])
      }
      item.sub.push(ul ? ul[1] : ol![2])
      inSub = true
      gap = false
      continue
    }
    if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      if (!current || current.kind !== kind) {
        flushList()
        list = ol ? { kind: 'ol', items: [], start: Number(ol[1]) } : { kind: 'ul', items: [] }
        base = ind
      }
      ;(list as List).items.push({ text: ul ? ul[1] : ol![2], sub: [] })
      inSub = false
      gap = false
    } else if (h) {
      flushPara()
      flushList()
      out.push({ kind: 'h', text: h[1] })
    } else if (current && ind > base && !gap) {
      const last = current.items[current.items.length - 1]
      if (inSub && last.sub.length) last.sub[last.sub.length - 1] += ` ${line.trim()}`
      else last.text += ` ${line.trim()}`
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

/** A code block, kept as written (scrolls sideways rather than wrapping), with a Copy button. */
function CodeBlock({ text, trailing }: { text: string; trailing?: ReactNode }): ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <div className="group/code relative">
      <pre className="scroll rounded-[8px] border border-border bg-bg-muted px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] text-text">
        <code className="rounded-none bg-transparent p-0">{text}</code>
        {trailing}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="absolute top-1.5 right-1.5 inline-flex h-6 items-center gap-1 rounded-[6px] border border-border bg-bg px-1.5 font-sans text-[11px] text-text-2 opacity-0 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-opacity duration-150 group-hover/code:opacity-100 hover:text-text focus-visible:opacity-100"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Table({ table }: { table: TableBlock }): ReactElement {
  const align = (j: number): CSSProperties | undefined =>
    table.align[j] ? { textAlign: table.align[j] } : undefined
  return (
    // a wide table scrolls inside its frame instead of widening the chat
    <div className="scroll rounded-[8px] border border-border">
      <table className="w-full border-collapse text-left text-[12px] leading-[1.45]">
        <thead className="bg-bg-muted">
          <tr>
            {table.head.map((c, j) => (
              <th
                key={j}
                style={align(j)}
                className="border-b border-border px-2.5 py-1.5 font-semibold"
              >
                {inline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, k) => (
            <tr key={k} className="border-b border-border last:border-b-0">
              {table.head.map((_, j) => (
                <td key={j} style={align(j)} className="px-2.5 py-1.5 align-top">
                  {inline(r[j] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
