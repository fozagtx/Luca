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
  files: Attachment[]
  previews: Record<string, string | null>
  aspect: Aspect
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
  create: (prompt: string) => Promise<boolean>
}

let bound = false

export const useStart = create<StartStore>((set, get) => ({
  files: [],
  previews: {},
  aspect: 'landscape',
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
      // one video or audio file is the whole starting point; images can be many
      if (a.kind !== 'image') {
        const keep = next.filter((f) => f.kind === 'image')
        next.length = 0
        next.push(...keep)
      } else if (next.some((f) => f.kind !== 'image')) continue
      next.push(a)
    }
    set({ files: next, error: null })
    for (const f of next) {
      if (f.path in get().previews) continue
      set((s) => ({ previews: { ...s.previews, [f.path]: null } }))
      void luca.project
        .mediaPreview(f.path)
        .then((url) => set((s) => ({ previews: { ...s.previews, [f.path]: url } })))
        .catch(() => undefined)
    }
  },
  removeFile: (path) => set((s) => ({ files: s.files.filter((f) => f.path !== path) })),
  pickFiles: async () => {
    const paths = await luca.project.pickMedia()
    if (paths.length) get().addFiles(paths)
  },
  setAspect: (aspect) => set({ aspect }),
  setDuration: (duration) => set({ duration }),
  reset: () => set({ files: [], error: null, progress: null, seen: [] }),

  create: async (prompt) => {
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
    if (kind === 'scratch' && !text) {
      set({ error: 'Describe the video you want, or add a video, audio or images.' })
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
      set({ files: [], previews: {} })
      const chat = useChat.getState()
      // a video with nothing asked is a plain new project; everything else starts Luca working
      if (text || kind === 'images' || kind === 'audio') {
        if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
        const visible =
          text ||
          (kind === 'images'
            ? files.length === 1
              ? 'Turn my photo into a video'
              : `Make a video from my ${files.length} photos`
            : 'Make a video that goes with my audio')
        await chat.send(visible, { time: 0, note: res.brief })
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
