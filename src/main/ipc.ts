import { BrowserWindow, ipcMain } from 'electron'

import { Channels, type Channel } from '../shared/channels'

export { Channels }
export type { Channel }

export function handle<A extends unknown[]>(channel: Channel, fn: (...args: A) => unknown): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))
}

export function broadcast(channel: Channel, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}
