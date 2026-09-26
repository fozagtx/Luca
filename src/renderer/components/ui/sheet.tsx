import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'

/** A macOS-style sheet that slides down from under the toolbar. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  width = 480,
  children,
  footer
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  width?: number
  children: ReactNode
  footer?: ReactNode
}): ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 top-[52px] z-40 bg-overlay transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup
          style={{ width }}
          className={cn(
            'sheet-popup fixed left-1/2 top-[52px] z-50 flex max-h-[calc(100vh-64px)] -translate-x-1/2 flex-col rounded-b-[12px] bg-bg shadow-popover outline-none',
            'transition-[transform,opacity] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]',
            'data-[starting-style]:-translate-y-4 data-[starting-style]:opacity-0 data-[ending-style]:-translate-y-4 data-[ending-style]:opacity-0'
          )}
        >
          <div className="flex shrink-0 items-start justify-between px-5 pt-4 pb-3">
            <div>
              <Dialog.Title className="text-[15px] font-semibold text-text">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 text-[12px] text-text-2">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close render={<Button variant="icon" aria-label="Close" />}>
              <X size={16} strokeWidth={1.5} />
            </Dialog.Close>
          </div>
          <div className="scroll min-h-0 flex-1 px-5 pb-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
