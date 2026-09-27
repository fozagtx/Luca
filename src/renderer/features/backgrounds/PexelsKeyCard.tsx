import { ArrowUpRight, Wallpaper } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/cn'
import { useBackgrounds } from '../../stores/backgrounds'

/** Connects Pexels with the person's own free API key (checked with Pexels, kept with safeStorage). */
export function PexelsKeyCard({
  className,
  autoFocus
}: {
  className?: string
  autoFocus?: boolean
}): ReactElement {
  const saveKey = useBackgrounds((s) => s.saveKey)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await saveKey(key.trim())
      setKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={cn('card p-3 text-[11.5px] leading-[1.45] text-text-2', className)}>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-text">
        <Wallpaper size={13} className="text-text-3" /> Backgrounds from Pexels
      </div>
      <p className="mt-1">
        Pexels is a free library of photos and short videos. Connect it with your free API key to
        browse backgrounds here, put one behind your video, and let Luca choose them for you. The
        key stays on this Mac.
      </p>
      <div className="mt-2 flex gap-1.5">
        <Input
          type="password"
          value={key}
          autoFocus={autoFocus}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Pexels API key"
          aria-label="Pexels API key"
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <Button variant="primary" loading={busy} disabled={!key.trim()} onClick={() => void save()}>
          Connect
        </Button>
      </div>
      {error ? <p className="mt-1.5 text-danger select-text">{error}</p> : null}
      <a
        href="https://www.pexels.com/api/"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
      >
        Get a free key <ArrowUpRight size={11} />
      </a>
    </div>
  )
}
