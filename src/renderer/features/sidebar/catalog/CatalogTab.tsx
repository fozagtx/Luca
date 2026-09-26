import { ArrowRight, Plus, RefreshCw, Search, X } from 'lucide-react'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type WheelEvent
} from 'react'
import {
  CATEGORIES,
  categoryLabel,
  searchLibrary,
  toLibrary,
  type LibraryCategory,
  type LibraryItem,
  type LibrarySource
} from '../../../../shared/catalog'
import type { CatalogItem, RemocnItem } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Segmented } from '../../../components/ui/segmented'
import { Thumb } from '../../../components/ui/thumb'
import { Tip } from '../../../components/ui/tooltip'
import { cn } from '../../../lib/cn'
import { setCatalogDrag } from '../../../lib/drag'
import { luca } from '../../../lib/luca'
import { useUi } from '../../../stores/ui'
import { EmptyPane } from '../EmptyPane'
import { PaneHead } from '../Sidebar'
import { ItemCover } from './ItemCover'
import { askLuca, dragOf } from './library-actions'

type Source = LibrarySource | 'all'

const sources = [
  { id: 'all', label: 'All' },
  { id: 'hyperframes', label: 'HyperFrames' },
  { id: 'remocn', label: 'Remocn' }
] as const satisfies readonly { id: Source; label: string }[]

type Studio = { ready: boolean; step?: string; error?: string }

export function CatalogTab(): ReactElement {
  const [hf, setHf] = useState<CatalogItem[] | null>(null)
  const [rc, setRc] = useState<RemocnItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<Source>('all')
  const [category, setCategory] = useState<LibraryCategory | 'all'>('all')
  const [studio, setStudio] = useState<Studio | null>(null)
  const [wantsRemocn, setWantsRemocn] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (refresh = false): Promise<void> => {
    setBusy(true)
    setError(null)
    const [a, b] = await Promise.allSettled([
      luca.catalog.list({ refresh }),
      luca.catalog.remocn({ refresh })
    ])
    if (a.status === 'fulfilled') setHf(a.value)
    else setHf((prev) => prev ?? [])
    if (b.status === 'fulfilled') setRc(b.value)
    else setRc((prev) => prev ?? [])
    if (a.status === 'rejected' && b.status === 'rejected')
      setError(a.reason instanceof Error ? a.reason.message : String(a.reason))
    setBusy(false)
  }, [])

  const refreshStudio = useCallback(async (): Promise<void> => {
    setStudio(await luca.catalog.remocnStudioStatus().catch(() => ({ ready: false })))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      void load()
      void refreshStudio()
    }, 0)
    return () => clearTimeout(t)
  }, [load, refreshStudio])

  const library = useMemo(() => (hf && rc ? toLibrary(hf, rc) : null), [hf, rc])
  const counts = useMemo(() => {
    const m = new Map<LibraryCategory, number>()
    for (const i of library ?? [])
      if (source === 'all' || i.source === source) m.set(i.category, (m.get(i.category) ?? 0) + 1)
    return m
  }, [library, source])

  // a category the chosen source doesn't have (Remocn has no Captions) falls back to All
  const activeCategory = category !== 'all' && !counts.get(category) ? 'all' : category
  const results = useMemo(
    () =>
      library
        ? searchLibrary(library, deferredQuery, {
            source,
            category: deferredQuery.trim() ? 'all' : activeCategory
          })
        : [],
    [library, deferredQuery, source, activeCategory]
  )
  const searching = deferredQuery.trim().length > 0
  const browsing = !searching && activeCategory === 'all'

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
  }, [deferredQuery, source, activeCategory])

  const onRemocnUse = (): void => {
    if (studio && !studio.ready) setWantsRemocn(true)
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Catalog">
        {library ? (
          <span className="mr-0.5 text-[11px] text-text-3 tabular-nums">{library.length}</span>
        ) : null}
        <Tip label="Refresh catalog">
          <Button
            variant="icon"
            className="h-6 w-6"
            aria-label="Refresh catalog"
            disabled={busy}
            onClick={() => void load(true)}
          >
            <RefreshCw size={12.5} strokeWidth={1.75} className={busy ? 'animate-spin' : ''} />
          </Button>
        </Tip>
      </PaneHead>

      <div className="flex flex-col gap-2 px-2.5 pt-2.5 pb-2">
        <SearchField value={query} onChange={setQuery} total={library?.length} />
        <Segmented
          items={[...sources]}
          value={source}
          onChange={setSource}
          ariaLabel="Catalog source"
          className="w-full [&_.seg-item]:flex-1"
        />
        {!searching ? (
          <CategoryRail value={activeCategory} onChange={setCategory} counts={counts} />
        ) : null}
      </div>

      {studio && !studio.ready && (source === 'remocn' || wantsRemocn) ? (
        <RemocnSetup studio={studio} onChanged={refreshStudio} />
      ) : null}

      {error ? (
        <EmptyPane
          title="The catalog didn't load"
          hint={error}
          action={
            <Button size="sm" onClick={() => void load(true)}>
              Try again
            </Button>
          }
        />
      ) : !library ? (
        <SkeletonGrid />
      ) : results.length === 0 ? (
        <EmptyPane
          title={searching ? `Nothing matches “${deferredQuery.trim()}”` : 'Nothing here yet'}
          hint="Try a simpler word, like “title”, “captions” or “transition”."
        />
      ) : (
        <div ref={listRef} className="scroll min-h-0 flex-1 px-2.5 pb-3">
          {browsing ? (
            <Sections items={results} onSeeAll={setCategory} onRemocnUse={onRemocnUse} />
          ) : (
            <>
              <div className="flex items-baseline justify-between px-0.5 pt-1 pb-2">
                <span className="text-[12px] font-semibold text-text">
                  {searching ? 'Results' : categoryLabel(activeCategory as LibraryCategory)}
                </span>
                <span className="text-[11px] text-text-3 tabular-nums">{results.length}</span>
              </div>
              <Grid
                key={`${deferredQuery}|${source}|${activeCategory}`}
                items={results}
                onRemocnUse={onRemocnUse}
              />
            </>
          )}
        </div>
      )}

      {library ? (
        <div className="truncate border-t border-border px-3 py-1.5 text-[10.5px] text-text-3">
          Click to ask Luca · drag onto the timeline
        </div>
      ) : null}
    </div>
  )
}

function SearchField({
  value,
  onChange,
  total
}: {
  value: string
  onChange: (v: string) => void
  total?: number
}): ReactElement {
  return (
    <div className="relative">
      <Search
        size={13}
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-3"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('')
        }}
        placeholder={total ? `Search ${total} components` : 'Search components'}
        aria-label="Search the catalog"
        className={cn(
          'h-8 w-full rounded-[8px] border border-transparent bg-bg-muted pr-7 pl-8 text-[12.5px] text-text placeholder:text-text-3',
          'transition-[background-color,border-color,box-shadow] duration-150 ease-out hover:bg-hover',
          'focus:border-border focus:bg-bg focus:shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-text-3 hover:bg-hover hover:text-text"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}

function CategoryRail({
  value,
  onChange,
  counts
}: {
  value: LibraryCategory | 'all'
  onChange: (c: LibraryCategory | 'all') => void
  counts: Map<LibraryCategory, number>
}): ReactElement {
  // a mouse wheel scrolls the rail sideways
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
  }
  return (
    <div
      className="chip-rail -mx-2.5 px-2.5"
      onWheel={onWheel}
      role="tablist"
      aria-label="Category"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'all'}
        data-active={value === 'all'}
        className="chip"
        onClick={() => onChange('all')}
      >
        All
      </button>
      {CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={value === c.id}
          data-active={value === c.id}
          className="chip"
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

function Sections({
  items,
  onSeeAll,
  onRemocnUse
}: {
  items: LibraryItem[]
  onSeeAll: (c: LibraryCategory) => void
  onRemocnUse: () => void
}): ReactElement {
  const groups = useMemo(() => {
    const m = new Map<LibraryCategory, LibraryItem[]>()
    for (const i of items) {
      const arr = m.get(i.category) ?? []
      arr.push(i)
      m.set(i.category, arr)
    }
    // items with real previews first, so each section opens with something to look at
    for (const arr of m.values())
      arr.sort((a, b) => Number(!!b.preview?.poster) - Number(!!a.preview?.poster))
    return CATEGORIES.filter((c) => m.has(c.id)).map((c) => ({ ...c, items: m.get(c.id)! }))
  }, [items])

  return (
    <div className="flex flex-col gap-5 pt-1">
      {groups.map((g) => (
        <section key={g.id}>
          <div className="mb-2 flex items-center justify-between px-0.5">
            <span className="text-[12px] font-semibold text-text">{g.label}</span>
            <button
              type="button"
              onClick={() => onSeeAll(g.id)}
              className="group inline-flex items-center gap-0.5 rounded-[5px] px-1 py-0.5 text-[11px] font-medium text-text-3 transition-colors hover:text-text"
            >
              See all {g.items.length}
              <ArrowRight
                size={11}
                className="transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </button>
          </div>
          <Grid items={g.items.slice(0, 4)} onRemocnUse={onRemocnUse} />
        </section>
      ))}
    </div>
  )
}

const PAGE = 60

function Grid({
  items,
  onRemocnUse
}: {
  items: LibraryItem[]
  onRemocnUse: () => void
}): ReactElement {
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef<HTMLDivElement>(null)
  const shown = items.slice(0, limit)

  // render a page at a time as the list scrolls
  useEffect(() => {
    const el = sentinel.current
    if (!el || limit >= items.length) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE)
      },
      { rootMargin: '400px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [limit, items.length])

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        {shown.map((i) => (
          <Card key={i.id} item={i} onRemocnUse={onRemocnUse} />
        ))}
      </div>
      {limit < items.length ? <div ref={sentinel} className="h-8" /> : null}
    </>
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

/** Poster (skeleton while loading, designed cover if none) that plays its preview on hover. */
export function ItemPreview({
  item,
  hover,
  className,
  children
}: {
  item: LibraryItem
  hover: boolean
  className?: string
  children?: ReactNode
}): ReactElement {
  const windowActive = useUi((s) => s.windowActive)
  const video = hover && windowActive ? item.preview?.video : undefined
  return (
    <Thumb
      src={item.preview?.poster}
      fallback={<ItemCover item={item} />}
      className={cn('aspect-video', className)}
    >
      {video ? <HoverVideo src={video} /> : null}
      {children}
    </Thumb>
  )
}

function Card({ item, onRemocnUse }: { item: LibraryItem; onRemocnUse: () => void }): ReactElement {
  const [hover, setHover] = useState(false)

  const use = (): void => {
    if (item.source === 'remocn') onRemocnUse()
    askLuca(item)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        setCatalogDrag(e.dataTransfer, dragOf(item))
        if (item.source === 'remocn') onRemocnUse()
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={use}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          use()
        }
      }}
      title={item.description}
      className="card card-hover group cursor-grab p-1.5 select-none active:cursor-grabbing"
    >
      <ItemPreview item={item} hover={hover} className="rounded-[6px]">
        <span className="absolute top-1 left-1 rounded-[4px] bg-black/45 px-1 py-px text-[9px] font-medium tracking-[0.02em] text-white backdrop-blur-sm">
          {item.source === 'remocn' ? 'Remocn' : item.type === 'block' ? 'Block' : 'Component'}
        </span>
        <span className="absolute top-1 right-1 flex size-6 scale-90 items-center justify-center rounded-full bg-white/90 text-[#111] opacity-0 shadow-sm transition-[opacity,transform] duration-150 group-hover:scale-100 group-hover:opacity-100">
          <Plus size={13} strokeWidth={2.25} />
        </span>
      </ItemPreview>
      <div className="px-0.5 pt-1.5 pb-0.5">
        <span className="block truncate text-[11.5px] font-medium text-text">{item.title}</span>
      </div>
    </div>
  )
}

function SkeletonGrid(): ReactElement {
  return (
    <div className="flex-1 overflow-hidden px-2.5 pt-1">
      <div className="skeleton mb-2.5 h-3 w-24 rounded-[3px]" />
      <div className="grid grid-cols-2 gap-2.5">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="card p-1.5">
            <div className="skeleton aspect-video rounded-[6px]" />
            <div className="skeleton mt-2 mb-0.5 h-2.5 w-3/4 rounded-[3px]" />
          </div>
        ))}
      </div>
    </div>
  )
}

function RemocnSetup({
  studio,
  onChanged
}: {
  studio: Studio
  onChanged: () => Promise<void>
}): ReactElement {
  const [settingUp, setSettingUp] = useState(false)
  const [err, setErr] = useState<string | null>(studio.error ?? null)

  useEffect(() => {
    if (!settingUp) return
    const id = setInterval(() => void onChanged(), 1500)
    return () => clearInterval(id)
  }, [settingUp, onChanged])

  const setup = async (): Promise<void> => {
    setSettingUp(true)
    setErr(null)
    try {
      const r = await luca.catalog.remocnSetup()
      if (!r.ok) setErr(r.error ?? 'Setup failed')
      await onChanged()
    } finally {
      setSettingUp(false)
    }
  }

  return (
    <div className="card mx-2.5 mb-2 p-2.5 text-[11.5px] text-text-2">
      <div className="font-medium text-text">Remocn needs a one-time setup</div>
      <p className="mt-0.5 leading-[1.45]">
        Luca prepares a small animation workspace so Remocn components can play in your video. It
        takes about two minutes.
      </p>
      {err ? (
        <p className="mt-1 line-clamp-3 text-[10.5px] text-danger select-text">{err}</p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={settingUp} onClick={() => void setup()}>
          {settingUp ? 'Setting up…' : 'Set up Remocn'}
        </Button>
        {settingUp && studio.step ? (
          <span className="shimmer-text text-[11px]">{studio.step}</span>
        ) : null}
      </div>
    </div>
  )
}
