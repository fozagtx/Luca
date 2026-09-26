import type { Look } from '@shared/types'
import { Check, MoreHorizontal, Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Button } from '../../../components/ui/button'
import { GenerateButton } from '../../../components/ui/generate-button'
import { Input } from '../../../components/ui/input'
import { cn } from '../../../lib/cn'
import { luca } from '../../../lib/luca'
import { errorMessage, useProject } from '../../../stores/project'
import { EmptyPane } from '../EmptyPane'

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
      <div className="border-b border-border p-2">
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
            <Button
              size="sm"
              variant="primary"
              disabled={saving || !name.trim()}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ) : (
          <Button size="sm" disabled={!project || saving} onClick={() => setNaming(true)}>
            <Plus size={12} /> Save current style
          </Button>
        )}
        {saving ? (
          <p className="mt-1 text-[10.5px] text-text-3">
            Claude is writing LOOK.md, then components and a thumbnail are captured…
          </p>
        ) : null}
        {error ? <p className="mt-1 text-[10.5px] text-danger">{error}</p> : null}
      </div>
      {!looks ? null : looks.length === 0 ? (
        <EmptyPane
          title="No Looks yet"
          hint="Save this project's style to reuse its fonts, colors, captions, transitions and pacing on another video."
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 overflow-y-auto p-2">
          {looks.map((l) => (
            <div
              key={l.slug}
              className={cn(
                'group relative overflow-hidden rounded-[8px] border border-border bg-bg',
                active === l.slug && 'border-accent'
              )}
              onContextMenu={(e) => {
                e.preventDefault()
                void luca.menu.popupLook(l.slug)
              }}
            >
              <div className="aspect-video bg-bg-muted">
                {l.thumb ? (
                  <img src={l.thumb} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-medium text-text">{l.name}</div>
                  <div className="truncate text-[10px] text-text-3">
                    {l.sourceProject} · {l.catalogItems.length} catalog items
                  </div>
                </div>
                <button
                  className="rounded p-0.5 text-text-3 hover:bg-hover"
                  onClick={() => void luca.menu.popupLook(l.slug)}
                  aria-label="Look menu"
                >
                  <MoreHorizontal size={13} />
                </button>
              </div>
              <div className="px-2 pb-2">
                {active === l.slug ? (
                  <span className="flex items-center gap-1 text-[10.5px] text-accent">
                    <Check size={11} /> Active
                  </span>
                ) : (
                  <GenerateButton
                    size="sm"
                    hue={210}
                    label="Apply Look"
                    generatingLabel="Applying"
                    generating={busy === l.slug}
                    disabled={!project || busy !== null}
                    onClick={() => void apply(l.slug)}
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
