import type { HyperframesPlayer } from '@hyperframes/player'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { clock } from '../../lib/timecode'
import { usePlayer } from '../../stores/player'
import { errorMessage } from '../../stores/project'
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
  /** Taking a picture of the frame: the outline and hint step aside so they aren't in it. */
  const [capturing, setCapturing] = useState(false)
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
    // ⌥ let go in another app never comes back as a keyup here
    const onBlur = (): void => setAlt(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [grab])

  if (!grab) {
    if (hit) setHit(null)
    if (comment) setComment(null)
    if (capturing) setCapturing(false)
    return null
  }

  const onClick = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    if (capturing) return
    // a click outside an open reply box just closes it
    if (comment) {
      setComment(null)
      return
    }
    // through the store, so the transport shows it paused too
    usePlayer.getState().handle?.pause()
    const time = usePlayer.getState().currentTime
    const box = layer.current!.getBoundingClientRect()
    if (e.altKey || alt) {
      const anchor = { x: e.clientX - box.left, y: e.clientY - box.top, w: 0, h: 0 }
      setHit(null)
      setCapturing(true)
      try {
        // two frames: the outline and hint are off screen before the window is captured
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const png = await luca.capture.frame({
          x: Math.round(box.left),
          y: Math.round(box.top),
          width: Math.round(box.width),
          height: Math.round(box.height)
        })
        setComment({
          chip: { kind: 'frame', time, png },
          label: `The whole frame at ${clock(time)}`,
          anchor
        })
      } catch (err) {
        toast.error('Couldn’t capture the frame', {
          description: errorMessage(err)
        })
      } finally {
        setCapturing(false)
      }
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
      className={cn('absolute inset-0 z-20 cursor-crosshair', capturing && 'cursor-progress')}
      onMouseMove={(e) => {
        if (!comment && !capturing) setHit(hitTest(e.clientX, e.clientY))
      }}
      onMouseLeave={() => setHit(null)}
      onClick={(e) => void onClick(e)}
    >
      {hit && alt ? (
        // ⌥ picks the whole frame, so the whole frame is outlined
        <>
          <div className="pointer-events-none absolute inset-0 rounded-[2px] border-[1.5px] border-accent bg-accent/10" />
          <div className="pointer-events-none absolute top-1.5 left-1.5 rounded-[4px] bg-accent px-1.5 py-0.5 text-[10.5px] font-medium text-white shadow-sm">
            The whole frame
          </div>
        </>
      ) : hit ? (
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
            {hit.label}
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
      ) : capturing ? null : (
        <div className="pointer-events-none absolute bottom-2 left-1/2 w-max max-w-[calc(100%-16px)] -translate-x-1/2 rounded-[10px] bg-black/70 px-2.5 py-1 text-center text-[11px] leading-[1.4] text-balance text-white backdrop-blur">
          Click what you want to change · ⌥-click for the whole frame · Esc to exit
        </div>
      )}
    </div>
  )
}
