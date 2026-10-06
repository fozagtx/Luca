import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { Channels } from './ipc'
import { looksDir } from './looks'
import { getSettings } from './settings'
import { currentProject, onProjectChange } from './state'

function send(cmd: string, arg?: unknown): void {
  const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  w?.webContents.send(Channels.menuCommand, { cmd, arg })
}

/**
 * A command that works on the open project. Home has none, so it is greyed out there (the
 * renderer ignores it too, for the keys that reach it some other way).
 */
function onProject(item: MenuItemConstructorOptions): MenuItemConstructorOptions {
  return { ...item, enabled: currentProject() !== null }
}

/** The last projects opened, newest first, as File → Open Recent lists them. */
function recentItems(): MenuItemConstructorOptions[] {
  const recent = getSettings().recentProjects.slice(0, 10)
  if (!recent.length) return [{ label: 'No Recent Projects', enabled: false }]
  return recent.map((r) => ({ label: r.name, click: () => send('open-recent', r.dir) }))
}

let following = false

export function buildAppMenu(): void {
  // opening or closing a project changes what can be done (and what was opened last)
  if (!following) {
    following = true
    onProjectChange(() => buildAppMenu())
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => send('check-updates') },
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
        { label: 'Edit a Video…', accelerator: 'Cmd+N', click: () => send('new-project') },
        { label: 'Open Project…', accelerator: 'Cmd+O', click: () => send('open-project') },
        { label: 'Open Recent', submenu: recentItems() },
        { type: 'separator' },
        onProject({
          label: 'Close Project and Go Home',
          accelerator: 'Cmd+Shift+W',
          click: () => send('close-project')
        }),
        { type: 'separator' },
        onProject({ label: 'Export…', accelerator: 'Cmd+E', click: () => send('export') }),
        onProject({
          label: 'Reveal in Finder',
          accelerator: 'Cmd+Shift+R',
          click: () => send('reveal')
        }),
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        // stays on at Home: ⌘Z also takes back typing in the start card's and the chat's fields
        { label: 'Undo Checkpoint', accelerator: 'Cmd+Z', click: () => send('undo') },
        // ⇧⌘Z in a text field: macOS only redoes typing through the menu
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        onProject({ label: 'Split at Playhead', click: () => send('split') }),
        onProject({ label: 'Delete Clip', click: () => send('delete-clip') }),
        { type: 'separator' },
        onProject({
          label: 'Clean Edit…',
          accelerator: 'Cmd+Shift+E',
          click: () => send('clean-edit')
        }),
        onProject({ label: 'Captions…', click: () => send('captions') }),
        onProject({ label: 'Color…', accelerator: 'Cmd+Shift+L', click: () => send('color') })
      ]
    },
    {
      label: 'View',
      submenu: [
        onProject({
          label: 'Toggle Sidebar',
          accelerator: 'Cmd+Shift+S',
          click: () => send('toggle-sidebar')
        }),
        { label: 'Toggle Chat', accelerator: 'Cmd+Shift+C', click: () => send('toggle-chat') },
        { type: 'separator' },
        {
          label: 'Appearance',
          submenu: [
            {
              label: 'Light',
              type: 'radio',
              checked: getSettings().theme !== 'dark',
              click: () => send('theme', 'light')
            },
            {
              label: 'Dark',
              type: 'radio',
              checked: getSettings().theme === 'dark',
              click: () => send('theme', 'dark')
            },
            { type: 'separator' },
            {
              label: 'Toggle Dark Mode',
              accelerator: 'Cmd+Shift+D',
              click: () => send('theme')
            }
          ]
        },
        { type: 'separator' },
        onProject({
          label: 'Transcript',
          accelerator: 'Cmd+1',
          click: () => send('tab', 'transcript')
        }),
        onProject({ label: 'B-roll', accelerator: 'Cmd+2', click: () => send('tab', 'broll') }),
        onProject({ label: 'Looks', accelerator: 'Cmd+3', click: () => send('tab', 'looks') }),
        onProject({ label: 'Sound', accelerator: 'Cmd+4', click: () => send('tab', 'sound') }),
        { type: 'separator' },
        onProject({ label: 'Toggle Grab', click: () => send('toggle-grab') }),
        onProject({ label: 'History', accelerator: 'Cmd+Y', click: () => send('history') }),
        { label: 'Command Palette…', accelerator: 'Cmd+K', click: () => send('palette') },
        { type: 'separator' },
        onProject({
          label: 'Zoom Timeline In',
          accelerator: 'Cmd+=',
          click: () => send('zoom-in')
        }),
        onProject({
          label: 'Zoom Timeline Out',
          accelerator: 'Cmd+-',
          click: () => send('zoom-out')
        }),
        onProject({ label: 'Zoom to Fit', accelerator: 'Cmd+0', click: () => send('zoom-fit') }),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions])
      ]
    },
    {
      label: 'Playback',
      submenu: [
        onProject({ label: 'Play / Pause', click: () => send('play-pause') }),
        onProject({ label: 'Go to Start', click: () => send('seek-start') }),
        onProject({ label: 'Go to End', click: () => send('seek-end') }),
        { type: 'separator' },
        onProject({ label: 'Step Back One Frame', click: () => send('frame-back') }),
        onProject({ label: 'Step Forward One Frame', click: () => send('frame-forward') }),
        onProject({ label: 'Back One Second', click: () => send('second-back') }),
        onProject({ label: 'Forward One Second', click: () => send('second-forward') }),
        { type: 'separator' },
        onProject({ label: 'Go to Timecode…', accelerator: 'Cmd+G', click: () => send('goto') }),
        onProject({ label: 'Mute', click: () => send('mute') })
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'Cmd+/', click: () => send('shortcuts') },
        { type: 'separator' },
        {
          label: 'Setting Up Claude',
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
