import { Popover } from '@base-ui/react/popover'
import { Check, Puzzle, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { categoryLabel, searchLibrary, toLibrary, type LibraryItem } from '../../../shared/catalog'
import type { CatalogItem, RemocnItem } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { catalogChip } from '../../lib/drag'
import { luca } from '../../lib/luca'
import { useChat } from '../../stores/chat'
import { ItemPreview } from '../sidebar/catalog/CatalogTab'
import { dragOf } from '../sidebar/catalog/library-actions'

/**
 * "Use these components": a searchable pick list over the HyperFrames and Remocn catalog.
 * Picks become chips in the chat composer, so Luca receives them with the first message.
 */
export function ComponentPicker({ disabled }: { disabled?: boolean }): ReactElement {
  const chips = useChat((s) => s.chips)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const picked = chips.filter((c) => c.kind === 'catalog')

  useEffect(() => {
    if (!open || items) return
    let live = true
    void Promise.all([
      luca.catalog.list().catch((): CatalogItem[] => []),
      luca.catalog.remocn().catch((): RemocnItem[] => [])
    ]).then(([hf, rc]) => live && setItems(toLibrary(hf, rc)))
    return () => {
      live = false
    }
  }, [open, items])

  const results = useMemo(
    () =>
      items ? searchLibrary(items, query, { source: 'all', category: 'all' }).slice(0, 60) : [],
    [items, query]
  )

  const toggle = (i: LibraryItem): void => {
    const chat = useChat.getState()
    const at = chat.chips.findIndex((c) => c.kind === 'catalog' && c.name === i.name)
    if (at >= 0) chat.removeChip(at)
    else chat.addChip(catalogChip(dragOf(i)))
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          'no-drag inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45',
          picked.length
            ? 'border-secondary-border bg-secondary text-secondary-fg'
            : 'border-border bg-bg text-text-2 hover:border-border-strong hover:text-text'
        )}
      >
        <Puzzle size={13} strokeWidth={1.9} />
        {picked.length
          ? `${picked.length} component${picked.length === 1 ? '' : 's'}`
          : 'Components'}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="tip-popup flex max-h-[420px] w-[400px] flex-col overflow-hidden rounded-[12px] border border-border bg-bg shadow-popover outline-none">
            <div className="border-b border-border p-2.5">
              <div className="flex h-8 items-center gap-2 rounded-[8px] bg-bg-muted px-2.5">
                <Search size={13} className="shrink-0 text-text-3" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search: titles, captions, lower third, chart…"
                  className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-text-3"
                />
              </div>
              <p className="mt-2 px-0.5 text-[11px] leading-[1.45] text-text-3">
                Pick the components Luca should use. Leave it empty and Luca chooses the best fit.
              </p>
            </div>
            <div className="scroll min-h-0 flex-1 p-1.5">
              {!items ? (
                <div className="flex flex-col gap-1.5 p-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="skeleton h-11" />
                  ))}
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-text-3">
                  Nothing matches “{query}”.
                </div>
              ) : (
                results.map((i) => {
                  const on = picked.some((c) => c.kind === 'catalog' && c.name === i.name)
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => toggle(i)}
                      onMouseEnter={() => setHover(i.id)}
                      onMouseLeave={() => setHover(null)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[8px] p-1.5 text-left transition-colors',
                        on ? 'bg-secondary' : 'hover:bg-hover'
                      )}
                    >
                      <ItemPreview
                        item={i}
                        hover={hover === i.id}
                        className="w-16 shrink-0 rounded-[5px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-text">
                          {i.title}
                        </span>
                        <span className="block truncate text-[11px] text-text-3">
                          {categoryLabel(i.category)}
                          {i.source === 'remocn' ? ' · Remocn' : ''}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                          on
                            ? 'border-accent bg-accent text-white'
                            : 'border-border-strong text-transparent'
                        )}
                      >
                        {on ? <Check size={11} strokeWidth={3} className="pop-in" /> : null}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
