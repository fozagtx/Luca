import type { Ai33Voice, Ai33VoiceTier } from '@shared/ai33'
import { Check } from 'lucide-react'
import {
  Fragment,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { PlayVoiceButton } from './AudioPreview'
import { canPreview, togglePreview } from './preview-player'
import { NO_SAMPLE, keepKeyLocal, tierOf, unusableReason, voiceLine } from './voice-meta'

export type VoiceGroup = {
  key: string
  /** Set when the group gets a heading (with what the tier means). */
  tier?: Ai33VoiceTier
  voices: Ai33Voice[]
}

export type VoiceListProps = {
  groups: VoiceGroup[]
  ariaLabel: string
  /** "Use this voice" on a row. */
  onUse(v: Ai33Voice): void
  useLabel: string
  /** Replaces the button on the voice that is in use or was just chosen. */
  chosenLabel: string
  selectedId?: string
  /** The script's language: a Standard voice in another language is greyed out. */
  language?: string
  /** Headings with the tier tooltips, instead of a tier tag on every row. */
  headings?: boolean
  /** Arrow Up on the first row. */
  onLeaveTop?(): void
  className?: string
}

const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])

/**
 * A listbox of voices with one row in the tab order: Arrow keys, Home and End move between rows,
 * Space hears the voice, Enter uses it. Each row also has a play button and a Use button for the
 * mouse, which the keys make redundant, so they stay out of the tab order.
 */
export function VoiceList({
  groups,
  ariaLabel,
  onUse,
  useLabel,
  chosenLabel,
  selectedId,
  language,
  headings = false,
  onLeaveTop,
  className
}: VoiceListProps): ReactElement {
  const root = useRef<HTMLDivElement>(null)
  const ids = useId()
  const [focused, setFocused] = useState<string | null>(null)

  const all = groups.flatMap((g) => g.voices)
  // the row that takes Tab: the one last focused, else the chosen one, else the first
  const tabbable =
    all.find((v) => v.id === focused)?.id ?? all.find((v) => v.id === selectedId)?.id ?? all[0]?.id

  const move = (from: HTMLElement, key: string): void => {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const at = rows.indexOf(from.closest<HTMLElement>('[role="option"]') ?? from)
    if (key === 'ArrowUp' && at <= 0) {
      onLeaveTop?.()
      return
    }
    const to =
      key === 'Home'
        ? 0
        : key === 'End'
          ? rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, at + (key === 'ArrowDown' ? 1 : -1)))
    rows[to]?.focus()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>, v: Ai33Voice): void => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      // Space and Enter mean hear and use only on the row itself; on a button they press it
      const onRow = (e.target as HTMLElement).getAttribute('role') === 'option'
      if (NAV_KEYS.has(e.key)) {
        e.preventDefault()
        move(e.target as HTMLElement, e.key)
      } else if (onRow && e.key === 'Enter') {
        e.preventDefault()
        if (!unusableReason(v, language)) onUse(v)
      } else if (onRow && e.key === ' ') {
        e.preventDefault()
        if (v.previewable && canPreview(v.id)) void togglePreview(v.id)
      }
    }
    keepKeyLocal(e)
  }

  return (
    <div
      ref={root}
      role="listbox"
      aria-label={ariaLabel}
      className={cn('flex flex-col', className)}
    >
      {groups.map((g) => {
        const tier = headings && g.tier ? tierOf(g.tier) : null
        const heading = `${ids}-${g.key}`
        const rows = g.voices.map((v) => (
          <VoiceRow
            key={v.id}
            voice={v}
            tag={!headings}
            tabbable={v.id === tabbable}
            chosen={v.id === selectedId}
            chosenLabel={chosenLabel}
            useLabel={useLabel}
            blocked={unusableReason(v, language)}
            onFocus={() => setFocused(v.id)}
            onKeyDown={(e) => onKeyDown(e, v)}
            onUse={() => onUse(v)}
          />
        ))
        return tier ? (
          <div key={g.key} role="group" aria-labelledby={heading}>
            <Tip label={tier.hint} side="top">
              <div
                id={heading}
                className="w-fit px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-text-3 uppercase"
              >
                {tier.label}
              </div>
            </Tip>
            {rows}
          </div>
        ) : (
          <Fragment key={g.key}>{rows}</Fragment>
        )
      })}
    </div>
  )
}

function VoiceRow({
  voice: v,
  tag,
  tabbable,
  chosen,
  chosenLabel,
  useLabel,
  blocked,
  onFocus,
  onKeyDown,
  onUse
}: {
  voice: Ai33Voice
  /** The tier as a small tag after the name. */
  tag: boolean
  tabbable: boolean
  chosen: boolean
  chosenLabel: string
  useLabel: string
  /** Why this voice can't be used, or null. */
  blocked: string | null
  onFocus(): void
  onKeyDown(e: ReactKeyboardEvent<HTMLElement>): void
  onUse(): void
}): ReactElement {
  const tier = tierOf(v.tier)
  const line = voiceLine(v)
  return (
    <div
      role="option"
      aria-selected={chosen}
      aria-disabled={blocked ? true : undefined}
      aria-label={`${v.name}. ${line}. ${tier.label} voice.${blocked ? ` ${blocked}` : ''}`}
      tabIndex={tabbable ? 0 : -1}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={cn(
        'flex items-center gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-hover focus-visible:bg-hover',
        chosen && 'bg-secondary hover:bg-secondary'
      )}
    >
      <PlayVoiceButton
        voiceId={v.id}
        label={`Hear ${v.name}`}
        disabledReason={v.previewable ? undefined : NO_SAMPLE}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      />
      <div className="min-w-0 flex-1">
        <div className={cn(blocked && 'opacity-70')}>
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-text">{v.name}</span>
            {tag ? (
              <Tip label={tier.hint} side="top">
                <span className="shrink-0 rounded-[4px] bg-bg-muted px-1 py-px text-[10px] font-medium text-text-2">
                  {tier.label}
                </span>
              </Tip>
            ) : null}
          </div>
          <div className="truncate text-[11px] text-text-3" title={line}>
            {line}
          </div>
        </div>
        {blocked ? <div className="text-[10.5px] leading-[1.35] text-text-2">{blocked}</div> : null}
      </div>
      {chosen ? (
        <span className="inline-flex shrink-0 items-center gap-1 pr-1 text-[11px] font-medium text-secondary-fg">
          <Check size={12} strokeWidth={2.25} aria-hidden /> {chosenLabel}
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          tabIndex={-1}
          disabled={blocked !== null}
          onClick={onUse}
          className="shrink-0"
        >
          {useLabel}
        </Button>
      )}
    </div>
  )
}

/** Rows that stand in for voices while they load. */
export function VoiceSkeleton({ rows = 6 }: { rows?: number }): ReactElement {
  return (
    <div className="flex flex-col" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <div className="skeleton size-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="skeleton h-2.5 w-2/5 rounded-[3px]" />
            <div className="skeleton mt-1.5 h-2 w-3/5 rounded-[3px]" />
          </div>
          <div className="skeleton h-6 w-12 shrink-0 rounded-[5px]" />
        </div>
      ))}
    </div>
  )
}
