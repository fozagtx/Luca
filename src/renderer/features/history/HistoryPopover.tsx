import { Popover } from '@base-ui/react/popover'
import { History, RotateCcw } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import type { Checkpoint } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { errorMessage, undoAction, useProject } from '../../stores/project'
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
  // another project's history is another list: it opens fresh when asked for
  useEffect(() => useUi.getState().setHistory(false), [projectDir])
  /** The list and why it couldn't be read, for the project they belong to. */
  const [list, setList] = useState<{
    dir: string | null
    items: Checkpoint[]
    error: string | null
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // null while the open project's list loads (another project's list is never shown)
  const items = list && list.dir === projectDir ? list.items : null
  const error = list && list.dir === projectDir ? list.error : null

  useEffect(() => {
    let alive = true
    // changes can come quickly (Luca saving several): only the newest list is shown
    let seq = 0
    const refresh = (): void => {
      const mine = ++seq
      const p = projectDir ? luca.history.list() : Promise.resolve([])
      void p.then(
        (l) => {
          if (alive && mine === seq) setList({ dir: projectDir, items: l, error: null })
        },
        (err: unknown) => {
          if (!alive || mine !== seq) return
          setList((prev) => ({
            dir: projectDir,
            items: prev?.dir === projectDir ? prev.items : [],
            error: errorMessage(err)
          }))
        }
      )
    }
    refresh()
    const off = luca.history.onChanged(refresh)
    return () => {
      alive = false
      off()
    }
  }, [projectDir])

  const restore = async (c: Checkpoint): Promise<void> => {
    setBusy(c.sha)
    try {
      await luca.history.restore(c.sha)
      // restoring adds a version on top, so it can be undone like any other change
      toast(`Restored “${c.message}”`, {
        action: undoAction
      })
    } catch (err) {
      toast.error(`Couldn’t restore that version: ${errorMessage(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setHistory}>
      <Tip label="History" shortcut="⌘Y">
        <Popover.Trigger
          render={
            <Button variant="ghost" active={open} disabled={!projectDir} aria-label="History" />
          }
        >
          <History size={15} strokeWidth={1.75} />
          History
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="no-drag z-50">
          <Popover.Popup
            className={cn(
              'w-[340px] rounded-[10px] border border-border bg-bg shadow-popover outline-none',
              'transition-[transform,opacity] duration-150 ease-[cubic-bezier(.2,.8,.2,1)]',
              'data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
            )}
          >
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
              <Popover.Title className="text-[13px] font-semibold text-text">History</Popover.Title>
              {items?.length ? (
                <span className="text-[11px] text-text-3">
                  {items.length} checkpoint{items.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            <ul className="max-h-[360px] overflow-y-auto pb-1.5">
              {items === null ? (
                <li className="px-3 py-6 text-center text-[12px] text-text-3">
                  <span className="shimmer-text">Reading the history…</span>
                </li>
              ) : error && items.length === 0 ? (
                <li className="px-3 py-6 text-center text-[12px] leading-[1.45] text-text-3">
                  The history couldn’t be read.
                  <span className="mt-1 block text-[11px] text-danger select-text">{error}</span>
                </li>
              ) : items.length === 0 ? (
                <li className="px-3 py-6 text-center text-[12px] leading-[1.45] text-text-3">
                  No checkpoints yet. Every change, Luca’s or yours, is saved here as a version you
                  can go back to.
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
                      <div className="truncate text-[12px] text-text" title={c.message}>
                        {c.message}
                      </div>
                      <div className="text-[11px] text-text-3">
                        {relative(c.date)} · {c.files} file{c.files === 1 ? '' : 's'} ·{' '}
                        <span className="font-mono">{c.shortSha}</span>
                      </div>
                    </div>
                    {!c.isHead && (
                      // shown on hover, and when reached with Tab (an invisible button can't be)
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          'shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                          busy === c.sha && 'opacity-100'
                        )}
                        disabled={busy !== null}
                        loading={busy === c.sha}
                        aria-label={`Restore “${c.message}”`}
                        onClick={() => void restore(c)}
                      >
                        {busy === c.sha ? null : <RotateCcw size={12} />}
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
