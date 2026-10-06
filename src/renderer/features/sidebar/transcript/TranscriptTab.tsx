import {
  AudioLines,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Scissors,
  Search,
  X
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { captionStyle } from '../../../../shared/captions'
import type {
  CaptionState,
  CleanStatus,
  Clip,
  Cut,
  Edl,
  Timeline,
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
import { useTimeline } from '../../../stores/timeline'
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

/**
 * Where moments of the recording play in the video. Words keep their original times; after a
 * clean edit the video plays the clean master, where every cut before them is gone. Then the clips
 * that play the speech (moved, trimmed or split) place that moment on the timeline, as captions do.
 * Built once per transcript/timeline, then asked for every word.
 */
function placer(cuts: Cut[], timeline: Timeline | null, source: string): (t: number) => number {
  const clips = timeline?.tracks.flatMap((tr) => tr.clips) ?? []
  const file = (c: Clip): string => (c.src ?? '').split(/[?#]/)[0]
  const master = clips.filter((c) => /^media\/clean-[0-9a-f]+\.mp4$/.test(file(c)))
  const raw = clips.filter((c) => file(c).split('/').pop() === source)
  const pool = master.length ? master : raw
  const heard = pool.filter((c) => c.kind === 'audio')
  const playing = heard.length ? heard : pool
  return (t) => {
    const clean = Math.max(
      0,
      t - cuts.filter((c) => c.end <= t + 1e-3).reduce((acc, c) => acc + (c.end - c.start), 0)
    )
    const at = master.length ? clean : t
    const hit = playing.find((c) => {
      const from = c.mediaStart ?? 0
      return at >= from - 1e-3 && at < from + c.end - c.start
    })
    return hit ? hit.start + at - (hit.mediaStart ?? 0) : clean
  }
}

/** Lowercased letters and digits of a word, so "Coffee," finds "coffee". */
const normalize = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')

/** Runs of words (first and last index) that read as the query, in order. */
function findMatches(words: Word[], query: string): { a: number; b: number }[] {
  const q = query.split(/\s+/).map(normalize).filter(Boolean).join(' ')
  if (!q) return []
  const offsets: number[] = []
  let text = ''
  for (const w of words) {
    offsets.push(text.length)
    text += normalize(w.text) + ' '
  }
  const wordAt = (pos: number): number => {
    let lo = 0
    let hi = offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const out: { a: number; b: number }[] = []
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
    out.push({ a: wordAt(i), b: wordAt(i + q.length - 1) })
    if (out.length >= 500) break
  }
  return out
}

export function TranscriptTab(): ReactElement {
  const project = useProject((s) => s.project)
  const projectId = project?.id ?? null
  const source = project?.source ?? ''
  const version = useProject((s) => s.version)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [edl, setEdl] = useState<Edl | null>(null)
  const [status, setStatus] = useState<CleanStatus>({ stage: 'idle' })
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captions, setCaptionState] = useState<CaptionState | null>(null)
  /** Asked to run, and the first progress hasn't come back yet. */
  const [starting, setStarting] = useState<'clean' | 'transcribe' | null>(null)
  const [query, setQuery] = useState('')
  /** The match last gone to; -1 until Enter or an arrow goes to one. */
  const [hit, setHit] = useState(-1)
  const setCaptions = useUi((s) => s.setCaptions)
  const timeline = useTimeline((s) => s.timeline)
  const listRef = useRef<HTMLDivElement>(null)
  const loadSeq = useRef(0)

  // every change to the project reloads; only the newest answer is shown
  const load = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current
    try {
      const [t, e, s, k, c] = await Promise.all([
        luca.clean.transcript(),
        luca.clean.edl(),
        luca.clean.status(),
        luca.env.hasAssemblyAiKey(),
        luca.captions.state().catch(() => null)
      ])
      if (seq !== loadSeq.current) return
      setTranscript(t)
      setEdl(e)
      setStatus(s)
      setHasKey(k)
      setCaptionState(c)
    } catch (err) {
      if (seq === loadSeq.current) setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    if (!projectId) return
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [projectId, version, load])
  useEffect(
    () =>
      luca.clean.onStatus((s) => {
        setStatus(s)
        if (BUSY.has(s.stage) || s.stage === 'error') setStarting(null)
        if (s.stage === 'done') void load()
      }),
    [load]
  )

  const words = useMemo(() => transcript?.words ?? [], [transcript])

  const cuts = useMemo(() => edl?.cuts ?? [], [edl])
  const cutIndex = useMemo(() => {
    const m = new Map<string, Cut>()
    for (const w of words) {
      const c = cuts.find((c) => w.start >= c.start - 1e-3 && w.end <= c.end + 1e-3)
      if (c) m.set(w.id, c)
    }
    return m
  }, [words, cuts])

  const at = useMemo(() => placer(cuts, timeline, source), [cuts, timeline, source])
  // where each word that is still heard plays, in time order, to follow the playhead
  const heard = useMemo(
    () =>
      words
        .flatMap((w, i) => (cutIndex.has(w.id) ? [] : [{ i, start: at(w.start), end: at(w.end) }]))
        .sort((a, b) => a.start - b.start),
    [words, cutIndex, at]
  )

  const matches = useMemo(() => findMatches(words, query), [words, query])
  const current = matches.length && hit >= 0 ? matches[Math.min(hit, matches.length - 1)] : null
  const matched = useMemo(() => {
    const m = new Set<number>()
    for (const r of matches) for (let i = r.a; i <= r.b; i++) m.add(i)
    return m
  }, [matches])

  /** Scroll the list (only the list, not the panes around it) so word `i` is in the middle. */
  const reveal = useCallback((i: number, smooth = true): void => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-w="${i}"]`)
    if (!list || !el) return
    const top = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2
    list.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // the word being heard is marked as the video plays, and the list keeps it in view while
  // playing (unless the person scrolled the list themselves just now). Marked on the element
  // directly: re-rendering every word on every frame would be far too slow for a long video.
  const userScrolled = useRef(0)
  useEffect(() => {
    let shown = -1
    let marked: Element | null = null
    const mark = (t: number, playing: boolean): void => {
      let lo = 0
      let hi = heard.length - 1
      let at = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (heard[mid].start <= t + 1e-3) {
          at = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      // between words the last one stays marked for a beat, then nothing is
      const w = at >= 0 && t < heard[at].end + 0.35 ? heard[at].i : -1
      if (w === shown) return
      marked?.removeAttribute('data-now')
      marked = null
      shown = w
      const list = listRef.current
      const el = w >= 0 ? list?.querySelector<HTMLElement>(`[data-w="${w}"]`) : null
      if (!list || !el) return
      el.setAttribute('data-now', '')
      marked = el
      if (playing && Date.now() - userScrolled.current > 2500) {
        const top = el.offsetTop - list.scrollTop
        if (top < 24 || top > list.clientHeight - 48) reveal(w)
      }
    }
    const p = usePlayer.getState()
    mark(p.currentTime, false)
    const off = usePlayer.subscribe((s, prev) => {
      if (s.currentTime !== prev.currentTime) mark(s.currentTime, s.playing)
    })
    return () => {
      off()
      marked?.removeAttribute('data-now')
    }
  }, [heard, reveal])

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
    if (starting) return
    setError(null)
    setStarting(which)
    try {
      await (which === 'clean' ? luca.clean.run() : luca.clean.transcribe())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setStarting(null)
    }
  }

  const selected = (): Word[] => {
    if (!transcript || !sel) return []
    const [a, b] = [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)]
    return transcript.words.slice(a, b + 1)
  }
  const selWords = selected()
  const selCut = selWords.filter((w) => cutIndex.has(w.id)).length

  const writeEdl = async (next: Cut[]): Promise<void> => {
    setError(null)
    const e: Edl = { version: 1, source: edl?.source ?? project.source, cuts: next }
    try {
      await luca.clean.applyEdl(e)
      setSel(null)
    } catch (err) {
      setError(errorMessage(err))
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
      start: at(ws[0].start),
      end: at(ws[ws.length - 1].end)
    })
    if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
    // the chat may only now be mounting: focus once it is there
    requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
  }

  /** Go to match `n` (wrapping): it scrolls into view and the playhead goes there. */
  const goTo = (n: number): void => {
    if (!matches.length) return
    const i = (n + matches.length) % matches.length
    setHit(i)
    reveal(matches[i].a)
    usePlayer.getState().seek(at(words[matches[i].a].start))
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
            Luca sends the audio (not the video) and any key terms you added to AssemblyAI for
            transcription, then deletes the transcript there. Your key stays in the macOS Keychain.
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
                generatingLabel="Starting"
                generating={starting === 'clean'}
                icon={<Scissors size={12} />}
                disabled={hasKey !== true || starting !== null}
                onClick={() => void run('clean')}
              />
              {!transcript ? (
                <Button
                  disabled={hasKey !== true || starting === 'clean'}
                  loading={starting === 'transcribe'}
                  onClick={() => void run('transcribe')}
                >
                  <AudioLines size={13} /> Just transcribe
                </Button>
              ) : null}
            </div>
            <p className="text-[11px] leading-[1.5] text-text-3">
              {transcript
                ? 'Clean edit cuts fillers, long pauses and retakes into a clean master.'
                : 'Just transcribe gets the words for captions. Clean edit also cuts fillers, pauses and retakes.'}
            </p>
            {(status.stage === 'done' || status.stage === 'error') && status.message ? (
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
          {transcript.words.length ? (
            <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={12}
                  strokeWidth={1.75}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-3"
                />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setHit(-1)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      // ⇧↩ goes back (from the last match when none was gone to yet)
                      goTo(e.shiftKey ? (hit < 0 ? -1 : hit - 1) : hit + 1)
                    } else if (e.key === 'Escape' && query) {
                      e.stopPropagation()
                      setQuery('')
                      setHit(-1)
                    }
                  }}
                  placeholder="Find in transcript"
                  aria-label="Find in transcript"
                  spellCheck={false}
                  className="h-6 w-full rounded-[6px] border border-transparent bg-bg-muted pr-6 pl-7 text-[12px] text-text placeholder:text-text-3 transition-[background-color,border-color] duration-150 hover:bg-hover focus:border-border focus:bg-bg"
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery('')
                      setHit(-1)
                    }}
                    className="absolute top-1/2 right-1 flex size-4 -translate-y-1/2 items-center justify-center rounded-full text-text-3 hover:bg-hover hover:text-text"
                  >
                    <X size={10} />
                  </button>
                ) : null}
              </div>
              {query.trim() ? (
                <>
                  <span
                    className="shrink-0 px-1 text-[10.5px] text-text-3 tabular-nums"
                    aria-live="polite"
                  >
                    {!matches.length
                      ? 'No match'
                      : hit < 0
                        ? `${matches.length} found`
                        : `${Math.min(hit, matches.length - 1) + 1} of ${matches.length}`}
                  </span>
                  <Button
                    variant="icon"
                    className="size-6 shrink-0"
                    aria-label="Previous match"
                    disabled={!matches.length}
                    onClick={() => goTo(hit < 0 ? -1 : hit - 1)}
                  >
                    <ChevronUp size={13} />
                  </Button>
                  <Button
                    variant="icon"
                    className="size-6 shrink-0"
                    aria-label="Next match"
                    disabled={!matches.length}
                    onClick={() => goTo(hit + 1)}
                  >
                    <ChevronDown size={13} />
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          {sel ? (
            <div className="flex items-center gap-1 border-b border-border bg-bg-subtle px-3 py-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={cutSelection}
                disabled={busy || selCut === selWords.length}
                title={selCut === selWords.length ? 'Already cut' : undefined}
              >
                <Scissors size={11} /> Cut
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={restoreSelection}
                disabled={busy || selCut === 0}
                title={selCut === 0 ? 'Nothing cut here to restore' : undefined}
              >
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
          <div
            ref={listRef}
            onWheel={() => (userScrolled.current = Date.now())}
            onPointerDown={() => (userScrolled.current = Date.now())}
            className="scroll relative flex-1 px-3 py-2.5 text-[12.5px] leading-[1.95] text-text select-none"
          >
            {transcript.words.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-text-3">
                No words were heard in this video.
              </p>
            ) : null}
            {transcript.words.map((w, i) => {
              const cut = cutIndex.get(w.id)
              const inSel = sel && i >= Math.min(sel.a, sel.b) && i <= Math.max(sel.a, sel.b)
              const found = matched.has(i)
              const here = current !== null && i >= current.a && i <= current.b
              return (
                <Fragment key={w.id}>
                  <span
                    data-w={i}
                    title={`${w.start.toFixed(2)}s${cut ? ` · cut (${cut.reason})` : ''}`}
                    onClick={(e) => {
                      if (e.shiftKey && sel) setSel({ a: sel.a, b: i })
                      else if (e.metaKey || e.shiftKey) setSel({ a: i, b: i })
                      else {
                        setSel(null)
                        usePlayer.getState().seek(at(w.start))
                      }
                    }}
                    className={cn(
                      '-mx-[2px] cursor-pointer rounded-[3px] px-[2px] py-px transition-colors hover:bg-hover',
                      // the word being heard right now
                      'data-[now]:bg-accent/15 data-[now]:text-text data-[now]:shadow-[inset_0_-1.5px_0_var(--accent)]',
                      w.filler && !cut && 'text-text-3 line-through decoration-text-3/70',
                      cut && 'bg-danger/10 text-text-3 line-through decoration-danger/60',
                      found && 'bg-warning/25 text-text',
                      here && 'bg-warning/55 text-text',
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
