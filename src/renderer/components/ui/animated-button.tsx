import { motion, type HTMLMotionProps } from 'framer-motion'
import { forwardRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * Vengeance UI "Animated Button" (vengenceui.com/r/animated-button): spring press,
 * periodic soft shine sweep. Adapted to Luca's accent tokens and sizing.
 */
export type AnimatedButtonProps = HTMLMotionProps<'button'> & {
  variant?: 'primary' | 'outline'
  size?: 'sm' | 'md'
}

const shine = 'linear-gradient(-75deg, transparent 30%, var(--shine) 50%, transparent 70%)'

export const AnimatedButton = forwardRef<HTMLButtonElement, AnimatedButtonProps>(
  function AnimatedButton(
    { children, className, variant = 'primary', size = 'md', disabled, ...rest },
    ref
  ) {
    return (
      <motion.button
        ref={ref}
        type="button"
        disabled={disabled}
        whileHover={disabled ? undefined : { scale: 1.02 }}
        whileTap={disabled ? undefined : { scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 0.5 }}
        className={cn(
          'no-drag group relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-[6px] text-[12px] font-medium leading-none',
          size === 'sm' ? 'h-6 px-2.5' : 'h-7 px-3',
          variant === 'primary'
            ? 'bg-accent text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] [--shine:rgba(255,255,255,.28)]'
            : 'border border-border bg-bg text-text [--shine:rgba(0,0,0,.06)] dark:[--shine:rgba(255,255,255,.1)]',
          'disabled:pointer-events-none disabled:opacity-40',
          className
        )}
        {...rest}
      >
        <span className="relative z-10 flex items-center gap-1.5">{children as ReactNode}</span>
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: shine, backgroundSize: '200% 100%' }}
          initial={{ backgroundPosition: '100% 0' }}
          animate={{ backgroundPosition: ['100% 0', '-100% 0'] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear', repeatDelay: 4 }}
        />
      </motion.button>
    )
  }
)
