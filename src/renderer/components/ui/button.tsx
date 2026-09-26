import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'icon' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none rounded-[6px] text-[12px] font-medium leading-none no-drag ' +
  'transition-[background-color,color,transform,box-shadow,border-color,opacity] duration-150 ease-out active:scale-[0.97] ' +
  'disabled:opacity-40 disabled:pointer-events-none [&_svg]:shrink-0 [&_svg]:pointer-events-none'

const variants: Record<Variant, string> = {
  default: 'bg-text text-bg hover:bg-text/90',
  primary:
    'bg-accent text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:brightness-110 active:brightness-95',
  secondary:
    'border border-secondary-border bg-secondary text-secondary-fg hover:brightness-[0.98] dark:hover:brightness-110',
  outline: 'border border-border bg-bg text-text hover:bg-hover active:bg-press',
  ghost:
    'text-text-2 hover:bg-hover hover:text-text active:bg-press data-[active=true]:bg-secondary data-[active=true]:text-secondary-fg data-[active=true]:shadow-[inset_0_0_0_1px_var(--secondary-border)]',
  icon: 'text-text-2 hover:bg-hover hover:text-text active:bg-press data-[active=true]:bg-secondary data-[active=true]:text-secondary-fg data-[active=true]:shadow-[inset_0_0_0_1px_var(--secondary-border)]',
  danger: 'bg-danger text-white hover:brightness-110'
}

const sizes: Record<Size, string> = {
  sm: 'h-6 px-2 rounded-[5px] text-[11px]',
  md: 'h-7 px-2.5',
  lg: 'h-8 px-3.5 text-[13px]'
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  active?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'outline', size = 'md', active, type = 'button', ...props },
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
