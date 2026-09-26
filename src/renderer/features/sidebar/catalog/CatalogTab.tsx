import { Blocks, Puzzle, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { CatalogItem, RemocnItem } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Segmented } from '../../../components/ui/segmented'
import { Tip } from '../../../components/ui/tooltip'
import { cn } from '../../../lib/cn'
import { catalogChip, setCatalogDrag } from '../../../lib/drag'
import { luca } from '../../../lib/luca'
import { useChat } from '../../../stores/chat'
import { useUi } from '../../../stores/ui'
import { EmptyPane } from '../EmptyPane'
import { PaneHead } from '../Sidebar'

type View = 'block' | 'component' | 'remocn'

const views = [
  { id: 'block', label: 'Blocks' },
  { id: 'component', label: 'Components' },
  { id: 'remocn', label: 'Remocn' }
] as const satisfies readonly { id: View; label: string }[]

export function CatalogTab(): ReactElement {
  const [view, setView] = useState<View>('block')
  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Catalog" />
      <div className="px-2.5 pt-2.5 pb-1">
        <Segmented
          items={[...views]}
          value={view}
          onChange={setView}
          ariaLabel="Catalog source"
          className="w-full"
        />
      </div>
      {view === 'remocn' ? <RemocnCatalog /> : <HyperframesCatalog filter={view} />}
    </div>
  )
}

function SkeletonGrid(): ReactElement {
  return (
    <div className="grid flex-1 grid-cols-2 gap-2.5 overflow-hidden px-2.5 pb-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="card p-1.5">
          <div className="skeleton aspect-video rounded-[5px]" />
          <div className="skeleton mt-2 h-2.5 w-3/4 rounded-[3px]" />
        </div>
      ))}
    </div>
  )
}

function SearchBox({
  value,
  onChange,
  placeholder,
  children
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  children?: ReactElement
}): ReactElement {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5">
      <div className="relative flex-1">
        <Search
          size={13}
          strokeWidth={1.75}
          className="absolute top-1/2 left-2 -translate-y-1/2 text-text-3"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-7"
        />
      </div>
      {children}
    </div>
  )
}

function HyperframesCatalog({ filter }: { filter: 'block' | 'component' }): ReactElement {
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (refresh = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setItems(await luca.catalog.list({ refresh }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const shown = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    return items.filter(
      (i) =>
        i.type === filter &&
        (!q ||
          i.name.includes(q) ||
          i.title.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)))
    )
  }, [items, query, filter])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={filter === 'block' ? 'Search blocks' : 'Search components'}
      >
        <Tip label="Refresh catalog">
          <Button
            variant="icon"
            aria-label="Refresh catalog"
            disabled={busy}
            onClick={() => void load(true)}
          >
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          </Button>
        </Tip>
      </SearchBox>
      {error ? (
        <EmptyPane title="Catalog unavailable" hint={error} />
      ) : items === null ? (
        <SkeletonGrid />
      ) : shown.length === 0 ? (
        <EmptyPane title="No matches" hint="Try another search." />
      ) : (
        <div className="scroll grid flex-1 auto-rows-min grid-cols-2 gap-2.5 px-2.5 pb-2">
          {shown.map((i) => (
            <Card key={i.name} item={i} />
          ))}
        </div>
      )}
      {items ? (
        <div className="truncate border-t border-border px-3 py-1.5 text-[10.5px] text-text-3">
          {shown.length} of {items.length} · drag to add · ⌘-click to attach
        </div>
      ) : null}
    </div>
  )
}

function Card({ item }: { item: CatalogItem }): ReactElement {
  const [hover, setHover] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const addChip = useChat((s) => s.addChip)
  const windowActive = useUi((s) => s.windowActive)
  const playing = hover && windowActive && !!item.preview?.video

  useEffect(() => {
    const v = video.current
    if (!v) return
    if (playing) void v.play().catch(() => undefined)
    else {
      v.pause()
      v.currentTime = 0
    }
  }, [playing])

  const attach = (): void => {
    addChip(catalogChip({ ...item, source: 'hyperframes' }))
    if (!useUi.getState().chatOpen) useUi.getState().toggleChat()
    document.getElementById('chat-composer')?.focus()
  }

  return (
    <div
      draggable
      onDragStart={(e) => setCatalogDrag(e.dataTransfer, { ...item, source: 'hyperframes' })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        if (e.metaKey) attach()
      }}
      className="card card-hover group cursor-grab select-none p-1.5 active:cursor-grabbing"
    >
      <div className="relative aspect-video overflow-hidden rounded-[5px] bg-bg-muted">
        {item.preview?.poster ? (
          <img
            src={item.preview.poster}
            alt=""
            loading="lazy"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-3/60">
            {item.type === 'block' ? <Blocks size={18} /> : <Puzzle size={18} />}
          </div>
        )}
        {item.preview?.video ? (
          <video
            ref={video}
            src={hover ? item.preview.video : undefined}
            muted
            loop
            playsInline
            preload="none"
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity',
              playing ? 'opacity-100' : 'opacity-0'
            )}
          />
        ) : null}
        <span className="absolute right-1 bottom-1 rounded-[4px] bg-black/55 px-1 py-px text-[9px] font-medium tracking-[0.02em] text-white uppercase backdrop-blur-sm">
          {item.type}
        </span>
      </div>
      <div className="px-0.5 pt-1.5 pb-0.5">
        <span
          className="block truncate text-[11.5px] font-medium text-text"
          title={`${item.title}\n${item.description}`}
        >
          {item.title}
        </span>
      </div>
    </div>
  )
}

function RemocnCatalog(): ReactElement {
  const [items, setItems] = useState<RemocnItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [studio, setStudio] = useState<{ ready: boolean; step?: string; error?: string } | null>(
    null
  )
  const [settingUp, setSettingUp] = useState(false)

  const refreshStudio = useCallback(async (): Promise<void> => {
    setStudio(await luca.catalog.remocnStudioStatus().catch(() => ({ ready: false })))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      void luca.catalog
        .remocn()
        .then(setItems)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      void refreshStudio()
    }, 0)
    return () => clearTimeout(t)
  }, [refreshStudio])

  useEffect(() => {
    if (!settingUp) return
    const id = setInterval(() => void refreshStudio(), 1500)
    return () => clearInterval(id)
  }, [settingUp, refreshStudio])

  const setup = async (): Promise<void> => {
    setSettingUp(true)
    try {
      const r = await luca.catalog.remocnSetup()
      if (!r.ok) setStudio({ ready: false, error: r.error })
      else await refreshStudio()
    } finally {
      setSettingUp(false)
    }
  }

  const categories = useMemo(
    () => ['All', ...Array.from(new Set((items ?? []).map((i) => i.category)))],
    [items]
  )
  const shown = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    return items.filter(
      (i) =>
        (category === 'All' || i.category === category) &&
        (!q || i.name.includes(q) || i.useFor.toLowerCase().includes(q))
    )
  }, [items, query, category])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {studio && !studio.ready ? (
        <div className="card mx-2.5 mt-1.5 p-2.5 text-[11px] text-text-2">
          <div className="font-medium text-text">Remocn studio not set up</div>
          <p className="mt-0.5">
            Luca renders remocn components to transparent clips with a shared Remotion workspace (~2
            min, one time).
          </p>
          {studio.error ? (
            <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] text-danger">
              {studio.error}
            </pre>
          ) : null}
          <div className="mt-1.5 flex items-center gap-2">
            <Button size="sm" disabled={settingUp} onClick={() => void setup()}>
              {settingUp ? 'Setting up…' : 'Set up studio'}
            </Button>
            {settingUp && studio.step ? <span className="text-text-3">{studio.step}</span> : null}
          </div>
        </div>
      ) : null}
      <SearchBox value={query} onChange={setQuery} placeholder="Search remocn">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-7 max-w-[110px] rounded-[6px] border border-border bg-bg px-1 text-[11px] text-text hover:bg-hover"
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </SearchBox>
      {error ? (
        <EmptyPane title="Remocn unavailable" hint={error} />
      ) : items === null ? (
        <div className="flex flex-1 flex-col gap-2 px-2.5 pb-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card p-2.5">
              <div className="skeleton h-2.5 w-1/2 rounded-[3px]" />
              <div className="skeleton mt-2 h-2 w-full rounded-[3px]" />
              <div className="skeleton mt-1 h-2 w-2/3 rounded-[3px]" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyPane title="No matches" hint="Try another search or category." />
      ) : (
        <div className="scroll flex flex-1 flex-col gap-2 px-2.5 pb-2">
          {shown.map((i) => (
            <RemocnCard key={i.name} item={i} />
          ))}
        </div>
      )}
      {items ? (
        <div className="truncate border-t border-border px-3 py-1.5 text-[10.5px] text-text-3">
          {shown.length} of {items.length} · drag to add · ⌘-click to attach
        </div>
      ) : null}
    </div>
  )
}

function RemocnCard({ item }: { item: RemocnItem }): ReactElement {
  const addChip = useChat((s) => s.addChip)
  const drag = {
    name: item.name,
    type: 'component' as const,
    title: item.name,
    source: 'remocn' as const
  }
  const attach = (): void => {
    addChip(catalogChip(drag))
    if (!useUi.getState().chatOpen) useUi.getState().toggleChat()
    document.getElementById('chat-composer')?.focus()
  }
  return (
    <div
      draggable
      onDragStart={(e) => setCatalogDrag(e.dataTransfer, drag)}
      onClick={(e) => {
        if (e.metaKey) attach()
      }}
      title={`Avoid for: ${item.avoidFor}`}
      className="card card-hover cursor-grab p-2.5 select-none active:cursor-grabbing"
    >
      <div className="flex items-center gap-1.5">
        <span className="flex size-4 items-center justify-center rounded-[4px] bg-secondary text-[9px] font-bold text-secondary-fg">
          R
        </span>
        <span className="truncate font-mono text-[11px] text-text">{item.name}</span>
        <span className="ml-auto shrink-0 text-[10px] text-text-3">
          {item.category} · {item.naturalLength}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-text-2">{item.useFor}</p>
      <a
        href={item.docs}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-1 inline-block text-[10px] text-accent hover:underline"
      >
        docs
      </a>
    </div>
  )
}
