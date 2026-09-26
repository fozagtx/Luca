import { RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { CatalogItem } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { cn } from '../../../lib/cn'
import { catalogChip, setCatalogDrag } from '../../../lib/drag'
import { luca } from '../../../lib/luca'
import { useChat } from '../../../stores/chat'
import { useUi } from '../../../stores/ui'
import { EmptyPane } from '../EmptyPane'

type Filter = 'all' | 'block' | 'component'

export function CatalogTab(): ReactElement {
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
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
        (filter === 'all' || i.type === filter) &&
        (!q ||
          i.name.includes(q) ||
          i.title.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)))
    )
  }, [items, query, filter])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <div className="relative flex-1">
          <Search size={12} className="absolute top-2 left-2 text-text-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search catalog"
            className="pl-6"
          />
        </div>
        <Button
          variant="icon"
          title="Refresh catalog"
          disabled={busy}
          onClick={() => void load(true)}
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        </Button>
      </div>
      <div className="flex gap-0.5 px-2 py-1.5">
        {(['all', 'block', 'component'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'flex-1 rounded-[5px] py-0.5 text-[11px] capitalize',
              filter === f ? 'bg-bg-muted font-medium text-text' : 'text-text-2 hover:text-text'
            )}
          >
            {f === 'all' ? 'All' : `${f}s`}
          </button>
        ))}
      </div>
      {error ? (
        <EmptyPane title="Catalog unavailable" hint={error} />
      ) : items === null ? (
        <EmptyPane title="Loading catalog…" hint="npx hyperframes catalog --json" />
      ) : shown.length === 0 ? (
        <EmptyPane title="No matches" hint="Try another search or filter." />
      ) : (
        <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto px-2 pb-2">
          {shown.map((i) => (
            <Card key={i.name} item={i} />
          ))}
        </div>
      )}
      {items ? (
        <div className="border-t border-border px-2 py-1 text-[10px] text-text-3">
          {shown.length} of {items.length} · drag to timeline or chat · ⌘-click to attach
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
      title={item.description}
      onDragStart={(e) => setCatalogDrag(e.dataTransfer, { ...item, source: 'hyperframes' })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        if (e.metaKey) attach()
      }}
      className="group cursor-grab select-none active:cursor-grabbing"
    >
      <div className="relative aspect-video overflow-hidden rounded-[6px] border border-border bg-bg-muted">
        {item.preview?.poster ? (
          <img
            src={item.preview.poster}
            alt=""
            loading="lazy"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
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
        <span className="absolute top-1 left-1 rounded-[3px] bg-black/55 px-1 text-[9px] text-white capitalize">
          {item.type}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-text" title={item.title}>
        {item.title}
      </div>
    </div>
  )
}
