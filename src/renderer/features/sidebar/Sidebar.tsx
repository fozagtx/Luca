import { Captions, FolderOpen, LayoutGrid, Palette } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { useUi, type SidebarTab } from '../../stores/ui'
import { CatalogTab } from './catalog/CatalogTab'
import { FilesTab } from './files/FilesTab'
import { LooksTab } from './looks/LooksTab'
import { TranscriptTab } from './transcript/TranscriptTab'

const tabs: { id: SidebarTab; label: string; shortcut: string; icon: ReactElement }[] = [
  { id: 'files', label: 'Files', shortcut: '⌘1', icon: <FolderOpen size={16} strokeWidth={1.5} /> },
  {
    id: 'catalog',
    label: 'Catalog',
    shortcut: '⌘2',
    icon: <LayoutGrid size={16} strokeWidth={1.5} />
  },
  {
    id: 'transcript',
    label: 'Transcript',
    shortcut: '⌘3',
    icon: <Captions size={16} strokeWidth={1.5} />
  },
  { id: 'looks', label: 'Looks', shortcut: '⌘4', icon: <Palette size={16} strokeWidth={1.5} /> }
]

export function Sidebar(): ReactElement {
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)
  return (
    <aside className="sidebar-vibrancy flex h-full min-w-0 flex-col border-r border-border">
      <div
        role="tablist"
        aria-label="Sidebar"
        className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-2"
      >
        {tabs.map((t) => (
          <Tip key={t.id} label={t.label} shortcut={t.shortcut}>
            <Button
              role="tab"
              aria-selected={tab === t.id}
              aria-label={t.label}
              variant="icon"
              active={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
            </Button>
          </Tip>
        ))}
        <span className="ml-auto pr-1 text-[11px] font-medium text-text-3">
          {tabs.find((t) => t.id === tab)?.label}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'files' && <FilesTab />}
        {tab === 'catalog' && <CatalogTab />}
        {tab === 'transcript' && <TranscriptTab />}
        {tab === 'looks' && <LooksTab />}
      </div>
    </aside>
  )
}
