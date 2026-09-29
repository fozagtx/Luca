import {
  ArrowUp,
  AudioLines,
  CircleAlert,
  Crosshair,
  LoaderCircle,
  Mic,
  Paperclip,
  Sparkles,
  Square,
  X
} from 'lucide-react'
import {
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement
} from 'react'
import { EdgeGlow } from '../../components/ui/edge-glow'
import { Thumb } from '../../components/ui/thumb'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { catalogChip, hasCatalogDrag, readCatalogDrag } from '../../lib/drag'
import { useChat, type PendingMedia } from '../../stores/chat'
import { luca } from '../../lib/luca'
import { stopLuca, useQueue } from '../../stores/queue'
import { usePlayer } from '../../stores/player'
import { kindOf, useStart } from '../../stores/start'
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
 * With no project open it still works: media dropped on it goes on the start card, and the
 * message is a note for Luca's first edit of it (Luca starts right away).
 */
export function Composer({ noProject }: { noProject: boolean }): ReactElement {
  const draft = useChat((s) => s.draft)
  const setDraft = useChat((s) => s.setDraft)
  const chips = useChat((s) => s.chips)
  const addChip = useChat((s) => s.addChip)
  const removeChip = useChat((s) => s.removeChip)
  const attaching = useChat((s) => s.attaching)
  const attach = useChat((s) => s.attach)
  const send = useChat((s) => s.send)
  const state = useChat((s) => s.state)
  const error = useChat((s) => s.error)
  const voiceMode = useVoice((s) => s.mode)
  const voiceError = useVoice((s) => s.error)
  const needsKey = useVoice((s) => s.needsKey)
  const startVoice = useVoice((s) => s.start)
  const dismissVoice = useVoice((s) => s.dismiss)
  const [over, setOver] = useState(false)
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)
  const ref = useRef<HTMLTextAreaElement>(null)
  const working = state === 'working'
  const hasText = draft.trim().length > 0
  const startFiles = useStart((s) => s.files)
  const startPreviews = useStart((s) => s.previews)
  const starting = useStart((s) => s.busy)
  const scriptMode = useStart((s) => s.scriptMode)
  const footage = !!kindOf(startFiles)
  const disabled = starting
  // a file still on its way in would be missing from the message
  const canSend = (hasText || (noProject && footage)) && attaching.length === 0
  const sendLabel = noProject ? 'Edit my video' : working ? 'Add to the queue' : 'Send'

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, LINE * 2), LINE * MAX_LINES + 8)}px`
  }, [draft, voiceMode])

  const submit = (): void => {
    const text = draft.trim()
    if (!canSend || disabled) return
    // Luca is busy: line it up in the queue instead of dropping it into the conversation
    if (!noProject && (working || useQueue.getState().items.some((i) => i.status !== 'review'))) {
      useQueue.getState().enqueue(text, chips, 'typed', { time: usePlayer.getState().currentTime })
      useChat.setState({ draft: '', chips: [] })
      return
    }
    // read at send time: subscribing would re-render the composer on every frame of playback
    void send(text, { time: usePlayer.getState().currentTime })
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
  const fileDrop = (dt: DataTransfer): boolean => Array.from(dt.types).includes('Files')
  /** With no project, files go on the start card; otherwise they go in the project. */
  const addFiles = (files: File[]): void => {
    if (noProject) {
      const paths = files.map((f) => luca.project.pathForFile(f))
      useStart.getState().addFiles(paths.filter(Boolean))
    } else void attach(files)
    ref.current?.focus()
  }
  const pick = async (): Promise<void> => {
    const paths = await luca.project.pickMedia()
    if (!paths.length) return
    if (noProject) useStart.getState().addFiles(paths)
    else void attach(paths)
  }
  /** A picture on the clipboard (a screenshot) is attached; copied text still pastes as text. */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...e.clipboardData.files]
    const text = e.clipboardData.getData('text/plain')
    // some apps put a picture of copied text next to the text itself: the text wins then (and a
    // new video can only start from files on disk)
    const real = files.filter((f) => luca.project.pathForFile(f))
    const take =
      real.length || text || noProject ? real : files.filter((f) => f.type.startsWith('image/'))
    if (!take.length) return
    e.preventDefault()
    addFiles(take)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      // isolate: the glow while Luca works sits behind the box, not behind the panel
      className="isolate shrink-0 px-3 pt-1 pb-3"
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
          addFiles([...e.dataTransfer.files])
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
          Voice input turns your speech into text live with AssemblyAI while you talk. Nothing is
          sent to Luca until you approve it. Your key stays in the macOS Keychain.
        </AssemblyAiKeyCard>
      ) : null}
      {noProject && !voiceMode ? (
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-text-3">
          <Sparkles size={11} className="shrink-0 text-accent" />
          {footage ? (
            'Say what you want, and Luca starts editing your video.'
          ) : scriptMode ? (
            'Paste your script on the start card, then press Record and edit.'
          ) : (
            <span>
              No project open: drop your video on the start card, or{' '}
              <button
                type="button"
                onClick={() => useStart.getState().setScriptMode(true)}
                className="font-medium text-accent hover:underline"
              >
                start from a script
              </button>
              .
            </span>
          )}
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
        <EdgeGlow on={working && !noProject && !over} />
        {over ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[16px] text-[12px] font-medium text-accent">
            {noProject ? 'Drop to add it on the start card' : 'Drop to show it to Luca'}
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
        {chips.length > 0 || attaching.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-3 pt-2.5">
            {chips.map((c, i) => (
              <ChipPill key={i} chip={c} onRemove={() => removeChip(i)} />
            ))}
            {attaching.map((a) => (
              <AddingPill key={a.id} file={a} />
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
              onPaste={onPaste}
              disabled={disabled}
              rows={1}
              placeholder={
                noProject
                  ? footage
                    ? 'Anything Luca should know? (optional)'
                    : 'Drop your video on the start card first…'
                  : 'Ask Luca to edit your video…'
              }
              className={cn(
                'block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13px] leading-[20px] text-text placeholder:text-text-3 select-text',
                over && 'opacity-0'
              )}
            />
            <div className="flex items-center gap-1 px-2 pt-0.5 pb-2">
              <Tip label="Add a video, audio or images" side="top">
                <button
                  type="button"
                  aria-label="Add a video, audio or images"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    void pick()
                  }}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-text-2 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-text active:scale-90 disabled:pointer-events-none disabled:opacity-45"
                >
                  <Paperclip size={14} strokeWidth={1.9} />
                </button>
              </Tip>
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
                  ? 'Getting your video ready…'
                  : attaching.length
                    ? 'Adding to your project…'
                    : working && hasText
                      ? '↩ to add to the queue'
                      : canSend
                        ? noProject
                          ? '↩ to start editing'
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
                      void stopLuca()
                    }}
                    className="relative flex size-8 items-center justify-center rounded-full bg-text text-bg transition-transform duration-150 active:scale-90"
                  >
                    <span className="absolute inset-[-3px] animate-spin rounded-full border-[1.5px] border-transparent border-t-accent [animation-duration:1.1s]" />
                    <Square size={10} fill="currentColor" strokeWidth={0} />
                  </button>
                </Tip>
              ) : (
                <Tip label={sendLabel} shortcut="↩" side="top">
                  <button
                    type="button"
                    aria-label={sendLabel}
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

/** A file on its way into the project, with how far along a video is. */
function AddingPill({ file }: { file: PendingMedia }): ReactElement {
  return (
    <span className="pop-in inline-flex h-[22px] max-w-full items-center gap-1 rounded-full border border-dashed border-border-strong px-2 text-[11px] font-medium text-text-2">
      <LoaderCircle size={11} className="shrink-0 animate-spin" />
      <span className="max-w-40 truncate">
        {file.media === 'video'
          ? 'Getting your video ready'
          : file.media === 'audio'
            ? 'Adding your audio'
            : 'Adding your image'}
      </span>
      {typeof file.progress === 'number' ? (
        <span className="text-text-3 tabular-nums">{Math.round(file.progress * 100)}%</span>
      ) : null}
    </span>
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
