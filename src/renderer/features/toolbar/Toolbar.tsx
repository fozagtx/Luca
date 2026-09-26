import { Crosshair, History, MessageSquare, PanelLeft, Upload } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

export function Toolbar(): ReactElement {
  const project = useProject((s) => s.project)
  const { sidebarOpen, chatOpen, toggleSidebar, toggleChat, setHistory, setExport, historyOpen } =
    useUi()
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)

  return (
    <header className="drag-region relative flex h-[52px] shrink-0 items-center border-b border-border bg-bg pl-[84px] pr-3">
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
        <span className="max-w-[40%] truncate text-[13px] font-medium text-text">
          {project?.name ?? 'Luca'}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Tip label="Grab an element or frame" shortcut="G">
          <Button
            variant="icon"
            active={grab}
            disabled={!project}
            onClick={() => toggleGrab()}
            aria-label="Grab"
            aria-pressed={grab}
          >
            <Crosshair size={16} strokeWidth={1.5} />
          </Button>
        </Tip>
        <Tip label="History" shortcut="⌘Y">
          <Button
            variant="icon"
            active={historyOpen}
            disabled={!project}
            onClick={() => setHistory(!historyOpen)}
            aria-label="History"
          >
            <History size={16} strokeWidth={1.5} />
          </Button>
        </Tip>
        <Button
          variant="primary"
          size="sm"
          className="ml-1 px-3"
          disabled={!project}
          onClick={() => setExport(true)}
        >
          <Upload size={14} strokeWidth={1.75} />
          Export
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Tip label="Toggle chat" shortcut="⇧⌘C">
          <Button variant="icon" active={chatOpen} onClick={toggleChat} aria-label="Toggle chat">
            <MessageSquare size={16} strokeWidth={1.5} />
          </Button>
        </Tip>
      </div>
    </header>
  )
}
