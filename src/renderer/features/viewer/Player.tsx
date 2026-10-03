import '@hyperframes/player'
import type { HyperframesPlayer } from '@hyperframes/player'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { GrabOverlay } from './GrabOverlay'
import { MakingOverlay } from './MakingOverlay'
import { TransformOverlay } from './TransformOverlay'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string
        width?: string | number
        height?: string | number
        muted?: boolean
        'disable-click-to-play'?: string
        'assets-loading-ui'?: string
      }
    }
  }
}

/**
 * The HyperFrames player, same-origin with the UI, reloaded on every project change while
 * preserving the playhead and play state (spec: preview and hot reload).
 */
export function Player(): ReactElement | null {
  const project = useProject((s) => s.project)
  const version = useProject((s) => s.previewVersion)
  const ref = useRef<HyperframesPlayer | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** Where to pick up once a reloaded preview is ready (play, pause and seek update it). */
  const restore = useRef<{ time: number; playing: boolean } | null>(null)
  /** The time a restore seeked to, until the player reports it (it reports 0 first). */
  const landing = useRef<{ time: number; until: number } | null>(null)
  /** A restore asked to play and playback hasn't started yet (the player still says paused). */
  const resuming = useRef(false)
  const loadError = usePlayer((s) => s.loadError)
  const [el, setEl] = useState<HyperframesPlayer | null>(null)
  const { setHandle, setReady, setLoadError, setPlaying, setTime, setDuration } =
    usePlayer.getState()

  // register the imperative handle once the element exists
  useEffect(() => {
    const el = ref.current
    setEl(el)
    if (!el) return
    setHandle({
      play: () => {
        if (restore.current) restore.current.playing = true
        el.play()
      },
      pause: () => {
        if (restore.current) restore.current.playing = false
        el.pause()
      },
      seek: (t) => {
        if (restore.current) restore.current.time = t
        landing.current = null
        el.seek(t)
      },
      setMuted: (m) => {
        el.muted = m
      },
      setVolume: (v) => {
        el.volume = v
      }
    })
    const onReady = (): void => {
      setLoadError(null)
      setReady(true)
      setDuration(el.duration)
      const r = restore.current
      if (r) {
        restore.current = null
        const time = Math.min(r.time, el.duration || r.time)
        el.seek(time)
        if (r.playing) el.play()
        resuming.current = r.playing
        landing.current = { time, until: performance.now() + 1500 }
        setTime(time)
      } else {
        // the player says ready again when the page finishes loading: keep the playhead
        setTime(el.currentTime)
      }
    }
    const onTime = (): void => {
      const l = landing.current
      if (l && Math.abs(el.currentTime - l.time) > 0.5 && performance.now() < l.until) return
      landing.current = null
      setTime(el.currentTime)
    }
    const onPlay = (): void => {
      resuming.current = false
      setPlaying(true)
    }
    const onPause = (): void => {
      resuming.current = false
      setPlaying(false)
    }
    const onEnded = (): void => setPlaying(false)
    const onDuration = (): void => setDuration(el.duration)
    const onError = (e: Event): void => {
      const detail = String((e as CustomEvent).detail ?? 'The preview could not load')
      console.warn('[luca] preview error', detail)
      setLoadError(detail)
      setReady(false)
    }
    el.addEventListener('ready', onReady)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    el.addEventListener('durationchange', onDuration)
    el.addEventListener('error', onError)
    return () => {
      el.removeEventListener('ready', onReady)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('durationchange', onDuration)
      el.removeEventListener('error', onError)
      setHandle(null)
      restore.current = null
      landing.current = null
      resuming.current = false
      setLoadError(null)
      setReady(false)
      setPlaying(false)
      // Home (or the next project) shouldn't show this project's playhead and length
      setTime(0)
      setDuration(0)
    }
  }, [project?.id, setHandle, setReady, setLoadError, setPlaying, setTime, setDuration])

  // reload on change, remembering where we were
  useEffect(() => {
    const el = ref.current
    if (!el || !project) return
    if (version > 0) {
      // a change that lands before the last reload was ready, or before it played again, keeps
      // the place that one saved: the half-loaded page would say 0 s and paused
      restore.current ??= { time: el.currentTime, playing: !el.paused || resuming.current }
      setReady(false)
    }
    setLoadError(null)
    el.setAttribute('src', `/p/${encodeURIComponent(project.id)}/index.html?v=${version}`)
  }, [project, version, setReady, setLoadError])

  // letterbox: fit the composition into the host
  useEffect(() => {
    const host = hostRef.current
    const el = ref.current
    if (!host || !el) return
    const fit = (): void => {
      const w = el.compositionWidth || 1920
      const h = el.compositionHeight || 1080
      const { width: hw, height: hh } = host.getBoundingClientRect()
      const scale = Math.min(hw / w, hh / h)
      el.style.width = `${Math.floor(w * scale)}px`
      el.style.height = `${Math.floor(h * scale)}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    el.addEventListener('ready', fit)
    el.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      el.removeEventListener('ready', fit)
      el.removeEventListener('resize', fit)
    }
  }, [project?.id])

  if (!project) return null

  return (
    <div ref={hostRef} className="flex h-full w-full items-center justify-center overflow-hidden">
      <div className="relative inline-flex">
        <hyperframes-player
          ref={ref}
          id="luca-player"
          disable-click-to-play="true"
          assets-loading-ui="none"
          className="block rounded-[4px] bg-black shadow-[0_0_0_1px_rgba(0,122,255,0.55),0_8px_24px_rgba(0,0,0,0.08)]"
        />
        <TransformOverlay player={el} />
        <GrabOverlay player={el} />
        <MakingOverlay />
        {loadError ? (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-[4px] bg-black/70 px-5 text-center text-[13px] text-white">
            <p>The preview couldn’t load this version of the video.</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setLoadError(null)
                ref.current?.setAttribute(
                  'src',
                  `/p/${encodeURIComponent(project.id)}/index.html?v=${version}&r=${Date.now()}`
                )
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
