import { styleLabel, TEMPLATES, type Template } from '@shared/styles'
import type { Aspect, Chip, CreateProgress, StartKind, StartStyle, StyleField } from '@shared/types'
import { create } from 'zustand'
import { aspectFrom, durationFrom } from '../lib/idea'
import { luca } from '../lib/luca'
import { useChat } from './chat'
import { useMaking } from './making'
import { errorMessage, useProject } from './project'
import { useUi } from './ui'

/** The start steps, in order; the review comes after the last one. */
export const START_STEPS = ['theme', 'font', 'background', 'motion', 'keyframes'] as const
export type StartStep = (typeof START_STEPS)[number]
export const REVIEW_STEP = START_STEPS.length

/** What `begin` did: opened the steps, left it to a plain create (a video, nothing asked), or refused. */
export type Begin = 'steps' | 'create' | 'invalid'

/** The picks as chips on the first request, so the person sees what Luca was given. */
function styleChips(style: StartStyle): Chip[] {
  const order: StyleField[] = ['template', 'theme', 'font', 'background', 'motion', 'keyframes']
  const names: Record<StyleField, string> = {
    template: 'Template',
    theme: 'Theme',
    font: 'Font',
    background: 'Background',
    motion: 'Motion',
    keyframes: 'Keyframes'
  }
  return order.flatMap((field) => {
    const value = style[field]
    // a Pexels pick has its own chip, with its picture
    if (!value || value === 'picked') return []
    return [{ kind: 'style', field, label: `${names[field]}: ${styleLabel(field, value)}` }]
  })
}

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
  /** The idea the start steps are for, while they are open. */
  idea: string
  /** The start step on screen (REVIEW_STEP for the review), or null while the prompt shows. */
  step: number | null
  /** What was picked on the steps or by a template; anything missing is Luca's call. */
  style: StartStyle
  /**
   * Take the idea to the steps (theme, font, background, motion, keyframes) instead of starting
   * straight away. A length or shape named in the words ("15 seconds", "a TikTok") is used.
   */
  begin: (prompt: string) => Begin
  setStep: (step: number | null) => void
  pick: <K extends keyof StartStyle>(field: K, value: StartStyle[K] | undefined) => void
  /** Start from a template (its shape, length and look), or drop the one in use (null). */
  applyTemplate: (id: string | null) => void
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
  // a shape the person picked stays until they start over with no video at all
  useStart.setState({ aspectFrom: first, ...(first ? {} : { aspectPicked: false }) })
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
  idea: '',
  step: null,
  style: {},

  begin: (prompt) => {
    const { files, style, aspectPicked } = get()
    const kind = kindOf(files)
    const text = prompt.trim()
    const background = useChat.getState().chips.some((c) => c.kind === 'background')
    // a video with nothing asked just opens: there is nothing to style yet
    if (kind === 'video' && !text && !background && !style.template) return 'create'
    if (kind === 'scratch' && !text && (style.template || !background)) {
      set({
        error: style.template
          ? 'Say what your video is about, and Luca builds it with the template.'
          : 'Describe the video you want, or add a video, audio, images or a background.'
      })
      return 'invalid'
    }
    const secs = kind === 'images' || kind === 'scratch' ? durationFrom(text) : null
    const shape = aspectPicked || files.some((f) => f.kind === 'video') ? null : aspectFrom(text)
    set({
      idea: text,
      step: 0,
      error: null,
      ...(secs ? { duration: secs } : {}),
      ...(shape ? { aspect: shape } : {})
    })
    return 'steps'
  },
  setStep: (step) => set({ step, error: null }),
  pick: (field, value) =>
    set((s) => {
      const style = { ...s.style }
      if (value === undefined) delete style[field]
      else style[field] = value
      return { style }
    }),
  applyTemplate: (id) => {
    const { style, files, duration } = get()
    const prev = TEMPLATES.find((t) => t.id === style.template)
    // what the last template chose goes with it; the person's own picks stay
    const base: StartStyle = { ...style }
    delete base.template
    if (prev)
      for (const k of Object.keys(prev.style) as (keyof Template['style'])[])
        if (base[k] === prev.style[k]) delete base[k]
    const t = TEMPLATES.find((x) => x.id === id)
    if (!t) {
      set({ style: base, ...(prev && duration === prev.duration ? { duration: null } : {}) })
      return
    }
    set({
      style: { ...base, ...t.style, template: t.id },
      duration: t.duration,
      // footage keeps its own shape
      ...(files.some((f) => f.kind === 'video') ? {} : { aspect: t.aspect }),
      error: null
    })
  },

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
  reset: () =>
    set({
      files: [],
      aspectFrom: null,
      aspectPicked: false,
      error: null,
      progress: null,
      seen: [],
      idea: '',
      step: null,
      style: {}
    }),

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
    // the Pexels pick is whatever background chip is there (picked on the steps or the browser)
    const style: StartStyle = { ...get().style }
    if (background) style.background = 'picked'
    else if (style.background === 'picked') delete style.background
    const template = TEMPLATES.find((t) => t.id === style.template)
    if (kind === 'scratch' && !text && (template || !background)) {
      set({
        error: template
          ? 'Say what your video is about, and Luca builds it with the template.'
          : 'Describe the video you want, or add a video, audio, images or a background.'
      })
      return false
    }
    set({ busy: true, error: null, progress: { stage: 'preparing' }, seen: ['preparing'] })
    useProject.setState({ loading: true })
    try {
      const res = await luca.project.start({
        name: nameFrom(text),
        aspect,
        files: files.map((f) => f.path),
        duration: duration ?? undefined,
        ...(Object.keys(style).length ? { style } : {})
      })
      useProject.setState({ project: res.project, version: 0, previewVersion: 0 })
      set({ files: [], previews: {}, aspectFrom: null, idea: '', step: null, style: {} })
      const chat = useChat.getState()
      // a video with nothing asked is a plain new project; everything else starts Luca working
      if (text || kind === 'images' || kind === 'audio' || background || template) {
        if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
        const visible =
          text ||
          (template
            ? `Make this a ${template.name}`
            : kind === 'images'
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
        // the picks go first among the chips, so they show on the request (and come back with
        // the rest if it can't be sent)
        useChat.setState({ chips: [...styleChips(style), ...chat.chips] })
        // the preview shows Luca at work instead of the blank starter until this turn ends
        useMaking.getState().begin(res.project.id, kind, duration)
        const sent = await chat.send(visible, {
          time: 0,
          note: res.brief,
          ...(opts?.spoken ? { voice: true } : {})
        })
        if (!sent) useMaking.getState().cancel()
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
