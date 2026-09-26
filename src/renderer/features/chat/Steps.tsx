import { Check, ChevronDown, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { TextShimmer } from '../../components/ai/text-shimmer'
import { cn } from '../../lib/cn'
import { activityOf, lowerFirst, type ToolPart } from './activity'

function StepIcon({ status }: { status: ToolPart['status'] }): ReactElement {
  if (status === 'running') return <span className="step-spinner" />
  if (status === 'error')
    return (
      <span className="flex size-3 items-center justify-center rounded-full bg-warning/20 text-warning">
        <X size={8} strokeWidth={3} />
      </span>
    )
  return (
    <span className="flex size-3 items-center justify-center rounded-full bg-success/15 text-success">
      <Check size={8} strokeWidth={3} />
    </span>
  )
}

/**
 * A run of tool calls as one collapsible list of plain-language steps (prompt-kit Steps /
 * Chain of Thought). Open while Luca works, folded to a one-line summary once done.
 */
export function Steps({
  parts,
  live,
  animate = true
}: {
  parts: ToolPart[]
  live: boolean
  animate?: boolean
}): ReactElement {
  // a step can only be running while the reply is live; a finished reply shows it as stopped
  const statusOf = (p: ToolPart): ToolPart['status'] =>
    p.status === 'running' && !live ? 'error' : p.status
  const running = live ? parts.find((p) => p.status === 'running') : undefined
  // a failed step followed by others is a normal retry; only a failed last step is a problem
  const endedBadly = !running && statusOf(parts[parts.length - 1]) === 'error'
  const [toggled, setToggled] = useState<boolean | null>(null)
  // a lone step says everything in its header; longer runs stay open for the whole turn so
  // they don't fold and unfold between tool calls
  const single = parts.length === 1
  const open = !single && (toggled ?? live)
  const summary = running
    ? `Luca is ${lowerFirst(activityOf(running).active)}`
    : single
      ? statusOf(parts[0]) === 'error'
        ? `${activityOf(parts[0]).active} didn't work`
        : activityOf(parts[0]).done
      : live
        ? `${parts.length} steps so far`
        : `Took ${parts.length} steps`

  return (
    <div className={animate ? 'fade-in' : undefined}>
      <button
        type="button"
        disabled={single}
        onClick={() => setToggled(!open)}
        aria-expanded={single ? undefined : open}
        className="group flex max-w-full items-center gap-2 rounded-[6px] py-0.5 text-left text-[12px] text-text-2 transition-colors enabled:hover:text-text"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {running ? (
            <span className="step-spinner" />
          ) : endedBadly ? (
            <StepIcon status="error" />
          ) : (
            <StepIcon status="done" />
          )}
        </span>
        {running ? (
          <TextShimmer className="truncate font-medium">{summary}…</TextShimmer>
        ) : (
          <span className="truncate font-medium">{summary}</span>
        )}
        {single ? null : (
          <ChevronDown
            size={12}
            className={cn(
              'shrink-0 text-text-3 transition-transform duration-200',
              open ? 'rotate-180' : ''
            )}
          />
        )}
      </button>
      {single ? null : (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(.2,.8,.2,1)]',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <ol className="relative mt-1 ml-[7px] border-l border-border pl-3.5">
              {parts.map((p) => {
                const a = activityOf(p)
                return (
                  <li
                    key={p.id}
                    className={cn('relative flex items-center gap-2 py-[3px]', live && 'fade-in')}
                  >
                    <span className="absolute -left-[21px] flex size-3.5 items-center justify-center bg-panel">
                      <StepIcon status={statusOf(p)} />
                    </span>
                    <span
                      className={cn(
                        'truncate text-[11.5px]',
                        statusOf(p) === 'running' ? 'text-text' : 'text-text-2'
                      )}
                    >
                      {statusOf(p) === 'running'
                        ? `${a.active}…`
                        : statusOf(p) === 'error'
                          ? `${a.active} didn't work`
                          : a.done}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}
