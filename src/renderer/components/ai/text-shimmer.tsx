import type { ElementType, HTMLAttributes, ReactElement, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** A light band that sweeps through muted text while something is in progress (prompt-kit TextShimmer). */
export function TextShimmer({
  as: Tag = 'span',
  duration,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType
  duration?: number
  children: ReactNode
}): ReactElement {
  return (
    <Tag
      className={cn('shimmer-text', className)}
      style={duration ? { animationDuration: `${duration}s` } : undefined}
      {...props}
    >
      {children}
    </Tag>
  )
}

/** Three bouncing dots. */
export function TypingDots({ className }: { className?: string }): ReactElement {
  return (
    <span className={cn('typing-dots', className)} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  )
}
