import type { Aspect, Look } from '@shared/types'
import { useEffect, useState, type ReactElement } from 'react'
import { luca } from '../../lib/luca'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Sheet } from '../../components/ui/sheet'
import { cn } from '../../lib/cn'
import { errorMessage, useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

const aspects: { id: Aspect; label: string; hint: string; box: string }[] = [
  { id: 'landscape', label: 'Landscape', hint: '1920 × 1080', box: 'h-6 w-10' },
  { id: 'portrait', label: 'Portrait', hint: '1080 × 1920', box: 'h-10 w-6' },
  { id: 'square', label: 'Square', hint: '1080 × 1080', box: 'h-8 w-8' }
]

export function NewProjectSheet(): ReactElement {
  const newProject = useUi((s) => s.newProject)
  const setNewProject = useUi((s) => s.setNewProject)
  const create = useProject((s) => s.create)
  const settings = useProject((s) => s.settings)
  const loading = useProject((s) => s.loading)
  const file = newProject?.file ?? ''
  return (
    <Sheet
      open={!!newProject}
      onOpenChange={(o) => !o && !loading && setNewProject(null)}
      title="New Project"
      description={file.replace(/^\/Users\/[^/]+/, '~')}
    >
      {file && (
        <NewProjectForm
          key={file}
          file={file}
          defaultAspect={settings?.defaultAspect ?? 'landscape'}
          loading={loading}
          onCancel={() => setNewProject(null)}
          onCreate={async (args) => {
            await create(args)
            setNewProject(null)
          }}
        />
      )}
    </Sheet>
  )
}

function NewProjectForm({
  file,
  defaultAspect,
  loading,
  onCancel,
  onCreate
}: {
  file: string
  defaultAspect: Aspect
  loading: boolean
  onCancel: () => void
  onCreate: (args: {
    file: string
    name?: string
    aspect: Aspect
    look?: string | null
  }) => Promise<void>
}): ReactElement {
  const [name, setName] = useState(() => (file.split('/').pop() ?? '').replace(/\.[^.]+$/, ''))
  const [aspect, setAspect] = useState<Aspect>(defaultAspect)
  const [looks, setLooks] = useState<Look[]>([])
  const [look, setLook] = useState<string>('')
  useEffect(() => {
    void luca.looks
      .list()
      .then(setLooks)
      .catch(() => undefined)
  }, [])
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!file) return
    try {
      await onCreate({ file, name: name.trim() || undefined, aspect, look: look || null })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-text-2">Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={loading}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-text-2">Aspect</span>
          <div role="radiogroup" className="grid grid-cols-3 gap-2">
            {aspects.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={aspect === a.id}
                disabled={loading}
                onClick={() => setAspect(a.id)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-[6px] border px-3 py-3 transition-colors',
                  aspect === a.id
                    ? 'border-accent bg-accent/[0.05]'
                    : 'border-border hover:bg-hover'
                )}
              >
                <div className="flex h-10 items-center">
                  <div
                    className={cn(
                      'rounded-[2px] bg-text-3/60',
                      a.box,
                      aspect === a.id && 'bg-accent'
                    )}
                  />
                </div>
                <div className="text-[12px] font-medium text-text">{a.label}</div>
                <div className="text-[11px] text-text-3">{a.hint}</div>
              </button>
            ))}
          </div>
        </div>
        {looks.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-text-2">Look</span>
            <select
              value={look}
              disabled={loading}
              onChange={(e) => setLook(e.target.value)}
              className="h-7 rounded-[6px] border border-border bg-bg px-2 text-[12px] text-text"
            >
              <option value="">None</option>
              {looks.map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {loading && (
          <div className="text-[12px] text-text-2">
            Running <span className="font-mono">hyperframes init</span>… copying the video and
            writing index.html.
          </div>
        )}
        {error && (
          <div className="selectable rounded-[6px] bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}
        <button type="submit" hidden />
      </form>
      <div className="-mx-5 mt-4 flex justify-end gap-2 border-t border-border px-5 pt-3">
        <Button onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={loading}>
          {loading ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </>
  )
}
