import { Command } from 'cmdk'
import {
  AudioLines,
  Clock,
  Contrast,
  Crosshair,
  FileText,
  FolderOpen,
  History,
  House,
  ImagePlay,
  Mic,
  Moon,
  RefreshCw,
  Palette,
  Plug,
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
import { goHome } from './go-home'

type Item = {
  id: string
  label: string
  shortcut?: string
  icon: ReactElement
  run: () => void
  needsProject?: boolean
  /** Other words that find it. */
  keywords?: string[]
}

export function CommandPalette(): ReactElement {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPalette)
  const ui = useUi()
  const project = useProject((s) => s.project)
  const openProject = useProject((s) => s.open)
  const toggleGrab = usePlayer((s) => s.toggleGrab)

  const items: Item[] = [
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
      id: 'script',
      label: 'Start from a script…',
      icon: <FileText size={14} strokeWidth={1.5} />,
      keywords: ['voiceover', 'record', 'no footage', 'faceless'],
      run: async () => {
        // it belongs on the start card: Home first, unless they choose to let Luca finish
        await goHome()
        const { busy, setScriptMode } = useStart.getState()
        if (useProject.getState().project || busy) return
        setScriptMode(true)
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
      run: () => ui.setExport(true),
      needsProject: true
    },
    {
      id: 'broll',
      label: 'Find B-roll…',
      shortcut: '⌘2',
      icon: <ImagePlay size={14} strokeWidth={1.5} />,
      run: () => {
        ui.setTab('broll')
        requestAnimationFrame(() => document.getElementById('broll-search')?.focus())
      },
      needsProject: true
    },
    {
      id: 'look',
      label: 'Apply Look…',
      icon: <Palette size={14} strokeWidth={1.5} />,
      run: () => ui.setTab('looks'),
      needsProject: true
    },
    {
      id: 'color',
      label: 'Color…',
      icon: <Contrast size={14} strokeWidth={1.5} />,
      run: () => ui.setColor(true),
      needsProject: true
    },
    {
      id: 'clean',
      label: 'Clean edit',
      shortcut: '⇧⌘E',
      icon: <Scissors size={14} strokeWidth={1.5} />,
      run: () => ui.setTab('transcript'),
      needsProject: true
    },
    {
      id: 'dictate',
      label: 'Dictate a message',
      icon: <Mic size={14} strokeWidth={1.5} />,
      run: () => void useVoice.getState().start('dictate'),
      needsProject: true
    },
    {
      id: 'voice',
      label: 'Voice mode: talk with Luca',
      icon: <AudioLines size={14} strokeWidth={1.5} />,
      run: () => void useVoice.getState().start('converse'),
      needsProject: true
    },
    {
      id: 'grab',
      label: 'Toggle Grab',
      shortcut: 'G',
      icon: <Crosshair size={14} strokeWidth={1.5} />,
      run: () => toggleGrab(),
      needsProject: true
    },
    {
      id: 'history',
      label: 'History',
      shortcut: '⌘Y',
      icon: <History size={14} strokeWidth={1.5} />,
      run: () => ui.setHistory(true),
      needsProject: true
    },
    {
      id: 'theme',
      label: ui.theme === 'dark' ? 'Appearance: Light' : 'Appearance: Dark',
      shortcut: '⇧⌘D',
      icon:
        ui.theme === 'dark' ? (
          <Sun size={14} strokeWidth={1.5} />
        ) : (
          <Moon size={14} strokeWidth={1.5} />
        ),
      run: () => ui.toggleTheme()
    },
    {
      id: 'goto',
      label: 'Go to timecode…',
      shortcut: '⌘G',
      icon: <Clock size={14} strokeWidth={1.5} />,
      run: () => ui.setGoto(true),
      needsProject: true
    },
    {
      id: 'connect-ai33',
      label: 'Connect ai33…',
      shortcut: '⌘,',
      icon: <Plug size={14} strokeWidth={1.5} />,
      keywords: ['connections', 'key', 'credits', 'voices', 'music', 'sound'],
      run: () => ui.setSettings(true)
    },
    {
      id: 'updates',
      label: 'Check for Updates…',
      icon: <RefreshCw size={14} strokeWidth={1.5} />,
      run: () => void useUpdates.getState().check()
    }
  ]

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
            keywords={it.keywords}
            disabled={it.needsProject && !project}
            onSelect={() => {
              setOpen(false)
              it.run()
            }}
            className="flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] text-text data-[selected=true]:bg-hover data-[disabled=true]:opacity-40"
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
