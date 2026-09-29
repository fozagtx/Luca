import { KeyRound, X } from 'lucide-react'
import { useState, type ReactElement, type ReactNode } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'

/**
 * Asks for the AssemblyAI API key (transcripts for cuts, captions and B-roll; voice input);
 * stored with safeStorage in main.
 */
export function AssemblyAiKeyCard({
  children,
  onSaved,
  onDismiss,
  autoFocus = !!onDismiss,
  className
}: {
  children: ReactNode
  onSaved: (ok: boolean) => void
  onDismiss?: () => void
  /** Put the caret in the key field; on by default when the card can be dismissed. */
  autoFocus?: boolean
  className?: string
}): ReactElement {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    if (!key.trim()) return
    setError(null)
    try {
      const ok = await luca.env.setAssemblyAiKey(key.trim())
      setKey('')
      if (!ok) setError('The key wasn’t saved. Try again.')
      onSaved(ok)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        `Couldn’t save the key: ${msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`
      )
    }
  }
  return (
    <div className={cn('card p-2.5 text-[11px] leading-[1.45] text-text-2', className)}>
      <div className="flex items-center gap-1.5 font-medium text-text">
        <KeyRound size={12} className="text-text-3" /> AssemblyAI key
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto rounded-[4px] text-text-3 hover:text-text"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      <p className="mt-1">{children}</p>
      <div className="mt-1.5 flex gap-1.5">
        <Input
          type="password"
          value={key}
          autoFocus={autoFocus}
          onChange={(e) => setKey(e.target.value)}
          placeholder="AssemblyAI API key"
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <Button variant="primary" onClick={() => void save()} disabled={!key.trim()}>
          Save
        </Button>
      </div>
      {error ? <p className="mt-1.5 text-danger select-text">{error}</p> : null}
    </div>
  )
}
