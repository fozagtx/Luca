import { AnimatePresence, motion } from 'framer-motion'
import { Eye, EyeOff, MessageSquare, Sparkles } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import { EdgeGlow } from '../../components/ui/edge-glow'
import { useElapsed } from '../../lib/elapsed'
import { useChat } from '../../stores/chat'
import { secondsLeft, timeLeftLabel, useMaking, type Making } from '../../stores/making'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'
import { nowOf } from '../chat/activity'

const EASE = [0.2, 0.8, 0.2, 1] as const

/**
 * Over the video frame: light circling its edges while Luca works. While Luca makes the first
 * edit of new footage, a veil hides the unedited video underneath and says what Luca is doing
 * and about how long is left; "Watch Luca edit" swaps it for a small pill so the preview shows
 * through.
 */
export function MakingOverlay(): ReactElement {
  const projectId = useProject((s) => s.project?.id)
  const working = useChat((s) => s.state === 'working')
  const making = useMaking((s) => (s.making?.projectId === projectId ? s.making : null))
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
            className="absolute inset-x-0 bottom-3 flex justify-center px-3"
          >
            <Pill making={making} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {/* last, so the light runs over the veil too */}
      <EdgeGlow inset on={working || !!making} strong={!!making} />
    </div>
  )
}

/** What Luca is doing, in plain words, and about how long the edit has left. */
function useStatus(m: Making, short = false): { status: string; left: string; waiting: boolean } {
  const messages = useChat((s) => s.messages)
  const { doing, waiting } = useMemo(() => nowOf(messages), [messages])
  const elapsed = useElapsed(m.since)
  const finishingFor = useElapsed(m.finishingSince)
  const left = secondsLeft(m, elapsed, finishingFor)
  return {
    status: m.started ? doing : 'Getting Luca ready…',
    left: waiting ? 'Waiting for you' : timeLeftLabel(left, -left, short),
    waiting
  }
}

function Veil({ making }: { making: Making }): ReactElement {
  const { status, left, waiting } = useStatus(making)
  const chatOpen = useUi((s) => s.chatOpen)
  const setChat = useUi((s) => s.setChat)
  const setPeek = useMaking((s) => s.setPeek)
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 px-5 text-center text-white">
      <div className="making-aurora" />
      <span className="relative isolate flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10">
        <EdgeGlow on />
        <Sparkles size={17} strokeWidth={1.7} />
      </span>
      <div className="relative flex max-w-full min-w-0 flex-col items-center gap-1">
        <div className="text-[15px] font-semibold tracking-[-0.01em]">
          Luca is editing your video
        </div>
        <div key={status} className="rise-in max-w-full truncate text-[12.5px] text-white/75">
          {status}
        </div>
      </div>
      <div className="relative max-w-full truncate rounded-full bg-white/10 px-3 py-1 text-[11.5px] font-medium text-white/90 tabular-nums ring-1 ring-white/15">
        {left}
      </div>
      <div className="relative mt-1 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => setPeek(true)} className={VEIL_BUTTON}>
          <Eye size={12} strokeWidth={1.9} />
          Watch Luca edit
        </button>
        {waiting && !chatOpen ? (
          <button type="button" onClick={() => setChat(true)} className={VEIL_BUTTON}>
            <MessageSquare size={12} strokeWidth={1.9} />
            Open the chat
          </button>
        ) : null}
      </div>
    </div>
  )
}

const VEIL_BUTTON =
  'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-medium text-white/80 ring-1 ring-white/20 transition-[background-color,color,transform] duration-150 hover:bg-white/10 hover:text-white active:scale-[0.97]'

/** The veil lifted: the preview shows the video as Luca edits it, with the status on top. */
function Pill({ making }: { making: Making }): ReactElement {
  const { status, left } = useStatus(making, true)
  const setPeek = useMaking((s) => s.setPeek)
  return (
    <div className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 rounded-full bg-black/65 py-1 pr-1 pl-3 text-[11.5px] text-white shadow-[0_6px_20px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur-md">
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#8f7bff]/60 [animation-duration:1.6s]" />
        <span className="relative size-2 rounded-full bg-[#8f7bff]" />
      </span>
      {/* in a narrow frame the status gives way first, then the time */}
      <span className="min-w-0 shrink-[100] truncate">{status}</span>
      <span className="min-w-0 truncate text-white/60 tabular-nums">{left}</span>
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
