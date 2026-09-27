import { Shuffle, Wallpaper } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { useBackgrounds } from '../../stores/backgrounds'
import { useUi } from '../../stores/ui'

/**
 * The home screen's backdrop: today's Pexels video (or photo) playing full-bleed behind the start
 * card, dimmed so the words stay readable, with its credit and a shuffle in the corner. Without
 * a Pexels key it offers to connect one instead.
 */
export function HomeBackdrop(): ReactElement | null {
  const hasKey = useBackgrounds((s) => s.hasKey)
  const home = useBackgrounds((s) => s.home)
  const windowActive = useUi((s) => s.windowActive)
  const setBackgrounds = useUi((s) => s.setBackgrounds)
  const [poster, setPoster] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [shuffling, setShuffling] = useState(false)
  const [still] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (hasKey === null) void useBackgrounds.getState().checkKey()
    else if (hasKey) void useBackgrounds.getState().loadHome()
  }, [hasKey])

  // nothing plays while Luca is in the background
  useEffect(() => {
    const v = video.current
    if (!v) return
    if (windowActive) void v.play().catch(() => undefined)
    else v.pause()
  }, [windowActive, home?.id])

  const shuffle = async (): Promise<void> => {
    setShuffling(true)
    await useBackgrounds.getState().loadHome(true)
    setShuffling(false)
  }

  const moving = !!home && home.media === 'video' && !!home.preview && !still

  return (
    <>
      {home ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            key={`poster-${home.id}`}
            src={home.poster}
            alt=""
            draggable={false}
            onLoad={() => setPoster(home.id)}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out',
              poster === home.id ? 'opacity-100' : 'opacity-0'
            )}
          />
          {moving ? (
            <video
              key={home.id}
              ref={video}
              src={home.preview}
              autoPlay={windowActive}
              muted
              loop
              playsInline
              onPlaying={() => setPlaying(home.id)}
              className={cn(
                'absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out',
                playing === home.id ? 'opacity-100' : 'opacity-0'
              )}
            />
          ) : null}
          <div className="home-scrim absolute inset-0" />
        </div>
      ) : null}

      {home ? (
        <div className="fade-in absolute right-3 bottom-3 z-10 flex max-w-[calc(100%-24px)] items-center gap-0.5 rounded-full border border-border bg-bg/85 py-0.5 pr-0.5 pl-2.5 text-[10.5px] text-text-2 shadow-card backdrop-blur">
          <a
            href={home.url}
            target="_blank"
            rel="noreferrer"
            title={home.title}
            className="truncate transition-colors hover:text-text"
          >
            {home.media === 'video' ? 'Video' : 'Photo'} by {home.author} on Pexels
          </a>
          <Tip label="Show another background" side="top">
            <button
              type="button"
              aria-label="Show another background"
              disabled={shuffling}
              onClick={() => void shuffle()}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-hover hover:text-text active:scale-90 disabled:opacity-50"
            >
              <Shuffle size={12} strokeWidth={1.9} className={shuffling ? 'animate-pulse' : ''} />
            </button>
          </Tip>
        </div>
      ) : hasKey === false ? (
        <button
          type="button"
          onClick={() => setBackgrounds(true)}
          className="chip fade-in absolute right-3 bottom-3 z-10 shadow-card"
        >
          <Wallpaper size={12} strokeWidth={1.9} /> Add Pexels backgrounds
        </button>
      ) : null}
    </>
  )
}
