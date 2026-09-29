import type { ChatMessage } from '@shared/types'
import { ArrowDown, Check, ChevronRight, Copy, LogIn, RotateCcw } from 'lucide-react'
import { memo, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useStickToBottom } from '../../components/ai/use-stick-to-bottom'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/cn'
import { useChat } from '../../stores/chat'
import { useProject } from '../../stores/project'
import { Composer } from './Composer'
import { AssistantMessage, UserMessage } from './Message'
import { LucaAvatar, LucaProfile, Suggestions } from './Profile'
import { QueueTray } from './Queue'
import { VoiceStage } from './VoiceRecorder'

// a streamed reply or a new step re-renders its own message, not the whole conversation
const UserItem = memo(UserMessage)
const AssistantItem = memo(AssistantMessage)

export function Chat(): ReactElement {
  const projectDir = useProject((s) => s.project?.dir ?? null)
  const messages = useChat((s) => s.messages)
  const state = useChat((s) => s.state)
  const detail = useChat((s) => s.detail)
  const bind = useChat((s) => s.bind)
  const load = useChat((s) => s.load)

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
          <Status />
        </div>
      </header>
      {state === 'needs-login' || state === 'missing-claude' ? (
        // pinned above the conversation so it stays in view however long the chat is
        <div className="shrink-0 px-3.5 pt-3">
          <Onboarding state={state} detail={detail} />
        </div>
      ) : null}
      <Messages messages={messages} disabled={!projectDir} />
      <QueueTray />
      <Composer noProject={!projectDir} />
    </section>
  )
}

const STATUS: Record<string, { label: string; dot: string }> = {
  idle: { label: 'Ready', dot: 'bg-text-3' },
  ready: { label: 'Ready', dot: 'bg-success' },
  starting: { label: 'Waking up…', dot: 'bg-accent animate-pulse' },
  working: { label: 'Working…', dot: 'bg-accent animate-pulse' },
  'needs-login': { label: 'Sign in needed', dot: 'bg-warning' },
  'missing-claude': { label: 'Setup needed', dot: 'bg-warning' },
  error: { label: 'Something went wrong', dot: 'bg-danger' }
}

function Status(): ReactElement {
  const state = useChat((s) => s.state)
  const s = STATUS[state] ?? { label: state, dot: 'bg-text-3' }
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-text-3">
      <span className={cn('size-1.5 rounded-full transition-colors', s.dot)} />
      {s.label}
    </span>
  )
}

function Messages({
  messages,
  disabled
}: {
  messages: ChatMessage[]
  disabled: boolean
}): ReactElement {
  const working = useChat((s) => s.state === 'working')
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom()
  // only messages that arrive while the chat is open animate in, not a reloaded history
  const [mountedAt] = useState(() => Date.now())
  const empty = messages.length === 0
  // for Try again: the request each assistant message answered (older history has no replyTo,
  // so fall back to the user message just before it)
  const askedBefore = useMemo(() => {
    const byId = new Map(messages.filter((m) => m.role === 'user').map((m) => [m.id, m]))
    const out = new Map<string, ChatMessage>()
    let asked: ChatMessage | undefined
    for (const m of messages) {
      if (m.role === 'user') asked = m
      else {
        const request = (m.replyTo && byId.get(m.replyTo)) || asked
        if (request) out.set(m.id, request)
      }
    }
    return out
  }, [messages])

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="scroll h-full">
        <div
          ref={contentRef}
          className={cn('flex min-h-full flex-col px-3 pb-4', empty && 'justify-center')}
        >
          <LucaProfile compact={!empty} live={working} />
          {empty ? (
            <div className="mx-auto w-full max-w-[340px] pt-1">
              <Suggestions start={disabled} />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-[10.5px] font-medium text-text-3">
                <span className="h-px flex-1 bg-border" />
                Conversation
                <span className="h-px flex-1 bg-border" />
              </div>
              {messages.map((m) => {
                const animate = new Date(m.createdAt).getTime() > mountedAt - 500
                return m.role === 'user' ? (
                  <UserItem key={m.id} m={m} animate={animate} />
                ) : (
                  <AssistantItem
                    key={m.id}
                    m={m}
                    animate={animate}
                    request={askedBefore.get(m.id)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
      <VoiceStage />
      <button
        type="button"
        aria-label="Scroll to the latest message"
        inert={isAtBottom || empty}
        onClick={() => scrollToBottom()}
        className={cn(
          'absolute bottom-2 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-bg text-text-2 shadow-popover transition-[opacity,transform] duration-200 ease-out hover:text-text',
          isAtBottom || empty
            ? 'pointer-events-none translate-y-3 scale-90 opacity-0'
            : 'translate-y-0 scale-100 opacity-100'
        )}
      >
        <ArrowDown size={14} />
      </button>
    </div>
  )
}

function Onboarding({ state, detail }: { state: string; detail?: string }): ReactElement {
  const signIn = useChat((s) => s.signIn)
  const retry = useChat((s) => s.retry)
  const [cmd, setCmd] = useState('npm install -g @anthropic-ai/claude-code')
  const [copied, setCopied] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    void window.luca.env.installClaudeCommand().then(setCmd)
  }, [])

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      await retry()
    } finally {
      setChecking(false)
    }
  }

  const missing = state === 'missing-claude'
  return (
    <div className="glow-card msg-in mb-1">
      <div className="rounded-[11px] bg-bg p-3.5">
        <div className="flex items-center gap-2.5">
          <LucaAvatar size={28} />
          <div className="text-[13px] font-semibold text-text">
            {missing ? 'One quick install' : 'Connect your Claude account'}
          </div>
        </div>
        <p className="mt-2 text-[12px] leading-[1.5] text-text-2">
          {missing
            ? 'Luca edits with Claude Code. Install it once with the command below (paste it into Terminal), then come back.'
            : 'Luca works with your own Claude subscription. Sign in once in the window that opens; Luca never sees your password.'}
        </p>
        {missing ? (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-[8px] bg-bg-muted py-1 pr-1 pl-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text select-text">
              {cmd}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void navigator.clipboard.writeText(cmd).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1400)
                })
              }
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        ) : null}
        {detail && !missing ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowDetail((d) => !d)}
              className="inline-flex items-center gap-0.5 text-[11px] text-text-3 hover:text-text"
            >
              <ChevronRight
                size={11}
                className={cn('transition-transform', showDetail && 'rotate-90')}
              />
              What Claude said
            </button>
            {showDetail ? (
              <pre className="fade-in mt-1 max-h-16 overflow-auto rounded-[6px] bg-bg-muted p-2 font-mono text-[10.5px] leading-[1.45] whitespace-pre-wrap text-text-2 select-text">
                {detail}
              </pre>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 flex gap-2">
          {missing ? null : (
            <Button variant="primary" onClick={() => void signIn()}>
              <LogIn size={12} /> Sign in
            </Button>
          )}
          <Button
            variant={missing ? 'primary' : 'outline'}
            disabled={checking}
            onClick={() => void check()}
          >
            <RotateCcw size={12} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : missing ? "I've installed it" : "I've signed in"}
          </Button>
        </div>
      </div>
    </div>
  )
}
