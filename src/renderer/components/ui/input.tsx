import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-7 w-full rounded-[7px] border border-transparent bg-bg-muted px-2 text-[13px] text-text placeholder:text-text-3',
          'transition-[background-color,border-color,box-shadow] duration-150 ease-out hover:bg-hover',
          'focus:border-border focus:bg-bg focus:shadow-[0_1px_2px_rgba(0,0,0,0.05)]',
          className
        )}
        {...props}
      />
    )
  }
)
