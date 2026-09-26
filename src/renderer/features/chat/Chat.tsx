import type { ChatContentPart, ChatMessage, Chip } from '@shared/types'
import {
  AtSign,
  AudioLines,
  ChevronRight,
  CircleAlert,
  FileCode2,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  MousePointer2,
  Package,
  Scissors,
  Sparkles,
  Square,
  Type,
  X
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { Button } from '../../components/ui/button'
import { GenerateButton } from '../../components/ui/generate-button'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { catalogChip, hasCatalogDrag, readCatalogDrag } from '../../lib/drag'
import { clock } from '../../lib/timecode'
import { useChat } from '../../stores/chat'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useVoice } from '../../stores/voice'
import { AssemblyAiKeyCard } from '../onboarding/AssemblyAiKeyCard'
import { VoiceRecorder } from './VoiceRecorder'

export function Chat(): ReactElement {
  const projectDir = useProject((s) => s.project?.dir ?? null)
  const { messages, state, detail, bind, load } = useChat()

  useEffect(() => {
    bind()
  }, [bind])
  useEffect(() => {
    void load()
  }, [projectDir, load])

  return (
    <section className="flex h-full flex-col bg-panel">
      <header className="panel-head shrink-0">
        <span className="panel-title">Chat</span>
        <div className="ml-auto">
          <StatusDot />
        </div>
      </header>
      {state === 'needs-login' || state === 'missing-claude' ? (
        <Onboarding state={state} detail={detail} />
      ) : null}
      <Messages messages={messages} />
      <Composer disabled={!projectDir} />
    </section>
  )
}

function StatusDot(): ReactElement {
  const state = useChat((s) => s.state)
  const label: Record<string, string> = {
    idle: 'Idle',
    starting: 'Starting Claude…',
    ready: 'Claude ready',
    working: 'Working…',
    'needs-login': 'Sign in required',
    'missing-claude': 'Claude Code not installed',
    error: 'Error'
  }
  const color =
    state === 'ready'
      ? 'bg-[#34C759]'
      : state === 'working' || state === 'starting'
        ? 'bg-accent animate-pulse'
        : state === 'idle'
          ? 'bg-text-3'
          : 'bg-[#FF9500]'
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-normal text-text-3">
      <span className={cn('size-1.5 rounded-full', color)} />
      {label[state] ?? state}
    </span>
  )
}

function Onboarding({ state, detail }: { state: string; detail?: string }): ReactElement {
  const { signIn, retry } = useChat()
  const [cmd, setCmd] = useState('npm install -g @anthropic-ai/claude-code')
  useEffect(() => {
    void window.luca.env.installClaudeCommand().then(setCmd)
  }, [])
  return (
    <div className="glow-card m-3">
      <div className="rounded-[11px] bg-bg p-3.5 text-[12px] leading-[1.5] text-text">
        {state === 'missing-claude' ? (
          <>
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <span className="flex size-6 items-center justify-center rounded-[6px] bg-secondary text-secondary-fg">
                <Sparkles size={13} />
              </span>
              Install Claude Code
            </div>
            <p className="mt-1 text-text-2">
              Luca drives your own Claude Code binary. Install it, then retry.
            </p>
            <code className="mt-2 block select-text rounded-[6px] bg-bg px-2 py-1 font-mono text-[11px]">
              {cmd}
            </code>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={() => void retry()}>
                Retry
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <span className="flex size-6 items-center justify-center rounded-[6px] bg-secondary text-secondary-fg">
                <Sparkles size={13} />
              </span>
              Sign in to Claude Code
            </div>
            <p className="mt-1 text-text-2">
              Luca uses your Claude account through the stock{' '}
              <code className="font-mono">claude</code> binary. Sign in opens Terminal running{' '}
              <code className="font-mono">claude /login</code>; Luca never sees your credentials.
            </p>
            {detail ? (
              <div className="mt-2.5 flex items-start gap-2 rounded-[8px] border border-danger/25 bg-danger/8 px-2.5 py-2 text-danger">
                <CircleAlert size={13} className="mt-px shrink-0" />
                <pre className="max-h-16 min-w-0 flex-1 select-text overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-[1.45]">
                  {detail}
                </pre>
              </div>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={() => void signIn()}>
                Sign in
              </Button>
              <Button variant="outline" onClick={() => void retry()}>
                I signed in, retry
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Messages({ messages }: { messages: ChatMessage[] }): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages])
  const onScroll = (): void => {
    const el = ref.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-secondary text-secondary-fg">
          <Sparkles size={16} />
        </span>
        <div>
          <div className="text-[13px] font-medium text-text">Ask Claude to edit your video</div>
          <div className="mt-1 text-[11.5px] leading-[1.5] text-text-3">
            “Add a title that says Hello” · “Make the captions bigger” · “Cut the first 2 seconds”
          </div>
        </div>
      </div>
    )
  }
  return (
    <div ref={ref} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-3">
        {messages.map((m) =>
          m.role === 'user' ? <UserBubble key={m.id} m={m} /> : <Assistant key={m.id} m={m} />
        )}
      </div>
    </div>
  )
}

function UserBubble({ m }: { m: ChatMessage }): ReactElement {
  return (
    <div className="ml-6 rounded-[10px] bg-bg-muted px-3 py-2 text-[13px] leading-[1.55] text-text">
      {m.chips && m.chips.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {m.chips.map((c, i) => (
            <ChipPill key={i} chip={c} />
          ))}
        </div>
      ) : null}
      <div className="select-text whitespace-pre-wrap">{m.text}</div>
    </div>
  )
}

function Assistant({ m }: { m: ChatMessage }): ReactElement {
  const parts =
    m.parts && m.parts.length > 0
      ? m.parts
      : m.text
        ? [{ type: 'text', text: m.text } as const]
        : []
  return (
    <div className="flex flex-col gap-1.5">
      {parts.map((p, i) => (
        <Part key={i} part={p} />
      ))}
      {m.pending && parts.length === 0 ? (
        <div className="flex items-center gap-1.5 text-[12px] text-text-3">
          <LoaderCircle size={12} className="animate-spin" /> Thinking…
        </div>
      ) : null}
      {m.isError && !m.pending ? (
        <div className="flex items-center gap-1.5 text-[11px] text-danger">
          <CircleAlert size={12} /> The turn ended with an error.
        </div>
      ) : null}
    </div>
  )
}

function Part({ part }: { part: ChatContentPart }): ReactElement {
  if (part.type === 'text') {
    return (
      <div className="select-text whitespace-pre-wrap text-[13px] leading-[1.55] text-text">
        {part.text}
      </div>
    )
  }
  if (part.type === 'tool') return <ToolRow part={part} />
  return <PermissionCard part={part} />
}

function ToolRow({ part }: { part: Extract<ChatContentPart, { type: 'tool' }> }): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-[6px] border border-border bg-bg-subtle py-[3px] pr-2 pl-1.5 text-left font-mono text-[11px] text-text-2 transition-colors hover:bg-hover',
          open && 'rounded-b-none'
        )}
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            part.status === 'running'
              ? 'animate-pulse bg-accent'
              : part.status === 'error'
                ? 'bg-danger'
                : 'bg-success'
          )}
        />
        <span className="shrink-0 font-medium text-text-2">{part.name}</span>
        <span className="truncate text-text-3">{part.summary}</span>
        {part.detail ? (
          <ChevronRight
            size={11}
            className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-90')}
          />
        ) : null}
      </button>
      {open && part.detail ? (
        <pre className="max-h-60 select-text overflow-auto whitespace-pre-wrap rounded-[6px] rounded-tl-none border border-border bg-bg-subtle p-2 font-mono text-[11px] leading-[1.45] text-text-2">
          {part.detail}
        </pre>
      ) : null}
    </div>
  )
}

function PermissionCard({
  part
}: {
  part: Extract<ChatContentPart, { type: 'permission' }>
}): ReactElement {
  const decide = useChat((s) => s.decide)
  const input = part.input as Record<string, unknown>
  const detail = part.tool === 'Bash' ? String(input.command ?? '') : JSON.stringify(input, null, 2)
  return (
    <div className="rounded-[10px] border border-border bg-bg-muted p-2.5 text-[12px]">
      <div className="mb-1 font-medium text-text">Claude wants to run {part.tool}</div>
      <pre className="max-h-40 select-text overflow-auto whitespace-pre-wrap rounded-[6px] bg-bg p-2 font-mono text-[11px] leading-[1.45] text-text-2">
        {detail}
      </pre>
      {part.resolved ? (
        <div className="mt-1.5 text-[11px] text-text-3">
          {part.resolved === 'deny'
            ? 'Denied'
            : part.resolved === 'allow-always'
              ? 'Always allowed in this project'
              : 'Allowed once'}
        </div>
      ) : (
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="primary" onClick={() => void decide(part.id, 'allow')}>
            Allow once
          </Button>
          <Button size="sm" onClick={() => void decide(part.id, 'allow-always')}>
            Always allow in this project
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void decide(part.id, 'deny')}>
            Deny
          </Button>
        </div>
      )}
    </div>
  )
}

function chipIcon(chip: Chip): ReactElement {
  switch (chip.kind) {
    case 'element':
      return <MousePointer2 size={12} />
    case 'frame':
      return <ImageIcon size={12} />
    case 'catalog':
      return <Package size={12} />
    case 'clip':
      return <Scissors size={12} />
    case 'transcript':
      return <Type size={12} />
    default:
      return <FileCode2 size={12} />
  }
}

function chipLabel(chip: Chip): string {
  switch (chip.kind) {
    case 'element':
      return chip.selector
    case 'frame':
      return `Frame ${clock(chip.time)}`
    case 'catalog':
      return chip.title || chip.name
    case 'clip':
      return chip.clipId
    case 'transcript':
      return `“${chip.text.slice(0, 24)}${chip.text.length > 24 ? '…' : ''}”`
  }
}

export function ChipPill({ chip, onRemove }: { chip: Chip; onRemove?: () => void }): ReactElement {
  return (
    <span className="group relative inline-flex h-[22px] items-center gap-1 rounded-full border border-border bg-bg px-2 text-[11px] text-text-2">
      {chipIcon(chip)}
      <span className="max-w-40 truncate">{chipLabel(chip)}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded-full text-text-3 hover:text-text"
        >
          <X size={11} />
        </button>
      ) : null}
      {chip.kind === 'frame' ? (
        <img
          src={`data:image/png;base64,${chip.png}`}
          alt=""
          className="pointer-events-none absolute bottom-7 left-0 hidden w-40 rounded-[6px] border border-border shadow-md group-hover:block"
        />
      ) : null}
    </span>
  )
}

function ErrorNote({ text, onDismiss }: { text: string; onDismiss?: () => void }): ReactElement {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-[8px] border border-danger/25 bg-danger/8 px-2.5 py-1.5 text-[11.5px] leading-[1.4] text-danger">
      <CircleAlert size={13} className="mt-px shrink-0" />
      <span className="flex-1 select-text">
        {text.replace(/^Error invoking remote method '[^']+': Error: /, '')}
      </span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="mt-px shrink-0" aria-label="Dismiss">
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}

function Composer({ disabled }: { disabled: boolean }): ReactElement {
  const { draft, setDraft, chips, addChip, removeChip, send, stop, state, error } = useChat()
  const voiceMode = useVoice((s) => s.mode)
  const voiceError = useVoice((s) => s.error)
  const needsKey = useVoice((s) => s.needsKey)
  const startVoice = useVoice((s) => s.start)
  const dismissVoice = useVoice((s) => s.dismiss)
  const [over, setOver] = useState(false)
  const currentTime = usePlayer((s) => s.currentTime)
  const ref = useRef<HTMLTextAreaElement>(null)
  const working = state === 'working'

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    const line = 19
    el.style.height = `${Math.min(Math.max(el.scrollHeight, line), line * 8 + 8)}px`
  }, [draft, voiceMode])

  const submit = (): void => {
    const text = draft.trim()
    if (!text || disabled) return
    void send(text, { time: currentTime })
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      className="shrink-0 border-t border-border p-2.5"
      onDragOver={(e) => {
        if (!hasCatalogDrag(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const d = readCatalogDrag(e.dataTransfer)
        if (!d) return
        e.preventDefault()
        addChip(catalogChip(d))
        ref.current?.focus()
      }}
    >
      {error ? <ErrorNote text={error} /> : null}
      {voiceError ? <ErrorNote text={voiceError} onDismiss={dismissVoice} /> : null}
      {needsKey ? (
        <AssemblyAiKeyCard
          className="mb-2"
          onDismiss={dismissVoice}
          onSaved={(ok) => {
            if (ok) void startVoice(needsKey)
          }}
        >
          Voice input streams your microphone to AssemblyAI’s real-time speech-to-text while you
          talk. The key is stored in the macOS Keychain (safeStorage).
        </AssemblyAiKeyCard>
      ) : null}
      <div
        className={cn(
          'rounded-[10px] border transition-[border-color,box-shadow] duration-150',
          'focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]',
          // cn() doesn't merge, so pick one of each conflicting utility
          over || voiceMode ? 'border-accent' : 'border-border',
          over ? 'bg-accent/5' : 'bg-input',
          voiceMode
            ? 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]'
            : 'shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
        )}
      >
        <div className="flex flex-wrap items-center gap-1 px-2 pt-2">
          {chips.map((c, i) => (
            <ChipPill key={i} chip={c} onRemove={() => removeChip(i)} />
          ))}
          <span className="inline-flex h-[22px] items-center gap-1 rounded-full px-1.5 text-[10.5px] text-text-3">
            <AtSign size={11} />
            {chips.length === 0 ? 'Grab an element or frame, or drop a catalog item' : 'Context'}
          </span>
        </div>
        {voiceMode ? (
          <VoiceRecorder />
        ) : (
          <div className="flex items-end gap-2 px-2 pt-1 pb-2">
            <textarea
              ref={ref}
              id="chat-composer"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              disabled={disabled}
              rows={1}
              placeholder={disabled ? 'Open a project to chat' : 'Ask Claude to edit…'}
              className="flex-1 resize-none select-text bg-transparent px-1 pb-1.5 text-[13px] leading-[19px] text-text outline-none placeholder:text-text-3"
            />
            <div className="flex h-8 shrink-0 items-center">
              <Tip label="Dictate" side="top">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={disabled}
                  onClick={() => void startVoice('dictate')}
                  aria-label="Dictate"
                >
                  <Mic size={15} />
                </button>
              </Tip>
              <Tip label="Voice mode: talk with Claude" side="top">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={disabled}
                  onClick={() => void startVoice('converse')}
                  aria-label="Voice mode"
                >
                  <AudioLines size={15} />
                </button>
              </Tip>
            </div>
            {working ? (
              <GenerateButton
                hue={210}
                generating
                label="Send"
                generatingLabel="Stop"
                icon={<Square size={10} fill="currentColor" />}
                onClick={() => void stop()}
                title="Stop"
              />
            ) : (
              <GenerateButton
                hue={210}
                label="Send"
                generatingLabel="Sending"
                disabled={disabled || !draft.trim()}
                onClick={submit}
                title="Send (↩)"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
