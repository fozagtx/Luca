import { Popover } from '@base-ui/react/popover'
import { ArrowUpRight, Clapperboard } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { useChat } from '../../stores/chat'
import { useGemini } from '../../stores/gemini'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

/** Things to ask for, put in the message box to finish. */
const IDEAS = [
  'Make an 8-second clip of ',
  'Make a vertical 1080×1920 clip of ',
  'Restyle this clip to look like ',
  'Continue this clip: ',
  'Bring this picture to life: '
]

function ask(text: string): void {
  useChat.getState().fillDraft(text)
  if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
  requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
}

/** Connects Gemini with the person's own API key (checked with Google, kept with safeStorage). */
function KeyForm({ onDone }: { onDone?: () => void }): ReactElement {
  const saveKey = useGemini((s) => s.saveKey)
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
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <p className="mt-1">
        Luca uses Gemini Omni to make new clips from your words or pictures, restyle a clip or a
        background, and continue a clip, with sound. Paste a Gemini API key: generations are billed
        to the key’s Google Cloud project, so a key from the project that has your credits uses
        them. The key stays on this Mac.
      </p>
      <div className="mt-2 flex gap-1.5">
        <Input
          type="password"
          value={key}
          autoFocus
          onChange={(e) => setKey(e.target.value)}
          placeholder="Gemini API key"
          aria-label="Gemini API key"
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <Button variant="primary" loading={busy} disabled={!key.trim()} onClick={() => void save()}>
          Connect
        </Button>
      </div>
      {error ? <p className="mt-1.5 text-danger select-text">{error}</p> : null}
      <a
        href="https://aistudio.google.com/apikey"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
      >
        Get a key <ArrowUpRight size={11} />
      </a>
    </>
  )
}

/** The toolbar's Gemini button: connect a key, or see what to ask Luca for. */
export function GeminiButton(): ReactElement {
  const hasKey = useGemini((s) => s.hasKey)
  const checkKey = useGemini((s) => s.checkKey)
  const saveKey = useGemini((s) => s.saveKey)
  const hasProject = useProject((s) => !!s.project)
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    if (hasKey === null) void checkKey()
  }, [hasKey, checkKey])

  const connected = hasKey === true && !changing
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setChanging(false)
      }}
    >
      <Tip label={hasKey ? 'Gemini: make and edit video' : 'Connect Gemini to make and edit video'}>
        <Popover.Trigger
          render={<Button variant="ghost" active={open} aria-label="Gemini" className="no-drag" />}
        >
          <Clapperboard size={15} strokeWidth={1.75} />
          Gemini
          {hasKey ? <span aria-hidden className="size-1.5 rounded-full bg-[#34c759]" /> : null}
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="no-drag z-50">
          <Popover.Popup
            className={cn(
              'w-[340px] rounded-[10px] border border-border bg-bg p-3 text-[11.5px] leading-[1.45] text-text-2 shadow-popover outline-none',
              'transition-[transform,opacity] duration-150 ease-[cubic-bezier(.2,.8,.2,1)]',
              'data-[starting-style]:-translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
            )}
          >
            <Popover.Title className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
              <Clapperboard size={13} className="text-text-3" /> Video with Gemini
              {connected ? (
                <span className="ml-auto text-[11px] font-medium text-[#1f9d45]">Connected</span>
              ) : null}
            </Popover.Title>
            {connected ? (
              <>
                <p className="mt-1">
                  Ask Luca in the chat. It makes clips from your words or pictures, restyles a clip
                  or a background (pick one in Backgrounds and say how it should look), continues a
                  clip, and puts the result in your video. Each clip takes a few minutes.
                </p>
                {hasProject ? (
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {IDEAS.map((t) => (
                      <li key={t}>
                        <button
                          type="button"
                          className="w-full rounded-[6px] px-2 py-1 text-left text-[12px] text-text transition-colors hover:bg-hover"
                          onClick={() => {
                            setOpen(false)
                            ask(t)
                          }}
                        >
                          {t.trim().replace(/:$/, '')}…
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-2 flex gap-1.5 border-t border-border pt-2">
                  <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
                    Change key
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void saveKey('')}>
                    Disconnect
                  </Button>
                </div>
              </>
            ) : (
              <KeyForm onDone={() => setChanging(false)} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
