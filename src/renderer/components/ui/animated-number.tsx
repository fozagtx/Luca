import { motion, useSpring, useTransform } from 'framer-motion'
import { useEffect, type ReactElement } from 'react'
import { cn } from '../../lib/cn'

/**
 * Vengeance UI "Animated Number" (vengenceui.com/r/animated-number): a spring-eased
 * numeric readout. Luca uses it for progress percentages, never for the frame-accurate timecode.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toString(),
  className
}: {
  value: number
  format?: (n: number) => string
  className?: string
}): ReactElement {
  const spring = useSpring(value, { stiffness: 120, damping: 24, mass: 0.6 })
  const text = useTransform(spring, (n) => format(n))
  useEffect(() => {
    spring.set(value)
  }, [spring, value])
  return <motion.span className={cn('tabular-nums', className)}>{text}</motion.span>
}
