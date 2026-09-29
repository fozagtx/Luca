import { create } from 'zustand'

export type PlayerHandle = {
  play: () => void
  pause: () => void
  seek: (t: number) => void
  setMuted: (m: boolean) => void
  setVolume: (v: number) => void
}

type PlayerStore = {
  handle: PlayerHandle | null
  ready: boolean
  playing: boolean
  currentTime: number
  duration: number
  fps: number
  muted: boolean
  volume: number
  grab: boolean
  loadError: string | null
  setHandle: (h: PlayerHandle | null) => void
  setReady: (ready: boolean) => void
  setLoadError: (e: string | null) => void
  setPlaying: (playing: boolean) => void
  setTime: (t: number) => void
  setDuration: (d: number) => void
  setFps: (fps: number) => void
  toggleGrab: (on?: boolean) => void
  // transport commands
  togglePlay: () => void
  seek: (t: number) => void
  step: (frames: number) => void
  nudge: (seconds: number) => void
  toggleMute: () => void
  setVolume: (v: number) => void
}

export const usePlayer = create<PlayerStore>((set, get) => ({
  handle: null,
  ready: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  fps: 30,
  muted: false,
  volume: 1,
  grab: false,
  loadError: null,
  setHandle: (handle) => set({ handle }),
  setReady: (ready) => set({ ready }),
  setLoadError: (loadError) => set({ loadError }),
  setPlaying: (playing) => set({ playing }),
  setTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setFps: (fps) => set({ fps }),
  toggleGrab: (on) => set((s) => ({ grab: on ?? !s.grab })),

  togglePlay: () => {
    const { handle, playing, currentTime, duration } = get()
    if (!handle) return
    if (playing) handle.pause()
    else {
      if (duration > 0 && currentTime >= duration - 1 / 60) handle.seek(0)
      handle.play()
    }
  },
  seek: (t) => {
    const { handle, duration } = get()
    const clamped = Math.min(Math.max(0, t), duration || t)
    set({ currentTime: clamped })
    handle?.seek(clamped)
  },
  step: (frames) => {
    const { currentTime, fps, handle } = get()
    handle?.pause()
    get().seek(currentTime + frames / fps)
  },
  nudge: (seconds) => get().seek(get().currentTime + seconds),
  toggleMute: () => {
    const muted = !get().muted
    set({ muted })
    get().handle?.setMuted(muted)
  },
  setVolume: (volume) => {
    set({ volume, muted: volume === 0 })
    get().handle?.setVolume(volume)
  }
}))
