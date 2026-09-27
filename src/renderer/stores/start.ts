import type { Aspect, CreateProgress, StartKind } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { useChat } from './chat'
import { errorMessage, useProject } from './project'
import { useUi } from './ui'

export type Attachment = { path: string; name: string; kind: 'video' | 'audio' | 'image' }

const VIDEO = /\.(mp4|mov|m4v|webm)$/i
const AUDIO = /\.(mp3|wav|m4a|flac|aac|ogg)$/i
const IMAGE = /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif|tiff?)$/i

export function attachmentOf(path: string): Attachment | null {
  const name = path.split('/').pop() ?? path
  if (VIDEO.test(name)) return { path, name, kind: 'video' }
  if (AUDIO.test(name)) return { path, name, kind: 'audio' }
  if (IMAGE.test(name)) return { path, name, kind: 'image' }
  return null
}

export function kindOf(files: Attachment[]): StartKind {
  if (files.some((f) => f.kind === 'video')) return 'video'
  if (files.some((f) => f.kind === 'audio')) return 'audio'
  if (files.length) return 'images'
  return 'scratch'
}

/** "A 20-second launch teaser for my coffee brand" → "Launch teaser coffee brand". */
function nameFrom(prompt: string): string | undefined {
  const words = prompt
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        !/^(a|an|the|make|me|for|of|my|with|and|to|video|please|create|\d+[-\s]?seconds?)$/i.test(w)
    )
  const name = words.slice(0, 4).join(' ')
  return name ? name[0].toUpperCase() + name.slice(1) : undefined
}

type StartStore = {
  /** In the order they were added: videos play back to back in this order. */
  files: Attachment[]
  previews: Record<string, string | null>
  aspect: Aspect
  /** The video the aspect was read from (the first one); whether the person then picked one. */
  aspectFrom: string | null
  aspectPicked: boolean
  /** Target length in seconds; null lets Luca decide. */
  duration: number | null
  busy: boolean
  progress: CreateProgress | null
  /** Stages seen during the current create, for the step list. */
  seen: CreateProgress['stage'][]
  error: string | null
  addFiles: (paths: string[]) => void
  removeFile: (path: string) => void
  pickFiles: () => Promise<void>
  setAspect: (a: Aspect) => void
  setDuration: (d: number | null) => void
  reset: () => void
  /**
   * Create the project from the attachments (or from nothing), open it and hand Luca the idea
   * with any components the person picked (they wait as chips in the chat composer).
   */
  /** `spoken`: asked out loud, so Luca's first reply is short enough to read aloud. */
  create: (prompt: string, opts?: { spoken?: boolean }) => Promise<boolean>
}

let bound = false

/** The first video decides the project's shape (phone footage: portrait) until the person picks. */
function followFirstVideo(): void {
  const { files, aspectFrom } = useStart.getState()
  const first = files.find((f) => f.kind === 'video')?.path ?? null
  if (first === aspectFrom) return
  useStart.setState({ aspectFrom: first, aspectPicked: false })
  if (!first) return
  void luca.project
    .probeVideo(first)
    .then((info) => {
      const s = useStart.getState()
      if (info && s.aspectFrom === first && !s.aspectPicked)
        useStart.setState({ aspect: info.aspect })
    })
    .catch(() => undefined)
}

export const useStart = create<StartStore>((set, get) => ({
  files: [],
  previews: {},
  aspect: 'landscape',
  aspectFrom: null,
  aspectPicked: false,
  duration: null,
  busy: false,
  progress: null,
  seen: [],
  error: null,

  addFiles: (paths) => {
    const next = [...get().files]
    for (const p of paths) {
      const a = attachmentOf(p)
      if (!a || next.some((f) => f.path === p)) continue
      // videos and images add up in the order they come; one audio track at a time
      if (a.kind === 'audio') {
        const at = next.findIndex((f) => f.kind === 'audio')
        if (at >= 0) next.splice(at, 1)
      }
      next.push(a)
    }
    set({ files: next, error: null })
    followFirstVideo()
    for (const f of next) {
      if (f.path in get().previews) continue
      set((s) => ({ previews: { ...s.previews, [f.path]: null } }))
      void luca.project
        .mediaPreview(f.path)
        .then((url) => set((s) => ({ previews: { ...s.previews, [f.path]: url } })))
        .catch(() => undefined)
    }
  },
  removeFile: (path) => {
    set((s) => ({ files: s.files.filter((f) => f.path !== path) }))
    followFirstVideo()
  },
  pickFiles: async () => {
    const paths = await luca.project.pickMedia()
    if (paths.length) get().addFiles(paths)
  },
  setAspect: (aspect) => set({ aspect, aspectPicked: true }),
  setDuration: (duration) => set({ duration }),
  reset: () => set({ files: [], aspectFrom: null, error: null, progress: null, seen: [] }),

  create: async (prompt, opts) => {
    if (get().busy) return false
    if (!bound) {
      bound = true
      luca.project.onCreateProgress((p) =>
        set((s) => ({
          progress: p,
          seen: s.seen.includes(p.stage) ? s.seen : [...s.seen, p.stage]
        }))
      )
    }
    const { files, aspect, duration } = get()
    const kind = kindOf(files)
    const text = prompt.trim()
    // a background picked on the start card goes to Luca with the first request
    const background = useChat.getState().chips.some((c) => c.kind === 'background')
    if (kind === 'scratch' && !text && !background) {
      set({ error: 'Describe the video you want, or add a video, audio, images or a background.' })
      return false
    }
    set({ busy: true, error: null, progress: { stage: 'preparing' }, seen: ['preparing'] })
    useProject.setState({ loading: true })
    try {
      const res = await luca.project.start({
        name: nameFrom(text),
        aspect,
        files: files.map((f) => f.path),
        duration: duration ?? undefined
      })
      useProject.setState({ project: res.project, version: 0, previewVersion: 0 })
      set({ files: [], previews: {}, aspectFrom: null })
      const chat = useChat.getState()
      // a video with nothing asked is a plain new project; everything else starts Luca working
      if (text || kind === 'images' || kind === 'audio' || background) {
        if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
        const visible =
          text ||
          (kind === 'images'
            ? files.length === 1
              ? 'Turn my photo into a video'
              : `Make a video from my ${files.length} photos`
            : kind === 'audio'
              ? 'Make a video that goes with my audio'
              : kind === 'video'
                ? files.filter((f) => f.kind === 'video').length > 1
                  ? 'Put my videos on this background'
                  : 'Put my video on this background'
                : 'Make a video on this background')
        await chat.send(visible, {
          time: 0,
          note: res.brief,
          ...(opts?.spoken ? { voice: true } : {})
        })
      }
      return true
    } catch (err) {
      set({ error: errorMessage(err) })
      return false
    } finally {
      useProject.setState({ loading: false })
      set({ busy: false })
    }
  }
}))
