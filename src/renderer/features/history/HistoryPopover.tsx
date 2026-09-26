import { Popover } from '@base-ui/react/popover'
import { History, RotateCcw } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { Checkpoint } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

function relative(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function HistoryPopover(): ReactElement {
  const projectDir = useProject((s) => s.project?.dir ?? null)
  const open = useUi((s) => s.historyOpen)
  const setHistory = useUi((s) => s.setHistory)
  const [items, setItems] = useState<Checkpoint[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      const p = projectDir ? luca.history.list() : Promise.resolve([])
      void p.then((l) => {
        if (alive) setItems(l)
      })
    }
    refresh()
    const off = luca.history.onChanged(refresh)
    return () => {
      alive = false
      off()
    }
  }, [projectDir])

  const restore = async (sha: string): Promise<void> => {
    setBusy(sha)
    try {
      await luca.history.restore(sha)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setHistory}>
      <Tip label="History" shortcut="⌘Y">
        <Popover.Trigger
          render={
            <Button variant="icon" active={open} disabled={!projectDir} aria-label="History" />
          }
        >
          <History size={16} strokeWidth={1.5} />
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          <Popover.Popup
            className={cn(
              'w-[340px] rounded-[10px] border border-border bg-bg shadow-popover outline-none',
              'transition-[transform,opacity] duration-150 ease-[cubic-bezier(.2,.8,.2,1)]',
              'data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
            )}
          >
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
              <Popover.Title className="text-[13px] font-semibold text-text">History</Popover.Title>
              <span className="text-[11px] text-text-3">
                {items.length} checkpoint{items.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="max-h-[360px] overflow-y-auto pb-1.5">
              {items.length === 0 ? (
                <li className="px-3 py-6 text-center text-[12px] text-text-3">
                  No checkpoints yet.
                </li>
              ) : (
                items.map((c) => (
                  <li
                    key={c.sha}
                    className="group flex items-start gap-2 px-3 py-1.5 hover:bg-bg-muted"
                  >
                    <span
                      className={cn(
                        'mt-[6px] size-[7px] shrink-0 rounded-full',
                        c.isHead ? 'bg-accent' : 'bg-border'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-text">{c.message}</div>
                      <div className="text-[11px] text-text-3">
                        {relative(c.date)} · {c.files} file{c.files === 1 ? '' : 's'} ·{' '}
                        <span className="font-mono">{c.shortSha}</span>
                      </div>
                    </div>
                    {!c.isHead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="invisible shrink-0 group-hover:visible"
                        disabled={busy !== null}
                        onClick={() => void restore(c.sha)}
                      >
                        <RotateCcw size={12} />
                        {busy === c.sha ? 'Restoring…' : 'Restore'}
                      </Button>
                    )}
                  </li>
                ))
              )}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
