import { describeResult } from '@shared/activity'
import type { Ai33Voice, ToolProgress } from '@shared/ai33'
import { Check, ChevronDown, Clock, Square, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { TextShimmer } from '../../components/ai/text-shimmer'
import { AnimatedNumber } from '../../components/ui/animated-number'
import { cn } from '../../lib/cn'
import { useElapsed } from '../../lib/elapsed'
import { formatDuration } from '../../lib/format'
import { useQueue, stopLuca } from '../../stores/queue'
import { VoiceChoices } from '../ai33/VoiceChoices'
import { firstLine, isAi33Tool, isJobTool, isStillWorking, voicesOf } from '../ai33/tool-result'
import { activityOf, lowerFirst, type ToolPart } from './activity'

/** A step's status, plus `working`: it finished waiting and the job carries on in the background. */
type StepState = ToolPart['status'] | 'working'

function StepIcon({ status, ai33 }: { status: StepState; ai33?: boolean }): ReactElement {
  if (status === 'running') return <span className="step-spinner" />
  if (status === 'working')
    return (
      <span className="flex size-3 items-center justify-center text-text-3">
        <Clock size={12} strokeWidth={2} />
      </span>
    )
  if (status === 'stopped')
    return (
      <span className="flex size-3 items-center justify-center rounded-full bg-bg-muted text-text-3">
        <Square size={6} fill="currentColor" strokeWidth={0} />
      </span>
    )
  if (status === 'error')
    return (
      <span
        className={cn(
          'flex size-3 items-center justify-center rounded-full',
          // a failed voiceover, song or effect cost something: it reads as an error, not a hiccup
          ai33 ? 'bg-danger/15 text-danger' : 'bg-warning/20 text-warning'
        )}
      >
        <X size={8} strokeWidth={3} />
      </span>
    )
  return (
    <span className="flex size-3 items-center justify-center rounded-full bg-success/15 text-success">
      <Check size={8} strokeWidth={3} />
    </span>
  )
}

/** Where a step stands now, and (for a finished ai33 step) what it made, read from its own result. */
type Resolved = { state: StepState; done?: string }

function resolve(p: ToolPart, live: boolean, stopped: boolean): Resolved {
  // a step can only be running while the reply is live; afterwards it was stopped or cut off
  if (p.status === 'running') return { state: live ? 'running' : stopped ? 'stopped' : 'error' }
  if (p.status !== 'done' || !isAi33Tool(p.name)) return { state: p.status }
  // a declined cost card is a finished, quiet step: neither a green check nor a red error
  const r = describeResult(p.name, firstLine(p.detail))
  if (r.status) return { state: r.status }
  return { state: isStillWorking(p) ? 'working' : 'done', done: r.done }
}

/** How a finished step reads, by status. `waiting`: the running step is stopped on a card. */
function label(p: ToolPart, r: Resolved, waiting?: string): string {
  const a = activityOf(p)
  if (r.state === 'running') return waiting ? `${waiting}…` : `${a.active}…`
  if (r.state === 'stopped') return `Stopped while ${lowerFirst(a.active)}`
  if (r.state === 'error') return `${a.active} didn't work`
  return r.done ?? a.done
}

const stopClass =
  'border-b border-dotted border-text-3/60 text-text-3 transition-colors hover:border-text hover:text-text'

/** Progress is announced to a screen reader at every quarter, not at every percent. */
const ANNOUNCE_EVERY = 25

/** `· 42% · 0:48` and Stop after a running voiceover, music or sound effect. */
function JobMeta({ progress, what }: { progress?: ToolProgress; what: string }): ReactElement {
  // before ai33 reports anything, the time counts from when the step appeared
  const [appeared] = useState(() => Date.now())
  const secs = useElapsed(progress?.since ?? appeared)
  const pct =
    progress && progress.pct !== null && isFinite(progress.pct)
      ? Math.min(100, Math.max(0, progress.pct))
      : null
  // the number on screen moves all the time (and eases between values): only this text is read out,
  // and it changes only when a quarter is reached
  const quarter = pct === null ? 0 : Math.floor(pct / ANNOUNCE_EVERY) * ANNOUNCE_EVERY
  return (
    <span className="flex shrink-0 items-center gap-2 text-[11px] text-text-3 tabular-nums">
      <span role="status" className="sr-only">
        {quarter > 0 ? `${what}, ${quarter}%` : ''}
      </span>
      <span aria-hidden>
        {pct !== null ? (
          <>
            <span>· </span>
            <AnimatedNumber value={pct} format={(n) => `${Math.round(n)}%`} />
          </>
        ) : null}
        <span> · {formatDuration(secs)}</span>
      </span>
      <button type="button" onClick={() => void stopLuca()} className={stopClass}>
        Stop
      </button>
    </span>
  )
}

/** The longest voice name that goes into a message. */
const MAX_NAME = 40

/**
 * A voice's name for a message the person didn't type: ai33 (and whoever made the voice) chose it,
 * so it is one short line of plain characters, never a paragraph of instructions.
 */
function safeName(name: string): string {
  const plain = name
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // by characters, not UTF-16 units, so an emoji is never cut in half
  return [...plain].slice(0, MAX_NAME).join('').trim()
}

/** Voices to listen to under a finished search; `Use` asks Luca to record with that one. */
function VoiceResults({ voices }: { voices: Ai33Voice[] }): ReactElement {
  const use = (v: Ai33Voice): void => {
    // the words are what the person sees; the note tells Luca which of the listed voices they mean,
    // by its id alone (a name is free text and would be read as part of the instructions)
    useQueue
      .getState()
      .enqueue(`Use ${safeName(v.name) || 'this voice'} for the voiceover`, [], 'typed', {
        note: `The user picked voice id ${v.id.replace(/[\p{Cc}\p{Cf}]+/gu, '')} from your voice_search list. Use that id as the voice.`
      })
  }
  return (
    <div className="fade-in ml-6">
      <VoiceChoices voices={voices} onUse={use} />
    </div>
  )
}

/**
 * A run of tool calls as one collapsible list of plain-language steps (prompt-kit Steps /
 * Chain of Thought). Open while Luca works, folded to a one-line summary once done.
 */
export function Steps({
  parts,
  live,
  stopped = false,
  animate = true,
  waiting,
  declined = false
}: {
  parts: ToolPart[]
  live: boolean
  /** The person pressed Stop during this reply. */
  stopped?: boolean
  animate?: boolean
  /** The running step is stopped on a card in the chat: "Waiting for your OK". */
  waiting?: string
  /** The person said no to the card the last step asked: that step was stopped, not done. */
  declined?: boolean
}): ReactElement {
  const info = parts.map((p, i): Resolved => {
    const r = resolve(p, live, stopped)
    return declined && i === parts.length - 1 && r.state !== 'running' ? { state: 'stopped' } : r
  })
  const running = live ? parts.find((p) => p.status === 'running') : undefined
  // a failed step followed by others is a normal retry; only a failed last step is a problem
  const endedBadly = !running && info[info.length - 1].state === 'error'
  const [toggled, setToggled] = useState<boolean | null>(null)
  // a lone step says everything in its header; longer runs stay open for the whole turn so
  // they don't fold and unfold between tool calls
  const single = parts.length === 1
  const open = !single && (toggled ?? live)
  // several steps can run at once, so Stop can cut off more than the last one
  const cutOff = !running && info.some((r) => r.state === 'stopped')
  const finished = info.filter((r) => r.state !== 'stopped').length
  const summary = running
    ? (waiting ?? `Luca is ${lowerFirst(activityOf(running).active)}`)
    : single
      ? label(parts[0], info[0])
      : live
        ? `${parts.length} steps so far`
        : cutOff
          ? finished
            ? `Stopped after ${finished} step${finished === 1 ? '' : 's'}`
            : 'Stopped'
          : `Took ${parts.length} steps`
  const job = running && !waiting && isJobTool(running.name) ? running : undefined
  // ai33 may say more than the step's name (waiting for the internet); never the same words twice
  const note = job?.progress?.note?.trim()
  const showNote = !!job && !!note && note.replace(/…$/, '') !== activityOf(job).active

  return (
    <div className={animate ? 'fade-in' : undefined}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={single}
          onClick={() => setToggled(!open)}
          aria-expanded={single ? undefined : open}
          className="group flex max-w-full min-w-0 items-center gap-2 rounded-[6px] py-0.5 text-left text-[12px] text-text-2 transition-colors enabled:hover:text-text"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            {running ? (
              <span className="step-spinner" />
            ) : cutOff ? (
              <StepIcon status="stopped" />
            ) : endedBadly ? (
              <StepIcon status="error" ai33={isAi33Tool(parts[parts.length - 1].name)} />
            ) : (
              <StepIcon status={single && info[0].state === 'working' ? 'working' : 'done'} />
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
        {job ? (
          <JobMeta key={job.id} progress={job.progress} what={activityOf(job).active} />
        ) : null}
      </div>
      {showNote ? <div className="ml-6 text-[11px] text-text-3">{note}</div> : null}
      {single ? null : (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(.2,.8,.2,1)]',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <ol className="relative mt-1 ml-[7px] border-l border-border pl-3.5">
              {parts.map((p, i) => {
                return (
                  <li
                    key={p.id}
                    className={cn('relative flex items-center gap-2 py-[3px]', live && 'fade-in')}
                  >
                    <span className="absolute -left-[21px] flex size-3.5 items-center justify-center bg-panel">
                      <StepIcon status={info[i].state} ai33={isAi33Tool(p.name)} />
                    </span>
                    <span
                      className={cn(
                        'truncate text-[11.5px]',
                        info[i].state === 'running' ? 'text-text' : 'text-text-2'
                      )}
                    >
                      {label(p, info[i], p === running ? waiting : undefined)}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      )}
      {parts.map((p) => {
        const voices = voicesOf(p)
        return voices ? <VoiceResults key={p.id} voices={voices} /> : null
      })}
    </div>
  )
}
