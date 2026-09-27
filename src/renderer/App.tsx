import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type Layout,
  type PanelImperativeHandle,
  type PanelSize
} from 'react-resizable-panels'
import { Toaster } from 'sonner'
import { ErrorBoundary } from './components/ui/error-boundary'
import { TooltipProvider } from './components/ui/tooltip'
import { Chat } from './features/chat/Chat'
import { CommandPalette } from './features/command/CommandPalette'
import { GotoSheet } from './features/command/GotoSheet'
import { ShortcutsSheet } from './features/command/ShortcutsSheet'
import { useShortcuts } from './features/command/useShortcuts'
import { BackgroundSheet } from './features/backgrounds/BackgroundSheet'
import { CaptionStudio } from './features/captions/CaptionStudio'
import { ExportBar, ExportSheet } from './features/export/ExportSheet'
import { NewProjectSheet } from './features/onboarding/NewProjectSheet'
import { Sidebar } from './features/sidebar/Sidebar'
import { Timeline } from './features/timeline/Timeline'
import { Toolbar } from './features/toolbar/Toolbar'
import { Transport } from './features/viewer/Transport'
import { Viewer } from './features/viewer/Viewer'
import { cn } from './lib/cn'
import { luca } from './lib/luca'
import { useChat } from './stores/chat'
import { useProject } from './stores/project'
import { useUi } from './stores/ui'

const sep =
  'group/sep relative shrink-0 bg-transparent outline-none flex items-center justify-center ' +
  'after:rounded-full after:bg-border-strong after:opacity-0 after:transition-[opacity,background-color] after:duration-150 ' +
  'hover:after:opacity-100 data-[separator=active]:after:bg-accent data-[separator=active]:after:opacity-100'
const sepV = `${sep} w-1.5 cursor-col-resize after:h-8 after:w-[3px]`
const sepH = `${sep} h-1.5 cursor-row-resize after:h-[3px] after:w-8`

/** Stored percentages become a Group layout only when every panel is present and expanded. */
function layoutOf(ids: string[], sizes: number[] | undefined): Layout | undefined {
  if (!sizes || sizes.length !== ids.length || sizes.some((s) => !(s > 0))) return undefined
  const total = sizes.reduce((a, b) => a + b, 0)
  if (Math.abs(total - 100) > 1) return undefined
  return Object.fromEntries(ids.map((id, i) => [id, sizes[i]]))
}

/**
 * Keeps a collapsible side panel and its toggle in the UI store in step: the toolbar button,
 * the menu and ⇧⌘S change the store and the panel follows (animated); dragging the panel shut
 * or open updates the store.
 */
function useSidePanel(
  open: boolean,
  setOpen: (open: boolean) => void,
  animate: () => void,
  animating: () => boolean
): {
  ref: React.RefObject<PanelImperativeHandle | null>
  onResize: (s: PanelSize, id?: string | number, prev?: PanelSize) => void
} {
  const ref = usePanelRef()
  useEffect(() => {
    const p = ref.current
    if (!p) return
    if (open && p.isCollapsed()) {
      animate()
      p.expand()
    } else if (!open && !p.isCollapsed()) {
      animate()
      p.collapse()
    }
  }, [open, ref, animate])
  const onResize = (s: PanelSize, _id?: string | number, prev?: PanelSize): void => {
    // only real size changes by the user count: the library also reports the same size when props
    // change, and the in-between sizes of a toggle's glide
    if (animating() || !prev || Math.abs(prev.inPixels - s.inPixels) < 0.5) return
    const collapsed = s.inPixels < 1
    if (collapsed === open) setOpen(!collapsed)
  }
  return { ref, onResize }
}

export default function App(): ReactElement {
  const init = useProject((s) => s.init)
  const settings = useProject((s) => s.settings)
  const setTheme = useUi((s) => s.setTheme)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const chatOpen = useUi((s) => s.chatOpen)
  const setSidebar = useUi((s) => s.setSidebar)
  const setChat = useUi((s) => s.setChat)
  const outerEl = useRef<HTMLDivElement>(null)
  const projectDir = useProject((s) => s.project?.dir ?? null)
  useShortcuts()

  // the chat panel unmounts when hidden, so the draft's project is tracked here
  useEffect(() => {
    useChat.getState().setProject(projectDir)
  }, [projectDir])

  useEffect(() => {
    void init()
  }, [init])
  useEffect(() => {
    if (settings) setTheme(settings.theme, false)
  }, [settings, setTheme])

  // flex-grow transitions only while a toggle animates, so dragging a separator stays direct
  const animateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animateUntil = useRef(0)
  const animate = useCallback(() => {
    const el = outerEl.current
    if (!el) return
    animateUntil.current = Date.now() + 320
    el.classList.add('panes-animating')
    if (animateTimer.current) clearTimeout(animateTimer.current)
    animateTimer.current = setTimeout(() => el.classList.remove('panes-animating'), 280)
  }, [])
  const animating = useCallback(() => Date.now() < animateUntil.current, [])
  const sidebar = useSidePanel(sidebarOpen, setSidebar, animate, animating)
  const chat = useSidePanel(chatOpen, setChat, animate, animating)

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
        <Toolbar />
        <ExportBar />
        {settings ? (
          <Group
            elementRef={outerEl}
            orientation="horizontal"
            className="min-h-0 flex-1 px-1.5 pb-1.5"
            defaultLayout={layoutOf(['sidebar', 'center', 'chat'], settings.panes?.outer)}
            onLayoutChanged={(l) => {
              // a collapsed side panel is a toggle state, not a size worth remembering
              if (!(l.sidebar > 0) || !(l.chat > 0)) return
              void luca.settings.savePanes('outer', [l.sidebar, l.center, l.chat])
            }}
          >
            <Panel
              id="sidebar"
              panelRef={sidebar.ref}
              onResize={sidebar.onResize}
              collapsible
              collapsedSize={0}
              defaultSize={280}
              minSize={232}
              maxSize={420}
              className={cn('panel', !sidebarOpen && 'panel-collapsed')}
            >
              <Sidebar />
            </Panel>
            <Separator
              className={sepV}
              onDoubleClick={() => setSidebar(!sidebarOpen)}
              title="Drag to resize · double-click to hide or show"
            />
            <Panel id="center" minSize={480}>
              <Group
                orientation="vertical"
                className="h-full"
                defaultLayout={layoutOf(['viewer', 'timeline'], settings.panes?.center)}
                onLayoutChanged={(l) =>
                  void luca.settings.savePanes('center', [l.viewer, l.timeline])
                }
              >
                <Panel id="viewer" minSize={260} className="panel">
                  <div className="flex h-full flex-col">
                    <div className="min-h-0 flex-1">
                      <Viewer />
                    </div>
                    <Transport />
                  </div>
                </Panel>
                <Separator className={sepH} />
                <Panel
                  id="timeline"
                  defaultSize={280}
                  minSize={200}
                  maxSize={560}
                  className="panel"
                >
                  <Timeline />
                </Panel>
              </Group>
            </Panel>
            <Separator
              className={sepV}
              onDoubleClick={() => setChat(!chatOpen)}
              title="Drag to resize · double-click to hide or show"
            />
            <Panel
              id="chat"
              panelRef={chat.ref}
              onResize={chat.onResize}
              collapsible
              collapsedSize={0}
              defaultSize={368}
              minSize={308}
              maxSize={540}
              className={cn('panel', !chatOpen && 'panel-collapsed')}
            >
              <ErrorBoundary label="the chat">
                <Chat />
              </ErrorBoundary>
            </Panel>
          </Group>
        ) : (
          <div className="min-h-0 flex-1" />
        )}
      </div>
      <CommandPalette />
      <NewProjectSheet />
      <ExportSheet />
      <GotoSheet />
      <ShortcutsSheet />
      <CaptionStudio />
      <BackgroundSheet />
      <Toaster
        position="top-center"
        offset={60}
        gap={8}
        toastOptions={{ className: 'luca-toast', duration: 3200 }}
      />
    </TooltipProvider>
  )
}
