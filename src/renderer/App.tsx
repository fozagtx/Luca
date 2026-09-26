import { useEffect, type ReactElement } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { ErrorBoundary } from './components/ui/error-boundary'
import { TooltipProvider } from './components/ui/tooltip'
import { Chat } from './features/chat/Chat'
import { CommandPalette } from './features/command/CommandPalette'
import { GotoSheet } from './features/command/GotoSheet'
import { useShortcuts } from './features/command/useShortcuts'
import { ExportBar, ExportSheet } from './features/export/ExportSheet'
import { NewProjectSheet } from './features/onboarding/NewProjectSheet'
import { Sidebar } from './features/sidebar/Sidebar'
import { Timeline } from './features/timeline/Timeline'
import { Toolbar } from './features/toolbar/Toolbar'
import { Transport } from './features/viewer/Transport'
import { Viewer } from './features/viewer/Viewer'
import { luca } from './lib/luca'
import { useChat } from './stores/chat'
import { useProject } from './stores/project'
import { useUi } from './stores/ui'

const sep =
  'group relative shrink-0 rounded-full bg-transparent outline-none transition-colors duration-150 hover:bg-accent/50 data-[resize-handle-active]:bg-accent'
const sepV = `${sep} w-1 cursor-col-resize before:absolute before:inset-y-0 before:-left-1 before:-right-1`
const sepH = `${sep} h-1 cursor-row-resize before:absolute before:inset-x-0 before:-top-1 before:-bottom-1`

export default function App(): ReactElement {
  const init = useProject((s) => s.init)
  const settings = useProject((s) => s.settings)
  const setTheme = useUi((s) => s.setTheme)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const chatOpen = useUi((s) => s.chatOpen)
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

  const panes = settings?.panes ?? {}
  const outer = panes.outer ?? []
  const center = panes.center ?? []

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
        <Toolbar />
        <ExportBar />
        <Group
          key={`${sidebarOpen}-${chatOpen}`}
          orientation="horizontal"
          className="min-h-0 flex-1 px-1.5 pb-1.5"
          onLayoutChanged={(l) =>
            luca.settings.savePanes('outer', [l.sidebar ?? 0, l.center ?? 0, l.chat ?? 0])
          }
        >
          {sidebarOpen && (
            <>
              <Panel
                id="sidebar"
                defaultSize={outer[0] || 272}
                minSize={220}
                maxSize={400}
                className="panel"
              >
                <Sidebar />
              </Panel>
              <Separator className={sepV} />
            </>
          )}
          <Panel id="center" minSize={480}>
            <Group
              orientation="vertical"
              className="h-full"
              onLayoutChanged={(l) =>
                luca.settings.savePanes('center', [l.viewer ?? 0, l.timeline ?? 0])
              }
            >
              <Panel id="viewer" minSize={240} className="panel">
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
                defaultSize={center[1] || 260}
                minSize={180}
                maxSize={520}
                className="panel"
              >
                <Timeline />
              </Panel>
            </Group>
          </Panel>
          {chatOpen && (
            <>
              <Separator className={sepV} />
              <Panel
                id="chat"
                defaultSize={outer[2] || 360}
                minSize={300}
                maxSize={520}
                className="panel"
              >
                <ErrorBoundary label="the chat">
                  <Chat />
                </ErrorBoundary>
              </Panel>
            </>
          )}
        </Group>
      </div>
      <CommandPalette />
      <NewProjectSheet />
      <ExportSheet />
      <GotoSheet />
    </TooltipProvider>
  )
}
