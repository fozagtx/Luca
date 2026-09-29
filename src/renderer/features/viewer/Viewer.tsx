import { MessageSquare, PanelLeftOpen } from 'lucide-react'
import type { ReactElement } from 'react'
import { Tip } from '../../components/ui/tooltip'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'
import { EmptyState } from '../onboarding/EmptyState'
import { Player } from './Player'

const EDGE =
  'pop-in absolute top-3 z-20 flex size-8 items-center justify-center rounded-[9px] border border-border bg-bg/90 text-text-2 shadow-card backdrop-blur transition-[color,transform] duration-150 hover:text-text active:scale-95'

export function Viewer(): ReactElement {
  const project = useProject((s) => s.project)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const chatOpen = useUi((s) => s.chatOpen)
  const setSidebar = useUi((s) => s.setSidebar)
  const setChat = useUi((s) => s.setChat)
  return (
    <div className="relative h-full w-full bg-viewer-bg">
      {project ? (
        <div className="h-full w-full p-6">
          <Player />
        </div>
      ) : (
        <EmptyState />
      )}
      {/* the sidebar works on the open project: Home has nothing for it */}
      {project && !sidebarOpen ? (
        <Tip label="Show sidebar" shortcut="⇧⌘S" side="right">
          <button
            type="button"
            aria-label="Show sidebar"
            className={`${EDGE} left-3`}
            onClick={() => setSidebar(true)}
          >
            <PanelLeftOpen size={15} strokeWidth={1.6} />
          </button>
        </Tip>
      ) : null}
      {!chatOpen ? (
        <Tip label="Show chat" shortcut="⇧⌘C" side="left">
          <button
            type="button"
            aria-label="Show chat"
            className={`${EDGE} right-3`}
            onClick={() => setChat(true)}
          >
            <MessageSquare size={15} strokeWidth={1.6} />
          </button>
        </Tip>
      ) : null}
    </div>
  )
}
