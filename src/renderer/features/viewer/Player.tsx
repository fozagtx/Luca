import '@hyperframes/player'
import type { HyperframesPlayer } from '@hyperframes/player'
import { DEFAULT_ASPECT, sizeOf } from '@shared/aspect'
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
  const projectId = project?.id ?? null
  const version = useProject((s) => s.previewVersion)
  const ref = useRef<HyperframesPlayer | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** Where to put the playhead (and whether to play) once the reloading preview is ready. */
  const restore = useRef<{ time: number; playing: boolean } | null>(null)
  /** Just restored: the new document may still report its own start once; that isn't shown. */
  const settling = useRef<{ time: number; until: number } | null>(null)
  const loadError = usePlayer((s) => s.loadError)
  const ready = usePlayer((s) => s.ready)
  const [el, setEl] = useState<HyperframesPlayer | null>(null)
  const { setHandle, setReady, setLoadError, setPlaying, setTime, setDuration } =
    usePlayer.getState()

  // register the imperative handle once the element exists
  useEffect(() => {
    const el = ref.current
    setEl(el)
    if (!el) return
    // while a new version loads, play, pause and seek also update where it picks up, so a frame
    // step or a click on the timeline during an edit isn't undone when the new version is ready
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
        settling.current = null
        el.seek(t)
      },
      setMuted: (m) => {
        el.muted = m
      },
      setVolume: (v) => {
        el.volume = v
      }
    })
    // a new player (back from Home) starts as loud as the transport says
    const { muted, volume } = usePlayer.getState()
    el.muted = muted
    el.volume = volume
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
        settling.current = { time, until: performance.now() + 800 }
        setTime(el.currentTime)
      } else {
        setTime(0)
      }
    }
    // the new document starts at 0: the playhead stays where it was until the version is ready
    const onTime = (): void => {
      if (restore.current) return
      const s = settling.current
      if (s && performance.now() < s.until && el.currentTime < s.time - 0.05) return
      setTime(el.currentTime)
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onEnded = (): void => setPlaying(false)
    const onDuration = (): void => setDuration(el.duration)
    const onError = (e: Event): void => {
      // the player's error event carries { message }
      const detail = (e as CustomEvent<{ message?: string } | undefined>).detail
      const message = detail?.message || 'The preview could not load'
      console.warn('[luca] preview error', message)
      setLoadError(message)
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
      setLoadError(null)
      setReady(false)
      setPlaying(false)
      // Home (or the next project) shouldn't show this project's playhead and length
      setTime(0)
      setDuration(0)
      // nor pick up where this one was
      restore.current = null
      settling.current = null
    }
  }, [projectId, setHandle, setReady, setLoadError, setPlaying, setTime, setDuration])

  // reload on change, remembering where we were. Keyed on the id: the project object is replaced
  // when it opens (the open call and the broadcast both set it), which loaded it twice.
  useEffect(() => {
    const el = ref.current
    if (!el || !projectId) return
    // an edit landing while the last one still loads keeps the place that one remembered (the
    // loading document has already put the player back at 0)
    if (version > 0 && !restore.current)
      restore.current = { time: el.currentTime, playing: !el.paused }
    setLoadError(null)
    el.setAttribute('src', `/p/${encodeURIComponent(projectId)}/index.html?v=${version}`)
  }, [projectId, version, setLoadError])

  // letterbox: fit the composition into the host. Until the composition says its size, the
  // project's shape stands in, so a vertical video doesn't start as a wide black box and jump.
  const aspect = project?.aspect ?? DEFAULT_ASPECT
  useEffect(() => {
    const host = hostRef.current
    const el = ref.current
    if (!host || !el) return
    let known = false
    const fit = (): void => {
      const [w, h] = known
        ? [el.compositionWidth || 1920, el.compositionHeight || 1080]
        : sizeOf(aspect)
      const { width: hw, height: hh } = host.getBoundingClientRect()
      if (!(hw > 0 && hh > 0)) return
      const scale = Math.min(hw / w, hh / h)
      el.style.width = `${Math.floor(w * scale)}px`
      el.style.height = `${Math.floor(h * scale)}px`
    }
    const onSized = (): void => {
      known = true
      fit()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    el.addEventListener('ready', onSized)
    el.addEventListener('resize', onSized)
    return () => {
      ro.disconnect()
      el.removeEventListener('ready', onSized)
      el.removeEventListener('resize', onSized)
    }
  }, [projectId, aspect])

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
        {/* keyed: what was picked or being written about belongs to that project */}
        <TransformOverlay key={`t-${project.id}`} player={el} />
        <GrabOverlay key={`g-${project.id}`} player={el} />
        {!ready && !loadError ? (
          <div
            role="status"
            // after a beat, so a quick load doesn't flash it
            className="fade-in pointer-events-none absolute inset-0 z-[5] flex items-center justify-center gap-2 rounded-[4px] text-[12px] text-white/70 [animation-delay:400ms]"
          >
            <span className="btn-spinner" aria-hidden />
            Loading the preview…
          </div>
        ) : null}
        <MakingOverlay />
        {loadError ? (
          <div
            role="alert"
            className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-[4px] bg-black/70 px-5 text-center text-[13px] text-white"
          >
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
