import { Scissors } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { CleanStatus, Cut, Edl, Transcript, Word } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { cn } from '../../../lib/cn'
import { luca } from '../../../lib/luca'
import { useChat } from '../../../stores/chat'
import { usePlayer } from '../../../stores/player'
import { useProject } from '../../../stores/project'
import { useUi } from '../../../stores/ui'
import { EmptyPane } from '../EmptyPane'

const STAGE_LABEL: Record<CleanStatus['stage'], string> = {
  idle: '',
  extracting: 'Extracting audio…',
  uploading: 'Uploading audio to AssemblyAI…',
  transcribing: 'Transcribing…',
  candidates: 'Finding fillers and pauses…',
  reviewing: 'Claude is reviewing the cut list…',
  applying: 'Cutting with ffmpeg…',
  relinking: 'Relinking the timeline…',
  done: 'Clean edit done',
  error: 'Clean edit failed'
}

const BUSY = new Set<CleanStatus['stage']>([
  'extracting',
  'uploading',
  'transcribing',
  'candidates',
  'reviewing',
  'applying',
  'relinking'
])

export function TranscriptTab(): ReactElement {
  const project = useProject((s) => s.project)
  const version = useProject((s) => s.version)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [edl, setEdl] = useState<Edl | null>(null)
  const [status, setStatus] = useState<CleanStatus>({ stage: 'idle' })
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [t, e, s, k] = await Promise.all([
      luca.clean.transcript(),
      luca.clean.edl(),
      luca.clean.status(),
      luca.env.hasAssemblyAiKey()
    ])
    setTranscript(t)
    setEdl(e)
    setStatus(s)
    setHasKey(k)
  }, [])

  useEffect(() => {
    if (!project) return
    const t = setTimeout(() => void load().catch(() => undefined), 0)
    return () => clearTimeout(t)
  }, [project, version, load])
  useEffect(
    () =>
      luca.clean.onStatus((s) => {
        setStatus(s)
        if (s.stage === 'done') void load().catch(() => undefined)
      }),
    [load]
  )

  const cuts = useMemo(() => edl?.cuts ?? [], [edl])
  const cutIndex = useMemo(() => {
    const m = new Map<string, Cut>()
    if (!transcript) return m
    for (const w of transcript.words) {
      const c = cuts.find((c) => w.start >= c.start - 1e-3 && w.end <= c.end + 1e-3)
      if (c) m.set(w.id, c)
    }
    return m
  }, [transcript, cuts])

  if (!project) return <EmptyPane title="Transcript" hint="Open a project first." />

  const busy = BUSY.has(status.stage)

  const run = async (): Promise<void> => {
    setError(null)
    try {
      await luca.clean.run()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const saveKey = async (): Promise<void> => {
    if (!key.trim()) return
    setHasKey(await luca.env.setAssemblyAiKey(key.trim()))
    setKey('')
  }

  const selected = (): Word[] => {
    if (!transcript || !sel) return []
    const [a, b] = [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)]
    return transcript.words.slice(a, b + 1)
  }

  const writeEdl = async (next: Cut[]): Promise<void> => {
    setError(null)
    const e: Edl = { version: 1, source: edl?.source ?? project.source, cuts: next }
    try {
      await luca.clean.applyEdl(e)
      setSel(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const cutSelection = (): void => {
    const ws = selected()
    if (!ws.length) return
    void writeEdl([
      ...cuts,
      {
        start: ws[0].start,
        end: ws[ws.length - 1].end,
        reason: 'manual',
        text: ws.map((w) => w.text).join(' ')
      }
    ])
  }
  const restoreSelection = (): void => {
    const ws = selected()
    if (!ws.length) return
    const hit = new Set(ws.map((w) => cutIndex.get(w.id)).filter(Boolean))
    void writeEdl(cuts.filter((c) => !hit.has(c)))
  }
  const addToChat = (): void => {
    const ws = selected()
    if (!ws.length) return
    useChat.getState().addChip({
      kind: 'transcript',
      text: ws.map((w) => w.text).join(' '),
      start: ws[0].start,
      end: ws[ws.length - 1].end
    })
    if (!useUi.getState().chatOpen) useUi.getState().toggleChat()
    document.getElementById('chat-composer')?.focus()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2">
        {hasKey === false ? (
          <div className="mb-2 rounded-[8px] border border-border bg-bg-muted p-2 text-[11px] text-text-2">
            <div className="font-medium text-text">AssemblyAI key</div>
            <p className="mt-0.5">
              Clean edit uploads a mono FLAC of the audio and deletes the transcript from AssemblyAI
              afterwards. The key is stored in the macOS Keychain (safeStorage).
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="AssemblyAI API key"
                onKeyDown={(e) => e.key === 'Enter' && void saveKey()}
              />
              <Button size="sm" onClick={() => void saveKey()} disabled={!key.trim()}>
                Save
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy || hasKey !== true} onClick={() => void run()}>
            <Scissors size={12} /> {transcript ? 'Re-run clean edit' : 'Clean edit'}
          </Button>
          <span
            className={cn(
              'truncate text-[10.5px] text-text-3',
              status.stage === 'error' && 'text-[#FF3B30]'
            )}
          >
            {busy ? STAGE_LABEL[status.stage] : (status.message ?? '')}
          </span>
        </div>
        {error ? <p className="mt-1 text-[10.5px] text-[#FF3B30]">{error}</p> : null}
      </div>
      {!transcript ? (
        <EmptyPane
          title="No transcript yet"
          hint="Clean edit transcribes the video with AssemblyAI (fillers kept), proposes cuts, lets Claude judge retakes and produces a clean master clip."
        />
      ) : (
        <>
          {sel ? (
            <div className="flex items-center gap-1 border-b border-border px-2 py-1">
              <Button size="sm" variant="secondary" onClick={cutSelection} disabled={busy}>
                Cut
              </Button>
              <Button size="sm" variant="secondary" onClick={restoreSelection} disabled={busy}>
                Restore
              </Button>
              <Button size="sm" variant="secondary" onClick={addToChat}>
                Add to chat
              </Button>
              <button className="ml-auto text-[10px] text-text-3" onClick={() => setSel(null)}>
                Clear
              </button>
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto p-2 text-[12px] leading-[1.9] text-text select-none">
            {transcript.words.map((w, i) => {
              const cut = cutIndex.get(w.id)
              const inSel = sel && i >= Math.min(sel.a, sel.b) && i <= Math.max(sel.a, sel.b)
              return (
                <span
                  key={w.id}
                  title={`${w.start.toFixed(2)}s${cut ? ` · cut (${cut.reason})` : ''}`}
                  onClick={(e) => {
                    if (e.shiftKey && sel) setSel({ a: sel.a, b: i })
                    else if (e.metaKey || e.shiftKey) setSel({ a: i, b: i })
                    else {
                      setSel(null)
                      const shift = cuts
                        .filter((c) => c.end <= w.start + 1e-3)
                        .reduce((acc, c) => acc + (c.end - c.start), 0)
                      usePlayer.getState().seek(Math.max(0, w.start - shift))
                    }
                  }}
                  className={cn(
                    'cursor-pointer rounded-[3px] px-[2px]',
                    w.filler && 'text-text-3 line-through',
                    cut && 'bg-[#FF3B30]/12 text-text-3 line-through',
                    inSel && 'bg-accent/25'
                  )}
                >
                  {w.text}{' '}
                </span>
              )
            })}
          </div>
          <div className="border-t border-border px-2 py-1 text-[10px] text-text-3">
            {transcript.words.length} words · {cuts.length} cuts · click seeks · ⌘/⇧-click selects
          </div>
        </>
      )}
    </div>
  )
}
