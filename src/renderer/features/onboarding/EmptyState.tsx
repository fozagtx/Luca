import { Menu } from '@base-ui/react/menu'
import { TEMPLATES } from '@shared/styles'
import type { Chip } from '@shared/types'
import {
  AudioLines,
  Clapperboard,
  Film,
  FolderOpen,
  ImagePlus,
  MoreHorizontal,
  Paperclip,
  Trash2,
  Wallpaper,
  X
} from 'lucide-react'
import {
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { toast } from 'sonner'
import logo from '../../assets/logo.png'
import { EdgeGlow } from '../../components/ui/edge-glow'
import { GenerateButton } from '../../components/ui/generate-button'
import { Segmented } from '../../components/ui/segmented'
import { Thumb } from '../../components/ui/thumb'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { formatDuration, relativeDate } from '../../lib/format'
import { luca } from '../../lib/luca'
import { useChat } from '../../stores/chat'
import { useProject } from '../../stores/project'
import { kindOf, useStart, type Attachment } from '../../stores/start'
import { useUi } from '../../stores/ui'
import { HomeBackdrop } from '../backgrounds/HomeBackdrop'
import { ChipPill } from '../chat/Message'
import { CreateProgressList } from './CreateProgress'
import { StartSteps } from './StartSteps'
import { ASPECTS, lengthOptions } from './steps-lib'
import { StyleFieldIcon } from './StyleFieldIcon'
import { Templates } from './Templates'

const IDEAS = [
  'A 15-second launch teaser with bold kinetic titles',
  'A photo slideshow with smooth camera moves',
  'An animated quote card for Instagram',
  'A product explainer with a chart and a logo ending'
]

export function EmptyState(): ReactElement {
  // while the steps are open they are all there is: one choice at a time
  const inSteps = useStart((s) => s.step !== null)
  return (
    <div className="relative h-full">
      <HomeBackdrop />
      <div className="scroll relative h-full">
        <div
          className={cn('flex min-h-full flex-col items-center px-8', inSteps ? 'py-5' : 'py-10')}
        >
          <div className="my-auto flex w-full max-w-[760px] flex-col gap-10">
            <StartCard />
            {inSteps ? null : <Templates />}
            {inSteps ? null : <Recent />}
          </div>
        </div>
      </div>
    </div>
  )
}

function StartCard(): ReactElement {
  const { files, previews, aspect, duration, busy, progress, seen, error, step, idea, style } =
    useStart()
  const { addFiles, removeFile, pickFiles, setAspect, setDuration } = useStart()
  const { create, begin, setStep, applyTemplate } = useStart()
  const draft = useChat((s) => s.draft)
  const setDraft = useChat((s) => s.setDraft)
  const chips = useChat((s) => s.chips)
  const removeChip = useChat((s) => s.removeChip)
  const setBackgrounds = useUi((s) => s.setBackgrounds)
  const template = TEMPLATES.find((t) => t.id === style.template)
  const inSteps = step !== null
  const openProject = useProject((s) => s.open)
  const loading = useProject((s) => s.loading)
  const [over, setOver] = useState(false)
  const [since, setSince] = useState<number | undefined>()
  const ref = useRef<HTMLTextAreaElement>(null)
  const kind = kindOf(files)
  const videos = files.filter((f) => f.kind === 'video')
  // the video (or audio) the project starts from, named on the progress card
  const lead = videos[0] ?? files.find((f) => f.kind === 'audio')
  const bgAt = chips.findIndex((c) => c.kind === 'background')
  const background = bgAt < 0 ? null : (chips[bgAt] as Extract<Chip, { kind: 'background' }>)
  const canGo = !busy && (draft.trim().length > 0 || files.length > 0 || !!background)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 66), 180)}px`
  }, [draft])

  /** The idea goes to the steps first (theme, font…); a video with nothing asked just opens. */
  const go = async (): Promise<void> => {
    if (!canGo) return
    const text = draft
    const begun = begin(text)
    if (begun === 'invalid') return
    setDraft('')
    if (begun === 'steps') return
    setSince(Date.now())
    const ok = await create(text)
    if (!ok) setDraft(text)
  }
  const createFromSteps = (): void => {
    setSince(Date.now())
    void create(idea)
  }
  const editIdea = (): void => {
    // words typed meanwhile (in the chat) win over the idea
    if (!draft.trim()) setDraft(idea)
    setStep(null)
    requestAnimationFrame(() => ref.current?.focus())
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void go()
    }
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

  const placeholder =
    template && kind === 'scratch'
      ? template.placeholder
      : kind === 'images'
        ? files.length === 1
          ? 'What should this photo become? (optional) e.g. “a moody cinematic intro”'
          : 'What should Luca make from these photos? (optional)'
        : kind === 'video'
          ? videos.length > 1
            ? 'What should Luca make from these clips? (optional) e.g. “cut them into a 30-second reel”'
            : 'What should Luca do with this video? (optional) e.g. “add captions and a title”'
          : kind === 'audio'
            ? 'What visuals should go with this audio? (optional)'
            : 'Describe the video you want… e.g. “a 15-second launch teaser for my coffee brand”'
  const catalogChips = chips.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'catalog')

  return (
    // isolate: the glow while the video starts sits behind the card
    <section className={cn('isolate flex flex-col items-center', inSteps ? 'gap-4' : 'gap-6')}>
      {inSteps && !busy ? (
        // compact while the steps are open, so the choices and Next fit on one screen
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-text">Make it yours</h1>
          <p className="text-[12.5px] leading-relaxed text-text-2">
            A few quick choices so Luca gets the look right. Slide through each one, or skip it and
            Luca decides.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src={logo}
            alt=""
            draggable={false}
            className="size-16 rounded-[16px] shadow-[0_10px_24px_rgba(0,0,0,0.18)] transition-transform duration-300 hover:scale-105 hover:-rotate-2"
          />
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-text">
            What are we making today?
          </h1>
          <p className="max-w-[460px] text-[13px] leading-relaxed text-text-2">
            Start from a video, one photo, a handful of images, a template or just an idea. Luca
            asks a few quick questions, then builds the scenes, titles, effects and motion for you.
          </p>
        </div>
      )}

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
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('button, a, input, [role=tab]'))
            ref.current?.focus()
        }}
        className={cn(
          'relative w-full cursor-text rounded-[18px] border bg-input transition-[border-color,box-shadow,transform,background-color] duration-200 ease-out',
          over
            ? 'scale-[1.01] border-dashed border-accent bg-accent/[0.04] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_14%,transparent)]'
            : 'border-border shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-14px_rgba(0,0,0,0.18)] focus-within:border-border-strong focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_14px_36px_-14px_rgba(0,0,0,0.24)]'
        )}
      >
        <EdgeGlow on={busy} />
        {over ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-[18px] text-accent">
            <ImagePlus size={22} strokeWidth={1.6} />
            <span className="text-[13px] font-medium">Drop a video, audio or images</span>
          </div>
        ) : null}

        {busy ? (
          <div className="rise-in flex flex-col gap-4 p-5">
            <div className="text-[13px] font-semibold text-text">
              {kind === 'scratch'
                ? 'Starting a new video from scratch'
                : kind === 'images'
                  ? `Starting from your ${files.length === 1 ? 'photo' : `${files.length} photos`}`
                  : kind === 'video' && videos.length > 1
                    ? `Starting from your ${videos.length} videos`
                    : `Starting from ${lead?.name ?? 'your file'}`}
            </div>
            <CreateProgressList kind={kind} progress={progress} seen={seen} since={since} />
          </div>
        ) : inSteps ? (
          <div className={cn(over && 'opacity-0')}>
            <StartSteps onCreate={createFromSteps} onEditIdea={editIdea} />
          </div>
        ) : (
          <div className={cn('flex flex-col', over && 'opacity-0')}>
            {template ? (
              <div className="flex px-4 pt-3.5">
                <span className="pop-in inline-flex h-7 items-center gap-1.5 rounded-full border border-secondary-border bg-secondary pr-1 pl-2.5 text-[12px] font-medium text-secondary-fg">
                  <StyleFieldIcon field="template" size={12} />
                  Template: {template.name}
                  <span className="font-normal opacity-75">
                    · {template.duration}s {template.aspect === 'portrait' ? '9:16' : '16:9'}
                  </span>
                  <button
                    type="button"
                    aria-label="Stop using the template"
                    onClick={() => applyTemplate(null)}
                    className="ml-0.5 flex size-5 items-center justify-center rounded-full hover:bg-bg/60"
                  >
                    <X size={11} />
                  </button>
                </span>
              </div>
            ) : null}
            {files.length > 0 || background ? (
              <div className="flex flex-wrap gap-2 px-4 pt-4">
                {background ? (
                  <BackgroundTile
                    chip={background}
                    onChange={() => setBackgrounds(true)}
                    onRemove={() => removeChip(bgAt)}
                  />
                ) : null}
                {files.map((f) => (
                  <AttachmentTile
                    key={f.path}
                    file={f}
                    preview={previews[f.path]}
                    onRemove={() => removeFile(f.path)}
                  />
                ))}
                {kind === 'images' || kind === 'video' ? (
                  <Tip label={kind === 'video' ? 'Add more videos or images' : 'Add more images'}>
                    <button
                      type="button"
                      onClick={() => void pickFiles()}
                      className="flex size-16 items-center justify-center rounded-[10px] border border-dashed border-border-strong text-text-3 transition-colors hover:border-accent hover:text-accent"
                    >
                      <ImagePlus size={18} strokeWidth={1.6} />
                    </button>
                  </Tip>
                ) : null}
              </div>
            ) : null}
            <textarea
              ref={ref}
              id="start-prompt"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              placeholder={placeholder}
              rows={3}
              className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-[22px] text-text placeholder:text-text-3"
            />
            {catalogChips.length ? (
              <div className="flex flex-wrap gap-1 px-4 pt-1">
                {catalogChips.map(({ c, i }) => (
                  <ChipPill key={i} chip={c} onRemove={() => removeChip(i)} />
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3 pb-3">
              <Tip label="Add a video, audio or images">
                <button
                  type="button"
                  onClick={() => void pickFiles()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-bg px-3 text-[12px] font-medium text-text-2 transition-[border-color,color,transform] duration-150 hover:border-border-strong hover:text-text active:scale-[0.97]"
                >
                  <Paperclip size={13} strokeWidth={1.9} />
                  Add media
                </button>
              </Tip>
              {/* for footage it starts out matching the first video's shape */}
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
              <GenerateButton
                className="ml-auto"
                label={
                  kind === 'video' && !draft.trim() && !background && !template
                    ? 'Open in Luca'
                    : 'Continue'
                }
                generatingLabel="Creating"
                generating={busy}
                disabled={!canGo}
                onClick={() => void go()}
              />
            </div>
          </div>
        )}
      </div>

      {error && !busy ? (
        <div className="fade-in -mt-2 w-full rounded-[10px] border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12px] text-danger select-text">
          {error}
        </div>
      ) : null}

      {!busy && !inSteps ? (
        <div className="-mt-1 flex w-full flex-wrap items-center justify-center gap-1.5">
          {IDEAS.map((idea, i) => (
            <button
              key={idea}
              type="button"
              style={{ animationDelay: `${60 + i * 50}ms` }}
              onClick={() => {
                setDraft(idea)
                requestAnimationFrame(() => ref.current?.focus())
              }}
              className="chip rise-in"
            >
              {idea}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <button type="button" className="chip" onClick={() => void openDir()} disabled={loading}>
            <FolderOpen size={12} /> Open a project…
          </button>
        </div>
      ) : null}
    </section>
  )
}

/** The background picked for the new video: click to change it. */
function BackgroundTile({
  chip,
  onChange,
  onRemove
}: {
  chip: Extract<Chip, { kind: 'background' }>
  onChange: () => void
  onRemove: () => void
}): ReactElement {
  return (
    <div className="pop-in group relative">
      <button type="button" onClick={onChange} title={`${chip.title} · click to change`}>
        <Thumb
          src={chip.thumb}
          lazy={false}
          className="h-16 w-28 rounded-[10px] ring-1 ring-border"
          fallback={
            <div className="flex h-full w-full items-center justify-center text-text-3">
              <Wallpaper size={18} strokeWidth={1.6} />
            </div>
          }
        >
          <span className="absolute inset-x-1 bottom-1 truncate rounded-[4px] bg-black/60 px-1 py-px text-[9.5px] text-white">
            {chip.media === 'video'
              ? `Background · ${formatDuration(chip.duration ?? 0)}`
              : 'Background photo'}
          </span>
        </Thumb>
      </button>
      <button
        type="button"
        aria-label="Remove the background"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-bg text-text-2 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-text"
      >
        <X size={11} />
      </button>
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
      <div className="flex items-baseline justify-between px-0.5">
        <h2 className="text-[13px] font-semibold text-text">Recent</h2>
        <span className="text-[11px] text-text-3">
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
