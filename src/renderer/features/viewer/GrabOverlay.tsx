import type { HyperframesPlayer } from '@hyperframes/player'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { luca } from '../../lib/luca'
import { clock } from '../../lib/timecode'
import { usePlayer } from '../../stores/player'
import { CommentBox, type Anchor, type CommentChip } from './CommentBox'
import { elementChip, elementLabel } from './element-chip'

type Hit = { rect: DOMRect; label: string; el: Element }
type Comment = { chip: CommentChip; label: string; anchor: Anchor }

/**
 * Grab mode (spec §Grab): a transparent layer over the same-origin player. Hover maps the
 * pointer into the composition document via elementFromPoint; a click opens a reply box on that
 * element (⌥-click: on the whole frame, captured by main) and what you write goes to Luca.
 */
export function GrabOverlay({ player }: { player: HyperframesPlayer | null }): ReactElement | null {
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)
  const [hit, setHit] = useState<Hit | null>(null)
  const [comment, setComment] = useState<Comment | null>(null)
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
      return { rect, el, label: elementLabel(el) }
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
    if (comment) setComment(null)
    return null
  }

  const onClick = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    // a click outside an open reply box just closes it
    if (comment) {
      setComment(null)
      return
    }
    player?.pause()
    const time = usePlayer.getState().currentTime
    const box = layer.current!.getBoundingClientRect()
    if (e.altKey || alt) {
      const png = await luca.capture.frame({
        x: Math.round(box.left),
        y: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height)
      })
      setHit(null)
      setComment({
        chip: { kind: 'frame', time, png },
        label: `The whole frame at ${clock(time)}`,
        anchor: { x: e.clientX - box.left, y: e.clientY - box.top, w: 0, h: 0 }
      })
    } else {
      const h = hitTest(e.clientX, e.clientY)
      if (!h) return
      setHit(null)
      setComment({
        chip: elementChip(h.el, time),
        label: `${h.label} at ${clock(time)}`,
        anchor: { x: h.rect.x, y: h.rect.y, w: h.rect.width, h: h.rect.height }
      })
    }
  }

  return (
    <div
      ref={layer}
      className="absolute inset-0 z-20 cursor-crosshair"
      onMouseMove={(e) => {
        if (!comment) setHit(hitTest(e.clientX, e.clientY))
      }}
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
            className="pointer-events-none absolute max-w-[80%] truncate rounded-[4px] bg-accent px-1.5 py-0.5 text-[10.5px] font-medium text-white shadow-sm"
            style={{
              left: Math.max(0, hit.rect.x),
              top: hit.rect.y > 18 ? hit.rect.y - 18 : hit.rect.y + hit.rect.height + 2
            }}
          >
            {alt ? 'The whole frame' : hit.label}
          </div>
        </>
      ) : null}
      {comment ? (
        <>
          <div
            className="pointer-events-none absolute rounded-[2px] border-[1.5px] border-accent bg-accent/10"
            style={{
              left: comment.anchor.x,
              top: comment.anchor.y,
              width: comment.anchor.w,
              height: comment.anchor.h
            }}
          />
          <CommentBox
            chip={comment.chip}
            label={comment.label}
            anchor={comment.anchor}
            onClose={(sent) => {
              setComment(null)
              if (sent) toggleGrab(false)
            }}
          />
        </>
      ) : (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          Click what you want to change · ⌥-click for the whole frame · Esc to exit
        </div>
      )}
    </div>
  )
}
