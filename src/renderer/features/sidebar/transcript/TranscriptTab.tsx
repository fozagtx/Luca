import { CircleAlert, Scissors } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { CleanStatus, Cut, Edl, Transcript, Word } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { GenerateButton } from '../../../components/ui/generate-button'
import { cn } from '../../../lib/cn'
import { luca } from '../../../lib/luca'
import { useChat } from '../../../stores/chat'
import { usePlayer } from '../../../stores/player'
import { useProject } from '../../../stores/project'
import { useUi } from '../../../stores/ui'
import { AssemblyAiKeyCard } from '../../onboarding/AssemblyAiKeyCard'
import { EmptyPane } from '../EmptyPane'
import { PaneHead } from '../Sidebar'

const STAGE_LABEL: Record<CleanStatus['stage'], string> = {
  idle: '',
  extracting: 'Extracting audio…',
  uploading: 'Uploading audio to AssemblyAI…',
  transcribing: 'Transcribing…',
  candidates: 'Finding fillers and pauses…',
  reviewing: 'Luca is reviewing the cut list…',
  applying: 'Cutting the video…',
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

  if (!project)
    return (
      <div className="flex h-full flex-col">
        <PaneHead title="Transcript" />
        <EmptyPane title="No project open" hint="Open a project to transcribe and clean it." />
      </div>
    )

  const busy = BUSY.has(status.stage)

  const run = async (): Promise<void> => {
    setError(null)
    try {
      await luca.clean.run()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
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
      <PaneHead title="Transcript">
        {transcript ? (
          <span className="text-[10.5px] text-text-3">
            {transcript.words.length} words · {cuts.length} cuts
          </span>
        ) : null}
      </PaneHead>
      <div className="border-b border-border p-2.5">
        {hasKey === false ? (
          <AssemblyAiKeyCard className="mb-2.5" onSaved={setHasKey}>
            Clean edit uploads a mono FLAC of the audio and deletes the transcript from AssemblyAI
            afterwards. The key is stored in the macOS Keychain (safeStorage).
          </AssemblyAiKeyCard>
        ) : null}
        <div className="flex items-center gap-2">
          <GenerateButton
            size="sm"
            hue={210}
            label={transcript ? 'Re-run clean edit' : 'Clean edit'}
            generatingLabel="Cleaning"
            generating={busy}
            icon={<Scissors size={12} />}
            disabled={busy || hasKey !== true}
            onClick={() => void run()}
          />
          <span
            className={cn(
              'truncate text-[10.5px] text-text-3',
              status.stage === 'error' && 'text-danger'
            )}
          >
            {busy ? STAGE_LABEL[status.stage] : (status.message ?? '')}
          </span>
        </div>
        {error ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-[6px] border border-danger/25 bg-danger/8 px-2 py-1.5 text-[10.5px] leading-[1.4] text-danger">
            <CircleAlert size={12} className="mt-px shrink-0" />
            <span className="select-text">{error}</span>
          </div>
        ) : null}
      </div>
      {!transcript ? (
        <EmptyPane
          title="No transcript yet"
          hint="Clean edit transcribes the video with AssemblyAI (fillers kept), proposes cuts, lets Luca judge retakes and produces a clean master clip."
        />
      ) : (
        <>
          {sel ? (
            <div className="flex items-center gap-1 border-b border-border bg-bg-subtle px-2.5 py-1.5">
              <Button size="sm" variant="outline" onClick={cutSelection} disabled={busy}>
                <Scissors size={11} /> Cut
              </Button>
              <Button size="sm" variant="outline" onClick={restoreSelection} disabled={busy}>
                Restore
              </Button>
              <Button size="sm" variant="outline" onClick={addToChat}>
                Add to chat
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSel(null)}>
                Clear
              </Button>
            </div>
          ) : null}
          <div className="scroll flex-1 px-3 py-2.5 text-[12.5px] leading-[1.95] text-text select-none">
            {transcript.words.map((w, i) => {
              const cut = cutIndex.get(w.id)
              const inSel = sel && i >= Math.min(sel.a, sel.b) && i <= Math.max(sel.a, sel.b)
              return (
                <Fragment key={w.id}>
                  <span
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
                      '-mx-[2px] cursor-pointer rounded-[3px] px-[2px] py-px transition-colors hover:bg-hover',
                      w.filler && !cut && 'text-text-3 line-through decoration-text-3/70',
                      cut && 'bg-danger/10 text-text-3 line-through decoration-danger/60',
                      inSel && 'bg-accent/20 text-text'
                    )}
                  >
                    {w.text}
                  </span>{' '}
                </Fragment>
              )
            })}
          </div>
          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10.5px] text-text-3">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-4 rounded-[2px] bg-danger/10 ring-1 ring-danger/30" />{' '}
              cut
            </span>
            <span className="line-through">filler</span>
            <span className="ml-auto">click seeks · ⌘/⇧-click selects</span>
          </div>
        </>
      )}
    </div>
  )
}
