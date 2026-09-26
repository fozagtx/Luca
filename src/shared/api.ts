import type {
  AgentEvent,
  Aspect,
  CaptionConfig,
  CaptionState,
  CreateProgress,
  ElementTransform,
  ProjectFont,
  StartArgs,
  StartResult,
  CatalogItem,
  ChatMessage,
  Checkpoint,
  Chip,
  CleanResult,
  CleanStatus,
  Edl,
  EnvStatus,
  ExportOptions,
  ExportProgress,
  Look,
  PermissionDecision,
  Project,
  ProjectChanged,
  RecentProject,
  RemocnItem,
  Settings,
  Timeline,
  TimelineEdit,
  Transcript,
  VoiceEvent
} from './types'

export type Unsubscribe = () => void

export type LucaApi = {
  platform: string
  versions: { electron: string; chrome: string; node: string }
  server: { getBaseUrl: () => Promise<string> }
  env: {
    status: () => Promise<EnvStatus>
    openClaudeLogin: () => Promise<void>
    installClaudeCommand: () => Promise<string>
    checkClaude: () => Promise<{ ok: boolean; loggedIn: boolean; error?: string }>
    setAssemblyAiKey: (key: string) => Promise<boolean>
    hasAssemblyAiKey: () => Promise<boolean>
  }
  settings: {
    get: () => Promise<Settings>
    update: (patch: Partial<Settings>) => Promise<Settings>
    savePanes: (key: string, sizes: number[]) => Promise<void>
  }
  project: {
    create: (args: {
      file: string
      name?: string
      aspect: Aspect
      look?: string | null
    }) => Promise<Project>
    open: (dir: string) => Promise<Project>
    close: () => Promise<void>
    current: () => Promise<Project | null>
    recent: () => Promise<RecentProject[]>
    /** New project from a video, an audio file, images, or nothing (start from scratch). */
    start: (args: StartArgs) => Promise<StartResult>
    pickVideo: () => Promise<string | null>
    /** Videos, audio or images (several at once) to start a project from. */
    pickMedia: () => Promise<string[]>
    /** Small data-URL preview of a local image or video file. */
    mediaPreview: (path: string) => Promise<string | null>
    pickProjectDir: () => Promise<string | null>
    /** Remove from Recent; the folder stays on disk. */
    forget: (dir: string) => Promise<void>
    /** Move the project folder to the Trash and remove it from Recent. */
    trash: (dir: string) => Promise<void>
    files: () => Promise<
      { path: string; size: number; kind: 'html' | 'media' | 'json' | 'other' }[]
    >
    readFile: (rel: string) => Promise<string>
    revealInFinder: (rel?: string) => Promise<void>
    onChanged: (cb: (e: ProjectChanged) => void) => Unsubscribe
    onOpened: (cb: (p: Project | null) => void) => Unsubscribe
    onRecentChanged: (cb: () => void) => Unsubscribe
    onDropFile: (cb: (path: string) => void) => Unsubscribe
    onCreateProgress: (cb: (p: CreateProgress) => void) => Unsubscribe
    pathForFile: (file: File) => string
  }
  timeline: {
    get: () => Promise<Timeline>
    edit: (edit: TimelineEdit) => Promise<{ ok: boolean; error?: string }>
    thumbs: () => Promise<{ dir: string; count: number; interval: number }>
    peaks: () => Promise<{ peaksPerSecond: number; peaks: number[] }>
    transform: (t: ElementTransform) => Promise<{ ok: boolean; error?: string }>
  }
  agent: {
    send: (args: { text: string; chips: Chip[]; context: unknown }) => Promise<void>
    interrupt: () => Promise<void>
    permission: (args: { id: string; decision: PermissionDecision }) => Promise<void>
    history: () => Promise<ChatMessage[]>
    state: () => Promise<{ state: string; detail?: string }>
    restart: () => Promise<void>
    onEvent: (cb: (e: AgentEvent) => void) => Unsubscribe
    /** A message that was added or changed (new tool step, permission, end of turn). */
    onMessage: (cb: (m: ChatMessage) => void) => Unsubscribe
  }
  catalog: {
    list: (args?: { refresh?: boolean }) => Promise<CatalogItem[]>
    add: (name: string) => Promise<{ ok: boolean; snippet?: string; error?: string }>
    remocn: (args?: { refresh?: boolean }) => Promise<RemocnItem[]>
    remocnPreview: (name: string) => Promise<string | null>
    remocnStudioStatus: () => Promise<{ ready: boolean; step?: string; error?: string }>
    remocnSetup: () => Promise<{ ok: boolean; error?: string }>
  }
  clean: {
    run: () => Promise<void>
    applyEdl: (edl: Edl) => Promise<CleanResult>
    status: () => Promise<CleanStatus>
    transcript: () => Promise<Transcript | null>
    edl: () => Promise<Edl | null>
    /** Transcribe only (for captions), without proposing cuts. */
    transcribe: () => Promise<void>
    onStatus: (cb: (s: CleanStatus) => void) => Unsubscribe
  }
  captions: {
    state: () => Promise<CaptionState>
    /** The words captions are built from (cleaned transcript, composition times). */
    words: () => Promise<{ text: string; start: number; end: number }[]>
    apply: (config: CaptionConfig) => Promise<{ lines: number }>
    remove: () => Promise<void>
    /** Pick font files (.ttf/.otf/.woff/.woff2) and add them to the project. */
    addFonts: () => Promise<ProjectFont[]>
  }
  looks: {
    list: () => Promise<(Look & { thumb: string | null })[]>
    save: (name: string) => Promise<Look>
    update: (slug: string) => Promise<Look>
    apply: (slug: string) => Promise<void>
    remove: (slug: string) => Promise<void>
    active: () => Promise<string | null>
  }
  history: {
    list: () => Promise<Checkpoint[]>
    restore: (sha: string) => Promise<void>
    undo: () => Promise<void>
    onChanged: (cb: () => void) => Unsubscribe
  }
  export: {
    start: (opts: ExportOptions) => Promise<void>
    cancel: () => Promise<void>
    onProgress: (cb: (p: ExportProgress) => void) => Unsubscribe
    reveal: (path: string) => Promise<void>
    freeMemoryMB: () => Promise<number>
  }
  capture: {
    frame: (rect: { x: number; y: number; width: number; height: number }) => Promise<string>
  }
  voice: {
    /** macOS microphone permission (prompts the first time). */
    micAccess: () => Promise<boolean>
    /** Opens a streaming session; resolves once AssemblyAI has accepted it. */
    start: (args: { sid: number; sampleRate: number }) => Promise<void>
    /** 16-bit mono PCM at the session's sample rate, ~50 ms per chunk. */
    audio: (sid: number, pcm: ArrayBuffer) => void
    /** Ends the session after the last turn is final; resolves with the whole transcript. */
    stop: (sid: number) => Promise<string>
    cancel: (sid: number) => Promise<void>
    onEvent: (cb: (e: VoiceEvent) => void) => Unsubscribe
  }
  menu: {
    onCommand: (cb: (cmd: string, arg?: unknown) => void) => Unsubscribe
    popupClip: (args: {
      clipId: string
      track: number
      start: number
      end: number
    }) => Promise<void>
    popupLook: (slug: string) => Promise<void>
  }
  window: {
    onActive: (cb: (active: boolean) => void) => Unsubscribe
    onFullscreen: (cb: (fullscreen: boolean) => void) => Unsubscribe
  }
}
