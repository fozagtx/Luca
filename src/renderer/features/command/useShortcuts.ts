import { useEffect } from 'react'
import { luca } from '../../lib/luca'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useTimeline } from '../../stores/timeline'
import { useUi, type SidebarTab } from '../../stores/ui'
import type { Theme } from '@shared/types'

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
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
      if (isEditable(e.target)) return
      const tl = useTimeline.getState()
      if (meta) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          tl.zoomBy(1.25)
        } else if (e.key === '-') {
          e.preventDefault()
          tl.zoomBy(0.8)
        } else if (e.key === '0') {
          e.preventDefault()
          tl.setZoom(80)
        }
        return
      }

      switch (e.key) {
        case 's':
          if (tl.selected) void tl.edit({ op: 'split', ref: tl.selected, time: player.currentTime })
          break
        case 'Delete':
        case 'Backspace':
          if (tl.selected) {
            e.preventDefault()
            void tl.edit({ op: 'delete', ref: tl.selected })
            tl.select(null)
          }
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
          if (useProject.getState().project) player.toggleGrab()
          break
        case 'Escape':
          if (player.grab) player.toggleGrab(false)
          else if (tl.selected) tl.select(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)

    const off = luca.menu.onCommand(async (cmd, arg) => {
      const ui = useUi.getState()
      const player = usePlayer.getState()
      const proj = useProject.getState()
      switch (cmd) {
        case 'new-project': {
          const file = await luca.project.pickVideo()
          if (file) ui.setNewProject({ file })
          break
        }
        case 'open-project': {
          const dir = await luca.project.pickProjectDir()
          if (dir) await proj.open(dir)
          break
        }
        case 'close-project':
          await proj.close()
          break
        case 'export':
          if (proj.project) ui.setExport(true)
          break
        case 'reveal':
          if (proj.project) await luca.project.revealInFinder()
          break
        case 'undo':
          if (proj.project) await luca.history.undo()
          break
        case 'toggle-sidebar':
          ui.toggleSidebar()
          break
        case 'toggle-chat':
          ui.toggleChat()
          break
        case 'tab':
          ui.setTab(arg as SidebarTab)
          break
        case 'theme':
          if (arg === 'light' || arg === 'dark') ui.setTheme(arg as Theme)
          else ui.toggleTheme()
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
          useTimeline.getState().zoomToFit(Math.max(player.duration, 1))
          break
        case 'history':
          ui.setHistory(!ui.historyOpen)
          break
        case 'palette':
          ui.setPalette(!ui.paletteOpen)
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
        case 'settings':
          ui.setSettings(true)
          break
        case 'clean-edit':
          ui.setTab('transcript')
          break
        case 'claude-login':
          await luca.env.openClaudeLogin()
          break
      }
    })

    const offDrop = luca.project.onDropFile((path) =>
      useUi.getState().setNewProject({ file: path })
    )
    const offActive = luca.window.onActive((active) => {
      useUi.getState().setWindowActive(active)
      document.body.classList.toggle('inactive', !active)
    })

    return () => {
      window.removeEventListener('keydown', onKey)
      off()
      offDrop()
      offActive()
    }
  }, [])
}
