import { X } from 'lucide-react'
import type { ReactElement } from 'react'
import { cn } from '../../lib/cn'
import { formatElapsed, useElapsed } from '../../lib/elapsed'
import { AnimatedNumber } from './animated-number'

/** A 4 px bar: determinate when `value` is known (0..1), otherwise a gliding segment. */
export function ProgressBar({
  value,
  className
}: {
  value?: number | null
  className?: string
}): ReactElement {
  const known = typeof value === 'number' && Number.isFinite(value)
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(value * 100) : undefined}
      className={cn('progress-track', !known && 'progress-indeterminate', className)}
    >
      <div
        className="progress-fill"
        style={{ width: known ? `${Math.max(2, Math.min(100, value * 100))}%` : undefined }}
      />
    </div>
  )
}

export function CheckDraw({ className }: { className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('check-draw', className)} aria-hidden>
      <path
        d="M4 8.4l2.6 2.6L12 5.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export type Step = { id: string; label: string }

/**
 * A vertical list of steps. Done steps pop a self-drawing check, the running step spins with a
 * breathing ring and shows its percentage (or elapsed time when it can't be measured), later
 * steps wait as hollow dots.
 */
export function StepList({
  steps,
  current,
  failed,
  progress,
  estimated,
  since,
  detail,
  className
}: {
  steps: Step[]
  /** Id of the running step; steps before it count as done. `null` = all done. */
  current: string | null
  failed?: boolean
  progress?: number
  estimated?: boolean
  since?: number
  detail?: string
  className?: string
}): ReactElement {
  const at = current === null ? steps.length : steps.findIndex((s) => s.id === current)
  const secs = useElapsed(since, current !== null && !failed)
  return (
    <ol className={cn('flex flex-col gap-2', className)}>
      {steps.map((s, i) => {
        const state = i < at ? 'done' : i === at ? (failed ? 'error' : 'active') : 'todo'
        return (
          <li key={s.id} className="flex min-h-5 items-start gap-2.5">
            <span className="relative mt-px flex size-4 shrink-0 items-center justify-center">
              {state === 'done' ? (
                <span className="pop-in flex size-4 items-center justify-center rounded-full bg-success text-white">
                  <CheckDraw className="size-3" />
                </span>
              ) : state === 'active' ? (
                <span className="pulse-ring flex size-4 items-center justify-center rounded-full">
                  <span className="step-spinner" />
                </span>
              ) : state === 'error' ? (
                <span className="pop-in flex size-4 items-center justify-center rounded-full bg-danger text-white">
                  <X size={10} strokeWidth={3} />
                </span>
              ) : (
                <span className="size-2 rounded-full border-[1.5px] border-border-strong" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'text-[12px] leading-4 transition-colors duration-200',
                    state === 'active'
                      ? 'font-medium text-text'
                      : state === 'done'
                        ? 'text-text-2'
                        : state === 'error'
                          ? 'font-medium text-danger'
                          : 'text-text-3'
                  )}
                >
                  {s.label}
                </span>
                {state === 'active' ? (
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] text-text-3 tabular-nums">
                    {typeof progress === 'number' ? (
                      <>
                        {estimated ? '~' : ''}
                        <AnimatedNumber
                          value={progress * 100}
                          format={(n) => `${Math.round(n)}%`}
                        />
                      </>
                    ) : secs >= 2 ? (
                      formatElapsed(secs)
                    ) : null}
                  </span>
                ) : null}
              </div>
              {state === 'active' ? (
                <div className="rise-in mt-1.5">
                  <ProgressBar value={progress} />
                  {detail ? (
                    <div className="mt-1 truncate text-[10.5px] text-text-3">{detail}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
