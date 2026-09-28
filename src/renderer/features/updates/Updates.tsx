import { ArrowUpRight } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { UpdateStatus } from '@shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { ProgressBar } from '../../components/ui/progress'
import { Sheet } from '../../components/ui/sheet'
import { useUpdates } from '../../stores/updates'

/** GitHub's generated notes as plain lines: "* Title by @who in https://…" → "Title". */
function noteLines(md: string | undefined, max = 6): string[] {
  return (md ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith('#') &&
        !l.startsWith('**Full Changelog**') &&
        !/made their first contribution/.test(l)
    )
    .map((l) =>
      l
        .replace(/^[*-]\s+/, '')
        .replace(/\s+by @\S+ in https?:\/\/\S+$/, '')
        .replace(/\*\*/g, '')
    )
    .slice(0, max)
}

/** A GitHub token, for updates from a private repository (checked with GitHub, kept with safeStorage). */
function TokenForm({ onDone }: { onDone?: () => void }): ReactElement {
  const saveToken = useUpdates((s) => s.saveToken)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    if (!token.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await saveToken(token.trim())
      setToken('')
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 rounded-[8px] border border-border p-3">
      <p>
        Luca’s repository is private, so GitHub shows its releases only with a token. Make a
        fine-grained token for just that repository with read-only <b>Contents</b>, and paste it
        here. It stays on this Mac.
      </p>
      <div className="mt-2 flex gap-1.5">
        <Input
          type="password"
          value={token}
          autoFocus
          onChange={(e) => setToken(e.target.value)}
          placeholder="GitHub token"
          aria-label="GitHub token"
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <Button
          variant="primary"
          loading={busy}
          disabled={!token.trim()}
          onClick={() => void save()}
        >
          Connect
        </Button>
      </div>
      {error ? <p className="mt-1.5 text-danger select-text">{error}</p> : null}
      <a
        href="https://github.com/settings/personal-access-tokens/new"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
      >
        Make a token <ArrowUpRight size={11} />
      </a>
    </div>
  )
}

function Body({ s }: { s: UpdateStatus }): ReactElement {
  const notes = noteLines(s.notes)
  switch (s.state) {
    case 'off':
      return <p>{s.message}</p>
    case 'checking':
      return (
        <>
          <p>Looking for a newer Luca…</p>
          <ProgressBar className="mt-2" />
        </>
      )
    case 'downloading':
      return (
        <>
          <p>
            Downloading Luca {s.version}… {Math.round((s.progress ?? 0) * 100)}%
          </p>
          <ProgressBar className="mt-2" value={s.progress ?? 0} />
        </>
      )
    case 'ready':
    case 'available':
      return (
        <>
          <p className="text-text">
            {s.state === 'ready'
              ? `Luca ${s.version} is ready. Restart to use it, or keep working: it goes in when you quit.`
              : `Luca ${s.version} is out. ${s.message ?? ''}`}
          </p>
          {notes.length ? (
            <ul className="mt-2 list-disc pl-4">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
            >
              See the release <ArrowUpRight size={11} />
            </a>
          ) : null}
        </>
      )
    case 'error':
      return <p className="select-text text-danger">{s.message}</p>
    default:
      return (
        <p>
          Luca is up to date.
          {s.checkedAt
            ? ` Checked at ${new Date(s.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
            : ''}{' '}
          New versions download by themselves and wait for a restart.
        </p>
      )
  }
}

/** Luca → Check for Updates…: where this Luca stands, and a GitHub token for a private repository. */
export function UpdatesSheet(): ReactElement {
  const open = useUpdates((s) => s.open)
  const setOpen = useUpdates((s) => s.setOpen)
  const s = useUpdates((st) => st.status)
  const check = useUpdates((st) => st.check)
  const install = useUpdates((st) => st.install)
  const move = useUpdates((st) => st.moveToApplications)
  const saveToken = useUpdates((st) => st.saveToken)
  const [changing, setChanging] = useState(false)

  const busy = s?.state === 'checking' || s?.state === 'downloading'
  const showToken = !!s && s.state !== 'off' && (s.needsToken || changing)
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setChanging(false)
      }}
      title="Updates"
      description={s ? `This is Luca ${s.current}.` : undefined}
      width={440}
      footer={
        s && s.state !== 'off' ? (
          <>
            <Button variant="outline" disabled={busy} onClick={() => void check()}>
              Check now
            </Button>
            {s.state === 'ready' ? (
              <Button variant="primary" onClick={() => void install()}>
                Restart to update
              </Button>
            ) : s.needsMove ? (
              <Button variant="primary" onClick={() => void move()}>
                Move to Applications
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <div className="text-[12px] leading-[1.5] text-text-2">
        {s ? <Body s={s} /> : <p>Looking for a newer Luca…</p>}
        {showToken ? <TokenForm onDone={() => setChanging(false)} /> : null}
        {s?.hasToken && !showToken ? (
          <p className="mt-3 text-[11px] text-text-3">
            Using your GitHub token for updates.{' '}
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => setChanging(true)}
            >
              Change
            </button>{' '}
            ·{' '}
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => void saveToken('').catch(() => undefined)}
            >
              Remove
            </button>
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
