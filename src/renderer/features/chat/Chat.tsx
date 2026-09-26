import type { ChatContentPart, ChatMessage, Chip } from '@shared/types'
import {
  Check,
  ChevronRight,
  CircleAlert,
  FileCode2,
  Image as ImageIcon,
  LoaderCircle,
  MousePointer2,
  Package,
  Scissors,
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
import { cn } from '../../lib/cn'
import { catalogChip, hasCatalogDrag, readCatalogDrag } from '../../lib/drag'
import { clock } from '../../lib/timecode'
import { useChat } from '../../stores/chat'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'

export function Chat(): ReactElement {
  const projectDir = useProject((s) => s.project?.dir ?? null)
  const { messages, state, detail, bind, load } = useChat()

  useEffect(() => {
    bind()
  }, [bind])
  useEffect(() => {
    if (projectDir) void load()
  }, [projectDir, load])

  return (
    <section className="flex h-full flex-col bg-panel">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3 text-[12px] font-medium text-text-2">
        <span>Chat</span>
        <StatusDot />
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
    <div className="m-3 rounded-[10px] border border-border bg-bg-muted p-3 text-[12px] leading-[1.5] text-text">
      {state === 'missing-claude' ? (
        <>
          <div className="font-medium">Install Claude Code</div>
          <p className="mt-1 text-text-2">
            Luca drives your own Claude Code binary. Install it, then retry.
          </p>
          <code className="mt-2 block select-text rounded-[6px] bg-bg px-2 py-1 font-mono text-[11px]">
            {cmd}
          </code>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void retry()}>
              Retry
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="font-medium">Sign in to Claude Code</div>
          <p className="mt-1 text-text-2">
            Luca uses your Claude account through the stock{' '}
            <code className="font-mono">claude</code> binary. Sign in opens Terminal running{' '}
            <code className="font-mono">claude /login</code>; Luca never sees your credentials.
          </p>
          {detail ? (
            <pre className="mt-2 max-h-16 select-text overflow-auto whitespace-pre-wrap font-mono text-[10.5px] text-text-3">
              {detail}
            </pre>
          ) : null}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void signIn()}>
              Sign in
            </Button>
            <Button size="sm" onClick={() => void retry()}>
              I signed in, retry
            </Button>
          </div>
        </>
      )}
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
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-[12px] text-text-3">
        <span>Ask Claude to edit your video.</span>
        <span className="text-[11px]">
          “Add a title that says Hello”, “Make the captions bigger”, “Cut the first 2 seconds”.
        </span>
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
    <div className="rounded-[6px] text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left text-text-2 hover:bg-hover"
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 transition-transform', open && 'rotate-90')}
        />
        {part.status === 'running' ? (
          <LoaderCircle size={12} className="shrink-0 animate-spin text-accent" />
        ) : part.status === 'error' ? (
          <CircleAlert size={12} className="shrink-0 text-danger" />
        ) : (
          <Check size={12} className="shrink-0 text-[#34C759]" />
        )}
        <span className="truncate">{part.summary}</span>
      </button>
      {open && part.detail ? (
        <pre className="mx-1.5 mb-1 max-h-60 select-text overflow-auto whitespace-pre-wrap rounded-[6px] bg-bg-muted p-2 font-mono text-[11px] leading-[1.45] text-text-2">
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

function Composer({ disabled }: { disabled: boolean }): ReactElement {
  const { draft, setDraft, chips, addChip, removeChip, send, stop, state, error } = useChat()
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
  }, [draft])

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
      className={cn('shrink-0 border-t border-border p-2', over && 'bg-accent/8')}
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
      {error ? (
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-danger">
          <CircleAlert size={12} />{' '}
          {error.replace(/^Error invoking remote method '[^']+': Error: /, '')}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1 px-1">
          {chips.map((c, i) => (
            <ChipPill key={i} chip={c} onRemove={() => removeChip(i)} />
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-1.5 rounded-[10px] border border-border bg-bg px-2 py-1.5 focus-within:border-accent">
        <textarea
          ref={ref}
          id="chat-composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? 'Open a project to chat' : 'Ask Claude…'}
          className="flex-1 resize-none select-text bg-transparent text-[13px] leading-[19px] text-text outline-none placeholder:text-text-3"
        />
        {working ? (
          <GenerateButton
            size="sm"
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
            size="sm"
            hue={210}
            label="Send"
            generatingLabel="Sending"
            disabled={disabled || !draft.trim()}
            onClick={submit}
            title="Send (↩)"
          />
        )}
      </div>
    </div>
  )
}
