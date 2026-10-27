import type { ProviderKind, ProviderStatus } from '@shared/types'
import { Check, LogOut, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Segmented } from '../../components/ui/segmented'
import { Sheet } from '../../components/ui/sheet'
import { cn } from '../../lib/cn'
import { errorMessage } from '../../stores/project'
import { useProvider } from '../../stores/provider'
import { useUi } from '../../stores/ui'

const PRESETS: { name: string; url: string }[] = [
  { name: 'Nebius', url: 'https://api.tokenfactory.nebius.com/v1' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1' }
]

/** Which AI Luca edits with: the Claude subscription, or the person's own API key, endpoint and model. */
export function ProviderSheet(): ReactElement {
  const open = useUi((s) => s.providerOpen)
  const setOpen = useUi((s) => s.setProvider)
  const status = useProvider((s) => s.status)
  const load = useProvider((s) => s.load)
  useEffect(() => {
    if (open) void load()
  }, [open, load])
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Model & API key"
      description="Pick what Luca edits with."
      width={520}
    >
      {status ? (
        <ProviderForm key={String(open)} status={status} close={() => setOpen(false)} />
      ) : null}
    </Sheet>
  )
}

function ProviderForm({
  status,
  close
}: {
  status: ProviderStatus
  close: () => void
}): ReactElement {
  const [tab, setTab] = useState<ProviderKind>(status.active)
  const [baseUrl, setBaseUrl] = useState(status.baseUrl)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState(status.model)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<'models' | 'save' | 'use' | 'signout' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (models ?? []).filter((m) => !f || m.toLowerCase().includes(f))
  }, [models, filter])

  const act = async (which: NonNullable<typeof busy>, fn: () => Promise<void>): Promise<void> => {
    setBusy(which)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const loadModels = (): Promise<void> =>
    act('models', async () => {
      const list = await useProvider.getState().models(baseUrl, key || undefined)
      setModels(list)
      if (!list.includes(model)) setModel('')
    })
  const save = (): Promise<void> =>
    act('save', async () => {
      await useProvider.getState().save({ baseUrl, key: key || undefined, model })
      setKey('')
      toast.success(`Luca now edits with ${model}`)
      close()
    })
  const switchToClaude = (): Promise<void> =>
    act('use', async () => {
      await useProvider.getState().use('claude')
      toast.success('Luca now edits with your Claude subscription')
      close()
    })
  const signOut = (): Promise<void> =>
    act('signout', async () => {
      await useProvider.getState().signOutClaude()
      toast.success('Signed out of Claude')
    })

  const hasKey = status.hasKey
  const canList = baseUrl.trim().length > 0 && (key.trim().length > 0 || hasKey)
  const canSave = canList && model.trim().length > 0

  return (
    <>
      <Segmented<ProviderKind>
        ariaLabel="Provider"
        value={tab}
        onChange={(t) => {
          setTab(t)
          setError(null)
        }}
        items={[
          { id: 'claude', label: 'Claude subscription' },
          { id: 'custom', label: 'My own API key' }
        ]}
      />

      {tab === 'claude' ? (
        <div className="mt-4 flex flex-col gap-3 text-[12px] leading-[1.5] text-text-2">
          <p>
            Luca edits with Claude Code, signed in with your Claude account.
            {status.active === 'claude' ? ' This is what Luca uses now.' : ''}
          </p>
          <div className="flex gap-2">
            {status.active !== 'claude' ? (
              <Button
                variant="primary"
                loading={busy === 'use'}
                onClick={() => void switchToClaude()}
              >
                <Check size={12} /> Use Claude
              </Button>
            ) : null}
            <Button loading={busy === 'signout'} onClick={() => void signOut()}>
              <LogOut size={12} /> Sign out of Claude
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3 text-[12px] text-text-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-text">Endpoint</span>
            <Input
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value)
                setModels(null)
              }}
              placeholder="https://api.tokenfactory.nebius.com/v1"
              aria-label="Endpoint"
              spellCheck={false}
            />
            <span className="flex flex-wrap gap-1 pt-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setBaseUrl(p.url)
                    setModels(null)
                  }}
                  className={cn(
                    'rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-hover',
                    baseUrl === p.url ? 'bg-secondary text-secondary-fg' : 'text-text-2'
                  )}
                >
                  {p.name}
                </button>
              ))}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-text">API key</span>
            <Input
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                setModels(null)
              }}
              placeholder={
                hasKey ? 'Saved on this Mac · paste a new one to replace it' : 'Paste your API key'
              }
              aria-label="API key"
              onKeyDown={(e) => e.key === 'Enter' && canList && void loadModels()}
            />
            <span className="text-[11px] text-text-3">
              Kept encrypted on this Mac and only sent to the endpoint above.
            </span>
          </label>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text">Model</span>
              <Button
                size="sm"
                className="ml-auto"
                disabled={!canList}
                loading={busy === 'models'}
                onClick={() => void loadModels()}
              >
                <RefreshCw size={11} /> {models ? 'Reload models' : 'Load models'}
              </Button>
            </div>
            {models ? (
              <>
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Search ${models.length} models`}
                  aria-label="Search models"
                />
                <div
                  role="listbox"
                  aria-label="Models"
                  className="scroll max-h-[220px] overflow-auto rounded-[8px] border border-border p-1"
                >
                  {shown.length ? (
                    shown.map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="option"
                        aria-selected={m === model}
                        onClick={() => setModel(m)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left font-mono text-[11.5px] hover:bg-hover',
                          m === model ? 'bg-secondary text-secondary-fg' : 'text-text'
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{m}</span>
                        {m === model ? <Check size={12} /> : null}
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-center text-text-3">No model matches “{filter}”</p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[11.5px] text-text-3">
                {model
                  ? `Using ${model}. Load models to pick another.`
                  : 'Add the endpoint and key, then load the models your key can use.'}
              </p>
            )}
            <span className="text-[11px] text-text-3">
              Pick a model that supports tool calling, or Luca can’t edit with it.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="primary"
              disabled={!canSave}
              loading={busy === 'save'}
              onClick={() => void save()}
            >
              <Check size={12} /> Save and use
            </Button>
          </div>
        </div>
      )}
      {error ? <p className="mt-3 text-[12px] text-danger select-text">{error}</p> : null}
    </>
  )
}
