import { FileCode2, FileJson2, FileText, Film, FolderOpen } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { Button } from '../../../components/ui/button'
import { Tip } from '../../../components/ui/tooltip'
import { luca } from '../../../lib/luca'
import { formatBytes } from '../../../lib/timecode'
import { useProject } from '../../../stores/project'
import { PaneHead } from '../Sidebar'

type Entry = Awaited<ReturnType<typeof luca.project.files>>[number]

const icon = (kind: Entry['kind']): ReactElement => {
  const p = { size: 14, strokeWidth: 1.6, className: 'shrink-0' }
  if (kind === 'html') return <FileCode2 {...p} className="shrink-0 text-[#e0742f]" />
  if (kind === 'media') return <Film {...p} className="shrink-0 text-[#8b5cf6]" />
  if (kind === 'json') return <FileJson2 {...p} className="shrink-0 text-[#d4a017]" />
  return <FileText {...p} className="shrink-0 text-text-3" />
}

export function FilesTab(): ReactElement {
  const project = useProject((s) => s.project)
  const version = useProject((s) => s.version)
  const [files, setFiles] = useState<Entry[]>([])
  const [hotVersion, setHotVersion] = useState(0)
  const changedPaths = useProject((s) => s.changedPaths)
  const changed = hotVersion === version && version > 0 ? new Set(changedPaths) : new Set<string>()

  useEffect(() => {
    let live = true
    const p = project ? luca.project.files().catch((): Entry[] => []) : Promise.resolve<Entry[]>([])
    void p.then((list) => live && setFiles(list))
    return () => {
      live = false
    }
  }, [project, version])

  useEffect(() => {
    if (version === 0) return
    const show = setTimeout(() => setHotVersion(version), 0)
    const hide = setTimeout(() => setHotVersion(0), 1500)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [version])

  if (!project) return <></>

  const groups = new Map<string, Entry[]>()
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    const arr = groups.get(dir) ?? []
    arr.push(f)
    groups.set(dir, arr)
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Files">
        <Tip label="Reveal in Finder">
          <Button
            variant="icon"
            className="h-6 w-6"
            aria-label="Reveal in Finder"
            onClick={() => luca.project.revealInFinder()}
          >
            <FolderOpen size={14} strokeWidth={1.5} />
          </Button>
        </Tip>
      </PaneHead>
      <div
        className="truncate px-3 pt-2 pb-1 font-mono text-[10.5px] text-text-3"
        title={project.dir}
      >
        {project.dir.replace(/^\/Users\/[^/]+/, '~')}
      </div>
      <div className="scroll flex-1 py-1">
        {[...groups.entries()].map(([dir, entries]) => (
          <div key={dir || '.'} className="mb-1">
            {dir && (
              <div className="px-3 pt-2 pb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-text-3">
                {dir}
              </div>
            )}
            {entries.map((f) => {
              const name = f.path.slice(f.path.lastIndexOf('/') + 1)
              const hot = changed.has(f.path)
              return (
                <button
                  key={f.path}
                  type="button"
                  className="group mx-1.5 flex w-[calc(100%-12px)] items-center gap-2 rounded-[5px] px-1.5 py-[4px] text-left transition-colors hover:bg-hover active:bg-press"
                  onDoubleClick={() => luca.project.revealInFinder(f.path)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', f.path)
                    e.dataTransfer.setData('application/x-luca-file', f.path)
                  }}
                >
                  {icon(f.kind)}
                  <span
                    className={
                      hot
                        ? 'flex-1 truncate text-[12px] text-accent transition-colors'
                        : 'flex-1 truncate text-[12px] text-text transition-colors duration-700'
                    }
                  >
                    {name}
                  </span>
                  <span className="font-mono text-[10.5px] tabular-nums text-text-3">
                    {formatBytes(f.size)}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
