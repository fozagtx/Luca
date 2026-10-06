import { AnimatePresence, motion } from 'framer-motion'
import { Check, Eye, EyeOff, ListChecks, MessageSquare, Sparkles, Square, X } from 'lucide-react'
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject
} from 'react'
import { TextShimmer } from '../../components/ai/text-shimmer'
import { EdgeGlow } from '../../components/ui/edge-glow'
import { cn } from '../../lib/cn'
import { useElapsed } from '../../lib/elapsed'
import { useChat } from '../../stores/chat'
import { progressOf, secondsLeft, timeLeftLabel, useMaking, type Making } from '../../stores/making'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'
import { activityOf, lowerFirst, nowOf, type ToolPart } from '../chat/activity'

const EASE = [0.2, 0.8, 0.2, 1] as const

/**
 * Over the video frame: light circling its edges while Luca works. While Luca makes the first
 * edit of new footage, a veil hides the unedited video underneath and shows Luca's latest steps,
 * how far along it is and about how long is left; "Watch Luca edit" swaps it for a small pill so
 * the preview shows through.
 */
export function MakingOverlay(): ReactElement {
  const projectId = useProject((s) => s.project?.id)
  const working = useChat((s) => s.state === 'working')
  const making = useMaking((s) => (s.making?.projectId === projectId ? s.making : null))
  // a frame grabbed while Luca works mustn't carry the light around its edges
  const grab = usePlayer((s) => s.grab)
  return (
    <div className="pointer-events-none absolute inset-0 z-30 rounded-[4px]">
      <AnimatePresence>
        {making && !making.peek ? (
          <motion.div
            key="veil"
            // there from the first frame, so the unedited video never flashes; it fades out when done
            initial={false}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="making-veil pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <Veil making={making} />
          </motion.div>
        ) : null}
        {making?.peek ? (
          <motion.div
            key="pill"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="@container absolute inset-x-0 bottom-3 flex justify-center px-3"
          >
            <Pill making={making} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {/* last, so the light runs over the veil too */}
      <EdgeGlow inset on={(working || !!making) && !grab} strong={!!making} />
    </div>
  )
}

/** What Luca is doing, in plain words, its steps so far, and about how long the edit has left. */
function useStatus(
  m: Making,
  short = false
): {
  status: string
  left: string
  waiting: boolean
  steps: ToolPart[]
  progress: number | null
} {
  const messages = useChat((s) => s.messages)
  const { doing, waiting, steps } = useMemo(() => nowOf(messages), [messages])
  const elapsed = useElapsed(m.since)
  const finishingFor = useElapsed(m.finishingSince)
  const left = secondsLeft(m, elapsed, finishingFor)
  // the bar only moves forward, even when the estimate grows (Luca went back to editing)
  const value = progressOf(m, elapsed, finishingFor)
  const [peak, setPeak] = useState(0)
  if (value !== null && value > peak) setPeak(value)
  return {
    status: m.started ? doing : 'Getting Luca ready…',
    left: waiting ? 'Waiting for you' : timeLeftLabel(left, -left, short),
    waiting,
    steps: m.started ? steps : [],
    progress: value === null ? null : Math.max(value, peak)
  }
}

/**
 * The box's size, to drop what doesn't fit when the preview is small. Its border box: the
 * padding changes with the size it measures, so the content box would flip back and forth.
 */
function useSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() =>
      setSize((s) =>
        s.width === el.offsetWidth && s.height === el.offsetHeight
          ? s
          : { width: el.offsetWidth, height: el.offsetHeight }
      )
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/** Open the chat at its newest message, where Luca's steps are. */
function showSteps(): void {
  useUi.getState().setChat(true)
  // once the panel has slid open
  setTimeout(() => {
    const all = document.querySelectorAll('[data-steps]')
    const box = all[all.length - 1]?.closest<HTMLElement>('.scroll')
    box?.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
  }, 320)
}

function Veil({ making }: { making: Making }): ReactElement {
  const setPeek = useMaking((s) => s.setPeek)
  const box = useRef<HTMLDivElement>(null)
  const { width, height } = useSize(box)
  const measured = width > 0
  // the list of steps needs the height (its rows shorten to fit a narrow frame); a small preview
  // keeps a one-line status, a short one drops the icon and a narrow one (a phone-shaped frame
  // in a small window) gets icon buttons
  const roomy = width >= 180 && height >= 330
  const short = measured && height < 240
  const narrow = measured && width < 240
  const { status, left, waiting, steps, progress } = useStatus(making, narrow)
  const buttons: { label: string; icon: ReactElement; onClick: () => void }[] = [
    {
      label: 'Watch Luca edit',
      icon: <Eye size={12} strokeWidth={1.9} />,
      onClick: () => setPeek(true)
    },
    {
      label: waiting ? 'Open the chat' : 'Show steps',
      icon: waiting ? (
        <MessageSquare size={12} strokeWidth={1.9} />
      ) : (
        <ListChecks size={12} strokeWidth={1.9} />
      ),
      onClick: showSteps
    }
  ]
  return (
    <div
      ref={box}
      className={cn(
        'relative flex h-full w-full flex-col items-center justify-center text-center text-white',
        narrow || short ? 'gap-2 px-3' : 'gap-3 px-5'
      )}
    >
      <div className="making-aurora" />
      {short ? null : (
        <span className="relative isolate flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10">
          <EdgeGlow on />
          <Sparkles size={17} strokeWidth={1.7} />
        </span>
      )}
      <div className="relative flex max-w-full min-w-0 flex-col items-center gap-1">
        <div
          className={cn(
            'font-semibold tracking-[-0.01em] text-balance',
            narrow ? 'text-[13px] leading-[1.25]' : 'text-[15px]'
          )}
        >
          {making.kind === 'brief' ? 'Building from your brief' : 'Luca is making your video'}
        </div>
        {roomy ? null : (
          <div
            key={status}
            className={cn(
              'rise-in max-w-full truncate text-white/75',
              narrow ? 'text-[11.5px]' : 'text-[12.5px]'
            )}
          >
            {status}
          </div>
        )}
      </div>
      {roomy ? <Checklist steps={steps} status={status} waiting={waiting} /> : null}
      <div className="relative flex w-full max-w-[260px] flex-col items-center gap-1.5">
        <Progress value={progress} />
        <div className="max-w-full truncate text-[11.5px] font-medium text-white/80 tabular-nums">
          {left}
        </div>
      </div>
      <div className="relative mt-0.5 flex flex-wrap items-center justify-center gap-2">
        {buttons.map((b) =>
          narrow ? (
            <button
              key={b.label}
              type="button"
              onClick={b.onClick}
              aria-label={b.label}
              title={b.label}
              className={cn(VEIL_BUTTON, 'w-7 justify-center')}
            >
              {b.icon}
            </button>
          ) : (
            <button
              key={b.label}
              type="button"
              onClick={b.onClick}
              className={cn(VEIL_BUTTON, 'px-3')}
            >
              {b.icon}
              {b.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}

const VEIL_BUTTON =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full text-[11.5px] font-medium text-white/80 ring-1 ring-white/20 transition-[background-color,color,transform] duration-150 hover:bg-white/10 hover:text-white active:scale-[0.97]'

/** A slim bar from the time spent against the time expected; a sweeping light once overdue. */
function Progress({ value }: { value: number | null }): ReactElement {
  return (
    <div
      role="progressbar"
      aria-label="How far along the edit is"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/15"
    >
      {value === null ? (
        <div className="absolute inset-y-0 left-0 w-[38%] animate-[progress-slide_1.6s_cubic-bezier(0.45,0,0.55,1)_infinite] rounded-full bg-gradient-to-r from-transparent via-white/80 to-transparent" />
      ) : (
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#5b9bff] to-[#b18cff] transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.max(3, value * 100)}%` }}
        />
      )}
    </div>
  )
}

const ROWS = 4

/**
 * Luca's latest steps, newest at the bottom: finished ones ticked, the running one spinning.
 * While no step runs, the last row says what Luca is doing instead (thinking, waiting for an OK).
 */
function Checklist({
  steps,
  status,
  waiting
}: {
  steps: ToolPart[]
  status: string
  waiting: boolean
}): ReactElement {
  const running = steps.some((p) => p.status === 'running')
  const rows: { id: string; status: ToolPart['status'] | 'waiting'; text: string }[] = steps
    .slice(running ? -ROWS : -(ROWS - 1))
    .map((p) => ({ id: p.id, status: p.status, text: stepText(p) }))
  if (!running) rows.push({ id: 'now', status: waiting ? 'waiting' : 'running', text: status })
  return (
    <ol
      aria-label="Luca's latest steps"
      className="relative flex h-[88px] w-full max-w-[260px] flex-col justify-end gap-1.5 overflow-hidden text-left [mask-image:linear-gradient(to_bottom,transparent,black_28%)]"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map((r) => (
          <motion.li
            key={r.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="flex min-h-4 min-w-0 items-center gap-2 text-[12px] leading-4"
          >
            <RowIcon status={r.status} />
            {r.status === 'running' ? (
              <TextShimmer className="min-w-0 truncate font-medium [--text-3:rgba(255,255,255,0.72)] [--text:#fff]">
                {r.text}
              </TextShimmer>
            ) : (
              <span
                className={cn(
                  'min-w-0 truncate',
                  r.status === 'waiting' ? 'font-medium text-white' : 'text-white/60'
                )}
              >
                {r.text}
              </span>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}

function stepText(p: ToolPart): string {
  const a = activityOf(p)
  if (p.status === 'running') return `${a.active}…`
  if (p.status === 'stopped') return `Stopped while ${lowerFirst(a.active)}`
  // a failed step is usually tried again another way; it isn't the person's problem
  if (p.status === 'error') return `${a.active} didn't work`
  return a.done
}

function RowIcon({ status }: { status: ToolPart['status'] | 'waiting' }): ReactElement {
  const box = 'flex size-4 shrink-0 items-center justify-center rounded-full'
  if (status === 'running')
    return (
      <span className={box}>
        <span className="step-spinner [--accent:#fff]" />
      </span>
    )
  if (status === 'waiting')
    return (
      <span className={box}>
        <span className="size-2 animate-pulse rounded-full bg-warning" />
      </span>
    )
  if (status === 'error')
    return (
      <span className={cn(box, 'bg-white/10 text-warning')}>
        <X size={9} strokeWidth={3} />
      </span>
    )
  if (status === 'stopped')
    return (
      <span className={cn(box, 'bg-white/10 text-white/60')}>
        <Square size={6} fill="currentColor" strokeWidth={0} />
      </span>
    )
  return (
    <span className={cn(box, 'pop-in bg-success/25 text-success')}>
      <Check size={9} strokeWidth={3} />
    </span>
  )
}

/** The veil lifted: the preview shows the video as Luca edits it, with the status on top. */
function Pill({ making }: { making: Making }): ReactElement {
  const { status, left } = useStatus(making, true)
  const setPeek = useMaking((s) => s.setPeek)
  return (
    <div
      title={status}
      className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 rounded-full bg-black/65 py-1 pr-1 pl-3 text-[11.5px] text-white shadow-[0_6px_20px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur-md"
    >
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#8f7bff]/60 [animation-duration:1.6s]" />
        <span className="relative size-2 rounded-full bg-[#8f7bff]" />
      </span>
      {/* in a narrow frame the status gives way (a few letters of it say nothing); the time
          left always reads whole */}
      <span key={status} className="rise-in hidden min-w-0 truncate @[210px]:block">
        {status}
      </span>
      <span className="shrink-0 text-white/60 tabular-nums @max-[209px]:text-white/85">{left}</span>
      <button
        type="button"
        aria-label="Cover the preview until Luca is done"
        title="Cover the preview until Luca is done"
        onClick={() => setPeek(false)}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
      >
        <EyeOff size={12} strokeWidth={1.9} />
      </button>
    </div>
  )
}
