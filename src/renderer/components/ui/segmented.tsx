import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { cn } from '../../lib/cn'
import { Tip } from './tooltip'

export type SegmentedItem<T extends string> = {
  id: T
  label: string
  icon?: ReactNode
  shortcut?: string
}

/** Segmented control with a sliding active thumb. `icons` renders icon-only items with tooltips. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  icons = false,
  ariaLabel,
  className
}: {
  items: SegmentedItem<T>[]
  value: T
  onChange: (v: T) => void
  icons?: boolean
  ariaLabel: string
  className?: string
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = (): void => {
      const el = root.querySelector<HTMLElement>(`[data-id="${value}"]`)
      if (!el) return
      setThumb({ x: el.offsetLeft, w: el.offsetWidth })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [value, items.length])

  // a tab list: the arrows move the choice (and keep their frame-stepping job for the video
  // elsewhere), Tab moves past the control
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    const at = items.findIndex((it) => it.id === value)
    const next = items[(at + step + items.length) % items.length]
    onChange(next.id)
    ref.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus()
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      data-icons={icons ? 'true' : undefined}
      onKeyDown={onKeyDown}
      className={cn('seg', className)}
    >
      {thumb && (
        <div
          className="seg-thumb"
          style={{ width: thumb.w, transform: `translateX(${thumb.x - 2}px)` }}
        />
      )}
      {items.map((it) => {
        const btn = (
          <button
            key={it.id}
            type="button"
            role="tab"
            data-id={it.id}
            aria-selected={value === it.id}
            tabIndex={value === it.id ? 0 : -1}
            aria-label={it.label}
            className="seg-item"
            onClick={() => onChange(it.id)}
          >
            {it.icon}
            {!icons && <span>{it.label}</span>}
          </button>
        )
        return icons ? (
          <Tip key={it.id} label={it.label} shortcut={it.shortcut}>
            {btn}
          </Tip>
        ) : (
          btn
        )
      })}
    </div>
  )
}
