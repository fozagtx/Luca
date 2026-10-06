import { app, BrowserWindow, dialog, nativeImage, nativeTheme, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  BrollSearch,
  CaptionConfig,
  Chip,
  CreateProgress,
  Edl,
  ElementTransform,
  ExportOptions,
  MediaInput,
  PermissionDecision,
  Project,
  Settings,
  StartArgs,
  TimelineEdit
} from '../shared/types'
import { activeAgent, agentFor, closeAgent, onTurnEnd } from './agent'
import {
  addFonts,
  addGoogleFont,
  applyCaptions,
  captionState,
  captionWords,
  FONT_EXT,
  installUsedBundledFonts,
  projectFonts,
  refreshCaptions,
  removeCaptions
} from './captions'
import {
  applyEdl,
  cleanStatus,
  placeVoiceover,
  readEdl,
  readTranscript,
  runCleanEdit,
  runTranscribeOnly
} from './clean'
import { cancelExport, startExport } from './export'
import { checkClaude, envStatus, openClaudeLoginTerminal } from './env'
import { applyColor, colorState, removeColor } from './color'
import { addMedia, footageInfo } from './footage'
import { readTimeline } from './hyperframes'
import { Channels, broadcast, handle, listen } from './ipc'
import { applyLook, listLooks, lookName, removeLook, saveLook, updateLook } from './looks'
import { buildAppMenu, popupClipMenu, popupLookMenu } from './menu'
import { hasPexelsKey, savePexelsKey, searchBroll } from './pexels'
import {
  checkForUpdates,
  installUpdate,
  moveToApplications,
  saveUpdateToken,
  updateStatus
} from './updater'
import {
  AUDIO_EXT,
  forgetRecent,
  IMAGE_EXT,
  listFiles,
  openProject,
  recentProjects,
  cancelPosterRefresh,
  flushPosterRefresh,
  schedulePosterRefresh,
  safeJoin,
  startProject,
  VIDEO_EXT
} from './projects'
import { hasSecret, setSecret } from './secrets'
import type { LucaServer } from './server'
import { getSettings, updateSettings } from './settings'
import { currentProject, requireProject, setCurrentProject } from './state'
import { applyEdit, applyTransform, editLabel, peaks, thumbnails } from './media'
import { refreshStudio } from './studio'
import { checkpoint, ensureRepo, history, restore, undo } from './versions'
import { cancelVoice, micAccess, pushVoiceAudio, startVoice, stopVoice } from './voice'
import { stopWatching, watchProject } from './watcher'

type WinGetter = () => BrowserWindow | null

const warnCheckpoint = (err: unknown): void => console.warn('[luca] checkpoint failed', err)

/**
 * Captions on the timeline follow the speech under them once it moved (a no-op otherwise); the
 * caller's checkpoint saves the change and the captions as one version.
 */
function followCaptions(p: Project): void {
  // the Studio look mirrors the footage, so it follows a trim or split too
  try {
    refreshStudio(p)
  } catch (err) {
    console.warn('[luca] following the footage with the Studio look failed', err)
  }
  try {
    refreshCaptions(p)
  } catch (err) {
    console.warn('[luca] re-timing captions failed', err)
  }
}

/** Fonts that come with Luca that a turn used without adding them go in with that turn's version. */
function followFonts(p: Project): void {
  try {
    installUsedBundledFonts(p.dir)
  } catch (err) {
    console.warn('[luca] adding fonts that come with Luca failed', err)
  }
}

const openDialog = (
  win: BrowserWindow | null,
  opts: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> =>
  win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)

export function registerHandlers(getWin: WinGetter, server: LucaServer): void {
  handle(Channels.serverBaseUrl, () => server.baseUrl)

  // env
  handle(Channels.envStatus, envStatus)
  handle(Channels.envOpenClaudeLogin, openClaudeLoginTerminal)
  handle(Channels.envInstallClaude, () => 'npm install -g @anthropic-ai/claude-code')
  handle(Channels.envCheckClaude, async () => {
    const r = await checkClaude()
    return { ok: r.ok, loggedIn: r.loggedIn, error: r.error }
  })
  handle(Channels.envSetAssemblyAiKey, (key: string) => {
    setSecret('assemblyai', key)
    return hasSecret('assemblyai')
  })
  handle(Channels.envHasAssemblyAiKey, () => hasSecret('assemblyai'))

  // settings
  handle(Channels.settingsGet, getSettings)
  handle(Channels.settingsUpdate, (patch: Partial<Settings>) => {
    const next = updateSettings(patch)
    if (patch.approvals === 'full') activeAgent()?.allowPending()
    if (patch.theme) {
      nativeTheme.themeSource = next.theme
      buildAppMenu()
    }
    return next
  })
  handle(Channels.settingsSavePanes, (key: string, sizes: number[]) => {
    updateSettings({ panes: { ...(getSettings().panes ?? {}), [key]: sizes } })
  })

  // project
  const activate = async (dir: string): Promise<ReturnType<typeof openProject>> => {
    // a folder that isn't a project throws here, while the open one is still being watched
    const p = openProject(dir)
    stopWatching()
    flushPosterRefresh()
    // versions need a working git; without one the project still opens and edits, unversioned
    await ensureRepo(p.dir).catch(warnCheckpoint)
    setCurrentProject(p)
    watchProject(p.dir)
    broadcast(Channels.projectOpened, p)
    app.addRecentDocument(p.dir)
    void agentFor(p).start()
    return p
  }
  onTurnEnd((p, e) => {
    // a stopped turn's edits are kept, so they get a checkpoint too (undo takes back just them)
    if (e.isError && !e.stopped) return
    followCaptions(p)
    followFonts(p)
    checkpoint(p.dir, 'Claude: ' + (activeAgent()?.lastUserText() ?? 'edit').slice(0, 72)).catch(
      warnCheckpoint
    )
    // projects without a source video take their thumbnail from the composition itself
    schedulePosterRefresh(p)
  })
  const start = async (args: StartArgs): Promise<Awaited<ReturnType<typeof startProject>>> => {
    const report = (p: CreateProgress): void => broadcast(Channels.projectCreateProgress, p)
    try {
      const res = await startProject(args, report)
      // init leaves a voiceover off the timeline (on its own, or as the voice of silent footage):
      // it plays from the first frame, even when Luca can't transcribe it (footage that has its
      // own sound is left as it is)
      await placeVoiceover(res.project)
      report({ stage: 'starting', message: 'Opening the project' })
      const opened = await activate(res.project.dir)
      report({ stage: 'done' })
      return { ...res, project: opened }
    } catch (err) {
      report({ stage: 'error', message: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }
  handle(Channels.projectStart, start)
  handle(Channels.projectPickMedia, async () => {
    const ext = (set: Set<string>): string[] => [...set].map((e) => e.slice(1))
    const res = await openDialog(getWin(), {
      title: 'Choose your video or voiceover',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Video, voiceover or images',
          extensions: [...ext(VIDEO_EXT), ...ext(AUDIO_EXT), ...ext(IMAGE_EXT)]
        }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })
  handle(Channels.projectMediaPreview, async (path: string) => {
    try {
      // Quick Look thumbnails cover images and videos on macOS
      const img = await nativeImage.createThumbnailFromPath(path, { width: 240, height: 240 })
      if (!img.isEmpty()) return img.toDataURL()
    } catch {
      // not supported for this file; try decoding it directly
    }
    const img = nativeImage.createFromPath(path)
    return img.isEmpty() ? null : img.resize({ width: 240 }).toDataURL()
  })
  handle(Channels.projectProbeVideo, (path: string) => footageInfo(path))
  handle(Channels.projectAddMedia, (file: MediaInput) => {
    const name = 'path' in file ? basename(file.path) : file.name
    return addMedia(requireProject().dir, file, (progress) =>
      broadcast(Channels.projectMediaProgress, { name, progress })
    )
  })
  handle(Channels.projectForget, (dir: string) => {
    forgetRecent(dir)
    broadcast(Channels.projectRecentChanged, null)
  })
  handle(Channels.projectTrash, async (dir: string) => {
    cancelPosterRefresh(dir)
    if (currentProject()?.dir === dir) {
      stopWatching()
      await closeAgent()
      setCurrentProject(null)
      broadcast(Channels.projectOpened, null)
    }
    await shell.trashItem(dir)
    forgetRecent(dir)
    broadcast(Channels.projectRecentChanged, null)
  })
  handle(Channels.projectOpen, (dir: string) => activate(dir))
  handle(Channels.projectClose, async () => {
    stopWatching()
    await closeAgent()
    setCurrentProject(null)
    broadcast(Channels.projectOpened, null)
    flushPosterRefresh()
  })
  handle(Channels.projectCurrent, currentProject)
  handle(Channels.projectRecent, recentProjects)
  handle(Channels.projectPickDir, async () => {
    const res = await openDialog(getWin(), {
      title: 'Open a Luca project',
      defaultPath: getSettings().projectsDir,
      properties: ['openDirectory']
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle(Channels.projectFiles, () => listFiles(requireProject().dir))
  handle(Channels.projectReadFile, (rel: string) =>
    readFileSync(safeJoin(requireProject().dir, rel), 'utf8')
  )
  handle(Channels.projectReveal, (rel?: string) => {
    const p = requireProject()
    shell.showItemInFolder(rel ? safeJoin(p.dir, rel) : join(p.dir, 'index.html'))
  })

  // timeline
  handle(Channels.timelineGet, () => readTimeline(requireProject().dir))
  handle(Channels.timelineEdit, async (edit: TimelineEdit) => {
    const p = requireProject()
    const res = await applyEdit(p.dir, edit)
    if (!res.ok) return res
    followCaptions(p)
    checkpoint(p.dir, editLabel(edit)).catch(warnCheckpoint)
    return res
  })
  handle(Channels.timelineTransform, async (t: ElementTransform) => {
    const p = requireProject()
    const res = await applyTransform(p.dir, t)
    if (res.ok) checkpoint(p.dir, `Edit: move/resize ${t.id}`).catch(warnCheckpoint)
    return res
  })
  handle(Channels.timelineThumbs, (src?: string) => thumbnails(requireProject(), src))
  handle(Channels.timelinePeaks, (src?: string) => peaks(requireProject(), src))

  // agent
  handle(Channels.agentSend, (args: { text: string; chips: Chip[]; context: unknown }) =>
    agentFor(requireProject()).send(args)
  )
  handle(Channels.agentInterrupt, () => activeAgent()?.interrupt())
  handle(Channels.agentPermission, (args: { id: string; decision: PermissionDecision }) =>
    activeAgent()?.decide(args.id, args.decision)
  )
  handle(Channels.agentHistory, () => activeAgent()?.history() ?? [])
  handle(Channels.agentState, () => activeAgent()?.status() ?? { state: 'idle' })
  handle(Channels.agentRestart, () => agentFor(requireProject()).restart())

  // updates (GitHub releases)
  handle(Channels.updatesStatus, updateStatus)
  handle(Channels.updatesCheck, checkForUpdates)
  handle(Channels.updatesInstall, installUpdate)
  handle(Channels.updatesSetToken, (token: string) => saveUpdateToken(token))
  handle(Channels.updatesMove, moveToApplications)

  // B-roll (Pexels)
  handle(Channels.brollHasKey, hasPexelsKey)
  handle(Channels.brollSetKey, (key: string) => savePexelsKey(key))
  handle(Channels.brollSearch, (args: BrollSearch) => searchBroll(args))

  // clean
  handle(Channels.cleanRun, () => runCleanEdit(requireProject()))
  handle(Channels.cleanApplyEdl, (edl: Edl) => applyEdl(requireProject(), edl))
  handle(Channels.cleanStatus, cleanStatus)
  handle(Channels.cleanTranscript, () => readTranscript(requireProject().dir))
  handle(Channels.cleanEdl, () => readEdl(requireProject().dir))
  handle(Channels.cleanTranscribe, () => runTranscribeOnly(requireProject()))

  // captions
  handle(Channels.captionsState, () => captionState(requireProject()))
  handle(Channels.captionsWords, () => captionWords(requireProject()))
  handle(Channels.captionsApply, (cfg: CaptionConfig) => applyCaptions(requireProject(), cfg))
  handle(Channels.captionsRemove, () => removeCaptions(requireProject()))

  // color grade (a LUT that comes with Luca, on the footage)
  handle(Channels.colorState, () => colorState(requireProject()))
  handle(Channels.colorApply, (grade: { lut: string; intensity: number }, checkpoint?: boolean) =>
    applyColor(requireProject(), grade, { checkpoint })
  )
  handle(Channels.colorRemove, () => removeColor(requireProject()))
  handle(Channels.fontsAdd, async () => {
    const p = requireProject()
    const res = await openDialog(getWin(), {
      title: 'Add fonts',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: FONT_EXT }]
    })
    if (res.canceled || !res.filePaths.length) return captionState(p).fonts
    return addFonts(p, res.filePaths)
  })
  handle(Channels.fontsAddGoogle, async (input: string) => {
    const p = requireProject()
    const families = await addGoogleFont(p.dir, input)
    await checkpoint(p.dir, `Add font${families.length === 1 ? '' : 's'}: ${families.join(', ')}`)
    return { families, fonts: projectFonts(p.dir) }
  })

  // looks
  handle(Channels.looksList, () => listLooks())
  handle(Channels.looksSave, (name: string) => saveLook(requireProject(), name))
  handle(Channels.looksUpdate, (slug: string) => updateLook(requireProject(), slug))
  handle(Channels.looksApply, async (slug: string) => {
    const p = requireProject()
    try {
      await applyLook(p, slug)
    } finally {
      // a look whose titles couldn't all be added is still on (its error still reaches the
      // person); going Home or to another project while it went in stays put
      if (currentProject()?.dir === p.dir) setCurrentProject(openProject(p.dir))
      await checkpoint(p.dir, `Apply Look: ${lookName(slug)}`)
    }
  })
  handle(Channels.looksRemove, (slug: string) => removeLook(slug))
  handle(Channels.looksActive, () => currentProject()?.look ?? null)

  // history
  handle(Channels.historyList, () => history(requireProject().dir))
  handle(Channels.historyRestore, (sha: string) => restore(requireProject().dir, sha))
  handle(Channels.historyUndo, () => undo(requireProject().dir))

  // export
  handle(Channels.exportStart, (opts: ExportOptions) => startExport(requireProject(), opts))
  handle(Channels.exportCancel, () => cancelExport())
  handle(Channels.exportReveal, (p: string) => shell.showItemInFolder(p))
  handle(Channels.exportFreeMemory, () => Math.round(process.getSystemMemoryInfo().total / 1024))

  // capture
  handle(
    Channels.captureFrame,
    async (rect: { x: number; y: number; width: number; height: number }) => {
      const win = getWin()
      if (!win) throw new Error('No window')
      const img = await win.webContents.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
      // bare base64: the chip thumbnail and the image block sent to Claude each add their own framing
      return img.resize({ width: 640 }).toPNG().toString('base64')
    }
  )

  // voice (AssemblyAI real-time speech-to-text)
  handle(Channels.voiceMicAccess, micAccess)
  handle(Channels.voiceStart, (args: { sid: number; sampleRate: number }) => startVoice(args))
  listen(Channels.voiceAudio, (sid: number, pcm: ArrayBuffer | Uint8Array) =>
    pushVoiceAudio(sid, pcm)
  )
  handle(Channels.voiceStop, (sid: number) => stopVoice(sid))
  handle(Channels.voiceCancel, (sid: number) => cancelVoice(sid))

  // menus
  handle(
    Channels.menuPopupClip,
    (args: { clipId: string; track: number; start: number; end: number }) => {
      const win = getWin()
      return win ? popupClipMenu(win, args) : undefined
    }
  )
  handle(Channels.menuPopupLook, (slug: string) => {
    const win = getWin()
    return win ? popupLookMenu(win, slug) : undefined
  })
}
