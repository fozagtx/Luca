import type { ReactElement } from 'react'
import avatar from '../../assets/luca-avatar.png'
import claude from '../../assets/claude.svg'
import { cn } from '../../lib/cn'

const tile =
  'relative flex items-center justify-center overflow-hidden rounded-[30%] border border-border shadow-card'

export function ConnectTiles({
  size = 40,
  className
}: {
  size?: number
  className?: string
}): ReactElement {
  const overlap = -size * 0.22
  return (
    <span className={cn('isolate inline-flex items-center', className)}>
      <span className={cn(tile, 'bg-panel')} style={{ width: size, height: size }}>
        <img src={avatar} alt="Luca" className="h-full w-full object-cover" />
      </span>
      <span
        className={cn(tile, 'z-10 bg-[#1c1917]')}
        style={{ width: size, height: size, marginLeft: overlap }}
      >
        <img src={claude} alt="Claude Code" style={{ width: size * 0.55 }} />
      </span>
      <span
        className="relative z-20"
        style={{ marginLeft: overlap }}
        title="Codex support is coming"
        aria-label="Codex (coming soon)"
      >
        <span className={cn(tile, 'bg-[#1c1917] opacity-60')} style={{ width: size, height: size }}>
          <svg viewBox="0 0 24 24" style={{ width: size * 0.55 }} aria-hidden="true">
            <path
              d="M5 3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7.6l-3.7 3.2c-.6.5-1.7.1-1.7-.8V17H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"
              fill="#8b8df5"
            />
            <path
              d="M8 8l3 3-3 3M13 14h3.5"
              stroke="#1c1917"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
        <span className="absolute -right-1 -bottom-1 z-40 rounded-full border border-border bg-bg px-1.5 py-px text-[9px] font-semibold leading-[1.4] tracking-[0.02em] text-text-3">
          Soon
        </span>
      </span>
    </span>
  )
}
