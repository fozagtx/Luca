import { FONTS, KEYFRAMES, MOTIONS, styleLabel, TEMPLATES, THEMES } from '@shared/styles'
import type { Background, Chip } from '@shared/types'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Pencil,
  Sparkles,
  Wallpaper,
  X
} from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { Button } from '../../components/ui/button'
import { GenerateButton } from '../../components/ui/generate-button'
import { Segmented } from '../../components/ui/segmented'
import { cn } from '../../lib/cn'
import { formatDuration } from '../../lib/format'
import { headlineFrom } from '../../lib/idea'
import { backgroundChip, TOPICS, useBackgrounds } from '../../stores/backgrounds'
import { useChat } from '../../stores/chat'
import { kindOf, REVIEW_STEP, START_STEPS, useStart, type StartStep } from '../../stores/start'
import { useUi } from '../../stores/ui'
import { EaseCurve, MotionText, Stage, ThemeSwatch, type StageBackground } from './Previews'
import {
  ASPECTS,
  easeCss,
  fontStyle,
  lengthOptions,
  MOTION_FX,
  themeOf,
  usePreviewFont
} from './steps-lib'
import { StyleFieldIcon } from './StyleFieldIcon'

const COPY: Record<StartStep, { name: string; title: string; hint: string }> = {
  theme: {
    name: 'Theme',
    title: 'Pick a design theme',
    hint: 'The colours and feel of every scene.'
  },
  font: {
    name: 'Font',
    title: 'Choose the font',
    hint: 'Slide through them: the preview shows your own words in each one.'
  },
  background: {
    name: 'Background',
    title: 'What goes behind it?',
    hint: 'A photo or short video, the theme’s colours, or let Luca find one that fits.'
  },
  motion: {
    name: 'Motion',
    title: 'How should things animate?',
    hint: 'How titles and everything else come on screen.'
  },
  keyframes: {
    name: 'Keyframes',
    title: 'Pick a keyframe style',
    hint: 'How every move speeds up and settles. Watch the dot ride the curve.'
  }
}

type Option = { key: string; name: string; blurb: string; preview: ReactNode }

const AUTO = 'auto'

function autoOption(blurb: string): Option {
  return {
    key: AUTO,
    name: 'Let Luca pick',
    blurb,
    preview: (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-bg-muted text-accent">
        <Sparkles size={18} strokeWidth={1.7} />
        <span className="text-[10.5px] font-medium text-text-2">Luca decides</span>
      </div>
    )
  }
}

/** The picked Pexels background (one at a time), or null. */
function useBackgroundChip(): Extract<Chip, { kind: 'background' }> | null {
  const chip = useChat((s) => s.chips.find((c) => c.kind === 'background'))
  return (chip as Extract<Chip, { kind: 'background' }> | undefined) ?? null
}

function setBackgroundChip(chip: Chip | null): void {
  const others = useChat.getState().chips.filter((c) => c.kind !== 'background')
  useChat.setState({ chips: chip ? [...others, chip] : others })
}

/**
 * The start steps: after the idea, one choice at a time (theme, font, background, motion,
 * keyframes) on a slider under a live preview, then a review and Create. Every choice can be
 * left to Luca.
 */
export function StartSteps({
  onCreate,
  onEditIdea
}: {
  onCreate: () => void
  onEditIdea: () => void
}): ReactElement {
  const idea = useStart((s) => s.idea)
  const step = useStart((s) => s.step) ?? 0
  const style = useStart((s) => s.style)
  const aspect = useStart((s) => s.aspect)
  const files = useStart((s) => s.files)
  const previews = useStart((s) => s.previews)
  const { setStep, pick } = useStart.getState()
  const chip = useBackgroundChip()
  const items = useBackgrounds((s) => s.items)
  const template = TEMPLATES.find((t) => t.id === style.template)
  const review = step >= REVIEW_STEP
  const field = review ? null : START_STEPS[step]
  const headline = headlineFrom(idea, template?.sample ?? 'Your video')
  const kind = kindOf(files)
  const lead = files.find((f) => f.kind === 'video') ?? files.find((f) => f.kind === 'image')
  const footage = (lead && previews[lead.path]) || null

  const picked = chip ? items?.find((b) => b.id === chip.id) : undefined
  const stageBg: StageBackground | null = chip
    ? {
        thumb: picked?.poster ?? chip.thumb,
        video: picked?.media === 'video' ? picked.preview : undefined
      }
    : null

  const next = (): void => (review ? onCreate() : setStep(step + 1))
  const skip = (): void => {
    if (!field) return
    if (field === 'background') setBackgroundChip(null)
    pick(field, undefined)
    setStep(step + 1)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const t = e.target as HTMLElement
    const here =
      t === e.currentTarget ||
      t.getAttribute('role') === 'listbox' ||
      (t instanceof HTMLInputElement && t.type === 'range')
    if (e.key === 'Enter' && !e.shiftKey && here && !review) {
      e.preventDefault()
      next()
    }
  }

  return (
    <div className="rise-in flex flex-col gap-4 p-4 outline-none" onKeyDown={onKey}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onEditIdea}
          title="Change what the video is about"
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-hover"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] text-text">
            {idea ? `“${idea}”` : <span className="text-text-3">No description, Luca decides</span>}
          </span>
          <Pencil
            size={12}
            className="shrink-0 text-text-3 transition-colors group-hover:text-text"
          />
        </button>
        {template ? (
          <span className="mt-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-secondary-border bg-secondary px-2.5 text-[11.5px] font-medium text-secondary-fg">
            <StyleFieldIcon field="template" size={12} /> {template.name}
          </span>
        ) : null}
        <button
          type="button"
          aria-label="Back to the description"
          onClick={onEditIdea}
          className="icon-btn mt-0.5 shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      <StepNav step={step} onStep={setStep} />

      <Stage
        aspect={aspect}
        headline={headline}
        style={style}
        background={stageBg}
        footage={footage}
        tiktok={template?.id === 'tiktok-viral' && aspect === 'portrait'}
      />

      {field ? (
        <div key={field} className="rise-in flex flex-col gap-2.5">
          <div className="flex items-end gap-3 px-1">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold tracking-[-0.01em] text-text">
                {COPY[field].title}
              </div>
              <div className="mt-0.5 text-[12px] text-text-3">{COPY[field].hint}</div>
            </div>
            {field === 'background' ? (
              <button
                type="button"
                onClick={() => useUi.getState().setBackgrounds(true)}
                className="shrink-0 text-[12px] font-medium text-accent hover:underline"
              >
                Browse all…
              </button>
            ) : null}
          </div>
          {field === 'theme' ? <ThemeChoices /> : null}
          {field === 'font' ? <FontChoices headline={headline} /> : null}
          {field === 'background' ? (
            <BackgroundChoices
              footage={kind === 'video' || kind === 'images' ? (footage ?? '') : null}
            />
          ) : null}
          {field === 'motion' ? <MotionChoices headline={headline} /> : null}
          {field === 'keyframes' ? <KeyframeChoices /> : null}
        </div>
      ) : (
        <Review onStep={setStep} />
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="ghost"
          size="lg"
          onClick={() => (step === 0 ? onEditIdea() : setStep(step - 1))}
        >
          <ArrowLeft size={14} /> {step === 0 ? 'Description' : 'Back'}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {field ? (
            <>
              <Button variant="ghost" size="lg" onClick={skip} title="Let Luca decide this one">
                Skip
              </Button>
              <Button variant="primary" size="lg" onClick={next}>
                {step + 1 < REVIEW_STEP ? `Next: ${COPY[START_STEPS[step + 1]].name}` : 'Review'}
                <ArrowRight size={14} />
              </Button>
            </>
          ) : (
            <CreateButton onCreate={onCreate} />
          )}
        </div>
      </div>
    </div>
  )
}

function CreateButton({ onCreate }: { onCreate: () => void }): ReactElement {
  const ref = useRef<HTMLButtonElement>(null)
  // on the review, ↩ creates
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <GenerateButton ref={ref} label="Create video" generatingLabel="Creating" onClick={onCreate} />
  )
}

/** Theme · Font · Background · Motion · Keyframes · Review, with a tick on each one picked. */
function StepNav({ step, onStep }: { step: number; onStep: (s: number) => void }): ReactElement {
  const style = useStart((s) => s.style)
  const chip = useBackgroundChip()
  const done = (f: StartStep): boolean => (f === 'background' ? !!chip || !!style[f] : !!style[f])
  return (
    <nav aria-label="Steps" className="flex flex-wrap items-center gap-1">
      {START_STEPS.map((f, i) => (
        <button
          key={f}
          type="button"
          aria-current={i === step ? 'step' : undefined}
          onClick={() => onStep(i)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors',
            i === step
              ? 'bg-text text-bg'
              : done(f)
                ? 'bg-secondary text-secondary-fg hover:brightness-[0.98]'
                : 'text-text-3 hover:bg-hover hover:text-text'
          )}
        >
          {done(f) && i !== step ? (
            <Check size={11} strokeWidth={2.5} />
          ) : (
            <StyleFieldIcon field={f} size={12} />
          )}
          {COPY[f].name}
        </button>
      ))}
      <span className="mx-0.5 h-3.5 w-px bg-border" />
      <button
        type="button"
        aria-current={step >= REVIEW_STEP ? 'step' : undefined}
        onClick={() => onStep(REVIEW_STEP)}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors',
          step >= REVIEW_STEP ? 'bg-text text-bg' : 'text-text-3 hover:bg-hover hover:text-text'
        )}
      >
        Review
      </button>
    </nav>
  )
}

/**
 * Options on a slider: a strip of cards (click one, or use ← →) and a slide bar under it. The
 * picked one is recorded as soon as it is chosen.
 */
function Choices({
  label,
  options,
  value,
  onChange,
  width = 136,
  extra
}: {
  label: string
  options: Option[]
  value: string
  onChange: (key: string) => void
  /** Card width in px. */
  width?: number
  /** Shown after the options (not one of them): a connect card, loading placeholders. */
  extra?: ReactNode
}): ReactElement {
  const strip = useRef<HTMLDivElement>(null)
  const index = Math.max(
    0,
    options.findIndex((o) => o.key === value)
  )
  const go = (i: number): void => {
    const o = options[Math.min(options.length - 1, Math.max(0, i))]
    if (o) onChange(o.key)
  }

  // the list takes the keys as soon as a step opens, so ← → choose straight away
  useEffect(() => strip.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    const el = strip.current?.children[index] as HTMLElement | undefined
    const box = strip.current
    if (!el || !box) return
    // centre the picked card in the strip without scrolling the page
    box.scrollTo({
      left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2,
      behavior: 'smooth'
    })
  }, [index])

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const to =
      e.key === 'ArrowRight'
        ? index + 1
        : e.key === 'ArrowLeft'
          ? index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? options.length - 1
              : null
    if (to === null) return
    e.preventDefault()
    go(to)
  }

  const arrow =
    'absolute top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg text-text-2 shadow-sm transition-[opacity,color] hover:text-text disabled:pointer-events-none disabled:opacity-0'
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <button
          type="button"
          aria-label="Previous"
          disabled={index === 0}
          onClick={() => go(index - 1)}
          className={cn(arrow, 'left-0')}
        >
          <ChevronLeft size={15} />
        </button>
        <div
          ref={strip}
          role="listbox"
          aria-label={label}
          aria-orientation="horizontal"
          tabIndex={0}
          onKeyDown={onKey}
          className="choice-strip no-ring flex gap-2 overflow-x-auto rounded-[12px] px-9 py-1.5 focus-visible:shadow-[inset_0_0_0_1px_var(--border-strong)]"
        >
          {options.map((o) => {
            const on = o.key === value
            return (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={-1}
                onClick={() => onChange(o.key)}
                style={{ width }}
                className={cn(
                  'group flex shrink-0 flex-col gap-1.5 rounded-[12px] p-1.5 text-left transition-[background-color,box-shadow] duration-150',
                  on ? 'bg-secondary shadow-[0_0_0_2px_var(--accent)]' : 'hover:bg-hover'
                )}
              >
                <div className="relative h-[76px] w-full overflow-hidden rounded-[8px] ring-1 ring-border">
                  {o.preview}
                  {on ? (
                    <span className="pop-in absolute top-1 right-1 flex size-4.5 items-center justify-center rounded-full bg-accent text-accent-fg shadow">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 px-0.5">
                  <div className="truncate text-[12px] font-medium text-text">{o.name}</div>
                  <div className="truncate text-[10.5px] text-text-3">{o.blurb}</div>
                </div>
              </button>
            )
          })}
          {extra}
        </div>
        <button
          type="button"
          aria-label="Next"
          disabled={index >= options.length - 1}
          onClick={() => go(index + 1)}
          className={cn(arrow, 'right-0')}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="flex items-center gap-3 px-9">
        <input
          type="range"
          min={0}
          max={Math.max(0, options.length - 1)}
          step={1}
          value={index}
          onChange={(e) => go(Number(e.target.value))}
          aria-label={`${label}: slide to choose`}
          aria-valuetext={options[index]?.name}
          className="choice-range min-w-0 flex-1"
        />
        <span className="w-40 truncate text-right text-[11.5px] text-text-2">
          <span className="font-medium text-text">{options[index]?.name}</span>
          <span className="text-text-3 tabular-nums">
            {' '}
            · {index + 1}/{options.length}
          </span>
        </span>
      </div>
    </div>
  )
}

function ThemeChoices(): ReactElement {
  const style = useStart((s) => s.style)
  const pick = useStart((s) => s.pick)
  usePreviewFont(style.font)
  const options: Option[] = [
    autoOption('Chosen to suit the idea'),
    ...THEMES.map((t) => ({
      key: t.id,
      name: t.name,
      blurb: t.blurb,
      preview: <ThemeSwatch theme={t} font={style.font} />
    }))
  ]
  return (
    <Choices
      label="Design theme"
      options={options}
      value={style.theme ?? AUTO}
      onChange={(k) => pick('theme', k === AUTO ? undefined : k)}
    />
  )
}

function FontChoices({ headline }: { headline: string }): ReactElement {
  const style = useStart((s) => s.style)
  const pick = useStart((s) => s.pick)
  const theme = themeOf(style.theme)
  const sample = headline.split(/\s+/).slice(0, 2).join(' ')
  const options: Option[] = [
    autoOption('Chosen to suit the look'),
    ...FONTS.map((f) => ({
      key: f.family,
      name: f.family,
      blurb: f.note,
      preview: <FontSample family={f.family} text={sample} bg={theme.bg} color={theme.text} />
    }))
  ]
  return (
    <Choices
      label="Font"
      width={150}
      options={options}
      value={style.font ?? AUTO}
      onChange={(k) => pick('font', k === AUTO ? undefined : k)}
    />
  )
}

function FontSample({
  family,
  text,
  bg,
  color
}: {
  family: string
  text: string
  bg: string
  color: string
}): ReactElement {
  usePreviewFont(family)
  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden px-2 text-center"
      style={{ background: bg }}
    >
      <span
        className="line-clamp-2 text-[19px] leading-[1.05]"
        style={{ ...fontStyle(family), color }}
      >
        {text}
      </span>
    </div>
  )
}

function BackgroundChoices({ footage }: { footage: string | null }): ReactElement {
  const style = useStart((s) => s.style)
  const aspect = useStart((s) => s.aspect)
  const pick = useStart((s) => s.pick)
  const chip = useBackgroundChip()
  const { hasKey, items, loading, query } = useBackgrounds()
  const { checkKey, search, setQuery } = useBackgrounds.getState()
  const setSheet = useUi((s) => s.setBackgrounds)
  const theme = themeOf(style.theme)

  useEffect(() => {
    if (hasKey === null) void checkKey()
  }, [hasKey, checkKey])
  useEffect(() => {
    if (hasKey) void search(aspect)
  }, [hasKey, query, aspect, search])

  const pexels = (items ?? []).slice(0, 24)
  // a pick from the full browser that isn't in this topic still shows, first
  const extraPick =
    chip && !pexels.some((b) => b.id === chip.id)
      ? [
          {
            id: chip.id,
            media: chip.media,
            title: chip.title,
            thumb: chip.thumb,
            duration: chip.duration
          }
        ]
      : []
  const photo = (b: Pick<Background, 'id' | 'media' | 'title' | 'thumb' | 'duration'>): Option => ({
    key: b.id,
    name: b.title || (b.media === 'video' ? 'Video' : 'Photo'),
    blurb: b.media === 'video' ? `Video · ${formatDuration(b.duration ?? 0)}` : 'Photo · Pexels',
    preview: (
      <>
        <img src={b.thumb} alt="" draggable={false} className="h-full w-full object-cover" />
        {b.media === 'video' ? (
          <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-[4px] bg-black/60 px-1 py-px text-[9.5px] text-white">
            <Clapperboard size={9} /> {formatDuration(b.duration ?? 0)}
          </span>
        ) : null}
      </>
    )
  })
  const options: Option[] = [
    autoOption('Finds a photo or video'),
    {
      key: 'theme',
      name: 'Theme colours',
      blurb: 'Plain, in the theme',
      preview: <div className="h-full w-full" style={{ background: theme.bg }} />
    },
    ...(footage !== null
      ? [
          {
            key: 'none',
            name: 'None',
            blurb: 'My footage fills the frame',
            preview: footage ? (
              <img src={footage} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-bg-muted text-text-3">
                <Clapperboard size={18} strokeWidth={1.6} />
              </div>
            )
          }
        ]
      : []),
    ...extraPick.map(photo),
    ...pexels.map(photo)
  ]
  const value = chip ? chip.id : (style.background ?? AUTO)
  const onChange = (k: string): void => {
    if (k === AUTO || k === 'theme' || k === 'none') {
      setBackgroundChip(null)
      pick('background', k === AUTO ? undefined : k)
      return
    }
    const b = pexels.find((x) => x.id === k)
    if (b) setBackgroundChip(backgroundChip(b))
    pick('background', 'picked')
  }

  const extra =
    hasKey === false ? (
      <button
        type="button"
        onClick={() => setSheet(true)}
        style={{ width: 176 }}
        className="flex shrink-0 flex-col items-start justify-center gap-1 rounded-[12px] border border-dashed border-border-strong p-3 text-left transition-colors hover:border-accent"
      >
        <Wallpaper size={16} className="text-accent" />
        <span className="text-[12px] font-medium text-text">Photos & videos</span>
        <span className="text-[10.5px] leading-snug text-text-3">
          Add a free Pexels key to slide through real backgrounds.
        </span>
      </button>
    ) : loading && !items ? (
      [0, 1, 2].map((i) => (
        <div key={i} style={{ width: 136 }} className="shrink-0 p-1.5">
          <div className="skeleton h-[76px] rounded-[8px]" />
        </div>
      ))
    ) : null

  return (
    <div className="flex flex-col gap-2">
      {hasKey ? (
        <div className="flex flex-wrap gap-1 px-9">
          {TOPICS.slice(0, 9).map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setQuery(t.query)}
              className={cn(
                'h-6 rounded-full px-2.5 text-[11px] font-medium transition-colors',
                query === t.query
                  ? 'bg-text text-bg'
                  : 'bg-bg-muted text-text-2 hover:bg-hover hover:text-text'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      <Choices
        label="Background"
        options={options}
        value={value}
        onChange={onChange}
        extra={extra}
      />
    </div>
  )
}

function MotionChoices({ headline }: { headline: string }): ReactElement {
  const style = useStart((s) => s.style)
  const pick = useStart((s) => s.pick)
  const theme = themeOf(style.theme)
  const font = style.font ?? 'Inter'
  usePreviewFont(font)
  const sample = headline.split(/\s+/).slice(0, 2).join(' ')
  const options: Option[] = [
    autoOption('Matched to the idea'),
    ...MOTIONS.map((m) => ({
      key: m.id,
      name: m.name,
      blurb: m.blurb,
      preview: (
        <div
          className="flex h-full w-full items-center justify-center overflow-hidden px-2 text-center"
          style={{ background: theme.bg }}
        >
          <MotionText
            text={sample}
            motion={m.id}
            ease={easeCss(style.keyframes, (MOTION_FX[m.id] ?? MOTION_FX.smooth).natural)}
            className="text-[17px] leading-[1.05]"
            style={{ ...fontStyle(font), color: theme.text }}
          />
        </div>
      )
    }))
  ]
  return (
    <Choices
      label="Motion"
      options={options}
      value={style.motion ?? AUTO}
      onChange={(k) => pick('motion', k === AUTO ? undefined : k)}
    />
  )
}

function KeyframeChoices(): ReactElement {
  const style = useStart((s) => s.style)
  const pick = useStart((s) => s.pick)
  const options: Option[] = [
    autoOption('Suits the motion'),
    ...KEYFRAMES.map((k) => ({
      key: k.id,
      name: k.name,
      blurb: k.blurb,
      preview: (
        <div className="flex h-full w-full items-center justify-center bg-bg-subtle text-text-3">
          <EaseCurve id={k.id} color="var(--text)" />
        </div>
      )
    }))
  ]
  return (
    <Choices
      label="Keyframe style"
      options={options}
      value={style.keyframes ?? AUTO}
      onChange={(k) => pick('keyframes', k === AUTO ? undefined : k)}
    />
  )
}

/** Everything picked, each one a click from its step, plus the shape and length. */
function Review({ onStep }: { onStep: (s: number) => void }): ReactElement {
  const style = useStart((s) => s.style)
  const aspect = useStart((s) => s.aspect)
  const duration = useStart((s) => s.duration)
  const files = useStart((s) => s.files)
  const { setAspect, setDuration } = useStart.getState()
  const chip = useBackgroundChip()
  const kind = kindOf(files)
  const theme = themeOf(style.theme)
  usePreviewFont(style.font)

  const value = (f: StartStep): string | null => {
    if (f === 'background' && chip) return chip.title || 'Pexels background'
    const v = style[f]
    return v ? styleLabel(f, v) : null
  }
  const aside = (f: StartStep): ReactNode => {
    if (f === 'theme' && style.theme)
      return (
        <span
          className="h-6 w-9 shrink-0 rounded-[5px] ring-1 ring-border"
          style={{ background: theme.bg }}
        />
      )
    if (f === 'font' && style.font)
      return (
        <span
          className="shrink-0 text-[18px] leading-none text-text"
          style={{ ...fontStyle(style.font), textTransform: 'none' }}
        >
          Aa
        </span>
      )
    if (f === 'background' && chip)
      return (
        <img
          src={chip.thumb}
          alt=""
          className="h-6 w-9 shrink-0 rounded-[5px] object-cover ring-1 ring-border"
        />
      )
    return null
  }

  return (
    <div className="rise-in flex flex-col gap-3">
      <div className="px-1">
        <div className="text-[14px] font-semibold tracking-[-0.01em] text-text">Ready to cook</div>
        <div className="mt-0.5 text-[12px] text-text-3">
          Check your picks; click one to change it. Anything left to Luca, it chooses to fit.
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
        {START_STEPS.map((f, i) => {
          const v = value(f)
          return (
            <button
              key={f}
              type="button"
              onClick={() => onStep(i)}
              className="card card-hover flex items-center gap-2.5 px-3 py-2.5 text-left"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-muted text-text-2">
                <StyleFieldIcon field={f} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-text-3">{COPY[f].name}</span>
                <span
                  className={cn(
                    'block truncate text-[12.5px] font-medium',
                    v ? 'text-text' : 'text-text-3'
                  )}
                >
                  {v ?? 'Luca decides'}
                </span>
              </span>
              {aside(f)}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-[12px] font-medium text-text-2">Format</span>
        <Segmented
          items={ASPECTS}
          value={aspect}
          onChange={setAspect}
          ariaLabel="Aspect ratio"
          className="h-8"
        />
        {kind === 'images' || kind === 'scratch' ? (
          <select
            aria-label="Length"
            value={duration ?? ''}
            onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}
            className="h-8 rounded-full border border-border bg-bg px-3 text-[12px] font-medium text-text-2 outline-none hover:border-border-strong"
          >
            {lengthOptions(duration).map((l) => (
              <option key={l.label} value={l.value ?? ''}>
                {l.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  )
}
