import { Clapperboard, FolderOpen, Plus } from 'lucide-react'
import { useState, type DragEvent, type ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { luca } from '../../lib/luca'
import { cn } from '../../lib/cn'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

const VIDEO = /\.(mp4|mov|m4v|webm)$/i

export function EmptyState(): ReactElement {
  const recent = useProject((s) => s.recent)
  const open = useProject((s) => s.open)
  const loading = useProject((s) => s.loading)
  const setNewProject = useUi((s) => s.setNewProject)
  const [over, setOver] = useState(false)

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const file = [...e.dataTransfer.files].find((f) => VIDEO.test(f.name))
    if (!file) return
    setNewProject({ file: luca.project.pathForFile(file) })
  }

  const pick = async (): Promise<void> => {
    const file = await luca.project.pickVideo()
    if (file) setNewProject({ file })
  }

  const openDir = async (): Promise<void> => {
    const dir = await luca.project.pickProjectDir()
    if (dir) await open(dir)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex w-[440px] flex-col items-center gap-3 rounded-[10px] border border-dashed bg-bg px-8 py-10 text-center transition-colors duration-150',
          over ? 'border-accent bg-accent/[0.04]' : 'border-black/15'
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-muted text-text-2">
          <Clapperboard size={18} strokeWidth={1.5} />
        </div>
        <div className="text-[20px] font-semibold tracking-[-0.01em] text-text">
          Drop a video to start
        </div>
        <div className="text-[13px] text-text-2">
          MP4, MOV, M4V or WebM. Luca keeps the original untouched.
        </div>
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={pick} disabled={loading}>
            <Plus size={14} strokeWidth={1.75} />
            New Project
          </Button>
          <Button onClick={openDir} disabled={loading}>
            <FolderOpen size={14} strokeWidth={1.5} />
            Open…
          </Button>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="w-[640px]">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-3">
            Recent
          </div>
          <div className="grid grid-cols-4 gap-3">
            {recent.slice(0, 8).map((r) => (
              <button
                key={r.dir}
                type="button"
                className="group text-left"
                onClick={() => open(r.dir)}
                disabled={loading}
                title={r.dir}
              >
                <div className="aspect-video w-full overflow-hidden rounded-[6px] bg-black/[0.06] ring-1 ring-black/[0.06] group-hover:ring-accent/60">
                  {r.thumb && <img src={r.thumb} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="mt-1.5 truncate text-[12px] font-medium text-text">{r.name}</div>
                <div className="text-[11px] text-text-3">
                  {r.aspect} · {new Date(r.lastOpenedAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
