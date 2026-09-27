import type { ReactElement } from 'react'
import { cn } from '../../lib/cn'

/**
 * Blue-violet light circling the edges of its parent while Luca works (after Gemini's
 * edge-to-edge overlay). `inset` bleeds in from the edges (the video frame); otherwise it glows
 * outward behind the parent, which needs `isolate`. Stays mounted so turning it off fades it out.
 */
export function EdgeGlow({
  on,
  inset = false,
  strong = false,
  className
}: {
  on: boolean
  inset?: boolean
  strong?: boolean
  className?: string
}): ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        'edge-glow',
        inset ? 'edge-glow-inset' : 'edge-glow-halo',
        strong && 'edge-glow-strong',
        !on && 'edge-glow-off',
        className
      )}
    >
      <span className="edge-glow-soft" />
      <span className="edge-glow-line" />
    </span>
  )
}
