import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

export function TooltipProvider({ children }: { children: ReactNode }): ReactElement {
  return <BaseTooltip.Provider delay={400}>{children}</BaseTooltip.Provider>
}

export function Tip({
  label,
  shortcut,
  side = 'bottom',
  children
}: {
  label: string
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactElement
}): ReactElement {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6}>
          <BaseTooltip.Popup className="tip-popup z-50 flex items-center gap-2 rounded-[6px] bg-(--tip-bg) px-2 py-1 text-[11px] text-(--tip-fg) shadow-popover">
            <span>{label}</span>
            {shortcut && <kbd className="font-sans text-[11px] opacity-60">{shortcut}</kbd>}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
