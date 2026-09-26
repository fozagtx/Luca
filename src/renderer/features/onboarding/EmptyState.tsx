import { Film, FolderOpen, Plus } from 'lucide-react'
import { useState, type DragEvent, type ReactElement } from 'react'
import logo from '../../assets/logo.png'
import { AnimatedButton } from '../../components/ui/animated-button'
import { Button } from '../../components/ui/button'
import { Thumb } from '../../components/ui/thumb'
import { luca } from '../../lib/luca'
import { cn } from '../../lib/cn'
import { formatDuration, relativeDate } from '../../lib/format'
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
          'group/drop flex w-[460px] flex-col items-center gap-3 rounded-[14px] border-[1.5px] border-dashed bg-bg px-8 py-11 text-center',
          'transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out',
          'hover:shadow-[inset_0_2px_12px_rgba(0,0,0,0.05)] dark:hover:shadow-[inset_0_2px_12px_rgba(0,0,0,0.4)]',
          over
            ? 'scale-[1.01] border-accent bg-accent/[0.05] shadow-[inset_0_2px_16px_rgba(0,122,255,0.12)]'
            : 'border-border-strong'
        )}
      >
        <img
          src={logo}
          alt="Luca"
          draggable={false}
          className={cn(
            'h-[88px] w-[88px] rounded-[20px] shadow-[0_10px_24px_rgba(0,0,0,0.2)] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]',
            over ? 'scale-105 -rotate-2' : 'group-hover/drop:scale-[1.03]'
          )}
        />
        <div className="mt-1 text-[20px] font-semibold tracking-[-0.015em] text-text">
          {over ? 'Release to start a project' : 'Drop a video to start'}
        </div>
        <div className="max-w-[320px] text-[13px] leading-relaxed text-text-2">
          MP4, MOV, M4V or WebM. Luca keeps the original untouched.
        </div>
        <div className="mt-3 flex gap-2">
          <AnimatedButton onClick={pick} disabled={loading}>
            <Plus size={14} strokeWidth={1.75} />
            New Project
          </AnimatedButton>
          <Button onClick={openDir} disabled={loading}>
            <FolderOpen size={14} strokeWidth={1.5} />
            Open…
          </Button>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="w-[720px]">
          <div className="mb-2.5 flex items-baseline justify-between px-0.5">
            <div className="text-[12px] font-semibold text-text">Recent</div>
            <div className="text-[11px] text-text-3">
              {recent.length} project{recent.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {recent.slice(0, 8).map((r) => (
              <button
                key={r.dir}
                type="button"
                className="card card-hover group overflow-hidden p-1.5 text-left"
                onClick={() => open(r.dir)}
                disabled={loading}
                title={r.dir}
              >
                <Thumb
                  src={r.thumb}
                  lazy={false}
                  className="aspect-video w-full rounded-[6px]"
                  imgClassName="transition-[opacity,transform] duration-300 group-hover:scale-[1.03]"
                  fallback={
                    <div className="flex h-full w-full items-center justify-center text-text-3">
                      <Film size={18} strokeWidth={1.5} />
                    </div>
                  }
                >
                  {r.duration ? (
                    <span className="absolute right-1.5 bottom-1.5 rounded-[4px] bg-black/70 px-1.5 py-[2px] font-mono text-[10px] tabular-nums text-white">
                      {formatDuration(r.duration)}
                    </span>
                  ) : null}
                </Thumb>
                <div className="px-1 pt-2 pb-0.5">
                  <div className="truncate text-[12px] font-medium text-text">{r.name}</div>
                  <div className="mt-px text-[11px] text-text-3">
                    {r.aspect} · {relativeDate(r.lastOpenedAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
