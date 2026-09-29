import type {
  Ai33Ask,
  Ai33Estimate,
  Ai33EstimateReq,
  Ai33Notice,
  Ai33Preview,
  Ai33SetKeyResult,
  Ai33Status,
  Ai33VoicePage,
  Ai33VoiceQuery
} from './ai33'
import type {
  AgentEvent,
  BrollResults,
  BrollSearch,
  CaptionConfig,
  CaptionState,
  ColorState,
  CreateProgress,
  ElementTransform,
  ProjectFont,
  StartArgs,
  StartResult,
  ChatMessage,
  Checkpoint,
  Chip,
  CleanResult,
  CleanStatus,
  Edl,
  EnvStatus,
  ExportOptions,
  ExportProgress,
  FootageInfo,
  Look,
  MediaInput,
  PermissionDecision,
  Project,
  ProjectChanged,
  RecentProject,
  Settings,
  Timeline,
  TimelineEdit,
  Transcript,
  UpdateStatus,
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
    open: (dir: string) => Promise<Project>
    close: () => Promise<void>
    current: () => Promise<Project | null>
    recent: () => Promise<RecentProject[]>
    /** New project from the person's footage or a voiceover (images next to them wait in media/). */
    start: (args: StartArgs) => Promise<StartResult>
    /** Stop starting a project (a script being recorded); the start call then rejects. */
    cancelStart: () => Promise<void>
    /** Videos, audio or images (several at once) to start a project from. */
    pickMedia: () => Promise<string[]>
    /** Small data-URL preview of a local image or video file. */
    mediaPreview: (path: string) => Promise<string | null>
    /** A video's shape and length (null when it can't be read), to pick the project's aspect. */
    probeVideo: (path: string) => Promise<FootageInfo | null>
    /**
     * Copy a video, audio file or image into the open project's media/ folder for the chat
     * (videos made ready to play), as a chip for the message.
     */
    addMedia: (file: MediaInput) => Promise<Extract<Chip, { kind: 'media' }>>
    /** Progress (0..1) of a video addMedia is getting ready. */
    onMediaProgress: (cb: (p: { name: string; progress: number }) => void) => Unsubscribe
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
    /** Frames and peaks of one clip's media file (project-relative), or of the project's source. */
    thumbs: (src?: string) => Promise<{ dir: string; count: number; interval: number }>
    peaks: (src?: string) => Promise<{ peaksPerSecond: number; peaks: number[] }>
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
  /** Free stock photos and videos from Pexels, for B-roll. */
  broll: {
    hasKey: () => Promise<boolean>
    /** Checks the key with Pexels and saves it (empty removes it); rejects when Pexels refuses it. */
    setKey: (key: string) => Promise<boolean>
    search: (args: BrollSearch) => Promise<BrollResults>
  }
  /**
   * Voiceover, music and sound effects from ai33, on the person's own key. The key
   * never reaches the renderer: it only learns whether there is one and what it can spend.
   */
  ai33: {
    hasKey: () => Promise<boolean>
    /** Credits, health of the voice services, running jobs; reads ai33 (cached briefly). */
    status: () => Promise<Ai33Status>
    /** Checks the key with ai33 and saves it (empty removes it); rejects when ai33 refuses it. */
    setKey: (key: string) => Promise<Ai33SetKeyResult>
    /** Voices to choose from (cached for ten minutes). */
    voices: (q: Ai33VoiceQuery) => Promise<Ai33VoicePage>
    /** A voice's sample as bytes: the renderer plays it from a blob: URL. */
    voicePreview: (voiceId: string) => Promise<Ai33Preview>
    /** What a job is expected to cost (a guess, marked as one). */
    estimate: (req: Ai33EstimateReq) => Promise<Ai33Estimate>
    /** Answer a question main pushed with onAsk (the start card's cost confirm). */
    askReply: (id: string, decision: 'allow' | 'deny') => Promise<void>
    /** The open project's words are exact (recorded from a script): nothing to transcribe or clean. */
    isScriptProject: () => Promise<boolean>
    /** Main asks a question before a chat exists (a cost card on the start card). */
    onAsk: (cb: (a: { id: string; ask: Ai33Ask }) => void) => Unsubscribe
    /** The question was answered elsewhere, timed out or was cancelled: take the card down. */
    onAskClosed: (cb: (id: string) => void) => Unsubscribe
    /** Something finished while you were elsewhere (a job that outlived its wait). */
    onNotice: (cb: (n: Ai33Notice) => void) => Unsubscribe
  }
  /** Luca updating itself from its GitHub releases. */
  updates: {
    status: () => Promise<UpdateStatus>
    /** Ask GitHub now (a newer Luca starts downloading at once). */
    check: () => Promise<UpdateStatus>
    /** Quit and open the downloaded Luca; rejects while an export or Luca's work is running. */
    install: () => Promise<void>
    /** Checks the token with GitHub and saves it (empty removes it); rejects when GitHub refuses it. */
    setToken: (token: string) => Promise<UpdateStatus>
    /** Move Luca to Applications (it opens again from there). */
    moveToApplications: () => Promise<boolean>
    onStatus: (cb: (s: UpdateStatus) => void) => Unsubscribe
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
    /** Download a Google Fonts family (a fonts.google.com link, a stylesheet link or a name) into the project. */
    addGoogleFont: (input: string) => Promise<{ families: string[]; fonts: ProjectFont[] }>
  }
  color: {
    state: () => Promise<ColorState>
    apply: (grade: { lut: string; intensity: number }, checkpoint?: boolean) => Promise<ColorState>
    remove: () => Promise<ColorState>
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
    /** The captured area as a base64 PNG (no data: prefix). */
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
