import type { CaptionConfig, CaptionState, CleanStatus } from '@shared/types'
import { AudioLines, CaseUpper, Check, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  BUILTIN_FONTS,
  CAPTION_STYLES,
  SAMPLE_WORDS,
  captionStyle,
  cleanWords,
  configFor,
  groupWords
} from '../../../shared/captions'
import { Button } from '../../components/ui/button'
import { GenerateButton } from '../../components/ui/generate-button'
import { StepList } from '../../components/ui/progress'
import { Segmented } from '../../components/ui/segmented'
import { Sheet } from '../../components/ui/sheet'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { errorMessage, useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'
import { CaptionPreview } from './CaptionPreview'
import { ensurePreviewFont, useSampleGroups } from './preview-lib'

type Word = { text: string; start: number; end: number }

const ACCENTS = [
  '#FFE14D',
  '#FFD400',
  '#7C5CFF',
  '#22D3EE',
  '#FF4D4D',
  '#A3E635',
  '#FF5DA2',
  '#FFFFFF'
]

/**
 * Captions in three moves: scroll the styles and pick one, choose a font (a built-in one or your
 * own file), put them on the timeline. The words come from the transcript, cleaned of fillers,
 * stutters and false starts; Luca writes them as a HyperFrames captions composition.
 */
export function CaptionStudio(): ReactElement {
  const open = useUi((s) => s.captionsOpen)
  const setOpen = useUi((s) => s.setCaptions)
  const project = useProject((s) => s.project)
  return (
    <Sheet
      open={open && !!project}
      onOpenChange={setOpen}
      title="Captions"
      description="Pick a look, pick a font, put them on the timeline. Ums and stutters are cleaned out."
      width={780}
    >
      {open && project ? <Studio key={project.id} onDone={() => setOpen(false)} /> : null}
    </Sheet>
  )
}

function Studio({ onDone }: { onDone: () => void }): ReactElement {
  const project = useProject((s) => s.project)!
  const version = useProject((s) => s.version)
  const recent = useProject((s) => s.recent)
  const [state, setState] = useState<CaptionState | null>(null)
  const [words, setWords] = useState<Word[] | null>(null)
  const [cfg, setCfg] = useState<CaptionConfig | null>(null)
  const [busy, setBusy] = useState<'apply' | 'remove' | 'font' | null>(null)
  const [clean, setClean] = useState<CleanStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const portrait = project.aspect === 'portrait'
  const poster = recent.find((r) => r.dir === project.dir)?.thumb ?? null

  useEffect(() => {
    let live = true
    void Promise.all([luca.captions.state(), luca.captions.words()])
      .then(([s, w]) => {
        if (!live) return
        setState(s)
        setWords(w)
        setCfg((c) => c ?? s.applied ?? configFor(CAPTION_STYLES[0].id))
      })
      .catch((e) => live && setError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [version])

  useEffect(() => luca.clean.onStatus(setClean), [])

  // every preview font, loaded once
  useEffect(() => {
    for (const s of CAPTION_STYLES) ensurePreviewFont(s.font)
    for (const f of state?.fonts ?? []) ensurePreviewFont(f.family, project.id, f.file)
  }, [state, project.id])

  const groups = useMemo(() => {
    if (!cfg) return []
    const src = words && words.length ? words : SAMPLE_WORDS
    return groupWords(cleanWords(src, cfg.clean), { wordsPerLine: cfg.wordsPerLine, portrait })
  }, [words, cfg, portrait])
  const sample = useSampleGroups(groups, 8)
  // the gallery shows each style with its own defaults, over the same sample lines
  const galleryLines = useSampleGroups(
    useMemo(
      () =>
        groupWords(cleanWords(words && words.length ? words : SAMPLE_WORDS, true), {
          wordsPerLine: 'short',
          portrait
        }),
      [words, portrait]
    ),
    4
  )

  const transcribing =
    clean && clean.task === 'transcribe' && !['idle', 'done', 'error'].includes(clean.stage)
  const noWords = words !== null && words.length === 0

  const apply = async (): Promise<void> => {
    if (!cfg) return
    setBusy('apply')
    setError(null)
    try {
      const { lines } = await luca.captions.apply(cfg)
      toast(`Captions on the timeline · ${lines} lines`, {
        description: `${captionStyle(cfg.style).name} in ${cfg.font}`,
        action: { label: 'Undo', onClick: () => void luca.history.undo() }
      })
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const remove = async (): Promise<void> => {
    setBusy('remove')
    try {
      await luca.captions.remove()
      toast('Captions removed', {
        action: { label: 'Undo', onClick: () => void luca.history.undo() }
      })
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const addFont = async (): Promise<void> => {
    setBusy('font')
    try {
      const before = new Set(state?.fonts.map((f) => f.family))
      const fonts = await luca.captions.addFonts()
      setState((s) => (s ? { ...s, fonts } : s))
      const added = fonts.find((f) => f.file && !before.has(f.family))
      if (added && cfg) {
        ensurePreviewFont(added.family, project.id, added.file)
        setCfg({ ...cfg, font: added.family })
        toast(`Added ${added.family}`, {
          description: 'It ships with the project, so exports use it too.'
        })
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (!cfg || !state || words === null)
    return (
      <div className="flex flex-col gap-3 pb-1">
        <div className="skeleton h-[220px] rounded-[12px]" />
        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[118px] rounded-[10px]" />
          ))}
        </div>
      </div>
    )

  if (noWords)
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-[12px] bg-secondary text-secondary-fg">
          <AudioLines size={20} strokeWidth={1.7} />
        </span>
        {!state.hasAudio ? (
          <>
            <div className="text-[14px] font-semibold text-text">No speech to caption</div>
            <p className="max-w-[420px] text-[12.5px] leading-[1.55] text-text-2">
              Captions come from the words spoken in your video or audio, and this project has
              neither. Ask Luca in the chat for animated titles or text instead.
            </p>
          </>
        ) : transcribing ? (
          <div className="w-full max-w-[380px] text-left">
            <div className="mb-3 text-center text-[13px] font-semibold text-text">
              Transcribing your video
            </div>
            <StepList
              steps={[
                { id: 'extracting', label: 'Pulling the audio out' },
                { id: 'uploading', label: 'Uploading to AssemblyAI' },
                { id: 'transcribing', label: 'Transcribing every word' }
              ]}
              current={clean!.stage}
              progress={clean!.progress}
              estimated={clean!.estimated}
              since={clean!.since}
            />
          </div>
        ) : (
          <>
            <div className="text-[14px] font-semibold text-text">First, the words</div>
            <p className="max-w-[420px] text-[12.5px] leading-[1.55] text-text-2">
              Luca transcribes your video with AssemblyAI (an API key is needed, set in the
              Transcript tab), then you pick how the captions look.
            </p>
            <GenerateButton
              label="Transcribe now"
              generatingLabel="Transcribing"
              onClick={() => void luca.clean.transcribe().catch((e) => setError(errorMessage(e)))}
            />
          </>
        )}
        {error ? <p className="text-[12px] text-danger select-text">{error}</p> : null}
      </div>
    )

  const set = (patch: Partial<CaptionConfig>): void => setCfg({ ...cfg, ...patch })
  const style = captionStyle(cfg.style)

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[12px] ring-1 ring-border">
        <CaptionPreview
          cfg={cfg}
          groups={sample}
          height={portrait ? 280 : 208}
          portrait={portrait}
          background={poster}
        />
      </div>

      <div className="-mx-5 max-h-[calc(100vh-590px)] min-h-[170px] overflow-y-auto border-y border-border bg-bg-subtle px-5 py-3 scroll">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[12px] font-semibold text-text">Style</span>
          <span className="text-[11px] text-text-3">
            {CAPTION_STYLES.length} looks · scroll for more
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {CAPTION_STYLES.map((s, i) => {
            const on = s.id === cfg.style
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setCfg(configFor(s.id, { ...cfg, accent: undefined }))}
                style={{ animationDelay: `${i * 25}ms` }}
                className={cn(
                  'rise-in group overflow-hidden rounded-[10px] bg-bg text-left ring-1 transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5',
                  on
                    ? 'shadow-[0_0_0_2px_var(--accent)] ring-transparent'
                    : 'ring-border hover:ring-border-strong'
                )}
              >
                <div className="relative">
                  <CaptionPreview
                    cfg={{ ...configFor(s.id), size: 'md', position: 'middle' }}
                    groups={galleryLines}
                    height={84}
                    zoom={2.3}
                  />
                  {on ? (
                    <span className="pop-in absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-white shadow">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  ) : null}
                </div>
                <div className="px-2.5 py-2">
                  <div className="text-[12px] font-semibold text-text">{s.name}</div>
                  <div className="line-clamp-2 text-[10.5px] leading-[1.35] text-text-3">
                    {s.blurb}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-2.5">
        <Label>Font</Label>
        <div className="flex min-w-0 items-center gap-2">
          <select
            value={cfg.font}
            onChange={(e) => set({ font: e.target.value })}
            style={{ fontFamily: `'${cfg.font}', Inter, sans-serif` }}
            className="h-8 min-w-0 flex-1 rounded-[8px] border border-border bg-bg px-2.5 text-[13px] text-text outline-none hover:border-border-strong"
          >
            {state.fonts.some((f) => f.file) ? (
              <optgroup label="Your fonts">
                {state.fonts
                  .filter((f) => f.file)
                  .map((f) => (
                    <option key={f.family} value={f.family}>
                      {f.family}
                    </option>
                  ))}
              </optgroup>
            ) : null}
            <optgroup label="Built in (embedded in exports)">
              {BUILTIN_FONTS.map((f) => (
                <option key={f.family} value={f.family}>
                  {f.family}
                  {f.family === style.font ? ' · style default' : ''}
                </option>
              ))}
            </optgroup>
          </select>
          <Button onClick={() => void addFont()} loading={busy === 'font'}>
            <Plus size={13} /> Add your font…
          </Button>
        </div>

        <Label>Size</Label>
        <Row>
          <Segmented
            items={[
              { id: 'sm', label: 'Small' },
              { id: 'md', label: 'Medium' },
              { id: 'lg', label: 'Large' }
            ]}
            value={cfg.size}
            onChange={(size) => set({ size })}
            ariaLabel="Size"
          />
          <Segmented
            items={[
              { id: 'bottom', label: 'Bottom' },
              { id: 'middle', label: 'Middle' },
              { id: 'top', label: 'Top' }
            ]}
            value={cfg.position}
            onChange={(position) => set({ position })}
            ariaLabel="Position"
          />
        </Row>

        <Label>Words</Label>
        <Row>
          <Segmented
            items={[
              { id: 'short', label: '2–3' },
              { id: 'normal', label: '4–5' },
              { id: 'long', label: '6–8' }
            ]}
            value={cfg.wordsPerLine}
            onChange={(wordsPerLine) => set({ wordsPerLine })}
            ariaLabel="Words per line"
          />
          <button
            type="button"
            aria-pressed={cfg.uppercase}
            onClick={() => set({ uppercase: !cfg.uppercase })}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] font-medium transition-colors',
              cfg.uppercase
                ? 'border-secondary-border bg-secondary text-secondary-fg'
                : 'border-border text-text-2 hover:text-text'
            )}
          >
            <CaseUpper size={14} /> All caps
          </button>
          <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-text-2 select-none">
            <input
              type="checkbox"
              checked={cfg.clean}
              onChange={(e) => set({ clean: e.target.checked })}
              className="size-3.5 accent-[var(--accent)]"
            />
            Remove ums, stutters & false starts
          </label>
        </Row>

        <Label>Highlight</Label>
        <Row>
          {[style.accent, ...ACCENTS.filter((a) => a.toLowerCase() !== style.accent.toLowerCase())]
            .slice(0, 8)
            .map((a) => {
              const on = (cfg.accent ?? style.accent).toLowerCase() === a.toLowerCase()
              return (
                <button
                  key={a}
                  type="button"
                  aria-label={`Highlight ${a}`}
                  onClick={() => set({ accent: a === style.accent ? undefined : a })}
                  className={cn(
                    'size-6 rounded-full ring-1 ring-black/10 transition-transform duration-150 hover:scale-110',
                    on && 'ring-2 ring-accent ring-offset-2 ring-offset-bg'
                  )}
                  style={{ background: a }}
                />
              )
            })}
          <label
            className="relative size-6 cursor-pointer overflow-hidden rounded-full ring-1 ring-border"
            title="Any color"
          >
            <span className="absolute inset-0 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" />
            <input
              type="color"
              value={cfg.accent ?? style.accent}
              onChange={(e) => set({ accent: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <span className="text-[11px] text-text-3">
            {style.anim === 'fade' || style.anim === 'slide' || style.anim === 'bounce'
              ? 'This style animates whole lines'
              : 'Colors the word being spoken'}
          </span>
        </Row>
      </div>

      {error ? (
        <div className="rounded-[8px] border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12px] text-danger select-text">
          {error}
        </div>
      ) : null}

      <div className="-mx-5 flex items-center gap-2 border-t border-border px-5 pt-3">
        {state.applied ? (
          <Button variant="ghost" onClick={() => void remove()} loading={busy === 'remove'}>
            <Trash2 size={13} /> Remove captions
          </Button>
        ) : (
          <span className="text-[11px] text-text-3">
            {groups.length} lines from {words.length} words
          </span>
        )}
        <Button className="ml-auto" onClick={onDone}>
          Cancel
        </Button>
        <GenerateButton
          label={state.applied ? 'Update captions' : 'Put on timeline'}
          generatingLabel={state.applied ? 'Updating' : 'Adding captions'}
          generating={busy === 'apply'}
          disabled={busy !== null}
          onClick={() => void apply()}
        />
      </div>
    </div>
  )
}

function Label({ children }: { children: ReactNode }): ReactElement {
  return <span className="text-[12px] font-medium text-text-2">{children}</span>
}
function Row({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
}
