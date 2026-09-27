import type { HyperframesPlayer } from '@hyperframes/player'
import { MessageSquarePlus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { usePlayer } from '../../stores/player'
import { useTimeline } from '../../stores/timeline'
import { findClip } from '../timeline/clip-actions'
import { clock } from '../../lib/timecode'
import { CommentBox } from './CommentBox'
import { elementChip, elementLabel } from './element-chip'

type Box = { x: number; y: number; w: number; h: number }
type Target = { id: string; file: string }
type Live = { tx: number; ty: number; scale: number }
type Gesture =
  | { mode: 'move'; px: number; py: number; from: Live }
  | { mode: 'scale'; cx: number; cy: number; d0: number; from: Live; center: [number, number] }

const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d

/** Nearest element that can be moved as one piece: a sub-composition host, else an element with an id. */
function pickable(el: Element | null): { el: HTMLElement; target: Target } | null {
  if (!el) return null
  const host = el.closest('[data-composition-src]')
  let node: Element | null = host && host.id ? host : el
  while (node && node !== node.ownerDocument.body) {
    if (node.id && !node.hasAttribute('data-composition-id')) break
    if (node.id && node.hasAttribute('data-composition-src')) break
    node = node.parentElement
  }
  if (!node || node === node.ownerDocument.body || !node.id) return null
  const parent = node.parentElement?.closest('[data-composition-src]')
  return {
    el: node as HTMLElement,
    target: { id: node.id, file: parent?.getAttribute('data-composition-src') ?? 'index.html' }
  }
}

/** What you actually see of an element: the union of its visible leaves (comp px). */
function contentRect(el: HTMLElement): DOMRect | null {
  const vis = (n: Element): boolean =>
    typeof (n as HTMLElement).checkVisibility === 'function'
      ? (n as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true })
      : true
  if (!vis(el)) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const add = (r: DOMRect): void => {
    if (r.width < 1 || r.height < 1) return
    x0 = Math.min(x0, r.left)
    y0 = Math.min(y0, r.top)
    x1 = Math.max(x1, r.right)
    y1 = Math.max(y1, r.bottom)
  }
  const nodes = el.querySelectorAll('*')
  let n = 0
  for (const c of nodes) {
    if (++n > 600) break
    const leaf = c.childElementCount === 0 || /^(IMG|VIDEO|CANVAS|SVG|PICTURE)$/i.test(c.tagName)
    if (leaf && vis(c)) add(c.getBoundingClientRect())
  }
  if (!Number.isFinite(x0)) add(el.getBoundingClientRect())
  if (!Number.isFinite(x0)) return null
  return new DOMRect(x0, y0, x1 - x0, y1 - y0)
}

function readLive(el: HTMLElement): Live {
  const cs = getComputedStyle(el)
  const t = cs.translate && cs.translate !== 'none' ? cs.translate.split(' ').map(parseFloat) : []
  const s = cs.scale && cs.scale !== 'none' ? parseFloat(cs.scale.split(' ')[0]) : 1
  return { tx: t[0] || 0, ty: t[1] || 0, scale: Number.isFinite(s) ? s : 1 }
}

function applyLive(el: HTMLElement, l: Live): void {
  el.style.translate = `${l.tx}px ${l.ty}px`
  el.style.scale = String(l.scale)
}

/**
 * Direct manipulation on the preview: hover outlines what can be moved, a click selects it (and
 * its clip in the timeline), dragging moves it and the corner handles resize it. The result is
 * written to the element's tag as CSS `translate` and `scale`, which sit on top of any animation.
 */
export function TransformOverlay({
  player
}: {
  player: HyperframesPlayer | null
}): ReactElement | null {
  const grab = usePlayer((s) => s.grab)
  const playing = usePlayer((s) => s.playing)
  const selectedRef = useTimeline((s) => s.selected)
  const selectClip = useTimeline((s) => s.select)
  const timeline = useTimeline((s) => s.timeline)
  const layer = useRef<HTMLDivElement>(null)
  /** An element picked on the canvas that isn't a timeline clip (clips select through the timeline). */
  const [picked, setPicked] = useState<Target | null>(null)
  const [box, setBox] = useState<{ key: string; box: Box } | null>(null)
  const [hover, setHover] = useState<Box | null>(null)
  const [readout, setReadout] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  /** Replying to the selected element: the reply box is open for this target. */
  const [commenting, setCommenting] = useState<string | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const live = useRef<Live | null>(null)

  // the selected timeline clip wins; otherwise whatever was picked on the canvas
  const clip = timeline ? findClip(selectedRef) : null
  const target: Target | null = clip
    ? { id: clip.ref.replace(/^#/, ''), file: clip.file || 'index.html' }
    : picked
  const targetKey = target ? `${target.file}#${target.id}` : ''

  const doc = (): Document | null => player?.iframeElement?.contentDocument ?? null
  const scaleOf = useCallback((): number => {
    const rect = layer.current?.getBoundingClientRect()
    if (!rect || !player) return 1
    return (player.compositionWidth || 1920) / rect.width
  }, [player])
  const toBox = useCallback(
    (r: DOMRect): Box => {
      const k = scaleOf()
      return { x: r.left / k, y: r.top / k, w: r.width / k, h: r.height / k }
    },
    [scaleOf]
  )
  const elementOf = useCallback(
    (t: Target | null): HTMLElement | null =>
      t
        ? ((player?.iframeElement?.contentDocument?.getElementById(t.id) as HTMLElement | null) ??
          null)
        : null,
    [player]
  )

  // follow the element while it animates or the player reloads
  useEffect(() => {
    if (!targetKey) return
    const id = targetKey.slice(targetKey.indexOf('#') + 1)
    let raf = 0
    let last = ''
    const tick = (): void => {
      const el = elementOf({ id, file: '' })
      const r = el ? contentRect(el) : null
      const b = r ? toBox(r) : null
      const key = b ? `${round(b.x)}|${round(b.y)}|${round(b.w)}|${round(b.h)}` : ''
      if (key !== last) {
        last = key
        setBox(b ? { key: targetKey, box: b } : null)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [targetKey, elementOf, toBox])
  const shown = box && box.key === targetKey ? box.box : null

  if (grab || !player) return null

  const pick = (clientX: number, clientY: number): { el: HTMLElement; target: Target } | null => {
    const d = doc()
    const rect = layer.current?.getBoundingClientRect()
    if (!d || !rect) return null
    const k = scaleOf()
    return pickable(d.elementFromPoint((clientX - rect.left) * k, (clientY - rect.top) * k))
  }

  const persist = async (t: Target, l: Live, verb: string): Promise<void> => {
    const res = await luca.timeline.transform({
      file: t.file,
      id: t.id,
      translate: [round(l.tx), round(l.ty)],
      scale: round(l.scale, 3)
    })
    if (res.ok)
      toast(`${verb} ${t.id.replace(/[-_]+/g, ' ')}`, {
        action: { label: 'Undo', onClick: () => void luca.history.undo() }
      })
    else toast.error(res.error ?? 'Could not save the change')
  }

  const onDown = (e: React.PointerEvent, mode: 'move' | 'scale'): void => {
    const el = elementOf(target)
    if (!el || !target) return
    e.stopPropagation()
    e.preventDefault()
    player.pause()
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const from = readLive(el)
    live.current = from
    if (mode === 'move') gesture.current = { mode, px: e.clientX, py: e.clientY, from }
    else {
      const r = contentRect(el)
      const rect = layer.current!.getBoundingClientRect()
      const k = scaleOf()
      const cx = r ? rect.left + (r.left + r.width / 2) / k : e.clientX
      const cy = r ? rect.top + (r.top + r.height / 2) / k : e.clientY
      const center: [number, number] = r ? [r.left + r.width / 2, r.top + r.height / 2] : [0, 0]
      gesture.current = {
        mode,
        cx,
        cy,
        d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)),
        from,
        center
      }
    }
  }

  const onMove = (e: React.PointerEvent): void => {
    const g = gesture.current
    if (!g) {
      const hit = pick(e.clientX, e.clientY)
      const r = hit && hit.target.id !== target?.id ? contentRect(hit.el) : null
      setHover(r ? toBox(r) : null)
      return
    }
    const el = elementOf(target)
    if (!el) return
    const k = scaleOf()
    if (g.mode === 'move') {
      const next = {
        ...g.from,
        tx: g.from.tx + (e.clientX - g.px) * k,
        ty: g.from.ty + (e.clientY - g.py) * k
      }
      applyLive(el, next)
      live.current = next
      setReadout(`${Math.round(next.tx)}, ${Math.round(next.ty)} px`)
    } else {
      const s = Math.min(
        8,
        Math.max(0.1, g.from.scale * (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) / g.d0))
      )
      // scale about the element's own origin, then shift so the visible center stays put
      applyLive(el, { ...g.from, scale: s })
      const r = contentRect(el)
      const next = { ...g.from, scale: s }
      if (r) {
        next.tx = g.from.tx + (g.center[0] - (r.left + r.width / 2))
        next.ty = g.from.ty + (g.center[1] - (r.top + r.height / 2))
      }
      applyLive(el, next)
      live.current = next
      setReadout(`${Math.round(s * 100)}%`)
    }
  }

  const onUp = (): void => {
    const g = gesture.current
    gesture.current = null
    setDragging(false)
    setReadout(null)
    const l = live.current
    if (!g || !l || !target) return
    const moved =
      Math.abs(l.tx - g.from.tx) > 0.5 ||
      Math.abs(l.ty - g.from.ty) > 0.5 ||
      Math.abs(l.scale - g.from.scale) > 0.002
    if (moved) void persist(target, l, g.mode === 'move' ? 'Moved' : 'Resized')
  }

  const onClick = (e: React.MouseEvent): void => {
    if (commenting) {
      setCommenting(null)
      return
    }
    const hit = pick(e.clientX, e.clientY)
    setHover(null)
    const hitClip = hit ? findClip(`#${hit.target.id}`) : null
    setPicked(hit && !hitClip ? hit.target : null)
    selectClip(hitClip ? hitClip.ref : null)
  }

  const reset = (): void => {
    const el = elementOf(target)
    if (!el || !target) return
    const l = { tx: 0, ty: 0, scale: 1 }
    applyLive(el, l)
    void persist(target, l, 'Reset')
  }

  const el = elementOf(target)
  const changed = el
    ? (() => {
        const l = readLive(el)
        return Math.abs(l.tx) > 0.5 || Math.abs(l.ty) > 0.5 || Math.abs(l.scale - 1) > 0.002
      })()
    : false

  return (
    <div
      ref={layer}
      className={cn('absolute inset-0 z-10', playing ? 'pointer-events-none' : '')}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      onClick={onClick}
    >
      {hover && !dragging ? (
        <div
          className="pointer-events-none absolute rounded-[2px] border border-dashed border-accent/70"
          style={{ left: hover.x, top: hover.y, width: hover.w, height: hover.h }}
        />
      ) : null}
      {shown && target ? (
        <div
          className="absolute cursor-move rounded-[2px] outline outline-[1.5px] outline-accent"
          style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }}
          onPointerDown={(e) => onDown(e, 'move')}
          onPointerUp={onUp}
          onClick={(e) => e.stopPropagation()}
        >
          {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
            <span
              key={c}
              onPointerDown={(e) => onDown(e, 'scale')}
              onPointerUp={onUp}
              className={cn(
                'absolute size-2.5 rounded-[3px] border-[1.5px] border-accent bg-white shadow-sm transition-transform duration-100 hover:scale-125',
                c === 'nw' && '-top-[6px] -left-[6px] cursor-nwse-resize',
                c === 'ne' && '-top-[6px] -right-[6px] cursor-nesw-resize',
                c === 'sw' && '-bottom-[6px] -left-[6px] cursor-nesw-resize',
                c === 'se' && '-right-[6px] -bottom-[6px] cursor-nwse-resize'
              )}
            />
          ))}
          <div
            className={cn(
              'absolute flex items-center gap-1 whitespace-nowrap',
              shown.y > 26 ? '-top-[26px]' : '-bottom-[26px]'
            )}
            // keep the readout on screen when the element runs past the frame's left edge
            style={{ left: Math.max(0, -shown.x) }}
          >
            <span className="rounded-[5px] bg-accent px-1.5 py-[3px] font-mono text-[10px] leading-none text-white shadow-sm">
              {readout ?? target.id.replace(/[-_]+/g, ' ')}
            </span>
            {!readout ? (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  player.pause()
                  setCommenting(targetKey)
                }}
                className="pop-in inline-flex items-center gap-1 rounded-[5px] bg-bg/95 px-1.5 py-[3px] text-[10px] leading-none font-medium text-text shadow-sm hover:bg-bg"
              >
                <MessageSquarePlus size={9} /> Comment
              </button>
            ) : null}
            {!readout && changed ? (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  reset()
                }}
                className="pop-in inline-flex items-center gap-1 rounded-[5px] bg-bg/95 px-1.5 py-[3px] text-[10px] leading-none font-medium text-text shadow-sm hover:bg-bg"
              >
                <RotateCcw size={9} /> Reset
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {shown && target && el && commenting === targetKey ? (
        <CommentBox
          chip={elementChip(el, usePlayer.getState().currentTime)}
          label={`${elementLabel(el)} at ${clock(usePlayer.getState().currentTime)}`}
          anchor={{ x: shown.x, y: shown.y, w: shown.w, h: shown.h }}
          onClose={() => setCommenting(null)}
        />
      ) : null}
    </div>
  )
}
