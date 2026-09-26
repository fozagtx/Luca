import type { ReactElement } from 'react'
import type { LibraryCategory, LibraryItem } from '../../../../shared/catalog'

/**
 * Artwork for library items that ship without a preview image: a per-category gradient and a
 * small motif of what the item does (a title, a caption pill, a lower third, bars…), so the grid
 * reads as designed rather than as missing images.
 */

const GRADIENTS: Record<LibraryCategory, [string, string]> = {
  text: ['#5b5bf7', '#a043e6'],
  captions: ['#1f2937', '#4b5563'],
  overlays: ['#0ea5e9', '#2563eb'],
  transitions: ['#f97316', '#e11d74'],
  effects: ['#10b981', '#0e7fbf'],
  data: ['#0f766e', '#22c55e'],
  ui: ['#334155', '#0f172a'],
  camera: ['#6d28d9', '#111827'],
  templates: ['#f43f5e', '#7c3aed'],
  more: ['#64748b', '#1e293b']
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function Motif({ item }: { item: LibraryItem }): ReactElement {
  const words = item.title.split(/\s+/)
  switch (item.category) {
    case 'text':
      return (
        <div className="absolute inset-x-2.5 bottom-2 line-clamp-2 text-[14px] leading-[1.08] font-extrabold tracking-[-0.025em] break-words text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
          {item.title}
        </div>
      )
    case 'captions':
      return (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-[6px] bg-black/55 px-2 py-1 text-[11px] font-bold tracking-tight text-white">
            {words.slice(0, 2).map((w, i) => (
              <span key={i} className={i === 1 ? 'text-[#facc15]' : ''}>
                {i > 0 ? ' ' : ''}
                {w}
              </span>
            ))}
          </span>
        </div>
      )
    case 'overlays':
      return (
        <div className="absolute bottom-3 left-3 flex items-stretch gap-1.5">
          <span className="w-[3px] rounded-full bg-white" />
          <span className="flex flex-col gap-1 py-px">
            <span className="h-[7px] w-16 rounded-[2px] bg-white" />
            <span className="h-[5px] w-10 rounded-[2px] bg-white/60" />
          </span>
        </div>
      )
    case 'transitions':
      return (
        <div
          className="absolute inset-0 bg-black/25"
          style={{ clipPath: 'polygon(58% 0, 100% 0, 100% 100%, 38% 100%)' }}
        />
      )
    case 'effects':
      return (
        <>
          <span className="absolute -top-4 left-6 size-16 rounded-full bg-white/30 blur-xl" />
          <span className="absolute right-3 -bottom-6 size-20 rounded-full bg-black/25 blur-xl" />
        </>
      )
    case 'data':
      return (
        <div className="absolute inset-x-4 bottom-3 flex h-[55%] items-end gap-1.5">
          {[45, 70, 55, 90, 75].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-[2px] bg-white/80"
              style={{ height: `${h}%`, opacity: 0.55 + i * 0.1 }}
            />
          ))}
        </div>
      )
    case 'ui':
      return (
        <div className="absolute inset-x-5 top-6 bottom-0 rounded-t-[6px] border border-white/25 bg-white/10">
          <div className="flex gap-1 p-1.5">
            <span className="size-1.5 rounded-full bg-white/60" />
            <span className="size-1.5 rounded-full bg-white/40" />
            <span className="size-1.5 rounded-full bg-white/25" />
          </div>
          <div className="mx-2 mt-0.5 h-1.5 w-2/3 rounded-full bg-white/35" />
          <div className="mx-2 mt-1.5 h-1.5 w-1/2 rounded-full bg-white/20" />
        </div>
      )
    case 'camera':
      return (
        <div className="absolute inset-x-3 top-6 bottom-3">
          <span className="absolute top-0 left-0 size-3 border-t-2 border-l-2 border-white/80" />
          <span className="absolute top-0 right-0 size-3 border-t-2 border-r-2 border-white/80" />
          <span className="absolute bottom-0 left-0 size-3 border-b-2 border-l-2 border-white/80" />
          <span className="absolute right-0 bottom-0 size-3 border-r-2 border-b-2 border-white/80" />
          <span className="absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full bg-[#ff453a]" />
        </div>
      )
    case 'templates':
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="absolute h-[52%] w-[46%] translate-x-3 -rotate-6 rounded-[5px] bg-white/25" />
          <span className="absolute h-[52%] w-[46%] -translate-x-3 rotate-6 rounded-[5px] bg-white/35" />
          <span className="absolute h-[56%] w-[48%] rounded-[5px] bg-white/85 shadow-lg" />
        </div>
      )
    default:
      return (
        <div className="absolute inset-0 flex items-center justify-center text-[22px] font-bold text-white/80">
          {item.title.slice(0, 1)}
        </div>
      )
  }
}

export function ItemCover({ item }: { item: LibraryItem }): ReactElement {
  const [a, b] = GRADIENTS[item.category]
  const angle = 120 + (hash(item.name) % 90)
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: `linear-gradient(${angle}deg, ${a}, ${b})` }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(255,255,255,0.22),transparent_60%)]" />
      <Motif item={item} />
    </div>
  )
}
