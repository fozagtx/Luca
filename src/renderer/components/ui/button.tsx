import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger'
type Size = 'sm' | 'md'

const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none rounded-[6px] text-[12px] font-medium leading-none transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none no-drag'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-[#0A6FE0] active:bg-[#0663CC]',
  secondary: 'bg-bg-muted text-text hover:bg-[#EBEBEE] active:bg-[#E2E2E6] border border-border',
  ghost: 'text-text-2 hover:bg-black/[0.05] hover:text-text active:bg-black/[0.08]',
  icon: 'text-text-2 hover:bg-black/[0.05] hover:text-text active:bg-black/[0.08] data-[active=true]:bg-black/[0.06] data-[active=true]:text-text',
  danger: 'bg-[#FF3B30] text-white hover:bg-[#E5342A]'
}

const sizes: Record<Size, string> = {
  sm: 'h-6 px-2',
  md: 'h-7 px-2.5'
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  active?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', active, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      data-active={active ? 'true' : undefined}
      className={cn(
        base,
        variants[variant],
        variant === 'icon' ? 'h-7 w-7 px-0' : sizes[size],
        className
      )}
      {...props}
    />
  )
})
