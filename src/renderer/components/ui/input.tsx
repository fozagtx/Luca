import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-7 w-full rounded-[6px] border border-border bg-bg-muted px-2 text-[13px] text-text placeholder:text-text-3',
          'focus:border-accent/60 focus:bg-bg',
          className
        )}
        {...props}
      />
    )
  }
)
