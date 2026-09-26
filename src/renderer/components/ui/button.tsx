import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger'
type Size = 'sm' | 'md'

const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none rounded-[6px] text-[12px] font-medium leading-none no-drag ' +
  'transition-[background-color,color,transform,box-shadow] duration-150 ease-out active:scale-[0.97] ' +
  'disabled:opacity-40 disabled:pointer-events-none [&_svg]:shrink-0'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:brightness-110 active:brightness-95',
  secondary: 'border border-border bg-bg text-text hover:bg-hover active:bg-press',
  ghost: 'text-text-2 hover:bg-hover hover:text-text active:bg-press',
  icon: 'text-text-2 hover:bg-hover hover:text-text active:bg-press data-[active=true]:bg-accent/12 data-[active=true]:text-accent',
  danger: 'bg-danger text-white hover:brightness-110'
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
