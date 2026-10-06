import { Command } from 'cmdk'
import {
  AudioLines,
  Captions,
  Clock,
  Contrast,
  Crosshair,
  FolderOpen,
  History,
  House,
  ImagePlay,
  Keyboard,
  Mic,
  Moon,
  RefreshCw,
  Palette,
  Plus,
  Scissors,
  Sun,
  Upload
} from 'lucide-react'
import type { ReactElement } from 'react'
import { luca } from '../../lib/luca'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useStart } from '../../stores/start'
import { useUi } from '../../stores/ui'
import { useUpdates } from '../../stores/updates'
import { useVoice } from '../../stores/voice'
import { goHome, openProject } from './go-home'

type Item = {
  id: string
  label: string
  shortcut?: string
  icon: ReactElement
  run: () => void
  needsProject?: boolean
}

export function CommandPalette(): ReactElement {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPalette)
  const theme = useUi((s) => s.theme)
  const hasProject = useProject((s) => !!s.project)
  const ui = useUi.getState

  const all: Item[] = [
    {
      id: 'new',
      label: 'Edit a Video…',
      shortcut: '⌘N',
      icon: <Plus size={14} strokeWidth={1.5} />,
      run: async () => {
        const paths = await luca.project.pickMedia()
        if (paths.length) await useStart.getState().startFrom(paths)
      }
    },
    {
      id: 'open',
      label: 'Open Project…',
      shortcut: '⌘O',
      icon: <FolderOpen size={14} strokeWidth={1.5} />,
      run: async () => {
        const dir = await luca.project.pickProjectDir()
        if (dir) await openProject(dir)
      }
    },
    {
      id: 'home',
      label: 'Go Home (close project)',
      shortcut: '⇧⌘W',
      icon: <House size={14} strokeWidth={1.5} />,
      run: () => void goHome(),
      needsProject: true
    },
    {
      id: 'export',
      label: 'Export…',
      shortcut: '⌘E',
      icon: <Upload size={14} strokeWidth={1.5} />,
      run: () => ui().setExport(true),
      needsProject: true
    },
    {
      id: 'broll',
      label: 'Find B-roll…',
      shortcut: '⌘2',
      icon: <ImagePlay size={14} strokeWidth={1.5} />,
      run: () => {
        ui().setTab('broll')
        requestAnimationFrame(() => document.getElementById('broll-search')?.focus())
      },
      needsProject: true
    },
    {
      id: 'look',
      label: 'Apply Look…',
      shortcut: '⌘3',
      icon: <Palette size={14} strokeWidth={1.5} />,
      run: () => ui().setTab('looks'),
      needsProject: true
    },
    {
      id: 'captions',
      label: 'Captions…',
      icon: <Captions size={14} strokeWidth={1.5} />,
      run: () => ui().setCaptions(true),
      needsProject: true
    },
    {
      id: 'color',
      label: 'Color…',
      shortcut: '⇧⌘L',
      icon: <Contrast size={14} strokeWidth={1.5} />,
      run: () => ui().setColor(true),
      needsProject: true
    },
    {
      id: 'clean',
      label: 'Clean edit',
      shortcut: '⇧⌘E',
      icon: <Scissors size={14} strokeWidth={1.5} />,
      run: () => ui().setTab('transcript'),
      needsProject: true
    },
    // talking works on Home too: what you say is the brief for the video on the start card
    {
      id: 'dictate',
      label: 'Dictate a message',
      icon: <Mic size={14} strokeWidth={1.5} />,
      run: () => void useVoice.getState().start('dictate')
    },
    {
      id: 'voice',
      label: 'Voice mode: talk with Luca',
      icon: <AudioLines size={14} strokeWidth={1.5} />,
      run: () => void useVoice.getState().start('converse')
    },
    {
      id: 'grab',
      label: 'Toggle Grab',
      shortcut: 'G',
      icon: <Crosshair size={14} strokeWidth={1.5} />,
      run: () => usePlayer.getState().toggleGrab(),
      needsProject: true
    },
    {
      id: 'history',
      label: 'History',
      shortcut: '⌘Y',
      icon: <History size={14} strokeWidth={1.5} />,
      run: () => ui().setHistory(true),
      needsProject: true
    },
    {
      id: 'theme',
      label: theme === 'dark' ? 'Appearance: Light' : 'Appearance: Dark',
      shortcut: '⇧⌘D',
      icon:
        theme === 'dark' ? (
          <Sun size={14} strokeWidth={1.5} />
        ) : (
          <Moon size={14} strokeWidth={1.5} />
        ),
      run: () => ui().toggleTheme()
    },
    {
      id: 'goto',
      label: 'Go to timecode…',
      shortcut: '⌘G',
      icon: <Clock size={14} strokeWidth={1.5} />,
      run: () => ui().setGoto(true),
      needsProject: true
    },
    {
      id: 'shortcuts',
      label: 'Keyboard Shortcuts',
      shortcut: '⌘/',
      icon: <Keyboard size={14} strokeWidth={1.5} />,
      run: () => ui().setShortcuts(true)
    },
    {
      id: 'updates',
      label: 'Check for Updates…',
      icon: <RefreshCw size={14} strokeWidth={1.5} />,
      run: () => void useUpdates.getState().check()
    }
  ]
  // Home has no project to work on: its commands aren't offered there at all
  const items = hasProject ? all : all.filter((it) => !it.needsProject)

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-overlay"
      contentClassName="fixed left-1/2 top-[18%] z-50 w-[520px] -translate-x-1/2 overflow-hidden rounded-[10px] border border-border bg-bg shadow-popover outline-none cmdk-pop"
    >
      <Command.Input
        placeholder="Type a command…"
        className="h-11 w-full border-b border-border bg-transparent px-4 text-[14px] text-text placeholder:text-text-3 outline-none"
      />
      <Command.List className="scroll max-h-[320px] p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-[12px] text-text-3">
          No matching command
        </Command.Empty>
        {items.map((it) => (
          <Command.Item
            key={it.id}
            value={it.label}
            onSelect={() => {
              setOpen(false)
              it.run()
            }}
            className="flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] text-text data-[selected=true]:bg-hover"
          >
            <span className="text-text-2">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="text-[11px] text-text-3">{it.shortcut}</span>}
          </Command.Item>
        ))}
      </Command.List>
    </Command.Dialog>
  )
}
