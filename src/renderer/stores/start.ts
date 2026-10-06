import { resolveAspect, type AspectChoice } from '@shared/aspect'
import { editRequest, editStep, videoType } from '@shared/edits'
import type {
  CreateProgress,
  EditStepId,
  FootageInfo,
  StartEdit,
  StartKind,
  StyleId,
  VideoTypeId
} from '@shared/types'
import { create } from 'zustand'
import { goHome } from '../features/command/go-home'
import { luca } from '../lib/luca'
import { useChat } from './chat'
import { useMaking } from './making'
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

/** What the files start: footage, a voiceover, or only the brief (no files, or images alone). */
export function kindOf(files: Attachment[]): StartKind {
  if (files.some((f) => f.kind === 'video')) return 'video'
  if (files.some((f) => f.kind === 'audio')) return 'audio'
  return 'brief'
}

/** Nothing to describe a video with yet. */
export const NO_FOOTAGE = 'Add your video first: drop it on the start card.'
/** Images come along with a video or a voiceover, but can't start one. */
export const IMAGES_ONLY =
  'Add a video or a voiceover too; images come along as extras, like a logo or screenshots.'
/** A brief start needs the words. */
export const NO_BRIEF = 'Tell Luca what the video is about first.'

/** The type picked for them until they choose: footage talks, a voiceover explains, words launch. */
export function defaultType(kind: StartKind): VideoTypeId {
  return kind === 'video' ? 'talking' : kind === 'audio' ? 'concept' : 'launch'
}

/** A video type and style with the steps they suggest, keeping the notes. */
function editOf(type: VideoTypeId, style: StyleId, notes?: string): StartEdit {
  return {
    type,
    style,
    steps: [...videoType(type).steps[style]],
    ...(notes ? { notes } : {})
  }
}

type StartStore = {
  /** In the order they were added: videos play back to back in this order. */
  files: Attachment[]
  previews: Record<string, string | null>
  /** Each video's shape and length, as it is read (kept, so a file added again is known). */
  footage: Record<string, FootageInfo>
  /** 'auto' resolves to the first video's best-fit ratio (16:9 with no video). */
  aspect: AspectChoice
  /** The video the auto aspect is read from (the first one). */
  aspectFrom: string | null
  /** What kind of video it is, how Luca builds it, what Luca does to it and the brief. */
  edit: StartEdit
  /** The person picked the type; until then it follows the files (a voiceover alone: concept). */
  typePicked: boolean
  /** A reference video Luca studies and builds the same way; it never goes on the timeline. */
  reference: string | null
  busy: boolean
  progress: CreateProgress | null
  /** Stages seen during the current create, for the step list. */
  seen: CreateProgress['stage'][]
  error: string | null
  addFiles: (paths: string[]) => void
  removeFile: (path: string) => void
  pickFiles: () => Promise<void>
  /**
   * Files opened from outside the start card (⌘N, a video dropped on the Dock icon): Home, with
   * them on the card. The open project closes first (asking if Luca is mid-reply).
   */
  startFrom: (paths: string[]) => Promise<void>
  setAspect: (a: AspectChoice) => void
  /** Switching type turns on its own steps for the picked style. */
  setType: (type: VideoTypeId) => void
  /** Switching style turns on the type's steps for that style. */
  setStyle: (style: StyleId) => void
  setReference: (path: string | null) => void
  clearReference: () => void
  toggleStep: (id: EditStepId) => void
  setNotes: (notes: string) => void
  /** Words said or typed in the chat: after the notes already there, on a new paragraph. */
  addNotes: (text: string) => void
  /**
   * Create the project from the footage or voiceover (images come along), open it and send
   * Luca the first request: the edit picked on the card and the notes. Luca starts right away.
   * `spoken`: asked out loud, so Luca's first reply is short enough to read aloud.
   */
  create: (opts?: { spoken?: boolean }) => Promise<boolean>
}

let bound = false
/** Videos being read, so each is read once. */
const reading = new Set<string>()

/** After the files change: read new videos, follow the first one's shape and the type's default. */
function filesChanged(): void {
  const { files, aspectFrom, typePicked, edit } = useStart.getState()
  const first = files.find((f) => f.kind === 'video')?.path ?? null
  // no video left to resolve 'auto' against: back to 'auto' (16:9 until one is picked)
  if (first !== aspectFrom)
    useStart.setState({ aspectFrom: first, ...(first ? {} : { aspect: 'auto' }) })
  const type = defaultType(kindOf(files))
  if (!typePicked && edit.type !== type)
    useStart.setState({ edit: editOf(type, edit.style, edit.notes) })
  for (const f of files) {
    if (f.kind !== 'video' || f.path in useStart.getState().footage || reading.has(f.path)) continue
    reading.add(f.path)
    void luca.project
      .probeVideo(f.path)
      .then((info) => {
        if (info) useStart.setState((s) => ({ footage: { ...s.footage, [f.path]: info } }))
      })
      .catch(() => undefined)
      .finally(() => reading.delete(f.path))
  }
}

export const useStart = create<StartStore>((set, get) => ({
  files: [],
  previews: {},
  footage: {},
  aspect: 'auto',
  aspectFrom: null,
  edit: editOf('launch', 'motion'),
  typePicked: false,
  reference: null,
  busy: false,
  progress: null,
  seen: [],
  error: null,

  addFiles: (paths) => {
    // the project is on its way: these would be left out of it
    if (get().busy) return
    const next = [...get().files]
    for (const p of paths) {
      const a = attachmentOf(p)
      if (!a || next.some((f) => f.path === p)) continue
      // videos and images add up in the order they come; one voiceover at a time
      if (a.kind === 'audio') {
        const at = next.findIndex((f) => f.kind === 'audio')
        if (at >= 0) next.splice(at, 1)
      }
      next.push(a)
    }
    set({ files: next, error: null })
    // the chat's "add your video first" is answered once there is something to edit
    const asked = useChat.getState().error
    if (kindOf(next) && (asked === NO_FOOTAGE || asked === IMAGES_ONLY))
      useChat.setState({ error: null })
    filesChanged()
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
    set((s) => ({ files: s.files.filter((f) => f.path !== path), error: null }))
    filesChanged()
  },
  pickFiles: async () => {
    const paths = await luca.project.pickMedia()
    if (paths.length) get().addFiles(paths)
  },
  startFrom: async (paths) => {
    if (useProject.getState().project) {
      await goHome()
      // they chose to let Luca finish
      if (useProject.getState().project) return
    }
    get().addFiles(paths)
  },
  setAspect: (aspect) => set({ aspect }),
  setType: (type) =>
    set((s) => ({ edit: editOf(type, s.edit.style, s.edit.notes), typePicked: true })),
  setStyle: (style) => set((s) => ({ edit: editOf(s.edit.type, style, s.edit.notes) })),
  setReference: (path) => set({ reference: path }),
  clearReference: () => set({ reference: null }),
  toggleStep: (id) =>
    set((s) => {
      const on = s.edit.steps.includes(id)
      return {
        edit: {
          ...s.edit,
          steps: on ? s.edit.steps.filter((x) => x !== id) : [...s.edit.steps, id]
        }
      }
    }),
  // typing the brief answers "Tell Luca what the video is about first"
  setNotes: (notes) =>
    set((s) => ({ edit: { ...s.edit, notes }, ...(s.error === NO_BRIEF ? { error: null } : {}) })),
  addNotes: (text) => {
    const words = text.trim()
    if (!words) return
    const notes = [get().edit.notes?.trim(), words].filter(Boolean).join('\n\n')
    set((s) => ({ edit: { ...s.edit, notes } }))
  },

  create: async (opts) => {
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
    const { files, aspect, aspectFrom, edit, footage, reference } = get()
    const kind = kindOf(files)
    const notes = edit.notes?.trim()
    if (kind === 'brief' && (notes?.length ?? 0) < 12) {
      set({ error: NO_BRIEF })
      return false
    }
    const voiceOnly = kind !== 'video'
    const videos = files.filter((f) => f.kind === 'video')
    const lead = videos[0] ?? files.find((f) => f.kind === 'audio')
    // what the card showed: a voiceover or brief has no picture to zoom into or name
    const picked: StartEdit = {
      type: edit.type,
      style: edit.style,
      steps: edit.steps.filter((id) => !(voiceOnly && editStep(id).needsPicture)),
      ...(notes ? { notes } : {}),
      ...(reference ? { reference } : {})
    }
    // all the footage's length once every video is read; a voiceover's comes from the timeline
    const length =
      kind === 'video' && videos.every((v) => footage[v.path])
        ? videos.reduce((sum, v) => sum + footage[v.path].duration, 0)
        : null
    set({ busy: true, error: null, progress: { stage: 'preparing' }, seen: ['preparing'] })
    useProject.setState({ loading: true })
    try {
      // 'auto' resolves against the first video's own ratio (16:9 when there is none)
      const chosen = resolveAspect(aspect, aspectFrom ? (footage[aspectFrom] ?? null) : null)
      const res = await luca.project.start({
        ...(lead ? { name: lead.name.replace(/\.[^.]+$/, '') } : {}),
        aspect: chosen,
        files: files.map((f) => f.path),
        edit: picked
      })
      useProject.setState({ project: res.project, version: 0, previewVersion: 0 })
      set({
        files: [],
        previews: {},
        aspect: 'auto',
        aspectFrom: null,
        edit: editOf('launch', 'motion'),
        typePicked: false,
        reference: null
      })
      if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
      const chat = useChat.getState()
      // the type goes first among the chips, so it shows on the request (and comes back with the
      // rest if it can't be sent)
      useChat.setState({
        chips: [{ kind: 'edit', label: videoType(picked.type).name }, ...chat.chips]
      })
      // the preview shows Luca at work instead of the unedited video until this turn ends
      useMaking.getState().begin(res.project.id, kind, length)
      const request = editRequest(picked, { voiceOnly, brief: kind === 'brief' })
      const sent = await chat.send(notes ? `${request}\n\n${notes}` : request, {
        time: 0,
        note: res.brief,
        ...(opts?.spoken ? { voice: true } : {})
      })
      if (!sent) useMaking.getState().cancel()
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
