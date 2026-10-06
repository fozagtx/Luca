import { useEffect, useRef, type ReactElement } from 'react'
import { useUi } from '../../stores/ui'

/** Widest canvas drawn, in device pixels (browsers refuse much wider ones). */
const MAX_CANVAS = 8192

/** Draws cached peaks for [start, end) seconds of the source onto a canvas sized to its box. */
export function Waveform({
  peaks,
  peaksPerSecond,
  start,
  end,
  color
}: {
  peaks: number[]
  peaksPerSecond: number
  start: number
  end: number
  color?: string
}): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  // the ink comes from CSS, so a theme switch needs a redraw
  const theme = useUi((s) => s.theme)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = (): void => {
      const box = canvas.parentElement?.getBoundingClientRect()
      if (!box || box.width === 0) return
      const dpr = window.devicePixelRatio || 1
      // a long clip zoomed in is wider than a canvas can be: past that it draws coarser and
      // CSS stretches it, instead of failing to draw at all
      const width = Math.min(Math.round(box.width * dpr), MAX_CANVAS)
      const kx = width / box.width
      canvas.width = width
      canvas.height = Math.round(box.height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(kx, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, box.width, box.height)
      ctx.fillStyle = color ?? getComputedStyle(canvas).color
      const first = Math.floor(start * peaksPerSecond)
      const last = Math.min(peaks.length, Math.ceil(end * peaksPerSecond))
      const n = last - first
      if (n <= 0) return
      let top = 0
      for (let i = first; i < last; i++) if (peaks[i] > top) top = peaks[i]
      const gain = top > 0 ? Math.min(1 / top, 4) : 1
      // one bar per device column, at most
      const cols = Math.max(1, Math.min(width, Math.ceil(box.width)))
      const colW = box.width / cols
      const perCol = n / cols
      const mid = box.height / 2
      for (let x = 0; x < cols; x++) {
        const a = first + Math.floor(x * perCol)
        const b = Math.max(a + 1, first + Math.floor((x + 1) * perCol))
        let max = 0
        for (let i = a; i < b && i < last; i++) if (peaks[i] > max) max = peaks[i]
        const h = Math.max(1, Math.min(1, max * gain) * (box.height - 6))
        ctx.fillRect(x * colW, mid - h / 2, Math.max(colW, 1 / kx), h)
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    if (canvas.parentElement) ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  }, [peaks, peaksPerSecond, start, end, color, theme])

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full text-[var(--waveform)]"
    />
  )
}
