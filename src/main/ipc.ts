import { BrowserWindow, Notification, ipcMain } from 'electron'

import { Channels, type Channel } from '../shared/channels'

export { Channels }
export type { Channel }

export function handle<A extends unknown[]>(channel: Channel, fn: (...args: A) => unknown): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))
}

/** Fire-and-forget messages from the renderer (ipcRenderer.send), e.g. streamed audio. */
export function listen<A extends unknown[]>(channel: Channel, fn: (...args: A) => void): void {
  ipcMain.removeAllListeners(channel)
  ipcMain.on(channel, (_e, ...args) => fn(...(args as A)))
}

export function broadcast(channel: Channel, payload?: unknown): void {
  for (const w of BrowserWindow?.getAllWindows?.() ?? []) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/**
 * A system notification, only while Luca is in the background (so work waiting on you never
 * stalls unseen). Clicking it brings the window back.
 */
export function notifyInBackground(title: string, body: string): void {
  const wins = BrowserWindow?.getAllWindows?.() ?? []
  if (wins.some((w) => !w.isDestroyed() && w.isFocused())) return
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => {
    const w = wins.find((x) => !x.isDestroyed())
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  })
  n.show()
}
