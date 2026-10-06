import { Dialog } from '@base-ui/react/dialog'
import { Check, ChevronLeft, ChevronRight, Copy, FolderSearch, ImageOff, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import { toast } from 'sonner'
import { cn } from '../../lib/cn'
import { formatDuration } from '../../lib/format'
import { luca } from '../../lib/luca'
import { useProject } from '../../stores/project'
import { copyImage, type Visual } from './images'

/** Buttons on the dimmed backdrop: light on dark in either theme. */
const BAR =
  'inline-flex h-8 items-center gap-1.5 rounded-full bg-white/12 px-3 text-[12px] font-medium text-white/90 backdrop-blur-md transition-[background-color,color,transform] duration-150 hover:bg-white/20 hover:text-white active:scale-95'
const ROUND =
  'flex size-8 items-center justify-center rounded-full bg-white/12 text-white/90 backdrop-blur-md transition-[background-color,color,transform] duration-150 hover:bg-white/20 hover:text-white active:scale-95'

/**
 * Copies a picture to the clipboard, then shows a check for a moment. `label` shows the words
 * too (the viewer); without it, it is a round icon button (on a tile).
 */
export function CopyImageButton({
  src,
  label,
  className
}: {
  src: string
  label?: boolean
  className?: string
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (e: MouseEvent): void => {
    e.stopPropagation()
    copyImage(src).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      },
      () => toast('Luca couldn’t copy this image')
    )
  }
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy image'}
      title={label ? undefined : 'Copy image'}
      onClick={copy}
      className={className}
    >
      {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} />}
      {label ? (copied ? 'Copied' : 'Copy image') : null}
    </button>
  )
}

/**
 * The picture viewer (lightbox): the image fit to the window over a dimmed backdrop. Esc or a
 * click outside closes it, ← → step through the message's pictures, and focus stays inside
 * while it's open and goes back to the tile after.
 */
export function ImageViewer({
  items,
  index,
  open,
  onIndex,
  onOpenChange
}: {
  items: Visual[]
  index: number
  open: boolean
  onIndex: (i: number) => void
  onOpenChange: (open: boolean) => void
}): ReactElement {
  const close = useRef<HTMLButtonElement>(null)
  const projectOpen = useProject((s) => !!s.project)
  const item = items[Math.min(index, items.length - 1)]
  const many = items.length > 1
  const go = (step: number): void => {
    const next = index + step
    if (next >= 0 && next < items.length) onIndex(next)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey) return
    const t = e.target as HTMLElement
    if (e.key === 'Escape') onOpenChange(false)
    // a playing video takes its own arrow keys (seeking)
    else if (e.key === 'ArrowLeft' && t.tagName !== 'VIDEO') go(-1)
    else if (e.key === 'ArrowRight' && t.tagName !== 'VIDEO') go(1)
    // the window's shortcuts (space plays, Delete removes a clip…) mustn't act behind the viewer
    e.stopPropagation()
  }

  const reveal = (): void => {
    if (!item?.path) return
    luca.project
      .revealInFinder(item.path)
      .catch(() => toast('Luca couldn’t find this file in your project'))
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="no-drag fixed inset-0 z-50 bg-black/80 backdrop-blur-[3px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          initialFocus={close}
          onKeyDown={onKey}
          // the popup lets clicks through to the backdrop (which closes it) around the picture
          className="no-drag pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center outline-none transition-[opacity,transform] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0"
        >
          {item ? (
            <>
              <Dialog.Title className="sr-only">{item.name}</Dialog.Title>
              <div className="pointer-events-auto absolute top-3.5 right-3.5 flex items-center gap-1.5">
                {item.video ? null : <CopyImageButton src={item.src} label className={BAR} />}
                {item.path && projectOpen ? (
                  <button type="button" onClick={reveal} className={BAR}>
                    <FolderSearch size={13} /> Show in Finder
                  </button>
                ) : null}
                <Dialog.Close ref={close} aria-label="Close" className={ROUND}>
                  <X size={15} />
                </Dialog.Close>
              </div>
              <Media key={index} item={item} />
              <div className="pointer-events-auto mt-3 flex max-w-[min(560px,80vw)] items-center gap-2 text-[12px] text-white/70">
                <span className="truncate select-text">{item.name}</span>
                {item.video && item.duration ? (
                  <span className="shrink-0 tabular-nums">{formatDuration(item.duration)}</span>
                ) : null}
                {many ? (
                  <span className="shrink-0 tabular-nums">
                    {index + 1} of {items.length}
                  </span>
                ) : null}
              </div>
              {many ? (
                <>
                  <button
                    type="button"
                    aria-label="Previous"
                    disabled={index === 0}
                    onClick={() => go(-1)}
                    className={cn(
                      ROUND,
                      'pointer-events-auto absolute top-1/2 left-4 size-9 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-0'
                    )}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next"
                    disabled={index === items.length - 1}
                    onClick={() => go(1)}
                    className={cn(
                      ROUND,
                      'pointer-events-auto absolute top-1/2 right-4 size-9 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-0'
                    )}
                  >
                    <ChevronRight size={17} />
                  </button>
                </>
              ) : null}
            </>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The picture (or the video, playing) at its own size, never larger than the window. */
function Media({ item }: { item: Visual }): ReactElement {
  // the file, then the small still made when it was added, then a note that it's gone
  const [attempt, setAttempt] = useState(0)
  const src = attempt === 0 ? item.src : attempt === 1 ? item.thumb : undefined
  const fit =
    'pointer-events-auto max-h-[calc(100vh-128px)] max-w-[calc(100vw-128px)] rounded-[10px] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)]'
  if (item.video && item.play)
    return (
      <video
        src={item.play}
        poster={item.src}
        controls
        autoPlay
        playsInline
        aria-label={item.name}
        className={cn(fit, 'bg-black')}
      />
    )
  if (!src)
    return (
      <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-[12px] bg-white/8 px-8 py-7 text-[12.5px] text-white/75">
        <ImageOff size={20} strokeWidth={1.6} />
        This picture is no longer in the project.
      </div>
    )
  return (
    <img
      src={src}
      alt={item.name}
      draggable={false}
      onError={() => setAttempt((a) => (a === 0 && item.thumb && item.thumb !== item.src ? 1 : 2))}
      className={cn(fit, 'object-contain')}
    />
  )
}
