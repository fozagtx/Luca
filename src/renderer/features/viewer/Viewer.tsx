import type { ReactElement } from 'react'
import { useProject } from '../../stores/project'
import { EmptyState } from '../onboarding/EmptyState'
import { Player } from './Player'

export function Viewer(): ReactElement {
  const project = useProject((s) => s.project)
  return (
    <div className="relative h-full w-full bg-viewer-bg p-6">
      {project ? <Player /> : <EmptyState />}
    </div>
  )
}
