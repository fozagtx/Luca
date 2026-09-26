import { Crosshair, MessageSquare, Moon, PanelLeft, Sun, Upload } from 'lucide-react'
import type { ReactElement } from 'react'
import { AnimatedButton } from '../../components/ui/animated-button'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'
import { HistoryPopover } from '../history/HistoryPopover'

const swap =
  'absolute inset-0 m-auto transition-[transform,opacity] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]'

export function ThemeToggle(): ReactElement {
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)
  const dark = theme === 'dark'
  return (
    <Tip label="Appearance" shortcut="⇧⌘D">
      <Button
        variant="icon"
        onClick={toggleTheme}
        aria-label="Appearance"
        aria-pressed={dark}
        className="relative overflow-hidden"
      >
        <Sun
          size={16}
          strokeWidth={1.5}
          className={cn(
            swap,
            dark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
          )}
        />
        <Moon
          size={16}
          strokeWidth={1.5}
          className={cn(
            swap,
            dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
          )}
        />
      </Button>
    </Tip>
  )
}

export function Toolbar(): ReactElement {
  const project = useProject((s) => s.project)
  const { sidebarOpen, chatOpen, toggleSidebar, toggleChat, setExport } = useUi()
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)

  return (
    <header className="drag-region relative flex h-[52px] shrink-0 items-center bg-bg pl-[84px] pr-3">
      <div className="flex items-center gap-1">
        <Tip label="Toggle sidebar" shortcut="⇧⌘S">
          <Button
            variant="icon"
            active={sidebarOpen}
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={16} strokeWidth={1.5} />
          </Button>
        </Tip>
      </div>

      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <span className="max-w-[40%] truncate text-[13px] font-semibold tracking-[-0.01em] text-text">
          {project?.name ?? 'Luca'}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Tip label="Grab an element or frame" shortcut="G">
          <Button
            variant="ghost"
            active={grab}
            disabled={!project}
            onClick={() => toggleGrab()}
            aria-label="Grab"
            aria-pressed={grab}
          >
            <Crosshair size={15} strokeWidth={1.75} />
            Grab
          </Button>
        </Tip>
        <HistoryPopover />
        <AnimatedButton
          size="sm"
          className="ml-1"
          disabled={!project}
          onClick={() => setExport(true)}
        >
          <Upload size={14} strokeWidth={1.75} />
          Export
        </AnimatedButton>
        <div className="mx-1.5 h-4 w-px bg-border" />
        <ThemeToggle />
        <Tip label="Toggle chat" shortcut="⇧⌘C">
          <Button variant="icon" active={chatOpen} onClick={toggleChat} aria-label="Toggle chat">
            <MessageSquare size={16} strokeWidth={1.5} />
          </Button>
        </Tip>
      </div>
    </header>
  )
}
