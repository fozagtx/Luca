import type { ReactElement } from 'react'
import { useProject } from '../../stores/project'

export function Timeline(): ReactElement {
  const project = useProject((s) => s.project)
  return (
    <div className="flex h-full items-center justify-center bg-bg-subtle text-[12px] text-text-3">
      {project ? 'Timeline' : 'Open a project to see its timeline'}
    </div>
  )
}
