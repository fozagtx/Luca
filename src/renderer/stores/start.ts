import { editRequest, editStep, videoType } from '@shared/edits'
import type {
  Aspect,
  CreateProgress,
  EditStepId,
  FootageInfo,
  StartEdit,
  StartKind,
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

/** What the files start: footage, a voiceover, or nothing yet (no files, or images alone). */
export function kindOf(files: Attachment[]): StartKind | null {
  if (files.some((f) => f.kind === 'video')) return 'video'
  if (files.some((f) => f.kind === 'audio')) return 'audio'
  return null
}

/** Nothing to edit yet. */
export const NO_FOOTAGE = 'Add your video first: drop it on the start card.'
/** Images come along with a video or a voiceover, but can't start one. */
export const IMAGES_ONLY =
  'Add a video or a voiceover too; images come along as extras, like a logo or screenshots.'

/** A video type with the steps it suggests, keeping the notes. */
function editOf(type: VideoTypeId, notes?: string): StartEdit {
  return { type, steps: [...videoType(type).steps], ...(notes ? { notes } : {}) }
}

type StartStore = {
  /** In the order they were added: videos play back to back in this order. */
  files: Attachment[]
  previews: Record<string, string | null>
  /** Each video's shape and length, as it is read (kept, so a file added again is known). */
  footage: Record<string, FootageInfo>
  aspect: Aspect
  /** The video the aspect was read from (the first one); whether the person then picked one. */
  aspectFrom: string | null
  aspectPicked: boolean
  /** What kind of video it is, what Luca does to it and the person's notes. */
  edit: StartEdit
  /** The person picked the type; until then it follows the files (a voiceover alone: explainer). */
  typePicked: boolean
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
  setAspect: (a: Aspect) => void
  /** Switching type turns on its own steps. */
  setType: (type: VideoTypeId) => void
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

/** The first video decides the project's shape (phone footage: portrait) until the person picks. */
function followFirstVideo(): void {
  const s = useStart.getState()
  const info = s.aspectFrom ? s.footage[s.aspectFrom] : undefined
  if (info && !s.aspectPicked && s.aspect !== info.aspect)
    useStart.setState({ aspect: info.aspect })
}

/** After the files change: read new videos, follow the first one's shape and the type's default. */
function filesChanged(): void {
  const { files, aspectFrom, typePicked, edit } = useStart.getState()
  const first = files.find((f) => f.kind === 'video')?.path ?? null
  // a shape the person picked stays until they start over with no video at all
  if (first !== aspectFrom)
    useStart.setState({ aspectFrom: first, ...(first ? {} : { aspectPicked: false }) })
  followFirstVideo()
  const type = kindOf(files) === 'audio' ? 'explainer' : 'talking'
  if (!typePicked && edit.type !== type) useStart.setState({ edit: editOf(type, edit.notes) })
  for (const f of files) {
    if (f.kind !== 'video' || f.path in useStart.getState().footage || reading.has(f.path)) continue
    reading.add(f.path)
    void luca.project
      .probeVideo(f.path)
      .then((info) => {
        if (info) useStart.setState((s) => ({ footage: { ...s.footage, [f.path]: info } }))
        followFirstVideo()
      })
      .catch(() => undefined)
      .finally(() => reading.delete(f.path))
  }
}

export const useStart = create<StartStore>((set, get) => ({
  files: [],
  previews: {},
  footage: {},
  aspect: 'landscape',
  aspectFrom: null,
  aspectPicked: false,
  edit: editOf('talking'),
  typePicked: false,
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
  setAspect: (aspect) => set({ aspect, aspectPicked: true }),
  setType: (type) => set((s) => ({ edit: editOf(type, s.edit.notes), typePicked: true })),
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
  setNotes: (notes) => set((s) => ({ edit: { ...s.edit, notes } })),
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
    const { files, aspect, edit, footage } = get()
    const kind = kindOf(files)
    if (!kind) {
      set({ error: files.length ? IMAGES_ONLY : NO_FOOTAGE })
      return false
    }
    const voiceOnly = kind === 'audio'
    const videos = files.filter((f) => f.kind === 'video')
    const lead = videos[0] ?? files.find((f) => f.kind === 'audio')!
    const notes = edit.notes?.trim()
    // what the card showed: a voiceover has no picture to zoom into or name
    const picked: StartEdit = {
      type: edit.type,
      steps: edit.steps.filter((id) => !(voiceOnly && editStep(id).needsPicture)),
      ...(notes ? { notes } : {})
    }
    // all the footage's length once every video is read; a voiceover's comes from the timeline
    const length =
      kind === 'video' && videos.every((v) => footage[v.path])
        ? videos.reduce((sum, v) => sum + footage[v.path].duration, 0)
        : null
    set({ busy: true, error: null, progress: { stage: 'preparing' }, seen: ['preparing'] })
    useProject.setState({ loading: true })
    try {
      const res = await luca.project.start({
        name: lead.name.replace(/\.[^.]+$/, ''),
        aspect,
        files: files.map((f) => f.path),
        edit: picked
      })
      useProject.setState({ project: res.project, version: 0, previewVersion: 0 })
      set({
        files: [],
        previews: {},
        aspectFrom: null,
        aspectPicked: false,
        edit: editOf('talking'),
        typePicked: false
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
      const request = editRequest(picked, { voiceOnly })
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
