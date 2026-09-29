import { ArrowUpRight, AudioLines, Check, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { AI33_NO_KEYCHAIN, AI33_URL, formatCredits } from '@shared/ai33'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/cn'
import { useAi33 } from '../../stores/ai33'

export type Ai33KeyCardProps = {
  /**
   * Where the card sits: `chat` is inside the permission card of a request that needs the key
   * (no title of its own, and a Not now button), `start` is on the start card, `sheet` is the
   * Connections sheet.
   */
  context?: 'chat' | 'start' | 'sheet'
  /** The key was saved and ai33 is connected. */
  onDone?(): void
  /** Not now (chat) or dismiss (start). */
  onDismiss?(): void
  className?: string
}

const linkClass =
  'inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline'

/**
 * Connects ai33 with the person's own key (checked with ai33, kept with safeStorage) and shows
 * the account once it is: the one place the key is asked for, wherever a request needs it.
 */
export function Ai33KeyCard({
  context = 'sheet',
  onDone,
  onDismiss,
  className
}: Ai33KeyCardProps): ReactElement {
  const hasKey = useAi33((s) => s.hasKey)
  const credits = useAi33((s) => s.credits)
  const persisted = useAi33((s) => s.persisted)
  const saveKey = useAi33((s) => s.saveKey)
  const refresh = useAi33((s) => s.refresh)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  // credits and running jobs when the card appears (a card with no key has none to read)
  useEffect(() => {
    if (useAi33.getState().hasKey !== false) void refresh()
  }, [refresh])

  const save = async (): Promise<void> => {
    const k = key.trim()
    if (!k || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveKey(k)
      setKey('')
      setChanging(false)
      setNote(res.note ?? null)
      onDone?.()
    } catch (err) {
      // the field keeps what was pasted, so a typo is one edit away
      setError(err instanceof Error ? err.message : String(err))
      field.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await saveKey('')
      setConfirmOff(false)
      setNote(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // asking to disconnect while something is being made warns first
  const askDisconnect = async (): Promise<void> => {
    await refresh()
    if (useAi33.getState().running > 0) setConfirmOff(true)
    else await disconnect()
  }

  const connected = hasKey === true && !changing
  const chat = context === 'chat'
  return (
    <div className={cn('text-[11.5px] leading-[1.45] text-text-2', !chat && 'card p-3', className)}>
      {!chat ? (
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-text">
          <AudioLines size={13} className="text-text-3" /> Voices, music and sound
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
      ) : null}

      {connected ? (
        <>
          <div
            className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-success"
            aria-live="polite"
          >
            <Check size={13} />
            <span>Connected{credits !== null ? ` · ${formatCredits(credits)} credits` : ''}</span>
          </div>
          {!persisted ? <p className="mt-1 text-text-3">{AI33_NO_KEYCHAIN}</p> : null}
          {note && note !== AI33_NO_KEYCHAIN ? <p className="mt-1 text-text-3">{note}</p> : null}
          {confirmOff ? (
            <div className="mt-2">
              <p>
                Luca is still making something. If you disconnect, it can’t be added until you
                reconnect.
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" variant="danger" loading={busy} onClick={() => void disconnect()}>
                  Disconnect anyway
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmOff(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : chat ? null : (
            <div className="mt-2 flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
                Change key
              </Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void askDisconnect()}>
                Disconnect
              </Button>
              <a
                href={AI33_URL}
                target="_blank"
                rel="noreferrer"
                className={cn(linkClass, 'ml-auto')}
              >
                Get credits <ArrowUpRight size={11} />
              </a>
            </div>
          )}
          {error ? (
            <p className="mt-1.5 text-danger select-text" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-1">
            {chat ? 'Luca needs an ai33 key to make this. ' : ''}
            Connect your ai33 account and Luca can record a voiceover from your script, make music
            and sound effects. ai33 is a separate paid service: you buy credits from ai33, and every
            job uses them. Luca asks before spending a lot. The key stays on this Mac.
          </p>
          <p className="mt-1.5 text-text-3">
            Luca sends ai33 only the words and prompts a job needs. Names you ask Luca to say a
            certain way are stored on your ai33 account. Your recordings and footage stay on this
            Mac.
          </p>
          <Input
            ref={field}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your ai33 key"
            aria-label="ai33 key"
            autoFocus={chat || changing || !!onDismiss}
            className="mt-2"
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
          {error ? (
            <p className="mt-1.5 text-danger select-text" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!key.trim()}
              onClick={() => void save()}
            >
              Connect
            </Button>
            {chat && onDismiss ? (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Not now
              </Button>
            ) : null}
            {changing ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setChanging(false)
                  setKey('')
                  setError(null)
                }}
              >
                Cancel
              </Button>
            ) : null}
            <a
              href={AI33_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(linkClass, 'ml-auto')}
            >
              Get a key <ArrowUpRight size={11} />
            </a>
          </div>
        </>
      )}
    </div>
  )
}
