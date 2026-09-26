import { ArrowUp, CircleAlert, Crosshair, Square, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { catalogChip, hasCatalogDrag, readCatalogDrag } from '../../lib/drag'
import { useChat } from '../../stores/chat'
import { usePlayer } from '../../stores/player'
import { ChipPill } from './Message'

const LINE = 20
const MAX_LINES = 8

/**
 * The message box (prompt-kit PromptInput): grows with the text, Enter sends, Shift+Enter adds a
 * line. Focus is shown by a firmer edge and a soft lift rather than a coloured ring.
 */
export function Composer({ disabled }: { disabled: boolean }): ReactElement {
  const { draft, setDraft, chips, addChip, removeChip, send, stop, state, error } = useChat()
  const [over, setOver] = useState(false)
  const currentTime = usePlayer((s) => s.currentTime)
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)
  const ref = useRef<HTMLTextAreaElement>(null)
  const working = state === 'working'
  const hasText = draft.trim().length > 0

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, LINE * 2), LINE * MAX_LINES + 8)}px`
  }, [draft])

  const submit = (): void => {
    const text = draft.trim()
    if (!text || disabled) return
    void send(text, { time: currentTime })
  }
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
        <div className="fade-in mb-2 flex items-start gap-2 rounded-[10px] border border-danger/20 bg-danger/[0.06] px-2.5 py-2 text-[11.5px] leading-[1.45] text-text">
          <CircleAlert size={13} className="mt-px shrink-0 text-danger" />
          <span className="flex-1 select-text">
            {error.replace(/^Error invoking remote method '[^']+': Error: /, '')}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => useChat.setState({ error: null })}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-text-3 hover:bg-hover hover:text-text"
          >
            <X size={11} />
          </button>
        </div>
      ) : null}
      <div
        onClick={() => !disabled && ref.current?.focus()}
        className={cn(
          'relative cursor-text rounded-[16px] border bg-input transition-[border-color,box-shadow,background-color] duration-200 ease-out',
          'border-border shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
          'focus-within:border-border-strong focus-within:shadow-[0_6px_20px_-6px_rgba(0,0,0,0.14),0_1px_2px_rgba(0,0,0,0.05)]',
          'dark:focus-within:shadow-[0_6px_20px_-6px_rgba(0,0,0,0.6)]',
          over && 'border-dashed border-accent bg-accent/[0.04]',
          disabled && 'cursor-default opacity-70'
        )}
      >
        {over ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[16px] text-[12px] font-medium text-accent">
            Drop to show it to Luca
          </div>
        ) : null}
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-3 pt-2.5">
            {chips.map((c, i) => (
              <ChipPill key={i} chip={c} onRemove={() => removeChip(i)} />
            ))}
          </div>
        ) : null}
        <textarea
          ref={ref}
          id="chat-composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? 'Open a project to start' : 'Ask Luca to edit your video…'}
          className={cn(
            'block w-full resize-none bg-transparent px-3.5 pt-2.5 text-[13px] leading-[20px] text-text placeholder:text-text-3 select-text',
            over && 'opacity-0'
          )}
        />
        <div className="flex items-center gap-1 px-2 pt-0.5 pb-2">
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
          <span className="ml-auto pr-1 text-[10.5px] text-text-3">
            {working && hasText ? 'Luca will read this next' : hasText ? '↩ to send' : ''}
          </span>
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
            <Tip label="Send" shortcut="↩" side="top">
              <button
                type="button"
                aria-label="Send"
                disabled={disabled || !hasText}
                onClick={(e) => {
                  e.stopPropagation()
                  submit()
                }}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full transition-[background-color,color,transform,box-shadow] duration-200 ease-out active:scale-90',
                  hasText && !disabled
                    ? 'bg-accent text-accent-fg shadow-[0_2px_8px_-2px_color-mix(in_srgb,var(--accent)_60%,transparent)]'
                    : 'bg-bg-muted text-text-3'
                )}
              >
                <ArrowUp size={15} strokeWidth={2.25} />
              </button>
            </Tip>
          )}
        </div>
      </div>
    </div>
  )
}
