import { Captions, Scissors, Sparkles, Type, Undo2, Wand2, type LucideIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import avatar from '../../assets/luca-avatar.png'
import { cn } from '../../lib/cn'
import { useChat } from '../../stores/chat'

export function LucaAvatar({
  size = 40,
  live = false,
  className
}: {
  size?: number
  live?: boolean
  className?: string
}): ReactElement {
  return (
    <span
      className={cn('relative inline-flex shrink-0', live && 'avatar-live', className)}
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
    >
      <img
        src={avatar}
        alt="Luca"
        draggable={false}
        className="h-full w-full object-cover shadow-[0_4px_14px_rgba(0,0,0,0.16)]"
        style={{ borderRadius: size * 0.28 }}
      />
    </span>
  )
}

const facts: { icon: LucideIcon; label: string }[] = [
  { icon: Scissors, label: 'Edits your video' },
  { icon: Sparkles, label: 'Adds titles & effects' },
  { icon: Undo2, label: 'Every change can be undone' }
]

/** Luca's profile, shown once at the top of the conversation. */
export function LucaProfile({ compact, live }: { compact: boolean; live: boolean }): ReactElement {
  return (
    <div
      className={cn('flex flex-col items-center text-center', compact ? 'pt-3 pb-4' : 'pt-2 pb-5')}
    >
      <LucaAvatar size={compact ? 44 : 64} live={live} />
      <div
        className={cn(
          'mt-2.5 font-semibold tracking-[-0.01em] text-text',
          compact ? 'text-[14px]' : 'text-[17px]'
        )}
      >
        Luca
      </div>
      <div className="mt-0.5 text-[12px] text-text-2">Your video editing partner</div>
      <div className="mt-2.5 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {facts.map((f) => (
          <span key={f.label} className="inline-flex items-center gap-1 text-[11px] text-text-3">
            <f.icon size={11} strokeWidth={1.75} />
            {f.label}
          </span>
        ))}
      </div>
    </div>
  )
}

const suggestions: { icon: LucideIcon; text: string }[] = [
  { icon: Type, text: 'Add a title that says Hello' },
  { icon: Captions, text: 'Add captions to the whole video' },
  { icon: Scissors, text: 'Cut the first 2 seconds' },
  { icon: Wand2, text: 'Add a lower third with my name' }
]

/** Starter prompts (prompt-kit PromptSuggestion). They fill the box so people can adjust first. */
export function Suggestions({ disabled }: { disabled: boolean }): ReactElement {
  const fillDraft = useChat((s) => s.fillDraft)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-1 pb-0.5 text-[11px] font-medium text-text-3">Try asking</div>
      {suggestions.map((s, i) => (
        <button
          key={s.text}
          type="button"
          disabled={disabled}
          onClick={() => {
            fillDraft(s.text)
            requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
          }}
          style={{ animationDelay: `${80 + i * 50}ms` }}
          className="msg-in group flex w-full items-center gap-2.5 rounded-[10px] border border-border bg-bg px-3 py-2 text-left text-[12.5px] text-text-2 shadow-[0_1px_1px_rgba(0,0,0,0.03)] transition-[background-color,border-color,color,transform] duration-150 hover:border-border-strong hover:text-text active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
        >
          <s.icon
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-text-3 transition-colors group-hover:text-accent"
          />
          {s.text}
        </button>
      ))}
    </div>
  )
}
