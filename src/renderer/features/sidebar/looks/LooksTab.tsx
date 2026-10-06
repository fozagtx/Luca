import type { Look } from '@shared/types'
import { Check, CircleAlert, MoreHorizontal, Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
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
type Busy = { slug: string; what: 'apply' | 'update' | 'delete' }

export function LooksTab(): ReactElement {
  const project = useProject((s) => s.project)
  const [looks, setLooks] = useState<LookCard[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  /** A Look asked to be deleted, waiting for a yes on its card (Looks can't be got back). */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [l, a] = await Promise.all([luca.looks.list(), luca.looks.active()])
    setLooks(l)
    setActive(a)
  }, [])
  const reload = useCallback(() => load().catch((e: unknown) => setError(errorMessage(e))), [load])
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0)
    return () => clearTimeout(t)
  }, [reload, project])

  /** Apply, update or delete a Look; the list is re-read either way (a Look can half apply). */
  const act = useCallback(
    async (slug: string, what: Busy['what']): Promise<void> => {
      const look = looks?.find((l) => l.slug === slug)
      const label = look ? `“${look.name}”` : 'the Look'
      setBusy({ slug, what })
      setError(null)
      setConfirming(null)
      try {
        if (what === 'apply') await luca.looks.apply(slug)
        else if (what === 'update') {
          await luca.looks.update(slug)
          toast(`Updated ${label} from this project`)
        } else {
          await luca.looks.remove(slug)
          toast(`Deleted ${label}`)
        }
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setBusy(null)
        await reload()
      }
    },
    [reload, looks]
  )

  useEffect(
    () =>
      luca.menu.onCommand((cmd, arg) => {
        const slug = typeof arg === 'string' ? arg : null
        if (!slug) return
        if (cmd === 'look-apply') void act(slug, 'apply')
        else if (cmd === 'look-update') void act(slug, 'update')
        else if (cmd === 'look-delete') setConfirming(slug)
      }),
    [act]
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

  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Looks" />
      <div className="p-3">
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
        // two cards a row only while each is wide enough for its Apply button; one when narrow
        <div className="scroll grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2.5 px-3 pb-3">
          {looks.map((l) => (
            <div
              key={l.slug}
              className={cn(
                'card card-hover group relative p-1.5',
                active === l.slug && 'ring-2 ring-accent ring-offset-1 ring-offset-bg',
                confirming === l.slug && 'ring-2 ring-danger/60 ring-offset-1 ring-offset-bg'
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
                {busy?.slug === l.slug && busy.what !== 'apply' ? (
                  <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 text-[10.5px] font-medium text-white">
                    <span className="btn-spinner" aria-hidden />
                    {busy.what === 'update' ? 'Updating…' : 'Deleting…'}
                  </span>
                ) : null}
              </Thumb>
              <div className="flex items-center gap-1 px-1 pt-1.5 pb-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-medium text-text">{l.name}</div>
                  <div className="truncate text-[10px] text-text-3">
                    {relativeDate(l.createdAt)}
                    {l.catalogItems.length > 0 &&
                      ` · ${l.catalogItems.length} item${l.catalogItems.length === 1 ? '' : 's'}`}
                  </div>
                </div>
                <Button
                  variant="icon"
                  className="h-6 w-6 shrink-0 text-text-3 hover:text-text"
                  disabled={busy !== null}
                  onClick={() => void luca.menu.popupLook(l.slug)}
                  aria-label={`More for ${l.name}`}
                >
                  <MoreHorizontal size={13} />
                </Button>
              </div>
              <div className="px-1 pb-1">
                {confirming === l.slug ? (
                  <div className="flex gap-1" role="group" aria-label={`Delete ${l.name}?`}>
                    <Button
                      variant="danger"
                      size="sm"
                      className="flex-1"
                      autoFocus
                      onClick={() => void act(l.slug, 'delete')}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => setConfirming(null)}
                      onKeyDown={(e) => e.key === 'Escape' && setConfirming(null)}
                    >
                      Keep
                    </Button>
                  </div>
                ) : active === l.slug ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Applied
                  </Button>
                ) : (
                  <GenerateButton
                    size="sm"
                    hue={210}
                    label="Apply Look"
                    generatingLabel="Applying"
                    generating={busy?.slug === l.slug && busy.what === 'apply'}
                    disabled={!project || busy !== null}
                    onClick={() => void act(l.slug, 'apply')}
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
