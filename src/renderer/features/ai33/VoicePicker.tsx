import type { VoiceRef } from '@shared/ai33'
import { Popover } from '@base-ui/react/popover'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { useAi33 } from '../../stores/ai33'
import { stopPreview } from './preview-player'
import { keepKeyLocal } from './voice-meta'
import { VoicePanel } from './VoicePanel'

export type VoicePickerProps = {
  value: VoiceRef | null
  onChange(v: VoiceRef): void
  /** Voices for this language first. */
  language?: string
  /**
   * Set when the caller has its own "More voices…" button and opens the picker from it: the
   * popover then opens beside the element just before it. Left out, the picker brings its own.
   */
  open?: boolean
  onOpenChange?(open: boolean): void
}

/** Search, filter and hear every voice, and pick one (the start card's "More voices…"). */
export function VoicePicker({
  value,
  onChange,
  language,
  open: openProp,
  onOpenChange
}: VoicePickerProps): ReactElement {
  const hasKey = useAi33((s) => s.hasKey)
  const checkKey = useAi33((s) => s.checkKey)
  const [inner, setInner] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const marker = useRef<HTMLSpanElement>(null)
  const ownButton = openProp === undefined
  const open = openProp ?? inner

  useEffect(() => {
    if (hasKey === null) void checkKey()
  }, [hasKey, checkKey])

  // the caller's button sits right before this component; the marker itself is the fallback
  const opener = (): HTMLElement | null => {
    const before = marker.current?.previousElementSibling
    return before instanceof HTMLElement ? before : marker.current
  }

  const setOpen = (next: boolean, e?: Event): void => {
    if (!next && e && !ownButton) {
      // pressing the caller's own button is not a click outside: it is how it stays open
      const from = (e as FocusEvent).relatedTarget ?? e.target
      if (from instanceof Node && opener()?.contains(from)) return
    }
    setInner(next)
    onOpenChange?.(next)
    // a sample doesn't play on after the list it belongs to is gone
    if (!next) stopPreview()
  }

  return (
    <Popover.Root open={open} onOpenChange={(next, details) => setOpen(next, details.event)}>
      {ownButton ? (
        <OwnButton disabled={hasKey === false} active={open} />
      ) : (
        <span ref={marker} aria-hidden className="pointer-events-none absolute size-0" />
      )}
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={8}
          align="start"
          anchor={ownButton ? undefined : opener}
          className="no-drag z-50"
        >
          <Popover.Popup
            initialFocus={search}
            finalFocus={ownButton ? undefined : opener}
            onKeyDown={keepKeyLocal}
            className={cn(
              'flex max-h-[min(500px,75vh)] w-[360px] flex-col rounded-[10px] border border-border bg-bg pt-3 text-[11.5px] leading-[1.45] text-text-2 shadow-popover outline-none',
              'transition-[transform,opacity] duration-150 ease-[cubic-bezier(.2,.8,.2,1)]',
              'data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
            )}
          >
            <Popover.Title className="px-3 pb-2 text-[13px] font-semibold text-text">
              Choose a voice
            </Popover.Title>
            <VoicePanel
              value={value}
              language={language}
              searchRef={search}
              onPick={(v) => {
                onChange({ id: v.id, name: v.name, language: v.language || undefined })
                setOpen(false)
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The picker's own button, greyed out until ai33 is connected. */
function OwnButton({ disabled, active }: { disabled: boolean; active: boolean }): ReactElement {
  const button = (
    <Popover.Trigger
      disabled={disabled}
      render={<Button variant="ghost" size="sm" active={active} className="no-drag" />}
    >
      More voices…
    </Popover.Trigger>
  )
  return disabled ? (
    <Tip label="Connect ai33 first">
      <span className="inline-flex">{button}</span>
    </Tip>
  ) : (
    button
  )
}
