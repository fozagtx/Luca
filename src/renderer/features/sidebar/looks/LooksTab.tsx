import type { Look } from '@shared/types'
import { Check, CircleAlert, MoreHorizontal, Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Button } from '../../../components/ui/button'
import { GenerateButton } from '../../../components/ui/generate-button'
import { Input } from '../../../components/ui/input'
import { Thumb } from '../../../components/ui/thumb'
import { cn } from '../../../lib/cn'
import { luca } from '../../../lib/luca'
import { errorMessage, useProject } from '../../../stores/project'
import { EmptyPane } from '../EmptyPane'
import { PaneHead } from '../Sidebar'
import { relativeDate } from '../../../lib/format'

type LookCard = Look & { thumb: string | null }

export function LooksTab(): ReactElement {
  const project = useProject((s) => s.project)
  const [looks, setLooks] = useState<LookCard[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [l, a] = await Promise.all([luca.looks.list(), luca.looks.active()])
    setLooks(l)
    setActive(a)
  }, [])
  useEffect(() => {
    const t = setTimeout(() => void load().catch((e) => setError(errorMessage(e))), 0)
    return () => clearTimeout(t)
  }, [load, project])

  useEffect(
    () =>
      luca.menu.onCommand(async (cmd, arg) => {
        const slug = typeof arg === 'string' ? arg : null
        if (!slug) return
        try {
          if (cmd === 'look-apply') {
            setBusy(slug)
            await luca.looks.apply(slug)
          } else if (cmd === 'look-update') {
            setBusy(slug)
            await luca.looks.update(slug)
          } else if (cmd === 'look-delete') {
            await luca.looks.remove(slug)
          } else return
          await load()
        } catch (e) {
          setError(errorMessage(e))
        } finally {
          setBusy(null)
        }
      }),
    [load]
  )

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await luca.looks.save(name.trim())
      setNaming(false)
      setName('')
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const apply = async (slug: string): Promise<void> => {
    setBusy(slug)
    setError(null)
    try {
      await luca.looks.apply(slug)
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Looks" />
      <div className="p-2.5">
        {naming ? (
          <div className="flex gap-1.5">
            <Input
              autoFocus
              value={name}
              placeholder="Look name"
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                if (e.key === 'Escape') setNaming(false)
              }}
            />
            <Button variant="primary" disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            disabled={!project || saving}
            onClick={() => setNaming(true)}
          >
            <Plus size={13} strokeWidth={2} /> Save current style
          </Button>
        )}
        {saving ? (
          <p className="mt-1.5 text-[10.5px] leading-[1.45] text-text-3">
            Luca is capturing this project&apos;s style: fonts, colors, captions and pacing…
          </p>
        ) : null}
        {error ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-[6px] border border-danger/25 bg-danger/8 px-2 py-1.5 text-[10.5px] leading-[1.4] text-danger">
            <CircleAlert size={12} className="mt-px shrink-0" />
            <span className="select-text">{error}</span>
          </div>
        ) : null}
      </div>
      {!looks ? null : looks.length === 0 ? (
        <EmptyPane
          title="No Looks yet"
          hint="Save this project's style to reuse its fonts, colors, captions, transitions and pacing on another video."
        />
      ) : (
        <div className="scroll grid auto-rows-min grid-cols-2 gap-2.5 px-2.5 pb-2.5">
          {looks.map((l) => (
            <div
              key={l.slug}
              className={cn(
                'card card-hover group relative p-1.5',
                active === l.slug && 'ring-2 ring-accent ring-offset-1 ring-offset-bg'
              )}
              onContextMenu={(e) => {
                e.preventDefault()
                void luca.menu.popupLook(l.slug)
              }}
            >
              <Thumb src={l.thumb} lazy={false} className="aspect-video rounded-[5px]">
                {active === l.slug ? (
                  <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-[4px] bg-accent px-1.5 py-px text-[9.5px] font-medium text-accent-fg">
                    <Check size={10} strokeWidth={2.5} /> Active
                  </span>
                ) : null}
              </Thumb>
              <div className="flex items-center gap-1 px-1 pt-1.5 pb-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-medium text-text">{l.name}</div>
                  <div className="truncate text-[10px] text-text-3">
                    {relativeDate(l.createdAt)}
                    {l.catalogItems.length > 0 && ` · ${l.catalogItems.length} items`}
                  </div>
                </div>
                <Button
                  variant="icon"
                  className="h-6 w-6 shrink-0 text-text-3 hover:text-text"
                  onClick={() => void luca.menu.popupLook(l.slug)}
                  aria-label="Look menu"
                >
                  <MoreHorizontal size={13} />
                </Button>
              </div>
              <div className="px-1 pb-1">
                {active === l.slug ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Applied
                  </Button>
                ) : (
                  <GenerateButton
                    size="sm"
                    hue={210}
                    label="Apply Look"
                    generatingLabel="Applying"
                    generating={busy === l.slug}
                    disabled={!project || busy !== null}
                    onClick={() => void apply(l.slug)}
                    className="w-full"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
