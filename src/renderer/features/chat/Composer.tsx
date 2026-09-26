import { ArrowUp, AudioLines, CircleAlert, Crosshair, Mic, Sparkles, Square, X } from 'lucide-react'
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement
} from 'react'
import { Thumb } from '../../components/ui/thumb'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { catalogChip, hasCatalogDrag, readCatalogDrag } from '../../lib/drag'
import { useChat } from '../../stores/chat'
import { luca } from '../../lib/luca'
import { usePlayer } from '../../stores/player'
import { useStart } from '../../stores/start'
import { useVoice } from '../../stores/voice'
import { AssemblyAiKeyCard } from '../onboarding/AssemblyAiKeyCard'
import { ChipPill } from './Message'
import { VoiceRecorder } from './VoiceRecorder'

const LINE = 20
const MAX_LINES = 8

/**
 * The message box (prompt-kit PromptInput): grows with the text, Enter sends, Shift+Enter adds a
 * line. Focus is shown by a firmer edge and a soft lift rather than a coloured ring.
 *
 * With no project open it still works: the message is the idea for a new video (and media
 * dropped on it is what the video starts from).
 */
export function Composer({ noProject }: { noProject: boolean }): ReactElement {
  const { draft, setDraft, chips, addChip, removeChip, send, stop, state, error } = useChat()
  const voiceMode = useVoice((s) => s.mode)
  const voiceError = useVoice((s) => s.error)
  const needsKey = useVoice((s) => s.needsKey)
  const startVoice = useVoice((s) => s.start)
  const dismissVoice = useVoice((s) => s.dismiss)
  const [over, setOver] = useState(false)
  const currentTime = usePlayer((s) => s.currentTime)
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)
  const ref = useRef<HTMLTextAreaElement>(null)
  const working = state === 'working'
  const hasText = draft.trim().length > 0
  const startFiles = useStart((s) => s.files)
  const startPreviews = useStart((s) => s.previews)
  const starting = useStart((s) => s.busy)
  const disabled = starting
  const canSend = hasText || (noProject && startFiles.length > 0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, LINE * 2), LINE * MAX_LINES + 8)}px`
  }, [draft, voiceMode])

  const submit = (): void => {
    const text = draft.trim()
    if (!canSend || disabled) return
    void send(text, { time: currentTime })
  }
  /** Anywhere on the box (not a button) puts the caret in the text, at the end. */
  const focusText = (e: MouseEvent): void => {
    const el = ref.current
    if (!el || disabled || e.target === el) return
    if ((e.target as HTMLElement).closest('button, a, input, textarea, [role=button]')) return
    e.preventDefault()
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }
  const fileDrop = (dt: DataTransfer): boolean =>
    noProject && Array.from(dt.types).includes('Files')
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      className="shrink-0 px-3 pt-1 pb-3"
      onDragOver={(e) => {
        if (!hasCatalogDrag(e.dataTransfer) && !fileDrop(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        if (fileDrop(e.dataTransfer)) {
          e.preventDefault()
          const paths = [...e.dataTransfer.files].map((f) => luca.project.pathForFile(f))
          useStart.getState().addFiles(paths.filter(Boolean))
          ref.current?.focus()
          return
        }
        const d = readCatalogDrag(e.dataTransfer)
        if (!d) return
        e.preventDefault()
        addChip(catalogChip(d))
        ref.current?.focus()
      }}
    >
      {error ? <Notice text={error} onDismiss={() => useChat.setState({ error: null })} /> : null}
      {voiceError ? <Notice text={voiceError} onDismiss={dismissVoice} /> : null}
      {needsKey ? (
        <AssemblyAiKeyCard
          className="fade-in mb-2"
          onDismiss={dismissVoice}
          onSaved={(ok) => {
            if (ok) void startVoice(needsKey)
          }}
        >
          Voice input streams your microphone to AssemblyAI’s real-time speech-to-text while you
          talk. The key is stored in the macOS Keychain (safeStorage).
        </AssemblyAiKeyCard>
      ) : null}
      {noProject && !voiceMode ? (
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-text-3">
          <Sparkles size={11} className="shrink-0 text-accent" />
          No project open: describe a video and Luca starts it from scratch.
        </div>
      ) : null}
      <div
        onMouseDown={focusText}
        className={cn(
          'relative cursor-text rounded-[16px] border transition-[border-color,box-shadow,background-color] duration-200 ease-out',
          // cn() doesn't merge classes, so each state picks its own border, background and shadow
          over
            ? 'border-dashed border-accent bg-accent/[0.04]'
            : voiceMode
              ? 'border-border-strong bg-input shadow-[0_6px_20px_-6px_rgba(0,0,0,0.14),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-[0_6px_20px_-6px_rgba(0,0,0,0.6)]'
              : 'border-border bg-input shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
          'focus-within:border-border-strong focus-within:shadow-[0_6px_20px_-6px_rgba(0,0,0,0.14),0_1px_2px_rgba(0,0,0,0.05)]',
          'dark:focus-within:shadow-[0_6px_20px_-6px_rgba(0,0,0,0.6)]',
          disabled && 'cursor-default opacity-70'
        )}
      >
        {over ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[16px] text-[12px] font-medium text-accent">
            {noProject ? 'Drop to start your video from it' : 'Drop to show it to Luca'}
          </div>
        ) : null}
        {noProject && startFiles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {startFiles.map((f) => (
              <span key={f.path} className="pop-in group relative">
                <Thumb
                  src={startPreviews[f.path] ?? null}
                  lazy={false}
                  className="size-10 rounded-[7px] ring-1 ring-border"
                />
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => useStart.getState().removeFile(f.path)}
                  className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border border-border bg-bg text-text-2 opacity-0 group-hover:opacity-100"
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-3 pt-2.5">
            {chips.map((c, i) => (
              <ChipPill key={i} chip={c} onRemove={() => removeChip(i)} />
            ))}
          </div>
        ) : null}
        {voiceMode ? (
          <VoiceRecorder />
        ) : (
          <>
            <textarea
              ref={ref}
              id="chat-composer"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              disabled={disabled}
              rows={1}
              placeholder={
                noProject
                  ? startFiles.length
                    ? 'What should Luca make from this? (optional)'
                    : 'Describe a video to make from scratch…'
                  : 'Ask Luca to edit your video…'
              }
              className={cn(
                'block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13px] leading-[20px] text-text placeholder:text-text-3 select-text',
                over && 'opacity-0'
              )}
            />
            <div className="flex items-center gap-1 px-2 pt-0.5 pb-2">
              <Tip label="Point at something in the preview" shortcut="G" side="top">
                <button
                  type="button"
                  disabled={disabled || noProject}
                  aria-pressed={grab}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleGrab()
                  }}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
                    grab
                      ? 'bg-secondary text-secondary-fg'
                      : 'text-text-2 hover:bg-hover hover:text-text'
                  )}
                >
                  <Crosshair size={13} strokeWidth={1.9} />
                  {grab ? 'Click the preview' : 'Grab'}
                </button>
              </Tip>
              <span className="ml-auto min-w-0 truncate pr-1 text-[10.5px] text-text-3">
                {starting
                  ? 'Starting your video…'
                  : working && hasText
                    ? 'Luca will read this next'
                    : canSend
                      ? noProject
                        ? '↩ to start'
                        : '↩ to send'
                      : ''}
              </span>
              <Tip label="Dictate" side="top">
                <button
                  type="button"
                  aria-label="Dictate"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    void startVoice('dictate')
                  }}
                  className={ROUND_ICON}
                >
                  <Mic size={15} strokeWidth={1.9} />
                </button>
              </Tip>
              <Tip label="Voice mode: talk with Luca" side="top">
                <button
                  type="button"
                  aria-label="Voice mode"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    void startVoice('converse')
                  }}
                  className={ROUND_ICON}
                >
                  <AudioLines size={15} strokeWidth={1.9} />
                </button>
              </Tip>
              {working && !hasText ? (
                <Tip label="Stop" side="top">
                  <button
                    type="button"
                    aria-label="Stop"
                    onClick={(e) => {
                      e.stopPropagation()
                      void stop()
                    }}
                    className="relative flex size-8 items-center justify-center rounded-full bg-text text-bg transition-transform duration-150 active:scale-90"
                  >
                    <span className="absolute inset-[-3px] animate-spin rounded-full border-[1.5px] border-transparent border-t-accent [animation-duration:1.1s]" />
                    <Square size={10} fill="currentColor" strokeWidth={0} />
                  </button>
                </Tip>
              ) : (
                <Tip label={noProject ? 'Start the video' : 'Send'} shortcut="↩" side="top">
                  <button
                    type="button"
                    aria-label={noProject ? 'Start the video' : 'Send'}
                    disabled={disabled || !canSend}
                    onClick={(e) => {
                      e.stopPropagation()
                      submit()
                    }}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full transition-[background-color,color,transform,box-shadow] duration-200 ease-out active:scale-90',
                      canSend && !disabled
                        ? 'bg-accent text-accent-fg shadow-[0_2px_8px_-2px_color-mix(in_srgb,var(--accent)_60%,transparent)]'
                        : 'bg-bg-muted text-text-3'
                    )}
                  >
                    <ArrowUp size={15} strokeWidth={2.25} />
                  </button>
                </Tip>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const ROUND_ICON =
  'flex size-8 shrink-0 items-center justify-center rounded-full text-text-2 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-text active:scale-90 disabled:pointer-events-none disabled:opacity-45'

function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }): ReactElement {
  return (
    <div className="fade-in mb-2 flex items-start gap-2 rounded-[10px] border border-danger/20 bg-danger/[0.06] px-2.5 py-2 text-[11.5px] leading-[1.45] text-text">
      <CircleAlert size={13} className="mt-px shrink-0 text-danger" />
      <span className="flex-1 select-text">
        {text.replace(/^Error invoking remote method '[^']+': Error: /, '')}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="flex size-4 shrink-0 items-center justify-center rounded-full text-text-3 hover:bg-hover hover:text-text"
      >
        <X size={11} />
      </button>
    </div>
  )
}
