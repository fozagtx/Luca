import type { HyperframesPlayer } from '@hyperframes/player'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Chip } from '../../../shared/types'
import { luca } from '../../lib/luca'
import { useChat } from '../../stores/chat'
import { usePlayer } from '../../stores/player'
import { useUi } from '../../stores/ui'

type Hit = { rect: DOMRect; label: string; el: Element }

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

function shortLabel(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const cls = el.classList[0]
  return cls ? `${tag}.${cls}` : tag
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

/**
 * Grab mode (spec §Grab): a transparent layer over the same-origin player. Hover maps the
 * pointer into the composition document via elementFromPoint; click → Element chip,
 * ⌥-click → Frame chip captured by main.
 */
export function GrabOverlay({ player }: { player: HyperframesPlayer | null }): ReactElement | null {
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)
  const addChip = useChat((s) => s.addChip)
  const [hit, setHit] = useState<Hit | null>(null)
  const [alt, setAlt] = useState(false)
  const layer = useRef<HTMLDivElement>(null)

  const hitTest = useCallback(
    (clientX: number, clientY: number): Hit | null => {
      if (!player || !layer.current) return null
      const iframe = player.iframeElement
      const doc = iframe?.contentDocument
      if (!doc) return null
      const box = layer.current.getBoundingClientRect()
      const cw = player.compositionWidth || 1920
      const ch = player.compositionHeight || 1080
      const sx = cw / box.width
      const sy = ch / box.height
      const x = (clientX - box.left) * sx
      const y = (clientY - box.top) * sy
      const el = doc.elementFromPoint(x, y)
      if (!el || el === doc.documentElement || el === doc.body) return null
      const r = el.getBoundingClientRect()
      const rect = new DOMRect(r.left / sx, r.top / sy, r.width / sx, r.height / sy)
      const { file } = compositionOf(el)
      return { rect, el, label: `${shortLabel(el)} · ${file}` }
    },
    [player]
  )

  useEffect(() => {
    if (!grab) return
    const onKey = (e: KeyboardEvent): void => setAlt(e.altKey)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [grab])

  if (!grab) {
    if (hit) setHit(null)
    return null
  }

  const onClick = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    player?.pause()
    const time = usePlayer.getState().currentTime
    if (e.altKey || alt) {
      const box = layer.current!.getBoundingClientRect()
      const png = await luca.capture.frame({
        x: Math.round(box.left),
        y: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height)
      })
      addChip({ kind: 'frame', time, png })
    } else {
      const h = hitTest(e.clientX, e.clientY)
      if (!h) return
      const { file, id } = compositionOf(h.el)
      const chip: Chip = {
        kind: 'element',
        selector: selectorFor(h.el),
        file,
        compositionId: id,
        time,
        html: trimmedHtml(h.el)
      }
      addChip(chip)
    }
    if (!useUi.getState().chatOpen) useUi.getState().toggleChat()
    toggleGrab(false)
  }

  return (
    <div
      ref={layer}
      className="absolute inset-0 z-20 cursor-crosshair"
      onMouseMove={(e) => setHit(hitTest(e.clientX, e.clientY))}
      onMouseLeave={() => setHit(null)}
      onClick={(e) => void onClick(e)}
    >
      {hit ? (
        <>
          <div
            className="pointer-events-none absolute rounded-[2px] border-[1.5px] border-accent bg-accent/10"
            style={{
              left: hit.rect.x,
              top: hit.rect.y,
              width: hit.rect.width,
              height: hit.rect.height
            }}
          />
          <div
            className="pointer-events-none absolute max-w-[80%] truncate rounded-[4px] bg-accent px-1.5 py-0.5 font-mono text-[10px] text-white shadow-sm"
            style={{
              left: Math.max(0, hit.rect.x),
              top: hit.rect.y > 18 ? hit.rect.y - 18 : hit.rect.y + hit.rect.height + 2
            }}
          >
            {alt ? `Frame · ${hit.label}` : hit.label}
          </div>
        </>
      ) : null}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white backdrop-blur">
        Click an element · ⌥-click for a frame · Esc to exit
      </div>
    </div>
  )
}
