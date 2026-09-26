import { Captions, Clock, FolderOpen, LayoutGrid, Palette } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { Segmented, type SegmentedItem } from '../../components/ui/segmented'
import { useProject } from '../../stores/project'
import { useUi, type SidebarTab } from '../../stores/ui'
import { formatDuration, relativeDate } from '../../lib/format'
import { CatalogTab } from './catalog/CatalogTab'
import { FilesTab } from './files/FilesTab'
import { LooksTab } from './looks/LooksTab'
import { TranscriptTab } from './transcript/TranscriptTab'

const tabs: (SegmentedItem<SidebarTab> & { title: string })[] = [
  {
    id: 'files',
    label: 'Files',
    title: 'Project files',
    shortcut: '⌘1',
    icon: <FolderOpen size={15} strokeWidth={1.6} />
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

function RecentList(): ReactElement {
  const recent = useProject((s) => s.recent)
  const open = useProject((s) => s.open)
  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Recent" />
      {recent.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <Clock size={18} strokeWidth={1.5} className="text-text-3" />
          <div className="text-[12px] text-text-3">Projects you open will show up here.</div>
        </div>
      ) : (
        <ul className="scroll flex-1 p-1.5">
          {recent.map((r) => (
            <li key={r.dir}>
              <button
                type="button"
                className="group flex w-full items-center gap-2.5 rounded-[6px] px-1.5 py-1.5 text-left transition-colors hover:bg-hover active:bg-press"
                onClick={() => void open(r.dir)}
              >
                <div className="relative h-8 w-14 shrink-0 overflow-hidden rounded-[4px] bg-bg-muted ring-1 ring-border">
                  {r.thumb && <img src={r.thumb} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-text">{r.name}</div>
                  <div className="truncate text-[11px] text-text-3">
                    {relativeDate(r.lastOpenedAt)}
                    {r.duration ? ` · ${formatDuration(r.duration)}` : ''}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Sidebar(): ReactElement {
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)
  const project = useProject((s) => s.project)
  return (
    <aside className="sidebar-vibrancy flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center px-2">
        <Segmented items={tabs} value={tab} onChange={setTab} icons ariaLabel="Sidebar" />
      </div>
      <div className="min-h-0 flex-1 border-t border-border">
        {tab === 'files' && (project ? <FilesTab /> : <RecentList />)}
        {tab === 'catalog' && <CatalogTab />}
        {tab === 'transcript' && <TranscriptTab />}
        {tab === 'looks' && <LooksTab />}
      </div>
    </aside>
  )
}
