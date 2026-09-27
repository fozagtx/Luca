import type { Look } from '@shared/types'
import {
  Captions,
  Film,
  History,
  Lightbulb,
  Palette,
  PanelLeftClose,
  ScrollText
} from 'lucide-react'
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { ErrorBoundary } from '../../components/ui/error-boundary'
import { Thumb } from '../../components/ui/thumb'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { useProject } from '../../stores/project'
import { useUi, type SidebarTab } from '../../stores/ui'
import { CatalogTab } from './catalog/CatalogTab'
import { InspirationTab } from './inspiration/InspirationTab'
import { LooksTab } from './looks/LooksTab'
import { MediaTab } from './media/MediaTab'
import { useProjectMedia } from './media/use-project-media'
import { TranscriptTab } from './transcript/TranscriptTab'

// Luca picks components itself from what you describe, so there is no catalog to browse; the
// Catalog pane (./catalog) stays in the code for when browsing comes back
const PANES: { id: SidebarTab; label: string; shortcut: string; icon: ReactElement }[] = [
  {
    id: 'inspiration',
    label: 'Inspiration',
    shortcut: '⌘1',
    icon: <Lightbulb size={14} strokeWidth={1.6} />
  },
  { id: 'media', label: 'Media', shortcut: '⌘2', icon: <Film size={14} strokeWidth={1.6} /> },
  {
    id: 'transcript',
    label: 'Transcript',
    shortcut: '⌘3',
    icon: <ScrollText size={14} strokeWidth={1.6} />
  },
  { id: 'looks', label: 'Looks', shortcut: '⌘4', icon: <Palette size={14} strokeWidth={1.6} /> }
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
  const setSidebar = useUi((s) => s.setSidebar)
  const setCaptions = useUi((s) => s.setCaptions)
  const setHistory = useUi((s) => s.setHistory)
  const project = useProject((s) => s.project)
  const media = useProjectMedia()
  const looks = useLooks()
  const counts: Partial<Record<SidebarTab, number>> = {
    ...(media ? { media: media.length } : {}),
    ...(looks ? { looks: looks.all.length } : {})
  }
  const active = looks?.active ?? null

  return (
    <aside className="sidebar-vibrancy flex h-full min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 pr-2 pl-3.5">
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-text-3 uppercase">
          Project
        </span>
        <Tip label="Hide sidebar" shortcut="⇧⌘S">
          <button
            type="button"
            aria-label="Hide sidebar"
            onClick={() => setSidebar(false)}
            className="icon-btn ml-auto"
          >
            <PanelLeftClose size={15} strokeWidth={1.6} />
          </button>
        </Tip>
      </div>
      <nav aria-label="Project" className="flex shrink-0 flex-col gap-px px-2 pb-2">
        {PANES.slice(0, 3).map((p) => (
          <NavRow
            key={p.id}
            icon={p.icon}
            label={p.label}
            shortcut={p.shortcut}
            count={counts[p.id]}
            active={tab === p.id}
            onClick={() => setTab(p.id)}
          />
        ))}
        <NavRow
          icon={<Captions size={14} strokeWidth={1.6} />}
          label="Captions"
          hint="Styles and fonts"
          disabled={!project}
          onClick={() => setCaptions(true)}
        />
        {PANES.slice(3).map((p) => (
          <NavRow
            key={p.id}
            icon={p.icon}
            label={p.label}
            shortcut={p.shortcut}
            count={counts[p.id]}
            active={tab === p.id}
            onClick={() => setTab(p.id)}
          />
        ))}
        <NavRow
          icon={<History size={14} strokeWidth={1.6} />}
          label="History"
          hint="Every version, restore any"
          shortcut="⌘Y"
          disabled={!project}
          onClick={() => setHistory(true)}
        />
      </nav>
      <div className="min-h-0 flex-1 border-t border-border">
        <ErrorBoundary key={tab} label={`the ${tab} tab`}>
          {tab === 'inspiration' && <InspirationTab />}
          {tab === 'media' && <MediaTab />}
          {tab === 'catalog' && <CatalogTab />}
          {tab === 'transcript' && <TranscriptTab />}
          {tab === 'looks' && <LooksTab />}
        </ErrorBoundary>
      </div>
      {project && active ? (
        <button
          type="button"
          onClick={() => setTab('looks')}
          className="card card-hover mx-2.5 mb-2.5 flex shrink-0 items-center gap-2.5 p-2 text-left"
        >
          <Thumb src={active.thumb} lazy={false} className="h-9 w-14 shrink-0 rounded-[6px]" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold tracking-[0.06em] text-text-3 uppercase">
              Look
            </span>
            <span className="block truncate text-[12.5px] font-medium text-text">
              {active.name}
            </span>
          </span>
        </button>
      ) : null}
    </aside>
  )
}

/** One row of the project list: a pane of the sidebar, or a tool that opens on top. */
function NavRow({
  icon,
  label,
  hint,
  shortcut,
  count,
  active,
  disabled,
  onClick
}: {
  icon: ReactElement
  label: string
  hint?: string
  shortcut?: string
  count?: number
  active?: boolean
  disabled?: boolean
  onClick: () => void
}): ReactElement {
  const row = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-[12.5px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45',
        active
          ? 'bg-secondary font-medium text-secondary-fg shadow-[inset_0_0_0_1px_var(--secondary-border)]'
          : 'text-text-2 hover:bg-hover hover:text-text'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined ? (
        <span
          className={cn(
            'font-mono text-[10.5px] tabular-nums',
            active ? 'text-secondary-fg' : 'text-text-3'
          )}
        >
          {String(count).padStart(2, '0')}
        </span>
      ) : null}
    </button>
  )
  return hint || shortcut ? (
    <Tip label={hint ?? label} shortcut={shortcut} side="right">
      {row}
    </Tip>
  ) : (
    row
  )
}

type LookCard = Look & { thumb: string | null }

/** Saved Looks and the one this project uses, refreshed as the project changes. */
function useLooks(): { all: LookCard[]; active: LookCard | null } | null {
  const project = useProject((s) => s.project)
  const version = useProject((s) => s.version)
  const tab = useUi((s) => s.tab)
  const [looks, setLooks] = useState<{ all: LookCard[]; active: LookCard | null } | null>(null)
  useEffect(() => {
    let live = true
    void Promise.all([luca.looks.list(), project ? luca.looks.active() : null])
      .then(([all, slug]) => {
        if (live) setLooks({ all, active: all.find((l) => l.slug === slug) ?? null })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [project, version, tab])
  return looks
}
