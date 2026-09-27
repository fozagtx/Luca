import {
  Captions,
  Crosshair,
  House,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Upload
} from 'lucide-react'
import type { ReactElement } from 'react'
import { AnimatedButton } from '../../components/ui/animated-button'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { usePlayer } from '../../stores/player'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'
import higgsfield from '../../assets/higgsfield.png'
import { goHome } from '../command/go-home'
import { GeminiButton } from '../gemini/GeminiButton'
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
        <Moon
          size={16}
          strokeWidth={1.5}
          className={cn(
            swap,
            dark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
          )}
        />
        <Sun
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

/** Higgsfield integration (search and generate media from chat) is planned; announce it. */
function Higgsfield(): ReactElement {
  return (
    <Tip label="Higgsfield: find and generate media right from chat. Coming soon">
      <span
        role="note"
        aria-label="Higgsfield, coming soon"
        className="no-drag inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-bg py-0.5 pr-1 pl-0.5 select-none"
      >
        <img
          src={higgsfield}
          alt=""
          draggable={false}
          className="size-[22px] rounded-full ring-1 ring-black/5"
        />
        <span className="text-[12px] font-medium text-text">Higgsfield</span>
        <span className="rounded-full bg-[#d9f94a] px-1.5 py-[3px] text-[9.5px] leading-none font-semibold tracking-[0.02em] text-[#111] uppercase">
          Coming soon
        </span>
      </span>
    </Tip>
  )
}

export function Toolbar(): ReactElement {
  const project = useProject((s) => s.project)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const chatOpen = useUi((s) => s.chatOpen)
  const setSidebar = useUi((s) => s.setSidebar)
  const setChat = useUi((s) => s.setChat)
  const setExport = useUi((s) => s.setExport)
  const setCaptions = useUi((s) => s.setCaptions)
  const fullscreen = useUi((s) => s.fullscreen)
  const grab = usePlayer((s) => s.grab)
  const toggleGrab = usePlayer((s) => s.toggleGrab)

  return (
    <header
      className={cn(
        'drag-region relative flex h-[52px] shrink-0 items-center bg-bg pr-3 transition-[padding] duration-200',
        // room for the traffic lights, which macOS hides in fullscreen
        fullscreen ? 'pl-3' : 'pl-[92px]'
      )}
    >
      {/* The title spans the whole bar and inherits its window-drag region. It comes first: on
          macOS a later drag region wins over earlier no-drag buttons, which then can't be clicked. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <span className="max-w-[40%] truncate text-[13px] font-semibold tracking-[-0.01em] text-text">
          {project?.name ?? 'Luca'}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Tip label="Home: close this project" shortcut="⇧⌘W">
          <Button
            variant="icon"
            disabled={!project}
            onClick={() => void goHome()}
            aria-label="Home"
          >
            <House size={16} strokeWidth={1.5} />
          </Button>
        </Tip>
        <Tip label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} shortcut="⇧⌘S">
          <Button
            variant="icon"
            active={sidebarOpen}
            onClick={() => setSidebar(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={sidebarOpen}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={16} strokeWidth={1.5} />
            ) : (
              <PanelLeftOpen size={16} strokeWidth={1.5} />
            )}
          </Button>
        </Tip>
        <div className="mx-1.5 h-4 w-px bg-border" />
        <GeminiButton />
        <Higgsfield />
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
        <Tip label="Captions: styles and fonts">
          <Button
            variant="ghost"
            disabled={!project}
            onClick={() => setCaptions(true)}
            aria-label="Captions"
          >
            <Captions size={15} strokeWidth={1.75} />
            Captions
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
        <Tip label={chatOpen ? 'Hide chat' : 'Show chat'} shortcut="⇧⌘C">
          <Button
            variant="icon"
            active={chatOpen}
            onClick={() => setChat(!chatOpen)}
            aria-label={chatOpen ? 'Hide chat' : 'Show chat'}
            aria-pressed={chatOpen}
          >
            <MessageSquare size={16} strokeWidth={1.5} />
          </Button>
        </Tip>
      </div>
    </header>
  )
}
