import { estimateSpoken, languageFor, type Say, type VoiceRef } from '@shared/ai33'
import { editRequest, editStep, videoType } from '@shared/edits'
import type {
  Aspect,
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
import { useAi33 } from './ai33'
import { useChat } from './chat'
import { MAKING_MUSIC_EXTRA_SECONDS, useMaking } from './making'
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

/** The script panel has nothing to record yet. */
export const NO_SCRIPT = 'Paste your script first.'
/** A script is recorded with ai33, so it can't start without a key. */
export const NO_AI33_KEY = 'Connect ai33 first: paste your key at the top of the card.'
/**
 * Cancel was pressed while the voiceover was being recorded. Not a failure: the card shows it as a
 * quiet note, not a red box.
 */
export const STOPPED = 'Stopped. Your script is still here.'
/**
 * Whether a start ended because it was stopped, not because it failed. Cancel gives STOPPED; Stop on
 * the cost question gives main's own words ("Stopped before the whole voiceover was recorded…"),
 * which begin the same way.
 */
export const isStopped = (message: string | null): boolean =>
  message !== null && /^Stopped\b/.test(message)
/** Shown in place of a refusal that was written for the model rather than the person. */
export const COULDNT_RECORD = 'Couldn’t record the voiceover. Your script is still here.'
/** Sentences main writes for Luca to relay ("Tell the user…"); they are never shown as they are. */
const MODEL_FACING = /Tell the user|Do not make it another way|Say so in one short sentence/i

/** What a failed start says to the person: main's own words, unless they were meant for Luca. */
export function startErrorText(err: unknown): string {
  const message = errorMessage(err)
  return MODEL_FACING.test(message) ? COULDNT_RECORD : message
}

/** What the script panel holds. It stays through a failed or cancelled start. */
export type ScriptDraft = {
  text: string
  /** A `LANGUAGES` id. */
  language: string
  /** Null: nothing picked yet, or voices can't be listed, so Luca picks one. */
  voice: VoiceRef | null
  /** Rows as typed; rows missing a word or how it sounds are left out when the script is sent. */
  say: Say[]
}

/** The most rows in "Say it right". */
export const MAX_SAY = 30

/** The Mac's own language when a script can be in it, else English. */
function defaultLanguage(): string {
  try {
    return languageFor(navigator.language)?.id ?? 'en'
  } catch {
    return 'en'
  }
}

function emptyScript(language = defaultLanguage()): ScriptDraft {
  return { text: '', language, voice: null, say: [] }
}

/**
 * The project's name from a script's first six words: title-cased, punctuation trimmed off the
 * ends, at most 40 characters (cut at a word).
 */
export function scriptName(text: string): string {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1))
  let name = words.join(' ')
  if (name.length > 40) {
    const cut = name.slice(0, 40)
    const space = cut.lastIndexOf(' ')
    name = (space > 10 ? cut.slice(0, space) : cut).trim()
  }
  return name || 'Script video'
}

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

/**
 * A step switched on, in the place its guide gives it: music is made after the cuts and titles and
 * before the captions (and the final review), so it fits the finished length; the rest go last.
 */
function withStep(steps: EditStepId[], id: EditStepId): EditStepId[] {
  const at = id === 'music' ? steps.findIndex((x) => x === 'captions' || x === 'critique') : -1
  return at < 0 ? [...steps, id] : [...steps.slice(0, at), id, ...steps.slice(at)]
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
  /** What kind of video it is, how Luca builds it, what Luca does to it and the brief. */
  edit: StartEdit
  /** The person picked the type; until then it follows the files (a voiceover alone: concept). */
  typePicked: boolean
  /** The start card asks for a script to record instead of footage. */
  scriptMode: boolean
  /** The script, its language and voice, kept while the card is busy and after it fails. */
  script: ScriptDraft
  /** Cancel was pressed and main hasn't stopped yet. */
  cancelling: boolean
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
  setAspect: (a: Aspect) => void
  /** Show the script panel (on) or the drop zone (off) on the start card. */
  setScriptMode: (on: boolean) => void
  setScript: (patch: Partial<ScriptDraft>) => void
  /** Stop recording the script: the start call then rejects and the panel comes back as it was. */
  cancelStart: () => Promise<void>
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
   * Create the project from the footage or voiceover (images come along), or from the script in
   * the panel, open it and send Luca the first request: the edit picked on the card and the
   * notes. Luca starts right away.
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
  const { files, aspectFrom, typePicked, edit, scriptMode } = useStart.getState()
  const first = files.find((f) => f.kind === 'video')?.path ?? null
  // a shape the person picked stays until they start over with no video at all
  if (first !== aspectFrom)
    useStart.setState({ aspectFrom: first, ...(first ? {} : { aspectPicked: false }) })
  followFirstVideo()
  const type = scriptMode ? 'concept' : defaultType(kindOf(files))
  if (!typePicked && edit.type !== type)
    useStart.setState({ edit: editOf(type, edit.style, edit.notes) })
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
  edit: editOf('launch', 'motion'),
  typePicked: false,
  scriptMode: false,
  script: emptyScript(),
  cancelling: false,
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
    // footage dropped on the script panel means they'd rather start from that (the script stays,
    // and the footage form says so); pictures alone come along with the script
    set({ files: next, error: null, ...(kindOf(next) !== 'brief' ? { scriptMode: false } : {}) })
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
  setScriptMode: (scriptMode) => {
    // a script is a concept explainer until they pick another kind; without one, back to the files'
    if (!get().typePicked) {
      const type = scriptMode ? 'concept' : defaultType(kindOf(get().files))
      if (get().edit.type !== type) set({ edit: editOf(type, get().edit.style, get().edit.notes) })
    }
    set({ scriptMode, error: null })
  },
  setScript: (patch) => set((s) => ({ script: { ...s.script, ...patch } })),
  cancelStart: async () => {
    if (!get().busy || get().cancelling) return
    set({ cancelling: true })
    try {
      await luca.project.cancelStart()
    } catch {
      // main may have finished already; the start call says how it ended
    }
  },
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
          steps: on ? s.edit.steps.filter((x) => x !== id) : withStep(s.edit.steps, id)
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
    const { files, aspect, edit, footage, reference, scriptMode, script } = get()
    // a script is recorded as the voiceover, so it starts like one
    const scriptText = script.text.trim()
    const notes = edit.notes?.trim()
    const kind: StartKind | null = scriptMode ? (scriptText ? 'audio' : null) : kindOf(files)
    if (!kind) {
      set({ error: scriptMode ? NO_SCRIPT : files.length ? IMAGES_ONLY : NO_FOOTAGE })
      return false
    }
    if (kind === 'brief' && (notes?.length ?? 0) < 12) {
      set({ error: NO_BRIEF })
      return false
    }
    // a script is recorded with ai33: without a key nothing starts (the panel asks for it)
    if (scriptMode && useAi33.getState().hasKey === false) {
      set({ error: NO_AI33_KEY })
      return false
    }
    const voiceOnly = kind !== 'video'
    const videos = files.filter((f) => f.kind === 'video')
    const lead = scriptMode ? null : (videos[0] ?? files.find((f) => f.kind === 'audio'))
    // what the card showed: a voiceover or brief has no picture to zoom into or name, and a
    // script has its words already, so there are no ums to cut
    const picked: StartEdit = {
      type: edit.type,
      style: edit.style,
      steps: edit.steps.filter(
        (id) => !(voiceOnly && editStep(id).needsPicture) && !(scriptMode && id === 'cut')
      ),
      ...(notes ? { notes } : {}),
      ...(reference ? { reference } : {})
    }
    // all the footage's length once every video is read; a voiceover's comes from the timeline,
    // and a script's is about as long as it takes to read aloud
    const length = scriptMode
      ? estimateSpoken(scriptText).seconds
      : kind === 'video' && videos.every((v) => footage[v.path])
        ? videos.reduce((sum, v) => sum + footage[v.path].duration, 0)
        : null
    set({
      busy: true,
      cancelling: false,
      error: null,
      progress: { stage: scriptMode ? 'voiceover' : 'preparing' },
      seen: [scriptMode ? 'voiceover' : 'preparing']
    })
    useProject.setState({ loading: true })
    try {
      // the card doesn't know yet whether there is a key: main does
      if (
        scriptMode &&
        !(useAi33.getState().hasKey === true || (await useAi33.getState().checkKey()))
      ) {
        set({ error: NO_AI33_KEY })
        return false
      }
      const say = script.say.filter((r) => r.word.trim() && r.as.trim())
      const res = await luca.project.start(
        scriptMode
          ? {
              name: scriptName(scriptText),
              aspect,
              // the recording is the voiceover; pictures dropped on the card come along
              files: files.filter((f) => f.kind === 'image').map((f) => f.path),
              script: {
                text: scriptText,
                voice: script.voice,
                language: languageFor(script.language)?.name ?? 'English',
                ...(say.length ? { say } : {})
              },
              edit: picked
            }
          : {
              ...(lead ? { name: lead.name.replace(/\.[^.]+$/, '') } : {}),
              aspect,
              files: files.map((f) => f.path),
              edit: picked
            }
      )
      useProject.setState({ project: res.project, version: 0, previewVersion: 0 })
      set({
        files: [],
        previews: {},
        aspectFrom: null,
        aspectPicked: false,
        edit: editOf('launch', 'motion'),
        typePicked: false,
        reference: null,
        // the script is in the project now; the language and voice are likely the next one's too
        scriptMode: false,
        script: { ...get().script, text: '', say: [] }
      })
      if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
      const chat = useChat.getState()
      // the type goes first among the chips, so it shows on the request (and comes back with the
      // rest if it can't be sent)
      useChat.setState({
        chips: [{ kind: 'edit', label: videoType(picked.type).name }, ...chat.chips]
      })
      // the preview shows Luca at work instead of the unedited video until this turn ends
      useMaking.getState().begin(res.project.id, scriptMode ? 'script' : kind, length, {
        extraSeconds: picked.steps.includes('music') ? MAKING_MUSIC_EXTRA_SECONDS : 0
      })
      const request = editRequest(picked, {
        voiceOnly,
        brief: kind === 'brief',
        ...(scriptMode ? { scripted: true } : {})
      })
      const sent = await chat.send(notes ? `${request}\n\n${notes}` : request, {
        time: 0,
        note: res.brief,
        ...(opts?.spoken ? { voice: true } : {})
      })
      if (!sent) useMaking.getState().cancel()
      return true
    } catch (err) {
      // Cancel was pressed: whatever main rejected with, that is why it stopped
      set({ error: get().cancelling ? STOPPED : startErrorText(err) })
      return false
    } finally {
      useProject.setState({ loading: false })
      set({ busy: false, cancelling: false })
    }
  }
}))
