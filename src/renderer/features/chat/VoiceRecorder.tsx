import { motion } from 'framer-motion'
import { Check, LoaderCircle, Square, VolumeX, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { orb25Orb } from '../../components/orbs/orb-25/meta'
import { createOrbRenderer, type OrbDrive, type OrbState } from '../../components/orbs/renderer'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { clock } from '../../lib/timecode'
import { useChat } from '../../stores/chat'
import { useProject } from '../../stores/project'
import { stopLuca, useQueue } from '../../stores/queue'
import { stageVisible, useVoice, type VoiceMode, type VoicePhase } from '../../stores/voice'

const BARS = 36
const ORB_SIZE = 56
/** Cleared the first time the orb can't start, so later sessions go straight to the meter. */
let webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator

function hint(mode: VoiceMode, phase: VoicePhase, take: boolean): string {
  switch (phase) {
    case 'connecting':
      return 'Getting the microphone ready…'
    case 'finishing':
      return 'Finishing the transcript…'
    case 'thinking':
      return take
        ? 'Luca is working. Say “send it” to line this up next.'
        : 'Luca is working on it. Talk to line up the next change.'
    case 'speaking':
      return 'Luca is answering…'
    default:
      if (mode === 'dictate') return 'Listening… speak and your words appear here.'
      return take
        ? 'Say “send it” or press ↩ to send. Keep talking to add more, or say “scratch that”.'
        : 'Listening… ask Luca to change your video. You approve it before it’s sent.'
  }
}

/** Replaces the composer's text row while dictating or in voice mode. */
export function VoiceRecorder(): ReactElement | null {
  const { mode, phase, finals, partial, startedAt, finish, cancel, skipSpeech } = useVoice()
  const working = useChat((s) => s.state === 'working')
  const dir = useProject((s) => s.project?.dir ?? null)
  const take = useQueue((s) => s.items.some((i) => i.open && i.dir === dir))
  const [orb, setOrb] = useState(webgpu)
  const scroll = useRef<HTMLDivElement>(null)
  const heard = finals.join(' ')

  useLayoutEffect(() => {
    const el = scroll.current
    if (el) el.scrollTop = el.scrollHeight
  }, [heard, partial])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel()
      } else if (
        e.key === 'Enter' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.isComposing &&
        !t?.closest('button, a, [role="button"]')
      ) {
        e.preventDefault()
        e.stopPropagation()
        if (mode === 'dictate') void finish()
        else useQueue.getState().approveNext()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode, cancel, finish])

  if (!mode) return null

  // the stage owns the orb, the status and the way out — the composer keeps just words and OK
  if (stageVisible({ mode, phase }))
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="flex items-start gap-3 px-3.5 pt-2.5">
          <div
            ref={scroll}
            className="scroll max-h-[170px] min-h-[50px] min-w-0 flex-1 text-[13px] leading-[20px] text-text select-text"
          >
            {heard || partial ? (
              <>
                {heard}
                {heard && partial ? ' ' : ''}
                <span className="text-text-2">{partial}</span>
              </>
            ) : (
              <span className="text-text-3">{hint(mode, phase, take)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end pt-0.5 pr-2 pb-2 pl-3.5">
          {take ? (
            <Tip label="Send what you said" shortcut="↩" side="top">
              <button
                type="button"
                onClick={() => useQueue.getState().approveNext()}
                aria-label="Send what you said"
                className="no-drag flex size-8 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95"
              >
                <Check size={16} strokeWidth={2.5} />
              </button>
            </Tip>
          ) : null}
        </div>
      </motion.div>
    )

  const bars =
    phase === 'speaking' ? 'speak' : phase === 'listening' || phase === 'thinking' ? 'live' : 'wait'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="flex items-start gap-3 px-3.5 pt-2.5">
        {orb ? (
          <VoiceOrb
            onError={() => {
              webgpu = false
              setOrb(false)
            }}
          />
        ) : null}
        <div
          ref={scroll}
          className={cn(
            'scroll max-h-[170px] min-w-0 flex-1 text-[13px] leading-[20px] text-text select-text',
            orb ? 'min-h-[56px]' : 'min-h-[50px]'
          )}
        >
          {heard || partial ? (
            <>
              {heard}
              {heard && partial ? ' ' : ''}
              <span className="text-text-2">{partial}</span>
            </>
          ) : (
            <span className="text-text-3">{hint(mode, phase, take)}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-0.5 pr-2 pb-2 pl-3.5">
        <Status mode={mode} phase={phase} startedAt={startedAt} />
        {orb ? (
          <span className="flex-1" />
        ) : (
          <VoiceBars
            state={bars}
            className={cn('min-w-0 flex-1', bars === 'wait' ? 'text-text-3' : 'text-accent')}
          />
        )}
        {mode === 'dictate' ? (
          <>
            <Tip label="Discard" shortcut="Esc" side="top">
              <button type="button" className="icon-btn" onClick={cancel} aria-label="Discard">
                <X size={15} />
              </button>
            </Tip>
            <Tip label="Done: review it before it’s sent" shortcut="↩" side="top">
              <button
                type="button"
                onClick={() => void finish()}
                disabled={phase === 'finishing'}
                aria-label="Done dictating"
                className="no-drag flex size-8 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95"
              >
                {phase === 'finishing' ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <Check size={16} strokeWidth={2.5} />
                )}
              </button>
            </Tip>
          </>
        ) : (
          <>
            {phase === 'speaking' ? (
              <Tip label="Skip the reply" side="top">
                <button type="button" className="icon-btn" onClick={skipSpeech} aria-label="Skip">
                  <VolumeX size={15} />
                </button>
              </Tip>
            ) : null}
            {take ? (
              <Tip label="Send what you said" shortcut="↩" side="top">
                <button
                  type="button"
                  onClick={() => useQueue.getState().approveNext()}
                  aria-label="Send what you said"
                  className="no-drag flex size-8 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95"
                >
                  <Check size={16} strokeWidth={2.5} />
                </button>
              </Tip>
            ) : null}
            {working ? (
              <Tip label="Stop" side="top">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void stopLuca()}
                  aria-label="Stop"
                >
                  <Square size={11} fill="currentColor" />
                </button>
              </Tip>
            ) : null}
            <Tip label="End voice mode" shortcut="Esc" side="top">
              <button
                type="button"
                onClick={cancel}
                className="no-drag inline-flex h-8 items-center gap-1 rounded-full bg-danger px-3 text-[12px] font-medium text-white transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95"
              >
                <X size={13} strokeWidth={2.5} /> End
              </button>
            </Tip>
          </>
        )}
      </div>
    </motion.div>
  )
}

function Status({
  mode,
  phase,
  startedAt
}: {
  mode: VoiceMode
  phase: VoicePhase
  startedAt: number
}): ReactElement {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  if (phase === 'connecting' || phase === 'finishing')
    return <LoaderCircle size={13} className="shrink-0 animate-spin text-text-3" />
  const label =
    mode === 'dictate'
      ? clock(Math.floor((now - startedAt) / 1000))
      : phase === 'thinking'
        ? 'Working'
        : phase === 'speaking'
          ? 'Speaking'
          : 'Listening'
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-text-2 tabular-nums">
      <span className="relative flex size-2">
        {phase === 'listening' ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-danger opacity-60" />
        ) : null}
        <span
          className={cn(
            'relative size-2 rounded-full',
            phase === 'listening' ? 'bg-danger' : 'animate-pulse bg-accent'
          )}
        />
      </span>
      {label}
    </span>
  )
}

/** Listening shows your voice in the orb; connecting, working and finishing think; the reply speaks. */
function orbState(phase: VoicePhase): OrbState {
  if (phase === 'speaking') return 'speaking'
  return phase === 'listening' ? 'idle' : 'thinking'
}

/**
 * Luca's voice orb (shadercn ORB-25). The frame loop reads the phase and the microphone level
 * straight from the voice store, so it follows the conversation without re-rendering React.
 * `onError` fires when WebGPU can't start, so the level meter can stand in.
 */
function VoiceOrb({
  onError,
  size = ORB_SIZE
}: {
  onError: () => void
  size?: number
}): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const [painted, setPainted] = useState(false)
  const fail = useRef(onError)
  useEffect(() => {
    fail.current = onError
  }, [onError])
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const drive: OrbDrive = { state: 'idle' }
    const heard = { input: 0 }
    const renderer = createOrbRenderer({
      canvas,
      variant: orb25Orb,
      drive: () => {
        const voice = useVoice.getState()
        drive.state = orbState(voice.phase)
        heard.input = voice.level()
        drive.volumes = drive.state === 'idle' ? heard : undefined
        return drive
      },
      onFirstFrame: () => setPainted(true)
    })
    renderer.ready.catch((err: unknown) => {
      console.warn('[voice] orb unavailable:', err)
      fail.current()
    })
    return renderer.dispose
  }, [])
  return (
    <span
      aria-hidden
      className="relative shrink-0 overflow-hidden rounded-full bg-[#07080c] shadow-[0_4px_14px_rgba(0,0,0,0.18)] ring-1 ring-black/10 dark:ring-white/10"
      style={{ width: size, height: size }}
    >
      <canvas
        ref={ref}
        className={cn(
          'block size-full transition-opacity duration-300',
          painted ? 'opacity-100' : 'opacity-0'
        )}
      />
    </span>
  )
}

/**
 * Level meter, in place of the orb when WebGPU is unavailable. `live` scrolls the microphone level
 * right to left like a recorder; `speak` and `wait` are synthetic motion for the reply and for
 * connecting/working. Bars are written from a rAF loop so the meter never re-renders React.
 */
function VoiceBars({
  state,
  className
}: {
  state: 'live' | 'speak' | 'wait'
  className?: string
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const bars = Array.from(el.children) as HTMLElement[]
    const history = new Array<number>(bars.length).fill(0)
    let raf = 0
    let last = 0
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const t = now / 1000
      if (state === 'live' && now - last >= 50) {
        last = now
        history.shift()
        history.push(useVoice.getState().level())
      }
      for (let i = 0; i < bars.length; i++) {
        const h =
          state === 'live'
            ? history[i]
            : state === 'speak'
              ? 0.2 + 0.7 * Math.abs(Math.sin(t * 5.3 + i * 0.9) * Math.sin(t * 2.1 + i * 0.37))
              : 0.12 + 0.2 * (0.5 + 0.5 * Math.sin(t * 4 - i * 0.45))
        bars[i].style.transform = `scaleY(${Math.max(0.1, Math.min(1, h))})`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state])
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('flex h-6 items-center justify-between gap-[2px] overflow-hidden', className)}
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          className="h-full w-[2px] shrink-0 rounded-full bg-current transition-transform duration-100 ease-out"
          style={{ transform: 'scaleY(0.1)' }}
        />
      ))}
    </div>
  )
}

const STAGE_LABEL: Partial<Record<VoicePhase, string>> = {
  connecting: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…'
}

/**
 * Voice mode's stage: the big orb over the message list with what Luca heard and the way out.
 * Rendered inside the chat's message area, so the composer stays reachable. Covers the messages
 * with the panel's own color while it is on.
 */
export function VoiceStage(): ReactElement | null {
  const { mode, phase, finals, partial, cancel, skipSpeech } = useVoice()
  const [orb, setOrb] = useState(webgpu)
  const heard = finals.join(' ')
  const transcript = partial || heard
  const label = STAGE_LABEL[phase]
  if (!stageVisible({ mode, phase })) return null
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-panel px-6"
    >
      {orb ? (
        <VoiceOrb
          size={200}
          onError={() => {
            webgpu = false
            setOrb(false)
          }}
        />
      ) : (
        <VoiceBars
          state={phase === 'speaking' ? 'speak' : phase === 'listening' ? 'live' : 'wait'}
          className="w-48 text-accent"
        />
      )}
      <div className="text-[13px] font-medium text-text-2">{label}</div>
      {transcript ? (
        <div className="line-clamp-3 max-w-[320px] text-center text-[12.5px] leading-[1.5] text-text-3 select-text">
          {transcript}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {phase === 'speaking' ? (
          <Tip label="Skip the reply" side="top">
            <button type="button" className="icon-btn" onClick={skipSpeech} aria-label="Skip">
              <VolumeX size={15} />
            </button>
          </Tip>
        ) : null}
        <Tip label="End voice mode" shortcut="Esc" side="top">
          <button
            type="button"
            onClick={cancel}
            className="no-drag inline-flex h-8 items-center gap-1 rounded-full bg-danger px-3 text-[12px] font-medium text-white transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95"
          >
            <X size={13} strokeWidth={2.5} /> End
          </button>
        </Tip>
      </div>
    </motion.div>
  )
}
