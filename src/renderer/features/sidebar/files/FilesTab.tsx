import { FileCode2, FileJson2, FileText, Film, FolderOpen } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { Button } from '../../../components/ui/button'
import { luca } from '../../../lib/luca'
import { formatBytes } from '../../../lib/timecode'
import { useProject } from '../../../stores/project'
import { EmptyPane } from '../EmptyPane'

type Entry = Awaited<ReturnType<typeof luca.project.files>>[number]

const icon = (kind: Entry['kind']): ReactElement => {
  const p = { size: 14, strokeWidth: 1.5, className: 'shrink-0 text-text-3' }
  if (kind === 'html') return <FileCode2 {...p} />
  if (kind === 'media') return <Film {...p} />
  if (kind === 'json') return <FileJson2 {...p} />
  return <FileText {...p} />
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

  if (!project) return <EmptyPane title="No project" hint="Drop a video in the viewer to start." />

  const groups = new Map<string, Entry[]>()
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    const arr = groups.get(dir) ?? []
    arr.push(f)
    groups.set(dir, arr)
  }

  return (
    <div className="scroll h-full py-1">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="truncate text-[11px] text-text-3" title={project.dir}>
          {project.dir.replace(/^\/Users\/[^/]+/, '~')}
        </span>
        <Button
          variant="icon"
          className="h-6 w-6"
          aria-label="Reveal in Finder"
          onClick={() => luca.project.revealInFinder()}
        >
          <FolderOpen size={14} strokeWidth={1.5} />
        </Button>
      </div>
      {[...groups.entries()].map(([dir, entries]) => (
        <div key={dir || '.'} className="mb-1">
          {dir && (
            <div className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-text-3">{dir}/</div>
          )}
          {entries.map((f) => {
            const name = f.path.slice(f.path.lastIndexOf('/') + 1)
            const hot = changed.has(f.path)
            return (
              <button
                key={f.path}
                type="button"
                className="group flex w-full items-center gap-2 px-3 py-[3px] text-left hover:bg-hover"
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
                <span className="text-[11px] text-text-3">{formatBytes(f.size)}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
