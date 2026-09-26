import { AudioLines, Captions, Check, ChevronRight, CircleAlert, Scissors } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { captionStyle } from '../../../../shared/captions'
import type {
  CaptionState,
  CleanStatus,
  Cut,
  Edl,
  Transcript,
  Word
} from '../../../../shared/types'
import { AnimatedNumber } from '../../../components/ui/animated-number'
import { Button } from '../../../components/ui/button'
import { GenerateButton } from '../../../components/ui/generate-button'
import { ProgressBar, StepList, type Step } from '../../../components/ui/progress'
import { cn } from '../../../lib/cn'
import { luca } from '../../../lib/luca'
import { useChat } from '../../../stores/chat'
import { usePlayer } from '../../../stores/player'
import { errorMessage, useProject } from '../../../stores/project'
import { useUi } from '../../../stores/ui'
import { AssemblyAiKeyCard } from '../../onboarding/AssemblyAiKeyCard'
import { EmptyPane } from '../EmptyPane'
import { PaneHead } from '../Sidebar'

const CLEAN_STEPS: (Step & { weight: number })[] = [
  { id: 'extracting', label: 'Pulling the audio out', weight: 6 },
  { id: 'uploading', label: 'Uploading the audio', weight: 12 },
  { id: 'transcribing', label: 'Transcribing every word (fillers kept)', weight: 32 },
  { id: 'candidates', label: 'Finding fillers and long pauses', weight: 2 },
  { id: 'reviewing', label: 'Luca reviews the cuts (retakes, false starts)', weight: 26 },
  { id: 'applying', label: 'Cutting a clean master', weight: 19 },
  { id: 'relinking', label: 'Putting it on the timeline', weight: 3 }
]
const TRANSCRIBE_STEPS = CLEAN_STEPS.slice(0, 3)

/** Weighted overall progress across the steps, counting the running step's own progress. */
function overall(steps: typeof CLEAN_STEPS, s: CleanStatus): number {
  const total = steps.reduce((n, x) => n + x.weight, 0)
  const at = steps.findIndex((x) => x.id === s.stage)
  if (at < 0) return s.stage === 'done' ? 1 : 0
  const done = steps.slice(0, at).reduce((n, x) => n + x.weight, 0)
  return (done + steps[at].weight * (s.progress ?? 0.15)) / total
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
  const [captions, setCaptionState] = useState<CaptionState | null>(null)
  const setCaptions = useUi((s) => s.setCaptions)

  const load = useCallback(async (): Promise<void> => {
    const [t, e, s, k, c] = await Promise.all([
      luca.clean.transcript(),
      luca.clean.edl(),
      luca.clean.status(),
      luca.env.hasAssemblyAiKey(),
      luca.captions.state().catch(() => null)
    ])
    setTranscript(t)
    setEdl(e)
    setStatus(s)
    setHasKey(k)
    setCaptionState(c)
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
  const task = status.task ?? 'clean'
  const steps = task === 'transcribe' ? TRANSCRIBE_STEPS : CLEAN_STEPS
  const noAudio = captions ? !captions.hasAudio : false

  const run = async (which: 'clean' | 'transcribe'): Promise<void> => {
    setError(null)
    try {
      await (which === 'clean' ? luca.clean.run() : luca.clean.transcribe())
    } catch (e) {
      setError(errorMessage(e))
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
      <div className="flex flex-col gap-3 border-b border-border p-3">
        {hasKey === false ? (
          <AssemblyAiKeyCard onSaved={setHasKey}>
            Luca sends only the audio for transcription and deletes the transcript from AssemblyAI
            afterwards. Your key stays in the macOS Keychain.
          </AssemblyAiKeyCard>
        ) : null}
        {noAudio ? (
          <p className="text-[11.5px] leading-[1.5] text-text-3">
            This project has no video or audio with speech to transcribe. Ask Luca in the chat for
            animated text instead.
          </p>
        ) : busy ? (
          <div className="rise-in card p-3">
            <div className="mb-2.5 flex items-baseline gap-2">
              <span className="text-[12px] font-semibold text-text">
                {task === 'transcribe' ? 'Transcribing' : 'Cleaning your video'}
              </span>
              <span className="ml-auto font-mono text-[11px] text-text-2 tabular-nums">
                <AnimatedNumber
                  value={overall(steps, status) * 100}
                  format={(n) => `${Math.round(n)}%`}
                />
              </span>
            </div>
            <ProgressBar value={overall(steps, status)} className="mb-3" />
            <StepList
              steps={steps}
              current={status.stage}
              progress={status.progress}
              estimated={status.estimated}
              since={status.since}
              detail={status.message}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <GenerateButton
                size="sm"
                hue={210}
                label={transcript ? 'Re-run clean edit' : 'Clean edit'}
                generatingLabel="Cleaning"
                icon={<Scissors size={12} />}
                disabled={hasKey !== true}
                onClick={() => void run('clean')}
              />
              {!transcript ? (
                <Button disabled={hasKey !== true} onClick={() => void run('transcribe')}>
                  <AudioLines size={13} /> Just transcribe
                </Button>
              ) : null}
            </div>
            <p className="text-[11px] leading-[1.5] text-text-3">
              {transcript
                ? 'Clean edit cuts fillers, long pauses and retakes into a clean master.'
                : 'Just transcribe gets the words for captions. Clean edit also cuts fillers, pauses and retakes.'}
            </p>
            {status.stage === 'done' || status.stage === 'error' ? (
              <div
                className={cn(
                  'rise-in flex items-start gap-1.5 text-[11px] leading-[1.4]',
                  status.stage === 'error' ? 'text-danger' : 'text-text-2'
                )}
              >
                {status.stage === 'error' ? (
                  <CircleAlert size={12} className="mt-px shrink-0" />
                ) : (
                  <Check size={12} className="mt-px shrink-0 text-success" />
                )}
                <span className="select-text">{status.message}</span>
              </div>
            ) : null}
          </div>
        )}
        {error ? (
          <div className="flex items-start gap-1.5 rounded-[8px] border border-danger/25 bg-danger/[0.06] px-2.5 py-2 text-[11px] leading-[1.4] text-danger">
            <CircleAlert size={12} className="mt-px shrink-0" />
            <span className="select-text">{error}</span>
          </div>
        ) : null}
        {transcript && !busy ? (
          <button
            type="button"
            onClick={() => setCaptions(true)}
            className="card card-hover group flex items-center gap-3 p-2.5 text-left"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-secondary text-secondary-fg">
              <Captions size={17} strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-text">
                {captions?.applied ? 'Captions are on the timeline' : 'Add captions to the video'}
              </span>
              <span className="block truncate text-[11px] text-text-3">
                {captions?.applied
                  ? `${captionStyle(captions.applied.style).name} · ${captions.applied.font} · change the style`
                  : 'Cleaned of fillers, with a style and font you choose'}
              </span>
            </span>
            <ChevronRight
              size={15}
              className="shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5"
            />
          </button>
        ) : null}
      </div>
      {!transcript ? (
        <EmptyPane
          title="No transcript yet"
          hint="Clean edit transcribes your video word by word, suggests cuts for ums, pauses and retakes, lets Luca pick the best takes and gives you a clean master clip."
        />
      ) : (
        <>
          {sel ? (
            <div className="flex items-center gap-1 border-b border-border bg-bg-subtle px-3 py-1.5">
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
