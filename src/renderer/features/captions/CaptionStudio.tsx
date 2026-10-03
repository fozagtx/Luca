import { isPortrait } from '@shared/aspect'
import type { CaptionConfig, CaptionOverrides, CaptionState, CleanStatus } from '@shared/types'
import {
  AudioLines,
  CaseUpper,
  Check,
  ChevronDown,
  Link2,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  BUILTIN_FONTS,
  BUNDLED_FONTS,
  CAPTION_STYLES,
  SAMPLE_WORDS,
  bundledFont,
  captionLook,
  captionStyle,
  cleanWords,
  configFor,
  groupWords,
  markEmphasis
} from '../../../shared/captions'
import { Button } from '../../components/ui/button'
import { GenerateButton } from '../../components/ui/generate-button'
import { Input } from '../../components/ui/input'
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
const TEXT_COLORS = ['#FFFFFF', '#111111', '#FFE14D', '#22D3EE', '#FF5DA2', '#A3E635', '#FF4D4D']

/** Outline widths (px at 1080p) behind the None / Thin / Bold / Heavy choice. */
const OUTLINES = { none: 0, thin: 3, bold: 6, heavy: 10 } as const
const WEIGHTS = { '400': 'Regular', '700': 'Bold', '900': 'Black' } as const

/** A CSS color as #rrggbb plus its alpha, for color inputs; black when it can't be read. */
function splitColor(c: string): { hex: string; alpha: number } {
  const h = /^#([0-9a-f]{3,8})$/i.exec(c)?.[1]
  if (h) {
    const full = h.length <= 4 ? [...h].map((x) => x + x).join('') : h
    const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1
    return { hex: `#${full.slice(0, 6)}`.toLowerCase(), alpha }
  }
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/i.exec(c)
  if (!m) return { hex: '#000000', alpha: 1 }
  const hex = [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
  return { hex: `#${hex}`, alpha: m[4] === undefined ? 1 : Number(m[4]) }
}

/**
 * Captions in three moves: scroll the styles and pick one, choose a font (a built-in one, one that
 * comes with Luca or your own file), put them on the timeline. The words come from the transcript,
 * cleaned of fillers, stutters and false starts; Luca writes them as a HyperFrames captions
 * composition.
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
  const [busy, setBusy] = useState<'apply' | 'remove' | 'font' | 'google' | null>(null)
  const [clean, setClean] = useState<CleanStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [customOpen, setCustomOpen] = useState<boolean | null>(null)
  const portrait = isPortrait(project.aspect)
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
    for (const f of BUNDLED_FONTS) ensurePreviewFont(f.family)
    for (const f of state?.fonts ?? []) ensurePreviewFont(f.family, project.id, f.faces)
  }, [state, project.id])

  const groups = useMemo(() => {
    if (!cfg) return []
    const src = words && words.length ? words : SAMPLE_WORDS
    // as the captions will be: the look's emphasis words and its own line length
    const s = captionStyle(cfg.style)
    const cleaned = cleanWords(src, cfg.clean)
    return groupWords(s.emphasis ? markEmphasis(cleaned, cfg.emphasis) : cleaned, {
      wordsPerLine: cfg.wordsPerLine,
      portrait,
      ...(s.line && cfg.wordsPerLine === s.words ? { limit: s.line } : {})
    })
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
        description: `${captionStyle(cfg.style).name}${cfg.overrides ? ', customized,' : ''} in ${cfg.font}`,
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
        ensurePreviewFont(added.family, project.id, added.faces)
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
  const addGoogleFont = async (): Promise<void> => {
    if (!link.trim()) return
    setBusy('google')
    setError(null)
    try {
      const { families, fonts } = await luca.captions.addGoogleFont(link)
      setState((s) => (s ? { ...s, fonts } : s))
      for (const f of fonts)
        if (families.includes(f.family)) ensurePreviewFont(f.family, project.id, f.faces)
      if (cfg && families[0]) setCfg({ ...cfg, font: families[0] })
      setLink('')
      toast(`Added ${families.join(', ')}`, {
        description:
          'Downloaded from Google Fonts. It ships with the project, so exports use it too.'
      })
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
                { id: 'uploading', label: 'Uploading the audio' },
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
              Luca transcribes your video word by word (add your AssemblyAI key in the Transcript
              tab first), then you pick how the captions look.
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
  // a font that comes with Luca has the same faces before and after it goes into the project
  const faces =
    state.fonts.find((f) => f.family === cfg.font)?.faces ?? bundledFont(cfg.font)?.faces
  const ownFonts = state.fonts.filter((f) => f.file && !bundledFont(f.family))
  const look = captionLook(cfg, faces)
  /** Change one custom value; undefined puts the style's own back. */
  const custom = (patch: CaptionOverrides): void => {
    const next: Record<string, unknown> = { ...cfg.overrides, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    set({ overrides: Object.keys(next).length ? (next as CaptionOverrides) : undefined })
  }
  const showCustom = customOpen ?? !!cfg.overrides
  const fontWeights = faces?.length
    ? new Set(faces.flatMap((f) => [f.weight, f.weightMax ?? f.weight]))
    : new Set(
        BUILTIN_FONTS.find((f) => f.family === cfg.font)?.weights.split(';') ?? ['400', '900']
      )
  const wantWeight = cfg.overrides?.weight ?? style.weight
  const weightLevel = wantWeight >= 800 ? '900' : wantWeight >= 600 ? '700' : '400'
  const outlineLevel = !look.outline
    ? 'none'
    : look.outline.width <= 4
      ? 'thin'
      : look.outline.width <= 8
        ? 'bold'
        : 'heavy'
  const boxKind = !look.box ? 'none' : look.box.radius >= 999 ? 'pill' : 'box'
  const boxColor = look.box ? splitColor(look.box.bg) : { hex: '#000000', alpha: 0.72 }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[12px] ring-1 ring-border">
        <CaptionPreview
          cfg={cfg}
          faces={faces}
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
            {ownFonts.length ? (
              <optgroup label="Your fonts">
                {ownFonts.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.family}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {BUNDLED_FONTS.length ? (
              <optgroup label="Included with Luca">
                {BUNDLED_FONTS.map((f) => (
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
        <span />
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addGoogleFont()
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Link2
              size={13}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-3"
            />
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a Google Fonts link, or type a font's name"
              aria-label="Google Fonts link or font name"
              spellCheck={false}
              className="pl-7"
            />
          </div>
          <Button type="submit" disabled={!link.trim()} loading={busy === 'google'}>
            Add
          </Button>
        </form>

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
          <Swatches
            label="Highlight"
            colors={[style.accent, ...ACCENTS]}
            value={look.accent}
            onPick={(a) =>
              set({ accent: a.toLowerCase() === style.accent.toLowerCase() ? undefined : a })
            }
          />
          <span className="text-[11px] text-text-3">
            {look.anim === 'fade' || look.anim === 'slide' || look.anim === 'bounce'
              ? 'This style animates whole lines'
              : look.anim === 'blur'
                ? 'Words blur into focus as they are said'
                : 'Colors the word being spoken'}
          </span>
        </Row>

        <Label>Customize</Label>
        <Row>
          <button
            type="button"
            aria-expanded={showCustom}
            onClick={() => setCustomOpen(!showCustom)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] font-medium transition-colors',
              showCustom
                ? 'border-secondary-border bg-secondary text-secondary-fg'
                : 'border-border text-text-2 hover:text-text'
            )}
          >
            <SlidersHorizontal size={13} /> Text color, outline, box & weight
            <ChevronDown
              size={13}
              className={cn('transition-transform duration-150', showCustom && 'rotate-180')}
            />
          </button>
          {cfg.overrides ? (
            <Button variant="ghost" size="sm" onClick={() => set({ overrides: undefined })}>
              <RotateCcw size={12} /> Back to {style.name}
            </Button>
          ) : null}
        </Row>

        {showCustom ? (
          <>
            <Label>Text color</Label>
            <Row>
              <Swatches
                label="Text color"
                colors={[style.color, ...TEXT_COLORS]}
                value={look.color}
                onPick={(c) =>
                  custom({ color: c.toLowerCase() === style.color.toLowerCase() ? undefined : c })
                }
              />
            </Row>

            <Label>Outline</Label>
            <Row>
              <Segmented
                items={[
                  { id: 'none', label: 'None' },
                  { id: 'thin', label: 'Thin' },
                  { id: 'bold', label: 'Bold' },
                  { id: 'heavy', label: 'Heavy' }
                ]}
                value={outlineLevel}
                onChange={(level) =>
                  custom({
                    outline:
                      level === 'none'
                        ? null
                        : { color: look.outline?.color ?? '#000000', width: OUTLINES[level] }
                  })
                }
                ariaLabel="Outline"
              />
              {look.outline ? (
                <ColorDot
                  label="Outline color"
                  value={look.outline.color}
                  onChange={(color) =>
                    custom({ outline: { color, width: look.outline?.width ?? OUTLINES.bold } })
                  }
                />
              ) : null}
            </Row>

            <Label>Box</Label>
            <Row>
              <Segmented
                items={[
                  { id: 'none', label: 'None' },
                  { id: 'box', label: 'Box' },
                  { id: 'pill', label: 'Pill' }
                ]}
                value={boxKind}
                onChange={(kind) =>
                  custom({
                    box:
                      kind === 'none'
                        ? style.box
                          ? null
                          : undefined
                        : {
                            color: boxColor.hex,
                            opacity: boxColor.alpha,
                            radius: kind === 'pill' ? 999 : 10
                          }
                  })
                }
                ariaLabel="Box behind the text"
              />
              {look.box ? (
                <>
                  <ColorDot
                    label="Box color"
                    value={boxColor.hex}
                    onChange={(color) =>
                      custom({
                        box: { color, opacity: boxColor.alpha, radius: look.box?.radius ?? 10 }
                      })
                    }
                  />
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={boxColor.alpha}
                    aria-label="Box opacity"
                    onChange={(e) =>
                      custom({
                        box: {
                          color: boxColor.hex,
                          opacity: Number(e.target.value),
                          radius: look.box?.radius ?? 10
                        }
                      })
                    }
                    className="w-20 accent-[var(--accent)]"
                  />
                  <span className="w-8 text-[11px] text-text-3 tabular-nums">
                    {Math.round(boxColor.alpha * 100)}%
                  </span>
                </>
              ) : null}
            </Row>

            <Label>Weight</Label>
            <Row>
              {fontWeights.size > 1 ? (
                <Segmented
                  items={Object.entries(WEIGHTS).map(([id, label]) => ({
                    id: id as keyof typeof WEIGHTS,
                    label
                  }))}
                  value={weightLevel}
                  onChange={(w) =>
                    custom({ weight: Number(w) === style.weight ? undefined : Number(w) })
                  }
                  ariaLabel="Weight"
                />
              ) : (
                <span className="text-[11px] text-text-3">{cfg.font} comes in one weight</span>
              )}
            </Row>
          </>
        ) : null}
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

/** A row of color dots plus a picker for any other color. */
function Swatches({
  label,
  colors,
  value,
  onPick
}: {
  label: string
  colors: string[]
  value: string
  onPick: (color: string) => void
}): ReactElement {
  const unique = colors.filter(
    (c, i) => colors.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i
  )
  return (
    <>
      {unique.slice(0, 8).map((c) => {
        const on = value.toLowerCase() === c.toLowerCase()
        return (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${c}`}
            onClick={() => onPick(c)}
            className={cn(
              'size-6 rounded-full ring-1 ring-black/10 transition-transform duration-150 hover:scale-110',
              on && 'ring-2 ring-accent ring-offset-2 ring-offset-bg'
            )}
            style={{ background: c }}
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
          aria-label={`${label}: any color`}
          value={splitColor(value).hex}
          onChange={(e) => onPick(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </>
  )
}

/** The current color as a dot; clicking it opens the color picker. */
function ColorDot({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (color: string) => void
}): ReactElement {
  return (
    <label
      className="relative size-6 cursor-pointer overflow-hidden rounded-full ring-1 ring-border transition-transform duration-150 hover:scale-110"
      title={label}
    >
      <span className="absolute inset-0" style={{ background: value }} />
      <input
        type="color"
        aria-label={label}
        value={splitColor(value).hex}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  )
}

function Label({ children }: { children: ReactNode }): ReactElement {
  return <span className="text-[12px] font-medium text-text-2">{children}</span>
}
function Row({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
}
