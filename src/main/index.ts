import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { basename, extname, join } from 'node:path'
import { registerHandlers } from './handlers'
import { Channels, broadcast } from './ipc'
import { buildAppMenu } from './menu'
import { VIDEO_EXT } from './projects'
import { DEV_PORT, LucaServer } from './server'
import { getSettings, updateSettings } from './settings'
import { currentProject, setCurrentProject } from './state'
import { loginShellPath } from './env'
import { cancelVoice } from './voice'
import { stopWatching } from './watcher'

export const server = new LucaServer(is.dev ? null : join(__dirname, '../renderer'), (id) => {
  const p = currentProject()
  return p && p.id === id ? p.dir : null
})

let mainWindow: BrowserWindow | null = null
let pendingOpenFile: string | null = null

function createWindow(): BrowserWindow {
  const s = getSettings()
  const bounds = s.window ?? { width: 1440, height: 900 }
  const win = new BrowserWindow({
    width: Math.max(1200, bounds.width),
    height: Math.max(760, bounds.height),
    x: bounds.x,
    y: bounds.y,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    title: 'Luca',
    backgroundColor: s.theme === 'dark' ? '#0D0D0D' : '#FFFFFF',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
    win.webContents.setZoomFactor(1)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const base = is.dev ? process.env.ELECTRON_RENDERER_URL! : server.baseUrl
    if (!url.startsWith(base)) e.preventDefault()
  })
  win.on('focus', () => win.webContents.send(Channels.windowActive, true))
  win.on('blur', () => win.webContents.send(Channels.windowActive, false))
  const saveBounds = (): void => {
    if (win.isDestroyed() || win.isFullScreen()) return
    const b = win.getBounds()
    updateSettings({ window: { x: b.x, y: b.y, width: b.width, height: b.height } })
  }
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)
  win.on('closed', () => {
    mainWindow = null
  })

  const tokenQuery = `?token=${server.token}`
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + tokenQuery)
  } else {
    win.loadURL(server.baseUrl + '/' + tokenQuery)
  }
  return win
}

app.on('open-file', (e, path) => {
  e.preventDefault()
  if (VIDEO_EXT.has(extname(basename(path)).toLowerCase())) {
    if (mainWindow) broadcast(Channels.projectDropFile, path)
    else pendingOpenFile = path
  }
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('ai.luca.app')
  nativeTheme.themeSource = getSettings().theme
  const iconPath = is.dev
    ? join(__dirname, '../../resources/icon.png')
    : join(process.resourcesPath, 'app.asar.unpacked/resources/icon.png')
  if (is.dev) app.dock?.setIcon(iconPath)
  app.setAboutPanelOptions({
    applicationName: 'Luca',
    applicationVersion: app.getVersion(),
    copyright: 'HyperFrames-native video editor',
    iconPath
  })
  await loginShellPath()
  await server.start(is.dev ? DEV_PORT : 0)
  registerHandlers(() => mainWindow, server)
  buildAppMenu()

  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  mainWindow = createWindow()
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOpenFile) {
      broadcast(Channels.projectDropFile, pendingOpenFile)
      pendingOpenFile = null
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  void cancelVoice()
  stopWatching()
  setCurrentProject(null)
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void cancelVoice()
  stopWatching()
  server.stop()
})

process.on('uncaughtException', (err) => {
  console.error('[luca] uncaught', err)
  if (app.isReady() && mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      message: 'Luca hit an unexpected error',
      detail: String(err)
    })
  }
})
