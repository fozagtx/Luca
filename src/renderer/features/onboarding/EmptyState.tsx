import { Menu } from '@base-ui/react/menu'
import { editStep, STYLES, VIDEO_TYPES, videoType } from '@shared/edits'
import type { Aspect, StyleId, VideoTypeId } from '@shared/types'
import {
  AudioLines,
  Check,
  Clapperboard,
  Film,
  FolderOpen,
  ImagePlus,
  Lightbulb,
  MoreHorizontal,
  Plus,
  Rocket,
  Smartphone,
  Trash2,
  Upload,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { toast } from 'sonner'
import logo from '../../assets/logo.png'
import { Button } from '../../components/ui/button'
import { EdgeGlow } from '../../components/ui/edge-glow'
import { GenerateButton } from '../../components/ui/generate-button'
import { Segmented, type SegmentedItem } from '../../components/ui/segmented'
import { Thumb } from '../../components/ui/thumb'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { formatDuration, relativeDate } from '../../lib/format'
import { luca } from '../../lib/luca'
import { useAi33 } from '../../stores/ai33'
import { useChat } from '../../stores/chat'
import { useProject } from '../../stores/project'
import { attachmentOf, IMAGES_ONLY, kindOf, useStart, type Attachment } from '../../stores/start'
import { Ai33KeyCard } from '../ai33/Ai33KeyCard'
import { AssemblyAiKeyCard } from './AssemblyAiKeyCard'
import { CreateProgressList } from './CreateProgress'
import { HomeGradient } from './HomeGradient'
import { MusicNote, ScriptFields, ScriptGoButton, StartAsk } from './ScriptPanel'

const ASPECTS: SegmentedItem<Aspect>[] = [
  { id: 'landscape', label: '16:9' },
  { id: 'portrait', label: '9:16' },
  { id: 'square', label: '1:1' }
]

const STYLE_ITEMS: SegmentedItem<StyleId>[] = STYLES.map((s) => ({
  id: s.id,
  label: s.name
}))

const TYPE_ICONS: Record<VideoTypeId, LucideIcon> = {
  launch: Rocket,
  concept: Lightbulb,
  tutorial: Clapperboard,
  talking: Smartphone
}

export function EmptyState(): ReactElement {
  return (
    <div className="relative h-full overflow-hidden">
      {/* the gradient and scrim sit outside the scroller, so they fill the pane at any scroll */}
      <HomeGradient />
      {/* a light scrim keeps the gradient soft behind the cards; legibility is on the blocks */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-bg/25" />
      <div className="scroll relative h-full">
        <div className="flex min-h-full flex-col items-center px-8">
          {/* top-aligned: opening the form or switching a style never re-centers the card */}
          <div className="flex w-full max-w-[760px] flex-col gap-8 pt-8 pb-16">
            <StartCard />
            <Recent />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Home: drop the footage (or a voiceover), or paste a script when there is none, say what kind of
 * video it is, and Luca edits it.
 */
function StartCard(): ReactElement {
  const { files, busy, progress, seen, error, scriptMode, cancelling } = useStart()
  const { addFiles, pickFiles, addNotes, create, setScriptMode, cancelStart } = useStart()
  const scripted = useStart((s) => s.scriptMode && !!s.script.text.trim())
  const openProject = useProject((s) => s.open)
  const loading = useProject((s) => s.loading)
  const [over, setOver] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [since, setSince] = useState<number | undefined>()
  const kind = kindOf(files)
  const videos = files.filter((f) => f.kind === 'video')
  // the video (or voiceover) the project starts from, named on the progress card
  const lead = videos[0] ?? files.find((f) => f.kind === 'audio')
  // the edit form shows for media, or once "Start from a brief" opens it for words only
  const formOpen = kind !== 'brief' || briefOpen

  const go = async (): Promise<void> => {
    if (busy || !(scriptMode ? scripted : kind)) return
    // words typed in the chat meanwhile are notes too
    const draft = useChat.getState().draft
    if (draft.trim()) {
      addNotes(draft)
      useChat.getState().setDraft('')
    }
    setSince(Date.now())
    await create()
  }
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const paths = [...e.dataTransfer.files].map((f) => luca.project.pathForFile(f)).filter(Boolean)
    if (paths.length) addFiles(paths)
  }
  const openDir = async (): Promise<void> => {
    const dir = await luca.project.pickProjectDir()
    if (dir) await openProject(dir).catch(() => undefined)
  }

  return (
    // isolate: the glow while the project starts sits behind the card
    <section className="isolate flex flex-col items-center gap-6">
      {/* the hero sits straight on the gradient: white type with a soft shadow reads in both themes */}
      <div className="flex w-full flex-col items-center gap-3 pt-2 text-center">
        <img
          src={logo}
          alt=""
          draggable={false}
          className="size-16 rounded-[16px] shadow-[0_10px_24px_rgba(0,0,0,0.18)] transition-transform duration-300 hover:scale-105 hover:-rotate-2"
        />
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
          Describe it. Luca makes the explainer.
        </h1>
        <p className="max-w-[520px] text-[13px] leading-relaxed text-white/85 [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
          Launch films, concept explainers, tutorials and talking videos. Say what it’s about, pick
          motion design or a classic edit, and Luca makes the whole thing.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          if (busy) return
          e.preventDefault()
          if (!over) setOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
        }}
        onDrop={onDrop}
        className={cn(
          'relative w-full rounded-[18px] border bg-input transition-[border-color,box-shadow,transform,background-color] duration-200 ease-out',
          over
            ? 'scale-[1.01] border-dashed border-accent bg-accent/[0.04] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_14%,transparent)]'
            : 'border-border shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-14px_rgba(0,0,0,0.18)]'
        )}
      >
        <EdgeGlow on={busy} />
        {over ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-[18px] text-accent">
            <Upload size={22} strokeWidth={1.6} />
            <span className="text-[13px] font-medium">Drop your video, a voiceover or images</span>
          </div>
        ) : null}

        {busy ? (
          <div className="rise-in flex flex-col gap-4 p-5">
            <div className="text-[13px] font-semibold text-text">
              {scriptMode
                ? 'Starting from your script'
                : videos.length > 1
                  ? `Starting from your ${videos.length} videos`
                  : `Starting from ${lead?.name ?? 'your brief'}`}
            </div>
            <StartAsk />
            <CreateProgressList
              kind={kind}
              script={scriptMode}
              progress={progress}
              seen={seen}
              since={since}
            />
            {scriptMode ? (
              // the script, voice and language are still in the panel when it comes back
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 self-start"
                disabled={cancelling}
                onClick={() => void cancelStart()}
              >
                {cancelling ? 'Stopping…' : 'Cancel'}
              </Button>
            ) : null}
          </div>
        ) : scriptMode ? (
          <div className={cn(over && 'opacity-0')}>
            <EditForm script onGo={() => void go()} />
          </div>
        ) : formOpen ? (
          <div className={cn(over && 'opacity-0')}>
            <EditForm onGo={() => void go()} />
          </div>
        ) : (
          // nothing to make yet: the drop zone, or start from the brief alone
          <div
            className={cn(
              'flex flex-col items-center gap-4 px-6 py-10 text-center',
              over && 'opacity-0'
            )}
          >
            {files.length ? (
              <Tiles className="justify-center" />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-full bg-bg-muted text-text-2">
                <Upload size={20} strokeWidth={1.7} />
              </span>
            )}
            <div className="flex flex-col gap-1">
              <div className="text-[15px] font-semibold text-text">
                Drop a video, a voiceover or screenshots — or just describe it
              </div>
              <div className="text-[12px] text-text-3">
                Footage plays back to back; a logo, screenshots and music can come along.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="lg" onClick={() => void pickFiles()}>
                Choose files
              </Button>
              <Button size="lg" variant="ghost" onClick={() => setBriefOpen(true)}>
                Start from a brief
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setScriptMode(true)}
              className="-mt-1 text-[12px] font-medium text-text-2 underline-offset-2 transition-colors hover:text-text hover:underline"
            >
              No footage? Start from a script
            </button>
            {files.length ? (
              <div className="fade-in rounded-[10px] border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12px] text-danger">
                {IMAGES_ONLY}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {error && !busy ? (
        <div className="fade-in -mt-2 w-full rounded-[10px] border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12px] text-danger select-text">
          {error}
        </div>
      ) : null}

      {!busy ? (
        <button
          type="button"
          className="chip -mt-1"
          onClick={() => void openDir()}
          disabled={loading}
        >
          <FolderOpen size={12} /> Open a project…
        </button>
      ) : null}
    </section>
  )
}

/**
 * The card's form: the style, the kind of video, a reference, the steps, the brief, and go. With a
 * script to record it leads with the script fields.
 */
function EditForm({ onGo, script = false }: { onGo: () => void; script?: boolean }): ReactElement {
  const { files, footage, aspect, aspectFrom, edit, busy, reference } = useStart()
  const { setAspect, setType, setStyle, toggleStep, setNotes, setReference, clearReference } =
    useStart()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [keyLater, setKeyLater] = useState(false)
  const hasAi33 = useAi33((s) => s.hasKey)
  const ref = useRef<HTMLTextAreaElement>(null)
  const kind = kindOf(files)
  const brief = kind === 'brief'
  // a voiceover, a brief or a script has no picture to zoom into or put a name on, and a script has
  // its words already: there are no ums or pauses to cut
  const voiceOnly = script || kind !== 'video'
  const steps = videoType(edit.type)
    .steps[edit.style].map(editStep)
    .filter((s) => !(voiceOnly && s.needsPicture) && !(script && s.id === 'cut'))
  // the words of a script are known, so nothing waits for AssemblyAI: its card never comes up
  const needsWords = !script && steps.some((s) => s.needsWords && edit.steps.includes(s.id))
  // steps that make something with ai33 and are switched on
  const making = steps.filter((s) => s.needsAi33 && edit.steps.includes(s.id))
  const shape = aspectFrom ? footage[aspectFrom]?.aspect : undefined
  const notes = edit.notes ?? ''
  const style = STYLES.find((s) => s.id === edit.style) ?? STYLES[0]

  const pickReference = async (): Promise<void> => {
    const paths = await luca.project.pickMedia()
    const video = paths.find((p) => attachmentOf(p)?.kind === 'video')
    if (video) setReference(video)
  }
  const dropReference = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const video = [...e.dataTransfer.files]
      .map((f) => luca.project.pathForFile(f))
      .filter(Boolean)
      .find((p) => attachmentOf(p)?.kind === 'video')
    if (video) setReference(video)
  }

  useEffect(() => {
    // not for a script: its words exist, so the answer would change nothing
    if (script) return
    void luca.env
      .hasAssemblyAiKey()
      .then(setHasKey)
      .catch(() => undefined)
    // the ai33 key, for the Music chip (the script panel reads it itself)
    void useAi33.getState().checkKey()
  }, [script])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 160)}px`
  }, [notes])

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onGo()
    }
  }

  return (
    <div className="rise-in flex flex-col">
      <div className="flex flex-col gap-5 p-4">
        {script ? <ScriptFields onGo={onGo} /> : <Tiles />}
        {script && files.length ? (
          // a logo or screenshots dropped on the card before the script came along
          <Field label="Pictures that come along">
            <Tiles />
          </Field>
        ) : null}

        <Field label="How should it be made?">
          <div className="flex flex-col gap-1.5">
            <Segmented
              items={STYLE_ITEMS}
              value={edit.style}
              onChange={setStyle}
              ariaLabel="Style"
              className="h-8 w-fit"
            />
            <span className="text-[11px] leading-[1.4] text-text-3">{style.blurb}</span>
          </div>
        </Field>

        <Field label="What kind of video is it?">
          <div
            role="radiogroup"
            aria-label="What kind of video is it?"
            className="grid grid-cols-2 gap-2 md:grid-cols-4"
          >
            {VIDEO_TYPES.map((t) => {
              const Icon = TYPE_ICONS[t.id]
              const on = t.id === edit.type
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setType(t.id)}
                  className={cn(
                    'flex h-full flex-col gap-2 rounded-[12px] border p-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150',
                    on
                      ? 'border-accent bg-secondary shadow-[0_0_0_1px_var(--accent)]'
                      : 'border-border bg-bg hover:border-border-strong'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
                        on ? 'bg-accent text-accent-fg' : 'bg-bg-muted text-text-2'
                      )}
                    >
                      <Icon size={14} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium whitespace-normal text-text">
                        {t.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-text-3">{t.who}</span>
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[11px] leading-[1.4] text-text-2">
                    {t.blurb}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Reference video (optional)">
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] leading-[1.4] text-text-3">
              Luca studies its motion and structure and builds yours the same way
            </div>
            {reference ? (
              <div className="flex items-center gap-2 rounded-[10px] border border-border bg-bg px-2.5 py-2">
                <Clapperboard size={14} strokeWidth={1.7} className="shrink-0 text-text-3" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-text">
                  {reference.split('/').pop()}
                </span>
                <button
                  type="button"
                  aria-label="Remove the reference"
                  onClick={clearReference}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-hover hover:text-text"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void pickReference()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={dropReference}
                className="flex items-center justify-center gap-2 rounded-[10px] border border-dashed border-border-strong px-3 py-2.5 text-[12px] text-text-3 transition-colors hover:border-accent hover:text-accent"
              >
                <Film size={14} strokeWidth={1.7} />
                Pick a video or drop it here
              </button>
            )}
          </div>
        </Field>

        <Field label="What Luca will do">
          {/* two chip rows reserved: Motion and Classic lists differ in length, the card doesn't move */}
          <div className="flex min-h-[68px] flex-wrap content-start gap-1.5">
            {steps.map((s) => {
              const on = edit.steps.includes(s.id)
              return (
                <Tip key={s.id} label={s.blurb} side="top">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleStep(s.id)}
                    className={cn(
                      'chip h-7 px-3 text-[12px]',
                      on &&
                        'border-secondary-border bg-secondary text-secondary-fg hover:border-secondary-border hover:text-secondary-fg'
                    )}
                  >
                    {on ? (
                      <Check size={12} strokeWidth={2.4} />
                    ) : (
                      <Plus size={12} strokeWidth={2} />
                    )}
                    {s.name}
                  </button>
                </Tip>
              )
            })}
          </div>
          {needsWords && !brief && hasKey === false && !keyLater ? (
            <AssemblyAiKeyCard
              className="fade-in mt-1"
              autoFocus={false}
              onDismiss={() => setKeyLater(true)}
              onSaved={setHasKey}
            >
              Cutting, captions and B-roll need Luca to hear the words: add an AssemblyAI key and it
              transcribes your {voiceOnly ? 'voiceover' : 'video'}. Without one, Luca skips them.
              Your key stays in the macOS Keychain.
            </AssemblyAiKeyCard>
          ) : null}
          {!script && making.length && hasAi33 === false ? (
            // the chip is switched back off when the card is dismissed
            <Ai33KeyCard
              context="start"
              className="fade-in mt-1"
              onDismiss={() => making.forEach((s) => toggleStep(s.id))}
            />
          ) : null}
          {making.some((s) => s.id === 'music') ? <MusicNote /> : null}
        </Field>

        <Field label={brief ? 'Your brief' : 'About the video'}>
          <div className="flex flex-col gap-1.5">
            <textarea
              ref={ref}
              id="start-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={onKey}
              placeholder={videoType(edit.type).example}
              rows={brief ? 3 : 2}
              required={brief}
              className="block w-full resize-none rounded-[10px] border border-border bg-bg px-3 py-2.5 text-[13px] leading-[20px] text-text transition-colors placeholder:text-text-3 focus:border-border-strong"
            />
            {brief ? (
              <span className="text-[11px] leading-[1.4] text-text-3">
                Paste the script or describe the product; a link helps
              </span>
            ) : null}
          </div>
        </Field>
      </div>

      <div className="sticky bottom-0 z-10 -mx-px flex flex-wrap items-center gap-2 rounded-b-[18px] border-t border-border bg-input px-4 py-3">
        <span className="text-[12px] font-medium text-text-2">Format</span>
        {/* it starts out matching the first video's shape: pick 9:16 to make a short of it */}
        <Segmented
          items={ASPECTS}
          value={aspect}
          onChange={setAspect}
          ariaLabel="Format"
          className="h-8"
        />
        {shape && shape !== aspect ? (
          <span className="fade-in text-[11px] text-text-3">
            Cropped from {ASPECTS.find((a) => a.id === shape)?.label}
          </span>
        ) : null}
        {script ? (
          <ScriptGoButton busy={busy} onGo={onGo} />
        ) : (
          <GenerateButton
            className="ml-auto"
            label="Make it"
            generatingLabel="Starting"
            generating={busy}
            disabled={busy}
            onClick={onGo}
          />
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12.5px] font-semibold text-text">{label}</div>
      {children}
    </div>
  )
}

/** The files on the card, in order, and a tile to add more. */
function Tiles({ className }: { className?: string }): ReactElement {
  const files = useStart((s) => s.files)
  const previews = useStart((s) => s.previews)
  const removeFile = useStart((s) => s.removeFile)
  const pickFiles = useStart((s) => s.pickFiles)
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {files.map((f) => (
        <AttachmentTile
          key={f.path}
          file={f}
          preview={previews[f.path]}
          onRemove={() => removeFile(f.path)}
        />
      ))}
      <Tip label="Add more videos, a voiceover or images (a logo, screenshots)">
        <button
          type="button"
          aria-label="Add more files"
          onClick={() => void pickFiles()}
          className="flex size-16 items-center justify-center rounded-[10px] border border-dashed border-border-strong text-text-3 transition-colors hover:border-accent hover:text-accent"
        >
          <ImagePlus size={18} strokeWidth={1.6} />
        </button>
      </Tip>
    </div>
  )
}

function AttachmentTile({
  file,
  preview,
  onRemove
}: {
  file: Attachment
  preview: string | null | undefined
  onRemove: () => void
}): ReactElement {
  const Icon = file.kind === 'audio' ? AudioLines : file.kind === 'video' ? Clapperboard : ImagePlus
  return (
    <div className="pop-in group relative">
      <Thumb
        src={preview ?? null}
        lazy={false}
        className={cn(
          'rounded-[10px] ring-1 ring-border',
          file.kind === 'image' ? 'size-16' : 'h-16 w-28'
        )}
        fallback={
          <div className="flex h-full w-full items-center justify-center text-text-3">
            <Icon size={18} strokeWidth={1.6} />
          </div>
        }
      >
        {file.kind !== 'image' ? (
          <span className="absolute inset-x-1 bottom-1 truncate rounded-[4px] bg-black/60 px-1 py-px text-[9.5px] text-white">
            {file.name}
          </span>
        ) : null}
      </Thumb>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-bg text-text-2 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-text"
      >
        <X size={11} />
      </button>
    </div>
  )
}

function Recent(): ReactElement | null {
  const recent = useProject((s) => s.recent)
  const open = useProject((s) => s.open)
  const loading = useProject((s) => s.loading)
  const busy = useStart((s) => s.busy)
  if (recent.length === 0 || busy) return null
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-2 py-1">
        <h2 className="text-[13px] font-semibold text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
          Recent
        </h2>
        <span className="text-[11px] text-white/70 [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
          {recent.length} project{recent.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-3">
        {recent.slice(0, 12).map((r, i) => (
          <div
            key={r.dir}
            style={{ animationDelay: `${i * 30}ms` }}
            className="card card-hover group rise-in relative overflow-hidden"
          >
            <button
              type="button"
              className="block w-full p-1.5 text-left"
              onClick={() => void open(r.dir).catch(() => undefined)}
              disabled={loading}
              title={r.dir}
            >
              <Thumb
                src={r.thumb}
                lazy={false}
                className="aspect-video w-full rounded-[6px]"
                imgClassName="transition-[opacity,transform] duration-300 group-hover:scale-[1.03]"
                fallback={
                  <div className="flex h-full w-full items-center justify-center text-text-3">
                    <Film size={18} strokeWidth={1.5} />
                  </div>
                }
              >
                {r.duration ? (
                  <span className="absolute right-1.5 bottom-1.5 rounded-[4px] bg-black/70 px-1.5 py-[2px] font-mono text-[10px] text-white tabular-nums">
                    {formatDuration(r.duration)}
                  </span>
                ) : null}
              </Thumb>
              <div className="px-1 pt-2 pb-0.5">
                <div className="truncate pr-6 text-[12px] font-medium text-text">{r.name}</div>
                <div className="mt-px text-[11px] text-text-3">
                  {r.aspect} · {relativeDate(r.lastOpenedAt)}
                </div>
              </div>
            </button>
            <RecentMenu dir={r.dir} name={r.name} />
          </div>
        ))}
      </div>
    </section>
  )
}

/** Remove from Recent, or move the project to the Trash (with a confirmation). */
function RecentMenu({ dir, name }: { dir: string; name: string }): ReactElement {
  const [confirm, setConfirm] = useState(false)
  const refresh = useProject((s) => s.refreshRecent)
  const item =
    'flex h-8 w-full cursor-default items-center gap-2 rounded-[6px] px-2.5 text-[12.5px] outline-none data-[highlighted]:bg-hover'
  return (
    <Menu.Root onOpenChange={(o) => !o && setConfirm(false)}>
      <Menu.Trigger
        aria-label={`More for ${name}`}
        className="absolute right-2.5 bottom-3 flex size-6 items-center justify-center rounded-[6px] text-text-3 opacity-0 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-hover hover:text-text data-[popup-open]:opacity-100"
      >
        <MoreHorizontal size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Menu.Popup className="tip-popup min-w-[200px] rounded-[10px] border border-border bg-bg p-1 shadow-popover outline-none">
            <Menu.Item
              className={cn(item, 'text-text')}
              onClick={() => {
                void luca.project.forget(dir).then(refresh)
                toast(`Removed ${name} from Recent`, {
                  description: 'The project folder is still on disk.'
                })
              }}
            >
              <X size={13} className="text-text-3" /> Remove from Recent
            </Menu.Item>
            {confirm ? (
              <Menu.Item
                className={cn(item, 'font-medium text-danger')}
                onClick={() => {
                  void luca.project
                    .trash(dir)
                    .then(() => {
                      void refresh()
                      toast(`Moved ${name} to the Trash`)
                    })
                    .catch((e) => toast.error(String(e)))
                }}
              >
                <Trash2 size={13} /> Click again to move to Trash
              </Menu.Item>
            ) : (
              <Menu.Item
                closeOnClick={false}
                className={cn(item, 'text-danger')}
                onClick={() => setConfirm(true)}
              >
                <Trash2 size={13} /> Move to Trash…
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
