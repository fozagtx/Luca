import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LucaApi, Unsubscribe } from '../shared/api'
import { Channels } from '../shared/channels'

const C = Channels

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: LucaApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? ''
  },
  server: { getBaseUrl: () => invoke(C.serverBaseUrl) },
  env: {
    status: () => invoke(C.envStatus),
    openClaudeLogin: () => invoke(C.envOpenClaudeLogin),
    installClaudeCommand: () => invoke(C.envInstallClaude),
    checkClaude: () => invoke(C.envCheckClaude),
    setAssemblyAiKey: (key) => invoke(C.envSetAssemblyAiKey, key),
    hasAssemblyAiKey: () => invoke(C.envHasAssemblyAiKey)
  },
  settings: {
    get: () => invoke(C.settingsGet),
    update: (patch) => invoke(C.settingsUpdate, patch),
    savePanes: (key, sizes) => invoke(C.settingsSavePanes, key, sizes)
  },
  project: {
    open: (dir) => invoke(C.projectOpen, dir),
    close: () => invoke(C.projectClose),
    current: () => invoke(C.projectCurrent),
    recent: () => invoke(C.projectRecent),
    start: (args) => invoke(C.projectStart, args),
    cancelStart: () => invoke(C.projectStartCancel),
    pickMedia: () => invoke(C.projectPickMedia),
    mediaPreview: (path) => invoke(C.projectMediaPreview, path),
    probeVideo: (path) => invoke(C.projectProbeVideo, path),
    addMedia: (file) => invoke(C.projectAddMedia, file),
    onMediaProgress: (cb) => on(C.projectMediaProgress, cb),
    pickProjectDir: () => invoke(C.projectPickDir),
    forget: (dir) => invoke(C.projectForget, dir),
    trash: (dir) => invoke(C.projectTrash, dir),
    files: () => invoke(C.projectFiles),
    readFile: (rel) => invoke(C.projectReadFile, rel),
    revealInFinder: (rel) => invoke(C.projectReveal, rel),
    onChanged: (cb) => on(C.projectChanged, cb),
    onOpened: (cb) => on(C.projectOpened, cb),
    onRecentChanged: (cb) => on(C.projectRecentChanged, cb),
    onDropFile: (cb) => on(C.projectDropFile, cb),
    onCreateProgress: (cb) => on(C.projectCreateProgress, cb),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  timeline: {
    get: () => invoke(C.timelineGet),
    edit: (edit) => invoke(C.timelineEdit, edit),
    thumbs: (src) => invoke(C.timelineThumbs, src),
    peaks: (src) => invoke(C.timelinePeaks, src),
    transform: (t) => invoke(C.timelineTransform, t)
  },
  agent: {
    send: (args) => invoke(C.agentSend, args),
    interrupt: () => invoke(C.agentInterrupt),
    permission: (args) => invoke(C.agentPermission, args),
    history: () => invoke(C.agentHistory),
    state: () => invoke(C.agentState),
    restart: () => invoke(C.agentRestart),
    onEvent: (cb) => on(C.agentEvent, cb),
    onMessage: (cb) => on(C.agentMessage, cb)
  },
  broll: {
    hasKey: () => invoke(C.brollHasKey),
    setKey: (key) => invoke(C.brollSetKey, key),
    search: (args) => invoke(C.brollSearch, args)
  },
  ai33: {
    hasKey: () => invoke(C.ai33HasKey),
    status: () => invoke(C.ai33Status),
    setKey: (key) => invoke(C.ai33SetKey, key),
    voices: (q) => invoke(C.ai33Voices, q),
    voicePreview: (voiceId) => invoke(C.ai33VoicePreview, voiceId),
    estimate: (req) => invoke(C.ai33Estimate, req),
    askReply: (id, decision) => invoke(C.ai33AskReply, id, decision),
    isScriptProject: () => invoke(C.ai33IsScript),
    onAsk: (cb) => on(C.ai33Ask, cb),
    onAskClosed: (cb) => on<{ id: string }>(C.ai33AskClosed, (p) => cb(p.id)),
    onNotice: (cb) => on(C.ai33Notice, cb)
  },
  updates: {
    status: () => invoke(C.updatesStatus),
    check: () => invoke(C.updatesCheck),
    install: () => invoke(C.updatesInstall),
    setToken: (token) => invoke(C.updatesSetToken, token),
    moveToApplications: () => invoke(C.updatesMove),
    onStatus: (cb) => on(C.updatesStatusPush, cb)
  },
  clean: {
    run: () => invoke(C.cleanRun),
    applyEdl: (edl) => invoke(C.cleanApplyEdl, edl),
    status: () => invoke(C.cleanStatus),
    transcript: () => invoke(C.cleanTranscript),
    edl: () => invoke(C.cleanEdl),
    transcribe: () => invoke(C.cleanTranscribe),
    onStatus: (cb) => on(C.cleanStatusPush, cb)
  },
  captions: {
    state: () => invoke(C.captionsState),
    words: () => invoke(C.captionsWords),
    apply: (config) => invoke(C.captionsApply, config),
    remove: () => invoke(C.captionsRemove),
    addFonts: () => invoke(C.fontsAdd),
    addGoogleFont: (input) => invoke(C.fontsAddGoogle, input)
  },
  color: {
    state: () => invoke(C.colorState),
    apply: (grade, checkpoint) => invoke(C.colorApply, grade, checkpoint),
    remove: () => invoke(C.colorRemove)
  },
  looks: {
    list: () => invoke(C.looksList),
    save: (name) => invoke(C.looksSave, name),
    update: (slug) => invoke(C.looksUpdate, slug),
    apply: (slug) => invoke(C.looksApply, slug),
    remove: (slug) => invoke(C.looksRemove, slug),
    active: () => invoke(C.looksActive)
  },
  history: {
    list: () => invoke(C.historyList),
    restore: (sha) => invoke(C.historyRestore, sha),
    undo: () => invoke(C.historyUndo),
    onChanged: (cb) => on(C.historyChanged, cb)
  },
  export: {
    start: (opts) => invoke(C.exportStart, opts),
    cancel: () => invoke(C.exportCancel),
    onProgress: (cb) => on(C.exportProgress, cb),
    reveal: (p) => invoke(C.exportReveal, p),
    freeMemoryMB: () => invoke(C.exportFreeMemory)
  },
  capture: { frame: (rect) => invoke(C.captureFrame, rect) },
  voice: {
    micAccess: () => invoke(C.voiceMicAccess),
    start: (args) => invoke(C.voiceStart, args),
    audio: (sid, pcm) => ipcRenderer.send(C.voiceAudio, sid, pcm),
    stop: (sid) => invoke(C.voiceStop, sid),
    cancel: (sid) => invoke(C.voiceCancel, sid),
    onEvent: (cb) => on(C.voiceEvent, cb)
  },
  menu: {
    onCommand: (cb) => on<{ cmd: string; arg?: unknown }>(C.menuCommand, (p) => cb(p.cmd, p.arg)),
    popupClip: (args) => invoke(C.menuPopupClip, args),
    popupLook: (slug) => invoke(C.menuPopupLook, slug)
  },
  window: {
    onActive: (cb) => on(C.windowActive, cb),
    onFullscreen: (cb) => on(C.windowFullscreen, cb)
  }
}

contextBridge.exposeInMainWorld('luca', api)
