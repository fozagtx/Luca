import { useEffect, type ReactElement } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { TooltipProvider } from './components/ui/tooltip'
import { Chat } from './features/chat/Chat'
import { CommandPalette } from './features/command/CommandPalette'
import { GotoSheet } from './features/command/GotoSheet'
import { useShortcuts } from './features/command/useShortcuts'
import { NewProjectSheet } from './features/onboarding/NewProjectSheet'
import { Sidebar } from './features/sidebar/Sidebar'
import { Timeline } from './features/timeline/Timeline'
import { Toolbar } from './features/toolbar/Toolbar'
import { Transport } from './features/viewer/Transport'
import { Viewer } from './features/viewer/Viewer'
import { luca } from './lib/luca'
import { useProject } from './stores/project'
import { useUi } from './stores/ui'

const sep = 'group relative shrink-0 bg-border outline-none'
const sepV = `${sep} w-px cursor-col-resize before:absolute before:inset-y-0 before:-left-1 before:-right-1 hover:bg-accent/60 data-[resize-handle-active]:bg-accent`
const sepH = `${sep} h-px cursor-row-resize before:absolute before:inset-x-0 before:-top-1 before:-bottom-1 hover:bg-accent/60 data-[resize-handle-active]:bg-accent`

export default function App(): ReactElement {
  const init = useProject((s) => s.init)
  const settings = useProject((s) => s.settings)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const chatOpen = useUi((s) => s.chatOpen)
  useShortcuts()

  useEffect(() => {
    void init()
  }, [init])

  const panes = settings?.panes ?? {}
  const outer = panes.outer ?? []
  const center = panes.center ?? []

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
        <Toolbar />
        <Group
          key={`${sidebarOpen}-${chatOpen}`}
          orientation="horizontal"
          className="min-h-0 flex-1"
          onLayoutChanged={(l) =>
            luca.settings.savePanes('outer', [l.sidebar ?? 0, l.center ?? 0, l.chat ?? 0])
          }
        >
          {sidebarOpen && (
            <>
              <Panel id="sidebar" defaultSize={outer[0] || 248} minSize={200} maxSize={360}>
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
              <Panel id="viewer" minSize={240}>
                <div className="flex h-full flex-col">
                  <div className="min-h-0 flex-1">
                    <Viewer />
                  </div>
                  <Transport />
                </div>
              </Panel>
              <Separator className={sepH} />
              <Panel id="timeline" defaultSize={center[1] || 280} minSize={180} maxSize={520}>
                <Timeline />
              </Panel>
            </Group>
          </Panel>
          {chatOpen && (
            <>
              <Separator className={sepV} />
              <Panel id="chat" defaultSize={outer[2] || 380} minSize={320} maxSize={520}>
                <Chat />
              </Panel>
            </>
          )}
        </Group>
      </div>
      <CommandPalette />
      <NewProjectSheet />
      <GotoSheet />
    </TooltipProvider>
  )
}
