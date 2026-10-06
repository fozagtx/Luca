import { useEffect } from 'react'
import { luca } from '../../lib/luca'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { stopLuca } from '../../stores/queue'
import { useStart } from '../../stores/start'
import { useTimeline } from '../../stores/timeline'
import { useUpdates } from '../../stores/updates'
import { useVoice } from '../../stores/voice'
import { useUi, type SidebarTab } from '../../stores/ui'
import { goHome, openProject } from './go-home'
import type { Theme } from '@shared/types'
import {
  clipToChat,
  deleteClip,
  findClip,
  splitClip,
  targetClip,
  trimToPlayhead
} from '../timeline/clip-actions'

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Focus is in a sheet, the palette, a menu or a popover: its keys are its own, not the video's. */
const inOverlay = (t: EventTarget | null): boolean =>
  t instanceof Element && !!t.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')

const hasProject = (): boolean => !!useProject.getState().project

/** Zoom to Fit: the timeline knows the length before the preview has loaded. */
function zoomToFit(): void {
  const tl = useTimeline.getState()
  tl.zoomToFit(Math.max(usePlayer.getState().duration, tl.timeline?.duration ?? 0, 1))
}

/** Open the chat if it's hidden and put the caret in the message box. */
async function focusChat(): Promise<void> {
  const ui = useUi.getState()
  if (!ui.chatOpen) ui.setChat(true)
  // the message box is hidden while talking: wrap up first (what was said stays in the queue)
  const voice = useVoice.getState()
  if (voice.mode === 'dictate') await voice.finish()
  else if (voice.mode === 'converse') voice.cancel()
  requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
}

/** Menu commands that work anywhere, Home included. False when `cmd` isn't one of them. */
async function anywhere(cmd: string, arg: unknown): Promise<boolean> {
  const ui = useUi.getState()
  switch (cmd) {
    case 'new-project': {
      const paths = await luca.project.pickMedia()
      if (paths.length) await useStart.getState().startFrom(paths)
      return true
    }
    case 'open-project': {
      const dir = await luca.project.pickProjectDir()
      if (dir) await openProject(dir)
      return true
    }
    case 'open-recent':
      if (typeof arg === 'string') await openProject(arg)
      return true
    case 'close-project':
      await goHome()
      return true
    case 'undo':
      // ⌘Z in a text field takes back the typing there, not Luca's last change
      if (isEditable(document.activeElement)) document.execCommand('undo')
      else if (hasProject()) await luca.history.undo()
      return true
    case 'toggle-chat':
      ui.setChat(!ui.chatOpen)
      return true
    case 'theme':
      if (arg === 'light' || arg === 'dark') ui.setTheme(arg as Theme)
      else ui.toggleTheme()
      return true
    case 'palette':
      ui.setPalette(!ui.paletteOpen)
      return true
    case 'check-updates':
      void useUpdates.getState().check()
      return true
    case 'claude-login':
      await luca.env.openClaudeLogin()
      return true
    case 'shortcuts':
      ui.setShortcuts(!ui.shortcutsOpen)
      return true
  }
  return false
}

/** Menu commands that work on the open project (the menu greys them out on Home). */
function onProject(cmd: string, arg: unknown): void {
  const ui = useUi.getState()
  const player = usePlayer.getState()
  switch (cmd) {
    case 'export':
      ui.setExport(true)
      break
    case 'reveal':
      void luca.project.revealInFinder()
      break
    case 'toggle-sidebar':
      ui.setSidebar(!ui.sidebarOpen)
      break
    case 'split': {
      const c = targetClip(arg)
      if (c) void splitClip(c)
      break
    }
    case 'trim-start':
    case 'trim-end': {
      const c = targetClip(arg)
      if (c) void trimToPlayhead(c, cmd === 'trim-start' ? 'start' : 'end')
      break
    }
    case 'delete-clip': {
      const c = targetClip(arg)
      if (c) void deleteClip(c)
      break
    }
    case 'chip-clip': {
      const c = targetClip(arg)
      if (c) clipToChat(c)
      break
    }
    case 'tab':
      ui.setTab(arg as SidebarTab)
      break
    case 'toggle-grab':
      player.toggleGrab()
      break
    case 'zoom-in':
      useTimeline.getState().zoomBy(1.25)
      break
    case 'zoom-out':
      useTimeline.getState().zoomBy(0.8)
      break
    case 'zoom-fit':
      zoomToFit()
      break
    case 'history':
      ui.setHistory(!ui.historyOpen)
      break
    case 'play-pause':
      player.togglePlay()
      break
    case 'seek-start':
      player.seek(0)
      break
    case 'seek-end':
      player.seek(player.duration)
      break
    case 'frame-back':
      player.step(-1)
      break
    case 'frame-forward':
      player.step(1)
      break
    case 'second-back':
      player.nudge(-1)
      break
    case 'second-forward':
      player.nudge(1)
      break
    case 'goto':
      ui.setGoto(true)
      break
    case 'mute':
      player.toggleMute()
      break
    case 'clean-edit':
      ui.setTab('transcript')
      break
    case 'captions':
      ui.setCaptions(true)
      break
    case 'color':
      ui.setColor(true)
      break
  }
}

/** Keyboard shortcuts and native menu commands. Menu items without accelerators are handled here. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ui = useUi.getState()
      const player = usePlayer.getState()
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.setPalette(!ui.paletteOpen)
        return
      }
      if (meta && e.key === '.') {
        e.preventDefault()
        void stopLuca()
        return
      }
      if (isEditable(e.target) || inOverlay(e.target)) return
      // a sheet or popover is open (focus can sit outside it, on its backdrop): its keys
      // aren't the video's either
      if (
        ui.exportOpen ||
        ui.captionsOpen ||
        ui.colorOpen ||
        ui.gotoOpen ||
        ui.paletteOpen ||
        ui.shortcutsOpen ||
        ui.historyOpen
      )
        return
      // Home has no video or timeline: there only the chat and this list answer to keys, and
      // Space or the arrows keep doing what they do for the focused button or the page
      const project = hasProject()
      const tl = useTimeline.getState()
      if (meta) {
        if (!project) return
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          tl.zoomBy(1.25)
        } else if (e.key === '-') {
          e.preventDefault()
          tl.zoomBy(0.8)
        } else if (e.key === '0') {
          // the same as View → Zoom to Fit and the timeline's own button
          e.preventDefault()
          zoomToFit()
        }
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        void focusChat()
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        ui.setShortcuts(true)
        return
      }
      if (!project) return

      const selected = findClip(tl.selected)
      switch (e.key) {
        case 's':
          if (selected) void splitClip(selected, player.currentTime)
          break
        case 'Delete':
        case 'Backspace':
          if (selected) {
            e.preventDefault()
            void deleteClip(selected)
          }
          break
        case '[':
          if (selected) void trimToPlayhead(selected, 'start')
          break
        case ']':
          if (selected) void trimToPlayhead(selected, 'end')
          break
        case ' ':
          e.preventDefault()
          player.togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) player.nudge(-1)
          else player.step(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) player.nudge(1)
          else player.step(1)
          break
        case 'Home':
          player.seek(0)
          break
        case 'End':
          player.seek(player.duration)
          break
        case 'j':
          player.nudge(-1)
          break
        case 'l':
          player.nudge(1)
          break
        case 'k':
          player.handle?.pause()
          break
        case 'm':
          player.toggleMute()
          break
        case 'g':
          player.toggleGrab()
          break
        case 'Escape':
          if (player.grab) player.toggleGrab(false)
          else if (tl.selected) tl.select(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)

    const off = luca.menu.onCommand(async (cmd, arg) => {
      if (await anywhere(cmd, arg)) return
      // the rest work on the open project; on Home they do nothing
      if (hasProject()) onProject(cmd, arg)
    })

    const offDrop = luca.project.onDropFile((path) => void useStart.getState().startFrom([path]))
    const offActive = luca.window.onActive((active) => {
      useUi.getState().setWindowActive(active)
      document.body.classList.toggle('inactive', !active)
    })
    const offFullscreen = luca.window.onFullscreen((f) => useUi.getState().setFullscreen(f))

    return () => {
      window.removeEventListener('keydown', onKey)
      off()
      offDrop()
      offActive()
      offFullscreen()
    }
  }, [])
}
