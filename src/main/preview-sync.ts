/**
 * Keeps the footage in the preview on the preview's clock, so lips stay on the voice.
 *
 * The preview plays a clip the way a browser does: its sound plays and drives the clock (the
 * captions and animations follow it) while the muted picture beside it plays on its own. The two
 * start a few frames apart, the picture slips further when decoding falls behind, and the engine
 * only steps in once it is half a second off, so a picture 40 to 100 ms behind the voice stayed
 * that way (measured in Luca's preview). This nudges the picture back: a slightly faster or slower
 * playbackRate for a small gap, a seek a little ahead (to cover the time the seek takes) for a big
 * one. It runs inside the preview page only; the export renders every frame on its own.
 *
 * The function is sent to the page as source text, so it must not use anything from outside it.
 */
function previewSync(): void {
  type Clock = {
    getTime?: () => number
    isPlaying?: () => boolean
    getPlaybackRate?: () => number
  }
  /** One video's state: the rate the engine wants, our nudge, and where it should be. */
  type Watch = {
    wanted: number
    nudge: number
    /** The media time the engine last set and the clock at that moment. */
    anchor: { media: number; clock: number } | null
    fixedAt: number
    /** How long a seek takes to land, measured on this video (null until one did). */
    lag: number | null
    seekAt: number
  }
  const win = window as Window & { __lucaSync?: boolean; __player?: Clock }
  if (win.__lucaSync) return
  win.__lucaSync = true

  /** Under IN_STEP the picture is in step; it is nudged past OUT_OF_STEP and seeked past BIG. */
  const IN_STEP = 0.006
  const OUT_OF_STEP = 0.02
  const BIG = 0.25
  /** A gap closes in about half a second: 40 ms behind plays 8% faster, never more than 15%. */
  const GAIN = 2
  const MAX_NUDGE = 0.15
  const HEARD_NUDGE = 0.05
  /** Seeking a playing video freezes it until the seek lands: only worth it when that is quick. */
  const QUICK_SEEK = 0.2

  const rateProp = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')
  const timeProp = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
  if (!rateProp?.get || !rateProp.set || !timeProp?.get || !timeProp.set) return
  const getRate = rateProp.get
  const setRate = rateProp.set
  const getTime = timeProp.get
  const setTime = timeProp.set
  const watched = new Map<HTMLVideoElement, Watch>()

  const clock = (): number | null => {
    try {
      const t = win.__player?.getTime?.()
      return typeof t === 'number' && Number.isFinite(t) ? t : null
    } catch {
      return null
    }
  }

  // The engine sets each video's rate and position through these properties; they are wrapped so
  // the nudge rides on top of its rate and every position it sets is remembered with the clock.
  const watch = (v: HTMLVideoElement): Watch => {
    const known = watched.get(v)
    if (known) return known
    const s: Watch = {
      wanted: getRate.call(v),
      nudge: 1,
      anchor: null,
      fixedAt: 0,
      lag: null,
      seekAt: 0
    }
    watched.set(v, s)
    Object.defineProperty(v, 'playbackRate', {
      configurable: true,
      get: () => s.wanted,
      set: (r: number) => {
        s.wanted = r
        setRate.call(v, r * s.nudge)
      }
    })
    Object.defineProperty(v, 'currentTime', {
      configurable: true,
      get: () => getTime.call(v),
      set: (t: number) => {
        const c = clock()
        s.anchor = c === null ? null : { media: t, clock: c }
        s.seekAt = performance.now()
        setTime.call(v, t)
      }
    })
    // every seek, the engine's too, measures how long this file takes to seek
    v.addEventListener('seeked', () => {
      if (!s.seekAt) return
      s.lag = (performance.now() - s.seekAt) / 1000
      s.seekAt = 0
    })
    return s
  }

  const setNudge = (v: HTMLVideoElement, s: Watch, n: number): void => {
    if (n === s.nudge) return
    s.nudge = n
    try {
      setRate.call(v, s.wanted * n)
    } catch {
      s.nudge = 1
    }
  }

  const step = (): void => {
    const player = win.__player
    const now = clock()
    let playing = false
    let transport = 1
    try {
      playing = !!player?.isPlaying?.()
      transport = player?.getPlaybackRate?.() || 1
    } catch {
      playing = false
    }
    for (const v of document.querySelectorAll('video')) watch(v)
    for (const [v, s] of watched) {
      if (!v.isConnected) {
        watched.delete(v)
        continue
      }
      const a = s.anchor
      const settled = !v.paused && !v.seeking && !v.loop && v.readyState >= 2
      if (!playing || now === null || !a || !settled || document.hidden) {
        setNudge(v, s, 1)
        continue
      }
      const expected = a.media + (now - a.clock) * (s.wanted / transport)
      if (expected < 0 || (Number.isFinite(v.duration) && expected > v.duration - 0.1)) {
        setNudge(v, s, 1)
        continue
      }
      const off = getTime.call(v) - expected
      const quick = s.lag !== null && s.lag < QUICK_SEEK
      if (Math.abs(off) > BIG && quick && performance.now() - s.fixedAt > 2000) {
        // far out (a stall, a slow start): jump to where the clock will be once the seek lands
        setNudge(v, s, 1)
        s.anchor = { media: expected, clock: now }
        s.fixedAt = performance.now()
        s.seekAt = s.fixedAt
        setTime.call(v, expected + (s.lag ?? 0) * (s.wanted / transport))
        continue
      }
      const nudging = s.nudge !== 1
      if (Math.abs(off) < IN_STEP || (!nudging && Math.abs(off) < OUT_OF_STEP)) {
        setNudge(v, s, 1)
        continue
      }
      // behind (off < 0) plays faster, ahead plays slower; steps of 0.5% keep rate changes rare;
      // a video that is heard is held to 5%, where the speed change can't be heard
      const most = v.muted || v.volume === 0 ? MAX_NUDGE : HEARD_NUDGE
      const n = 1 - Math.max(-most, Math.min(most, off * GAIN))
      setNudge(v, s, Math.round(n * 200) / 200)
    }
  }
  window.setInterval(step, 100)
}

/** The guard as a script for the preview page, run before the composition's own scripts. */
export const PREVIEW_SYNC_SCRIPT = `(${previewSync.toString()})();`
