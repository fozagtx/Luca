import { Captions, LayoutGrid, Lightbulb, Palette } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { ErrorBoundary } from '../../components/ui/error-boundary'
import { Segmented, type SegmentedItem } from '../../components/ui/segmented'
import { useUi, type SidebarTab } from '../../stores/ui'
import { CatalogTab } from './catalog/CatalogTab'
import { InspirationTab } from './inspiration/InspirationTab'
import { LooksTab } from './looks/LooksTab'
import { TranscriptTab } from './transcript/TranscriptTab'

const tabs: (SegmentedItem<SidebarTab> & { title: string })[] = [
  {
    id: 'inspiration',
    label: 'Inspiration',
    title: 'Inspiration',
    shortcut: '⌘1',
    icon: <Lightbulb size={15} strokeWidth={1.6} />
  },
  {
    id: 'catalog',
    label: 'Catalog',
    title: 'Catalog',
    shortcut: '⌘2',
    icon: <LayoutGrid size={15} strokeWidth={1.6} />
  },
  {
    id: 'transcript',
    label: 'Transcript',
    title: 'Transcript',
    shortcut: '⌘3',
    icon: <Captions size={15} strokeWidth={1.6} />
  },
  {
    id: 'looks',
    label: 'Looks',
    title: 'Looks',
    shortcut: '⌘4',
    icon: <Palette size={15} strokeWidth={1.6} />
  }
]

/** Title row rendered by each tab so its actions sit on the same line as the title. */
export function PaneHead({
  title,
  children
}: {
  title: string
  children?: ReactNode
}): ReactElement {
  return (
    <div className="panel-head">
      <span className="panel-title">{title}</span>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  )
}

export function Sidebar(): ReactElement {
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)
  return (
    <aside className="sidebar-vibrancy flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center px-2">
        <Segmented items={tabs} value={tab} onChange={setTab} icons ariaLabel="Sidebar" />
      </div>
      <div className="min-h-0 flex-1 border-t border-border">
        <ErrorBoundary key={tab} label={`the ${tab} tab`}>
          {tab === 'inspiration' && <InspirationTab />}
          {tab === 'catalog' && <CatalogTab />}
          {tab === 'transcript' && <TranscriptTab />}
          {tab === 'looks' && <LooksTab />}
        </ErrorBoundary>
      </div>
    </aside>
  )
}
