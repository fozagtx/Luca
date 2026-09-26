import type { Activity } from './activity'

export type Aspect = 'landscape' | 'portrait' | 'square'

export type Project = {
  id: string
  name: string
  dir: string
  aspect: Aspect
  source: string
  createdAt: string
  lastOpenedAt: string
  look?: string | null
}

export type RecentProject = {
  id: string
  name: string
  dir: string
  aspect: Aspect
  lastOpenedAt: string
  duration?: number | null
  thumb?: string | null
}

export type ClipKind = 'video' | 'audio' | 'block' | 'component' | 'caption'

export type Clip = {
  id: string
  track: number
  kind: ClipKind
  start: number
  end: number
  file: string
  label: string
  src?: string | null
  ref: string
  remocn?: boolean
  /** data-volume of audio/video clips (1 = unchanged, 0 = muted). */
  volume?: number
}

export type Track = {
  index: number
  kind: ClipKind
  label: string
  clips: Clip[]
}

export type Timeline = {
  duration: number
  fps: number
  width: number
  height: number
  tracks: Track[]
}

export type Chip =
  | {
      kind: 'element'
      selector: string
      file: string
      compositionId: string
      time: number
      html: string
    }
  | { kind: 'frame'; time: number; png: string }
  | {
      kind: 'catalog'
      name: string
      type: 'block' | 'component'
      title: string
      source?: 'hyperframes' | 'remocn'
    }
  | { kind: 'clip'; clipId: string; track: number; start: number; end: number }
  | { kind: 'transcript'; text: string; start: number; end: number }

export type AgentEvent =
  /** Streamed reply text for the assistant message `id`. */
  | { type: 'text-delta'; id: string; text: string }
  | {
      type: 'tool'
      id: string
      name: string
      summary: string
      status: ToolStatus
      detail?: string
      activity?: Activity
    }
  | { type: 'permission'; id: string; tool: string; input: unknown; rule?: string }
  | { type: 'permission-resolved'; id: string }
  | { type: 'turn-start' }
  | {
      type: 'turn-end'
      sessionId: string
      durationMs: number
      /** True for failures and for turns the person stopped (whoever waits must not carry on). */
      isError: boolean
      stopped?: boolean
      error?: string
    }
  | { type: 'status'; state: AgentState; detail?: string }

/** `stopped`: the person pressed Stop while the step ran. */
export type ToolStatus = 'running' | 'done' | 'error' | 'stopped'

export type AgentState =
  'idle' | 'starting' | 'ready' | 'working' | 'needs-login' | 'missing-claude' | 'error'

export type PermissionDecision = 'allow' | 'allow-always' | 'deny'

export type ChatContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool'
      id: string
      name: string
      summary: string
      status: ToolStatus
      detail?: string
      /** Plain-language description (older history may not have it). */
      activity?: Activity
    }
  | {
      type: 'permission'
      id: string
      tool: string
      input: unknown
      resolved?: PermissionDecision
      /** The turn ended (Stop, restart, a crash) before the person answered: not their "deny". */
      cancelled?: boolean
      /** The rule "Always allow" saves, e.g. `Bash(ls)` or `WebFetch`. */
      rule?: string
    }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  createdAt: string
  text: string
  chips?: Chip[]
  parts?: ChatContentPart[]
  pending?: boolean
  isError?: boolean
  /** How long the assistant turn took, set when it ends. */
  durationMs?: number
  /** For an assistant message: the id of the user message it answers. */
  replyTo?: string
  /** The person pressed Stop during this reply. */
  stopped?: boolean
  /** For a user message: the hidden context it was sent with (playhead, notes), for Try again. */
  context?: unknown
}

export type CutReason = 'filler' | 'pause' | 'retake' | 'false_start' | 'manual'
export type Cut = { start: number; end: number; reason: CutReason; text: string }
export type Edl = { version: 1; source: string; cuts: Cut[] }

export type Word = { id: string; text: string; start: number; end: number; filler?: boolean }
export type Transcript = { words: Word[] }

export type Look = {
  name: string
  slug: string
  createdAt: string
  sourceProject: string
  aspect: Aspect
  keyterms: string[]
  catalogItems: string[]
}

export type CatalogItem = {
  name: string
  type: 'block' | 'component'
  title: string
  description: string
  tags: string[]
  duration?: number
  dimensions?: { width: number; height: number }
  preview?: { video?: string; poster?: string }
}

export type RemocnItem = {
  name: string
  category: string
  useFor: string
  avoidFor: string
  naturalLength: string
  docs: string
  title?: string
  description?: string
  vibe?: string
}

export type Checkpoint = {
  sha: string
  shortSha: string
  message: string
  date: string
  files: number
  isHead: boolean
}

export type ExportOptions = {
  name: string
  quality: 'draft' | 'looks'
  format: 'mp4'
}

export type ExportProgress = {
  progress: number
  stage: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  outputPath?: string
  error?: string
}

export type EnvStatus = {
  node: { ok: boolean; version: string }
  claude: { ok: boolean; path: string | null; loggedIn: boolean | null }
  ffmpeg: { ok: boolean; path: string | null }
  git: { ok: boolean; path: string | null }
  assemblyaiKey: boolean
  chrome: string
}

export type Theme = 'light' | 'dark'

export type Settings = {
  projectsDir: string
  theme: Theme
  renderWorkers: number
  defaultAspect: Aspect
  keyterms: string[]
  recentProjects: RecentProject[]
  window?: { x?: number; y?: number; width: number; height: number }
  panes?: Record<string, number[]>
  alwaysAllow?: Record<string, string[]>
}

export type TimelineEdit =
  | { op: 'move'; ref: string; time: number }
  | { op: 'trim'; ref: string; start?: number; end?: number }
  | { op: 'split'; ref: string; time: number }
  /** `with`: linked clips removed in the same checkpoint (a video's own audio). */
  | { op: 'delete'; ref: string; with?: string[] }
  /** Mute (0) or restore the clips' `data-volume`; the level before muting is kept. */
  | { op: 'mute'; refs: string[]; muted: boolean }

/**
 * Move/resize an element on the canvas. Written as the CSS `translate`, `scale` and
 * `transform-origin` properties, which compose with (and never fight) GSAP's `transform`.
 */
export type ElementTransform = {
  /** Composition file holding the element, e.g. index.html or compositions/x.html. */
  file: string
  id: string
  /** Composition pixels. */
  translate: [number, number]
  scale: number
  /** Composition pixels relative to the element's own box. */
  origin?: [number, number]
}

export type ProjectChanged = {
  paths: string[]
  version: number
  /** False when only files the preview never loads changed (Luca's state, the cut list…). */
  composition: boolean
}

export type CleanStatus = {
  /** `transcribe` stops after the transcript (for captions); `clean` goes on to cut. */
  task?: 'clean' | 'transcribe'
  stage:
    | 'idle'
    | 'extracting'
    | 'uploading'
    | 'transcribing'
    | 'candidates'
    | 'reviewing'
    | 'applying'
    | 'relinking'
    | 'done'
    | 'error'
  message?: string
  /** Progress of the current stage, 0..1, when it can be measured. */
  progress?: number
  /** True when `progress` is an estimate (AssemblyAI does not report transcription progress). */
  estimated?: boolean
  /** When the current stage started (ms since epoch), for elapsed-time readouts. */
  since?: number
}

export type CleanResult = { cuts: number; cleanFile: string }

/**
 * Real-time speech-to-text events (AssemblyAI Universal-Streaming), tagged with the session id
 * the renderer chose. Each turn sends `partial` updates, then exactly one `final`.
 */
export type VoiceEvent =
  | { type: 'partial'; sid: number; order: number; text: string }
  | { type: 'final'; sid: number; order: number; text: string; language?: string }
  | { type: 'closed'; sid: number; reason?: string }

/** Stages of making a new project, pushed while it is created. */
export type CreateProgress = {
  stage: 'preparing' | 'copying' | 'scaffolding' | 'media' | 'starting' | 'done' | 'error'
  message?: string
  /** 0..1 within the stage when measurable. */
  progress?: number
}

/** What a new project starts from: a video, an audio track, images, or nothing but an idea. */
export type StartKind = 'video' | 'audio' | 'images' | 'scratch'

export type StartArgs = {
  name?: string
  aspect: Aspect
  /** Absolute paths: one video, one audio file, or any number of images. */
  files: string[]
  look?: string | null
  /** Target length in seconds for image and scratch projects. */
  duration?: number
}

export type StartResult = {
  project: Project
  kind: StartKind
  /** Hidden context for Luca's first turn: what the project starts from and what is in it. */
  brief: string
}

/** One line of captions, with the words it shows. Times are composition seconds. */
export type CaptionGroup = {
  text: string
  start: number
  end: number
  words: { text: string; start: number; end: number }[]
}

export type CaptionConfig = {
  style: string
  /** Font family; a built-in HyperFrames font or one added to the project. */
  font: string
  size: 'sm' | 'md' | 'lg'
  position: 'bottom' | 'middle' | 'top'
  wordsPerLine: 'short' | 'normal' | 'long'
  uppercase: boolean
  /** Active-word / highlight color override. */
  accent?: string
  /** Drop "um", "uh", stutters and false starts. */
  clean: boolean
}

export type ProjectFont = {
  family: string
  /** Project-relative file for fonts added by the user; absent for built-in fonts. */
  file?: string
}

export type CaptionState = {
  /** Words available to caption (after a transcription or clean edit). */
  words: number
  /** The config last put on the timeline, if captions are on it. */
  applied: CaptionConfig | null
  fonts: ProjectFont[]
  /** The project has audio worth transcribing. */
  hasAudio: boolean
}
