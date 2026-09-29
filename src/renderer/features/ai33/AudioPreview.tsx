import { Pause, Play } from 'lucide-react'
import {
  useEffect,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/cn'
import { previewState, stopPreview, subscribePreview, togglePreview } from './preview-player'
import { CANT_PLAY, keepKeyLocal } from './voice-meta'

export type AudioPreviewProps = {
  voiceId: string
  /** What the play button is called for screen readers, e.g. "Hear Ryan". */
  label?: string
}

const subscribeOnline = (cb: () => void): (() => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
const isOnline = (): boolean => navigator.onLine !== false

export type PlayVoiceButtonProps = AudioPreviewProps & {
  /** Greyed out, and why (a voice with no sample). */
  disabledReason?: string
  /** -1 inside a list that moves focus between its rows itself. */
  tabIndex?: number
  /** Runs first; the key press is then kept from the app's shortcuts either way. */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
  className?: string
}

/**
 * The play button behind every voice: press to hear the sample, press again to stop. It shows a
 * spinner while the sample is fetched and is greyed out, with the reason, when it can't play.
 */
export function PlayVoiceButton({
  voiceId,
  label = 'Hear this voice',
  disabledReason,
  tabIndex,
  onKeyDown,
  className
}: PlayVoiceButtonProps): ReactElement {
  const { playing, loading, failed } = useSyncExternalStore(subscribePreview, previewState)
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true)
  const isPlaying = playing === voiceId
  const isLoading = loading === voiceId
  const reason = disabledReason ?? (!online || failed === voiceId ? CANT_PLAY : null)

  // a button that goes away (its row, the picker) takes its sample with it
  useEffect(
    () => () => {
      const s = previewState()
      if (s.playing === voiceId || s.loading === voiceId) stopPreview()
    },
    [voiceId]
  )

  return (
    <span title={reason ?? undefined} className="inline-flex shrink-0">
      <Button
        variant="icon"
        active={isPlaying}
        disabled={reason !== null}
        tabIndex={tabIndex}
        aria-label={reason ? `${label}. ${reason}` : label}
        aria-pressed={isPlaying}
        aria-busy={isLoading || undefined}
        data-voice-play={voiceId}
        onClick={() => void togglePreview(voiceId)}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          keepKeyLocal(e)
        }}
        className={cn('rounded-full', className)}
      >
        {isLoading ? (
          <span className="btn-spinner" aria-hidden />
        ) : isPlaying ? (
          <Pause size={12} fill="currentColor" />
        ) : (
          <Play size={12} fill="currentColor" />
        )}
      </Button>
    </span>
  )
}

/** A play button that plays one voice's sample (one sample at a time, app-wide). */
export function AudioPreview({ voiceId, label }: AudioPreviewProps): ReactElement {
  return <PlayVoiceButton voiceId={voiceId} label={label} />
}
