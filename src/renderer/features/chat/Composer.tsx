import { Menu } from '@base-ui/react/menu'
import { PreviewCard } from '@base-ui/react/preview-card'
import type { ApprovalMode } from '@shared/types'
import {
  ArrowUp,
  AudioLines,
  Check,
  CircleAlert,
  Clapperboard,
  Crosshair,
  ImagePlus,
  LoaderCircle,
  Mic,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
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
  type ReactElement,
  type ReactNode
} from 'react'
import { EdgeGlow } from '../../components/ui/edge-glow'
import { Thumb } from '../../components/ui/thumb'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { useChat, type PendingMedia } from '../../stores/chat'
import { luca } from '../../lib/luca'
import { stopLuca, useQueue } from '../../stores/queue'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { kindOf, useStart, type Attachment } from '../../stores/start'
import { useVoice } from '../../stores/voice'
import { AssemblyAiKeyCard } from '../onboarding/AssemblyAiKeyCard'
import { ImageViewer } from './ImageViewer'
import { chipKeys, visualOf, type Visual } from './images'
import { ChipPill, VideoBadge } from './Message'
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
  // drag enters minus leaves: crossing into the box's own parts fires a leave for the box
  const dragDepth = useRef(0)
  const [view, setView] = useState({ index: 0, open: false })
  const projectId = useProject((s) => s.project?.id)
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)
  const ref = useRef<HTMLTextAreaElement>(null)
  const working = state === 'working'
  const hasText = draft.trim().length > 0
  const startFiles = useStart((s) => s.files)
  const startPreviews = useStart((s) => s.previews)
  const starting = useStart((s) => s.busy)
  const media = kindOf(startFiles) !== 'brief'
  const disabled = starting
  // a file still on its way in would be missing from the message
  const canSend = (hasText || (noProject && media)) && attaching.length === 0
  const sendLabel = noProject ? 'Make it' : working ? 'Add to the queue' : 'Send'
  // pictures and videos show as small tiles of themselves, everything else as a pill
  const keys = chipKeys(chips)
  const tiles: { i: number; key: string; visual: Visual }[] = []
  const pills: { i: number; key: string }[] = []
  chips.forEach((c, i) => {
    const visual = visualOf(c, projectId)
    if (visual) tiles.push({ i, key: keys[i], visual })
    else pills.push({ i, key: keys[i] })
  })
  const addingTiles = attaching.filter((a) => a.media !== 'audio')
  const addingPills = attaching.filter((a) => a.media === 'audio')

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
      // as send() does: a later suggestion mustn't think the emptied box is still its own
      useChat.setState({ draft: '', chips: [], auto: null })
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
    // back to the words, as after a drop or a paste
    ref.current?.focus()
  }
  /** Taking an attachment off leaves the caret in the box, not on a button that's gone. */
  const unchip = (i: number): void => {
    removeChip(i)
    ref.current?.focus()
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
    if (!take.length) {
      // a pasted screenshot on Home would otherwise vanish without a word
      if (noProject && !text && files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault()
        useChat.setState({
          error: 'To start from a pasted picture, save it as a file and drop it here.'
        })
      }
      return
    }
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
      onDragEnter={(e) => {
        if (fileDrop(e.dataTransfer)) dragDepth.current++
      }}
      onDragOver={(e) => {
        // while the video is being set up, nothing more can be added
        if (!fileDrop(e.dataTransfer) || disabled) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!fileDrop(e.dataTransfer)) return
        // only leaving the whole thing hides the hint; it would flicker over the box's own parts
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setOver(false)
      }}
      onDrop={(e) => {
        dragDepth.current = 0
        setOver(false)
        if (!fileDrop(e.dataTransfer) || disabled) return
        e.preventDefault()
        addFiles([...e.dataTransfer.files])
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
          {media
            ? 'Say what you want, and Luca starts making your video.'
            : 'Describe the video you want, and Luca makes it.'}
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
          <div className={cn('flex flex-wrap gap-2 px-3 pt-3', over && 'opacity-0')}>
            {startFiles.map((f) => (
              <Tile
                key={f.path}
                name={f.name}
                src={startPreviews[f.path] ?? null}
                video={f.kind === 'video'}
                fallback={<KindIcon kind={f.kind} />}
                onRemove={() => {
                  useStart.getState().removeFile(f.path)
                  ref.current?.focus()
                }}
              />
            ))}
          </div>
        ) : null}
        {tiles.length > 0 || addingTiles.length > 0 ? (
          <div className={cn('flex flex-wrap gap-2 px-3 pt-3', over && 'opacity-0')}>
            {tiles.map((t, n) => (
              <Tile
                key={t.key}
                name={t.visual.name}
                // the small still is plenty for a tile, and quick; the file stands in without one
                src={t.visual.thumb ?? t.visual.src}
                video={t.visual.video}
                fallback={<KindIcon kind={t.visual.video ? 'video' : 'image'} />}
                onOpen={() => setView({ index: n, open: true })}
                onRemove={() => unchip(t.i)}
              />
            ))}
            {addingTiles.map((a) => (
              <AddingTile key={a.id} file={a} />
            ))}
          </div>
        ) : null}
        {pills.length > 0 || addingPills.length > 0 ? (
          <div className={cn('flex flex-wrap gap-1 px-3 pt-2.5', over && 'opacity-0')}>
            {pills.map((p) => (
              <ChipPill key={p.key} chip={chips[p.i]} onRemove={() => unchip(p.i)} />
            ))}
            {addingPills.map((a) => (
              <AddingPill key={a.id} file={a} />
            ))}
          </div>
        ) : null}
        {tiles.length > 0 ? (
          <ImageViewer
            items={tiles.map((t) => t.visual)}
            index={view.index}
            open={view.open}
            onIndex={(index) => setView({ index, open: true })}
            onOpenChange={(open) => setView((v) => ({ ...v, open }))}
          />
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
                  ? media
                    ? 'Anything Luca should know? (optional)'
                    : 'Describe the video you want…'
                  : 'Tell Luca what to change…'
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
              {/* pointing needs a video in the preview: Home has none */}
              {noProject ? null : (
                <Tip label="Point at something in the preview" shortcut="G" side="top">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={grab}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleGrab()
                    }}
                    className={cn(
                      'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40',
                      grab
                        ? 'bg-secondary text-secondary-fg'
                        : 'text-text-2 hover:bg-hover hover:text-text'
                    )}
                  >
                    <Crosshair size={13} strokeWidth={1.9} />
                    {grab ? 'Click the preview' : 'Grab'}
                  </button>
                </Tip>
              )}
              <ApprovalsPill disabled={disabled} />
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

/**
 * An attachment as a small square of itself (as in ChatGPT), with × to take it off and a
 * larger look on hover; clicking it opens the viewer when there is one.
 */
function Tile({
  name,
  src,
  video,
  fallback,
  onOpen,
  onRemove
}: {
  name: string
  src: string | null
  video?: boolean
  fallback?: ReactNode
  onOpen?: () => void
  onRemove: () => void
}): ReactElement {
  const picture = (
    <Thumb src={src} alt={name} lazy={false} fallback={fallback} className="size-full">
      {video ? <VideoBadge compact /> : null}
    </Thumb>
  )
  const frame =
    'block size-full overflow-hidden rounded-[10px] border border-border bg-bg-muted shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={350}
        closeDelay={0}
        render={<span className="pop-in group/tile relative block size-[52px] shrink-0" />}
      >
        {onOpen ? (
          <button
            type="button"
            aria-label={`Open ${name}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            className={cn(frame, 'transition-[filter] duration-150 hover:brightness-95')}
          >
            {picture}
          </button>
        ) : (
          <span className={frame} title={name}>
            {picture}
          </span>
        )}
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="absolute -top-1.5 -right-1.5 flex size-[18px] items-center justify-center rounded-full border border-border bg-bg text-text-2 opacity-0 shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-opacity duration-150 group-hover/tile:opacity-100 hover:text-text focus-visible:opacity-100"
        >
          <X size={10} strokeWidth={2.2} />
        </button>
      </PreviewCard.Trigger>
      {src ? (
        <PreviewCard.Portal>
          <PreviewCard.Positioner side="top" sideOffset={8} collisionPadding={8} className="z-50">
            <PreviewCard.Popup className="tip-popup pointer-events-none overflow-hidden rounded-[10px] border border-border bg-bg shadow-popover">
              <img src={src} alt="" className="block max-h-56 max-w-56" />
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      ) : null}
    </PreviewCard.Root>
  )
}

/** A picture or video on its way into the project: a tile with a spinner and how far along. */
function AddingTile({ file }: { file: PendingMedia }): ReactElement {
  const pct = typeof file.progress === 'number' ? Math.round(file.progress * 100) : null
  return (
    <span
      role="status"
      title={file.name}
      aria-label={file.media === 'video' ? 'Getting your video ready' : 'Adding your image'}
      className="pop-in flex size-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[10px] border border-dashed border-border-strong bg-bg-muted text-text-3"
    >
      <LoaderCircle size={15} className="animate-spin" />
      {pct !== null ? <span className="text-[10px] font-medium tabular-nums">{pct}%</span> : null}
    </span>
  )
}

/** An audio file on its way into the project. */
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

/** A start file with no picture (a voiceover, or one still being read): what kind it is. */
function KindIcon({ kind }: { kind: Attachment['kind'] }): ReactElement {
  const Icon = kind === 'audio' ? AudioLines : kind === 'video' ? Clapperboard : ImagePlus
  return (
    <div className="flex h-full w-full items-center justify-center text-text-3">
      <Icon size={14} strokeWidth={1.6} />
    </div>
  )
}

const APPROVAL_MODES: { mode: ApprovalMode; title: string; body: string }[] = [
  {
    mode: 'ask',
    title: 'Ask first',
    body: 'Luca asks before running commands that aren’t on its safe list.'
  },
  {
    mode: 'full',
    title: 'Full access',
    body: 'Every step runs without asking. Edits still stay inside the project folder and media/ and renders/ stay untouched.'
  }
]

/** How Luca's steps are approved: a card for each one, or full access. */
function ApprovalsPill({ disabled }: { disabled: boolean }): ReactElement {
  const mode = useProject((s) => s.settings?.approvals) ?? 'ask'
  const full = mode === 'full'
  const Icon = full ? ShieldAlert : ShieldCheck
  return (
    <Menu.Root>
      <Tip label="How Luca's steps are approved" side="top">
        <Menu.Trigger
          disabled={disabled}
          aria-label="How Luca's steps are approved"
          onMouseDown={(e: MouseEvent) => e.stopPropagation()}
          onClick={(e: MouseEvent) => e.stopPropagation()}
          className={cn(
            // the hint beside it gives way first: the label never wraps under its icon
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40',
            full ? 'text-warning' : 'text-text-2 hover:bg-hover hover:text-text'
          )}
        >
          <Icon size={13} strokeWidth={1.9} />
          {full ? 'Full access' : 'Ask first'}
        </Menu.Trigger>
      </Tip>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="tip-popup min-w-[280px] rounded-[10px] border border-border bg-bg p-1 shadow-popover outline-none">
            <div className="px-2.5 pt-1.5 pb-1 text-[11px] text-text-3">
              How should Luca’s steps be approved?
            </div>
            {APPROVAL_MODES.map((m) => {
              const ItemIcon = m.mode === 'full' ? ShieldAlert : ShieldCheck
              const selected = m.mode === mode
              return (
                <Menu.Item
                  key={m.mode}
                  onClick={() => void useProject.getState().setApprovals(m.mode)}
                  className="flex cursor-default items-start gap-2.5 rounded-[6px] px-2.5 py-2 outline-none data-[highlighted]:bg-hover"
                >
                  <ItemIcon
                    size={13}
                    strokeWidth={1.9}
                    className={cn(
                      'mt-0.5 shrink-0',
                      m.mode === 'full' ? 'text-warning' : 'text-text-3'
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-[12.5px] font-medium',
                        m.mode === 'full' ? 'text-warning' : 'text-text'
                      )}
                    >
                      {m.title}
                    </span>
                    <span className="block text-[11px] leading-[1.4] text-text-3">{m.body}</span>
                  </span>
                  {selected ? <Check size={13} className="mt-0.5 shrink-0 text-text" /> : null}
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
