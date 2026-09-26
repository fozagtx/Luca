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
    create: (args) => invoke(C.projectCreate, args),
    open: (dir) => invoke(C.projectOpen, dir),
    close: () => invoke(C.projectClose),
    current: () => invoke(C.projectCurrent),
    recent: () => invoke(C.projectRecent),
    pickVideo: () => invoke(C.projectPickVideo),
    pickProjectDir: () => invoke(C.projectPickDir),
    files: () => invoke(C.projectFiles),
    readFile: (rel) => invoke(C.projectReadFile, rel),
    revealInFinder: (rel) => invoke(C.projectReveal, rel),
    onChanged: (cb) => on(C.projectChanged, cb),
    onOpened: (cb) => on(C.projectOpened, cb),
    onDropFile: (cb) => on(C.projectDropFile, cb),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  timeline: {
    get: () => invoke(C.timelineGet),
    edit: (edit) => invoke(C.timelineEdit, edit),
    thumbs: () => invoke(C.timelineThumbs),
    peaks: () => invoke(C.timelinePeaks)
  },
  agent: {
    send: (args) => invoke(C.agentSend, args),
    interrupt: () => invoke(C.agentInterrupt),
    permission: (args) => invoke(C.agentPermission, args),
    history: () => invoke(C.agentHistory),
    state: () => invoke(C.agentState),
    restart: () => invoke(C.agentRestart),
    onEvent: (cb) => on(C.agentEvent, cb),
    onHistory: (cb) => on(C.agentHistoryPush, cb)
  },
  catalog: {
    list: (args) => invoke(C.catalogList, args),
    add: (name) => invoke(C.catalogAdd, name),
    remocn: (args) => invoke(C.catalogRemocn, args),
    remocnPreview: (name) => invoke(C.catalogRemocnPreview, name),
    remocnStudioStatus: () => invoke(C.catalogRemocnStudioStatus),
    remocnSetup: () => invoke(C.catalogRemocnSetup)
  },
  clean: {
    run: () => invoke(C.cleanRun),
    applyEdl: (edl) => invoke(C.cleanApplyEdl, edl),
    status: () => invoke(C.cleanStatus),
    transcript: () => invoke(C.cleanTranscript),
    edl: () => invoke(C.cleanEdl),
    onStatus: (cb) => on(C.cleanStatusPush, cb)
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
  menu: {
    onCommand: (cb) => on<{ cmd: string; arg?: unknown }>(C.menuCommand, (p) => cb(p.cmd, p.arg)),
    popupClip: (args) => invoke(C.menuPopupClip, args),
    popupLook: (slug) => invoke(C.menuPopupLook, slug)
  },
  window: { onActive: (cb) => on(C.windowActive, cb) }
}

contextBridge.exposeInMainWorld('luca', api)
