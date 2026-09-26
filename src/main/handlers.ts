import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Aspect,
  Chip,
  Edl,
  ExportOptions,
  PermissionDecision,
  Settings,
  TimelineEdit
} from '../shared/types'
import { activeAgent, agentFor, closeAgent, onTurnEnd } from './agent'
import { applyEdl, cleanStatus, readEdl, readTranscript, runCleanEdit } from './clean'
import { cancelExport, startExport } from './export'
import { checkClaude, envStatus, openClaudeLoginTerminal } from './env'
import { addCatalogItem, catalog, readTimeline } from './hyperframes'
import { remocnCatalog, setupStudio, studioStatus } from './remocn'
import { Channels, broadcast, handle } from './ipc'
import { applyLook, listLooks, lookName, removeLook, saveLook, updateLook } from './looks'
import { buildAppMenu, popupClipMenu, popupLookMenu } from './menu'
import { createProject, listFiles, openProject, recentProjects, safeJoin } from './projects'
import { hasSecret, setSecret } from './secrets'
import type { LucaServer } from './server'
import { getSettings, updateSettings } from './settings'
import { currentProject, requireProject, setCurrentProject } from './state'
import { applyEdit, editLabel, peaks, thumbnails } from './media'
import { checkpoint, ensureRepo, history, restore, undo } from './versions'
import { stopWatching, watchProject } from './watcher'

type WinGetter = () => BrowserWindow | null

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
    stopWatching()
    const p = openProject(dir)
    await ensureRepo(p.dir)
    setCurrentProject(p)
    watchProject(p.dir)
    broadcast(Channels.projectOpened, p)
    app.addRecentDocument(p.dir)
    void agentFor(p).start()
    return p
  }
  onTurnEnd((p, e) => {
    if (e.isError) return
    void checkpoint(p.dir, 'Claude: ' + (activeAgent()?.lastUserText() ?? 'edit').slice(0, 72))
  })
  handle(
    Channels.projectCreate,
    async (args: { file: string; name?: string; aspect: Aspect; look?: string | null }) => {
      const p = await createProject(args)
      const opened = await activate(p.dir)
      if (args.look) {
        await applyLook(opened, args.look)
        return activate(p.dir)
      }
      return opened
    }
  )
  handle(Channels.projectOpen, (dir: string) => activate(dir))
  handle(Channels.projectClose, async () => {
    stopWatching()
    await closeAgent()
    setCurrentProject(null)
    broadcast(Channels.projectOpened, null)
  })
  handle(Channels.projectCurrent, currentProject)
  handle(Channels.projectRecent, recentProjects)
  handle(Channels.projectPickVideo, async () => {
    const res = await openDialog(getWin(), {
      title: 'Choose a video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm'] }]
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
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
    if (res.ok) void checkpoint(p.dir, editLabel(edit))
    return res
  })
  handle(Channels.timelineThumbs, () => thumbnails(requireProject()))
  handle(Channels.timelinePeaks, () => peaks(requireProject()))

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

  // catalog
  handle(Channels.catalogList, (args?: { refresh?: boolean }) =>
    catalog({ refresh: args?.refresh, cwd: currentProject()?.dir ?? app.getPath('userData') })
  )
  handle(Channels.catalogAdd, (name: string) => addCatalogItem(requireProject().dir, name))
  handle(Channels.catalogRemocn, (args?: { refresh?: boolean }) => remocnCatalog(args?.refresh))
  handle(Channels.catalogRemocnPreview, () => null)
  handle(Channels.catalogRemocnStudioStatus, () => studioStatus())
  handle(Channels.catalogRemocnSetup, () => setupStudio())

  // clean
  handle(Channels.cleanRun, () => runCleanEdit(requireProject()))
  handle(Channels.cleanApplyEdl, (edl: Edl) => applyEdl(requireProject(), edl))
  handle(Channels.cleanStatus, cleanStatus)
  handle(Channels.cleanTranscript, () => readTranscript(requireProject().dir))
  handle(Channels.cleanEdl, () => readEdl(requireProject().dir))

  // looks
  handle(Channels.looksList, () => listLooks())
  handle(Channels.looksSave, (name: string) => saveLook(requireProject(), name))
  handle(Channels.looksUpdate, (slug: string) => updateLook(requireProject(), slug))
  handle(Channels.looksApply, async (slug: string) => {
    const p = requireProject()
    await applyLook(p, slug)
    setCurrentProject(openProject(p.dir))
    await checkpoint(p.dir, `Apply Look: ${lookName(slug)}`)
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
  handle(Channels.exportFreeMemory, () => Math.round(process.getSystemMemoryInfo().free / 1024))

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
      return img.resize({ width: 640 }).toDataURL()
    }
  )

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
