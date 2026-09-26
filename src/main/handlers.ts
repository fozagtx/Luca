import { app, BrowserWindow, dialog, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Aspect, Settings } from '../shared/types'
import { checkClaude, envStatus, openClaudeLoginTerminal } from './env'
import { addCatalogItem, catalog, readTimeline } from './hyperframes'
import { Channels, broadcast, handle } from './ipc'
import { popupClipMenu, popupLookMenu } from './menu'
import { createProject, listFiles, openProject, recentProjects, safeJoin } from './projects'
import { hasSecret, setSecret } from './secrets'
import type { LucaServer } from './server'
import { getSettings, updateSettings } from './settings'
import { currentProject, requireProject, setCurrentProject } from './state'
import { ensureRepo, history, restore, undo } from './versions'
import { stopWatching, watchProject } from './watcher'

type WinGetter = () => BrowserWindow | null

const openDialog = (
  win: BrowserWindow | null,
  opts: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> =>
  win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)

const notReady = (feature: string) => (): never => {
  throw new Error(`${feature} is not available yet`)
}

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
  handle(Channels.settingsUpdate, (patch: Partial<Settings>) => updateSettings(patch))
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
    return p
  }
  handle(
    Channels.projectCreate,
    async (args: { file: string; name?: string; aspect: Aspect; look?: string | null }) => {
      const p = await createProject(args)
      return activate(p.dir)
    }
  )
  handle(Channels.projectOpen, (dir: string) => activate(dir))
  handle(Channels.projectClose, () => {
    stopWatching()
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
  handle(Channels.timelineEdit, notReady('Timeline editing'))
  handle(Channels.timelineThumbs, notReady('Thumbnails'))
  handle(Channels.timelinePeaks, notReady('Waveform'))

  // agent
  handle(Channels.agentSend, notReady('Chat'))
  handle(Channels.agentInterrupt, () => undefined)
  handle(Channels.agentPermission, () => undefined)
  handle(Channels.agentHistory, () => [])
  handle(Channels.agentState, () => ({ state: 'idle' }))
  handle(Channels.agentRestart, () => undefined)

  // catalog
  handle(Channels.catalogList, (args?: { refresh?: boolean }) =>
    catalog({ refresh: args?.refresh, cwd: currentProject()?.dir ?? app.getPath('userData') })
  )
  handle(Channels.catalogAdd, (name: string) => addCatalogItem(requireProject().dir, name))
  handle(Channels.catalogRemocn, () => [])
  handle(Channels.catalogRemocnPreview, () => null)
  handle(Channels.catalogRemocnStudioStatus, () => ({ ready: false, step: 'not set up' }))
  handle(Channels.catalogRemocnSetup, notReady('Remocn'))

  // clean
  handle(Channels.cleanRun, notReady('Clean edit'))
  handle(Channels.cleanApplyEdl, notReady('Clean edit'))
  handle(Channels.cleanStatus, () => ({ stage: 'idle' }))
  handle(Channels.cleanTranscript, () => null)
  handle(Channels.cleanEdl, () => null)

  // looks
  handle(Channels.looksList, () => [])
  handle(Channels.looksSave, notReady('Looks'))
  handle(Channels.looksUpdate, notReady('Looks'))
  handle(Channels.looksApply, notReady('Looks'))
  handle(Channels.looksRemove, notReady('Looks'))
  handle(Channels.looksActive, () => currentProject()?.look ?? null)

  // history
  handle(Channels.historyList, () => history(requireProject().dir))
  handle(Channels.historyRestore, (sha: string) => restore(requireProject().dir, sha))
  handle(Channels.historyUndo, () => undo(requireProject().dir))

  // export
  handle(Channels.exportStart, notReady('Export'))
  handle(Channels.exportCancel, () => undefined)
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
