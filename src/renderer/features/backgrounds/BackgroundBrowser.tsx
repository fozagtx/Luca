import type { Aspect, Background } from '@shared/types'
import { Check, Film, Plus, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement, type WheelEvent } from 'react'
import { Button } from '../../components/ui/button'
import { Segmented, type SegmentedItem } from '../../components/ui/segmented'
import { Thumb } from '../../components/ui/thumb'
import { cn } from '../../lib/cn'
import { formatDuration } from '../../lib/format'
import {
  TOPICS,
  useBackgroundOrientation,
  useBackgrounds,
  type BackgroundFilter
} from '../../stores/backgrounds'
import { useUi } from '../../stores/ui'
import { EmptyPane } from '../sidebar/EmptyPane'
import { PexelsKeyCard } from './PexelsKeyCard'

const FILTERS: SegmentedItem<BackgroundFilter>[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Videos' },
  { id: 'photo', label: 'Photos' }
]

const SHAPE: Record<Aspect, string> = {
  landscape: 'aspect-video',
  portrait: 'aspect-[9/16]',
  square: 'aspect-square'
}

const GRID = { 2: 'grid-cols-2', 3: 'grid-cols-3' } as const

/**
 * Pexels photos and short videos, shaped like the video they're for: search or pick a topic,
 * filter to videos or photos, hover a video to watch it, click to use it.
 */
export function BackgroundBrowser({
  columns = 2,
  onPick,
  pickedId,
  hint,
  autoFocus
}: {
  columns?: 2 | 3
  onPick: (b: Background) => void
  /** The background already chosen, marked in the grid. */
  pickedId?: string
  /** What clicking does, shown in the footer. */
  hint?: string
  autoFocus?: boolean
}): ReactElement {
  const orientation = useBackgroundOrientation()
  const { hasKey, query, media, items, loading, error, hasMore } = useBackgrounds()
  const { checkKey, setQuery, setMedia, search } = useBackgrounds.getState()
  const topic = TOPICS.find((t) => t.query === query)
  const [text, setText] = useState(topic ? '' : query)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hasKey === null) void checkKey()
  }, [hasKey, checkKey])
  useEffect(() => {
    if (hasKey) void search(orientation)
  }, [hasKey, query, media, orientation, search])
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
  }, [query, media, orientation])

  if (hasKey === null) return <SkeletonGrid columns={columns} shape={SHAPE[orientation]} />
  if (!hasKey)
    return (
      <div className="scroll min-h-0 flex-1 p-3">
        <PexelsKeyCard autoFocus={autoFocus} />
      </div>
    )

  const submit = (): void => setQuery(text)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
        <div className="relative">
          <Search
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-3"
          />
          <input
            value={text}
            autoFocus={autoFocus}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape' && text) {
                e.stopPropagation()
                setText('')
              }
            }}
            placeholder="Search, then press ↩"
            aria-label="Search backgrounds"
            className={cn(
              'h-8 w-full rounded-[8px] border border-transparent bg-bg-muted pr-7 pl-8 text-[12.5px] text-text placeholder:text-text-3',
              'transition-[background-color,border-color,box-shadow] duration-150 ease-out hover:bg-hover',
              'focus:border-border focus:bg-bg focus:shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
            )}
          />
          {text ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setText('')
                setQuery('')
              }}
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-text-3 hover:bg-hover hover:text-text"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
        <Segmented
          items={FILTERS}
          value={media}
          onChange={setMedia}
          ariaLabel="Photos or videos"
          className="w-full [&_.seg-item]:flex-1"
        />
        <Topics
          active={topic?.query}
          onPick={(q) => {
            setText('')
            setQuery(q)
          }}
        />
      </div>

      {error && !items ? (
        <EmptyPane
          title="Backgrounds didn’t load"
          hint={error}
          action={
            <Button size="sm" onClick={() => void search(orientation, { force: true })}>
              Try again
            </Button>
          }
        />
      ) : !items ? (
        <SkeletonGrid columns={columns} shape={SHAPE[orientation]} />
      ) : items.length === 0 ? (
        <EmptyPane
          title={`Nothing matches “${topic?.label ?? query}”`}
          hint="Try simpler words, like “abstract”, “office” or “sky”."
        />
      ) : (
        <div ref={listRef} className="scroll min-h-0 flex-1 px-3 pb-3">
          <div className={cn('grid gap-2.5 pt-1', GRID[columns])}>
            {items.map((b) => (
              <Card
                key={b.id}
                item={b}
                shape={SHAPE[orientation]}
                picked={b.id === pickedId}
                onPick={onPick}
              />
            ))}
          </div>
          {error ? <p className="pt-3 text-center text-[11px] text-danger">{error}</p> : null}
          {hasMore ? (
            <div className="flex justify-center pt-3">
              <Button
                size="sm"
                loading={loading}
                onClick={() => void search(orientation, { more: true })}
              >
                Show more
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[10.5px] text-text-3">
        {hint ? <span className="truncate">{hint}</span> : null}
        <a
          href="https://www.pexels.com"
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 transition-colors hover:text-text"
        >
          Photos and videos by Pexels
        </a>
      </div>
    </div>
  )
}

function Topics({
  active,
  onPick
}: {
  active?: string
  onPick: (query: string) => void
}): ReactElement {
  // a mouse wheel scrolls the rail sideways
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
  }
  return (
    <div className="chip-rail -mx-2.5 px-2.5" onWheel={onWheel} role="tablist" aria-label="Topic">
      {TOPICS.map((t) => (
        <button
          key={t.query}
          type="button"
          role="tab"
          aria-selected={active === t.query}
          data-active={active === t.query}
          className="chip"
          onClick={() => onPick(t.query)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function HoverVideo({ src }: { src: string }): ReactElement {
  const [ready, setReady] = useState(false)
  return (
    <video
      src={src}
      autoPlay
      muted
      loop
      playsInline
      onPlaying={() => setReady(true)}
      className={cn(
        'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
        ready ? 'opacity-100' : 'opacity-0'
      )}
    />
  )
}

function Card({
  item,
  shape,
  picked,
  onPick
}: {
  item: Background
  shape: string
  picked: boolean
  onPick: (b: Background) => void
}): ReactElement {
  const [hover, setHover] = useState(false)
  const windowActive = useUi((s) => s.windowActive)
  const kind = item.media === 'video' ? 'Video' : 'Photo'
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${item.title} · ${kind} by ${item.author}`}
      aria-pressed={picked}
      className={cn(
        'card card-hover group block w-full p-1.5 text-left',
        picked &&
          'border-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_35%,transparent)]'
      )}
    >
      <Thumb src={item.thumb} className={cn(shape, 'rounded-[6px]')}>
        {hover && windowActive && item.preview ? <HoverVideo src={item.preview} /> : null}
        {item.media === 'video' ? (
          <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded-[4px] bg-black/55 px-1 py-px font-mono text-[9.5px] text-white tabular-nums backdrop-blur-sm">
            <Film size={9} strokeWidth={2} />
            {formatDuration(item.duration ?? 0)}
          </span>
        ) : null}
        <span
          className={cn(
            'absolute top-1 right-1 flex size-6 items-center justify-center rounded-full shadow-sm transition-[opacity,transform] duration-150',
            picked
              ? 'bg-accent text-accent-fg'
              : 'scale-90 bg-white/90 text-[#111] opacity-0 group-hover:scale-100 group-hover:opacity-100'
          )}
        >
          {picked ? <Check size={13} strokeWidth={2.5} /> : <Plus size={13} strokeWidth={2.25} />}
        </span>
      </Thumb>
      <div className="px-0.5 pt-1.5 pb-0.5">
        <span className="block truncate text-[11.5px] font-medium text-text">{item.title}</span>
        <span className="block truncate text-[10.5px] text-text-3">{item.author}</span>
      </div>
    </button>
  )
}

function SkeletonGrid({ columns, shape }: { columns: 2 | 3; shape: string }): ReactElement {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-3 pt-1">
      <div className={cn('grid gap-2.5', GRID[columns])}>
        {Array.from({ length: columns * 4 }, (_, i) => (
          <div key={i} className="card p-1.5">
            <div className={cn('skeleton rounded-[6px]', shape)} />
            <div className="skeleton mt-2 mb-0.5 h-2.5 w-3/4 rounded-[3px]" />
          </div>
        ))}
      </div>
    </div>
  )
}
