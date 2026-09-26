import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { Channels } from './ipc'
import { looksDir } from './looks'

function send(cmd: string, arg?: unknown): void {
  const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  w?.webContents.send(Channels.menuCommand, { cmd, arg })
}

export function buildAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'Cmd+N', click: () => send('new-project') },
        { label: 'Open Project…', accelerator: 'Cmd+O', click: () => send('open-project') },
        { label: 'Open Recent', submenu: [{ label: 'Clear Menu', enabled: false }] },
        { type: 'separator' },
        { label: 'Close Project', accelerator: 'Cmd+Shift+W', click: () => send('close-project') },
        { type: 'separator' },
        { label: 'Export…', accelerator: 'Cmd+E', click: () => send('export') },
        { label: 'Reveal in Finder', accelerator: 'Cmd+Shift+R', click: () => send('reveal') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo Checkpoint', accelerator: 'Cmd+Z', click: () => send('undo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Split at Playhead', click: () => send('split') },
        { label: 'Delete Clip', click: () => send('delete-clip') },
        { type: 'separator' },
        { label: 'Clean Edit…', accelerator: 'Cmd+Shift+E', click: () => send('clean-edit') }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'Cmd+Shift+S',
          click: () => send('toggle-sidebar')
        },
        { label: 'Toggle Chat', accelerator: 'Cmd+Shift+C', click: () => send('toggle-chat') },
        { type: 'separator' },
        { label: 'Files', accelerator: 'Cmd+1', click: () => send('tab', 'files') },
        { label: 'Catalog', accelerator: 'Cmd+2', click: () => send('tab', 'catalog') },
        { label: 'Transcript', accelerator: 'Cmd+3', click: () => send('tab', 'transcript') },
        { label: 'Looks', accelerator: 'Cmd+4', click: () => send('tab', 'looks') },
        { type: 'separator' },
        { label: 'Toggle Grab', click: () => send('toggle-grab') },
        { label: 'History', accelerator: 'Cmd+Y', click: () => send('history') },
        { label: 'Command Palette…', accelerator: 'Cmd+K', click: () => send('palette') },
        { type: 'separator' },
        { label: 'Zoom Timeline In', accelerator: 'Cmd+=', click: () => send('zoom-in') },
        { label: 'Zoom Timeline Out', accelerator: 'Cmd+-', click: () => send('zoom-out') },
        { label: 'Zoom to Fit', accelerator: 'Cmd+0', click: () => send('zoom-fit') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions])
      ]
    },
    {
      label: 'Playback',
      submenu: [
        { label: 'Play / Pause', click: () => send('play-pause') },
        { label: 'Go to Start', click: () => send('seek-start') },
        { label: 'Go to End', click: () => send('seek-end') },
        { type: 'separator' },
        { label: 'Step Back One Frame', click: () => send('frame-back') },
        { label: 'Step Forward One Frame', click: () => send('frame-forward') },
        { label: 'Back One Second', click: () => send('second-back') },
        { label: 'Forward One Second', click: () => send('second-forward') },
        { type: 'separator' },
        { label: 'Go to Timecode…', accelerator: 'Cmd+G', click: () => send('goto') },
        { label: 'Mute', click: () => send('mute') }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'HyperFrames Documentation',
          click: () => shell.openExternal('https://hyperframes.heygen.com/')
        },
        {
          label: 'Claude Code',
          click: () => shell.openExternal('https://docs.anthropic.com/en/docs/claude-code')
        },
        { type: 'separator' },
        { label: 'Sign in to Claude…', click: () => send('claude-login') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function popupClipMenu(
  win: BrowserWindow,
  clip: { clipId: string; track: number; start: number; end: number }
): Promise<void> {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate([
      { label: 'Split at Playhead', click: () => send('split', clip) },
      { label: 'Trim Start to Playhead', click: () => send('trim-start', clip) },
      { label: 'Trim End to Playhead', click: () => send('trim-end', clip) },
      { type: 'separator' },
      { label: 'Add to Chat', click: () => send('chip-clip', clip) },
      { type: 'separator' },
      { label: 'Delete', click: () => send('delete-clip', clip) }
    ])
    menu.popup({ window: win, callback: () => resolve() })
  })
}

export function popupLookMenu(win: BrowserWindow, slug: string): Promise<void> {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate([
      { label: 'Apply to This Project', click: () => send('look-apply', slug) },
      { label: 'Update from This Project', click: () => send('look-update', slug) },
      { type: 'separator' },
      { label: 'Reveal in Finder', click: () => shell.showItemInFolder(join(looksDir(), slug)) },
      { label: 'Delete Look', click: () => send('look-delete', slug) }
    ])
    menu.popup({ window: win, callback: () => resolve() })
  })
}
