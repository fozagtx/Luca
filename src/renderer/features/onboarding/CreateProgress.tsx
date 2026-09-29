import type { CreateProgress, StartKind } from '@shared/types'
import type { ReactElement } from 'react'
import { StepList, type Step } from '../../components/ui/progress'

const STEPS: Record<StartKind, Step[]> = {
  video: [
    { id: 'preparing', label: 'Getting ready' },
    { id: 'copying', label: 'Copying your video (the original stays untouched)' },
    { id: 'scaffolding', label: 'Building the timeline' },
    { id: 'starting', label: 'Opening the project' }
  ],
  audio: [
    { id: 'preparing', label: 'Getting ready' },
    { id: 'copying', label: 'Copying your voiceover (the original stays untouched)' },
    { id: 'scaffolding', label: 'Building the timeline' },
    { id: 'starting', label: 'Opening the project' }
  ]
}

/** The real stages of making a project, as main reports them. */
export function CreateProgressList({
  kind,
  progress,
  seen = [],
  since
}: {
  kind: StartKind
  progress: CreateProgress | null
  /** Stages reached so far; an error marks the last of them. */
  seen?: CreateProgress['stage'][]
  since?: number
}): ReactElement {
  const steps = STEPS[kind]
  const stage = progress?.stage ?? 'preparing'
  const known = (id: string): boolean => steps.some((s) => s.id === id)
  const current =
    stage === 'done'
      ? null
      : stage === 'error'
        ? ([...seen].reverse().find(known) ?? steps[0].id)
        : known(stage)
          ? stage
          : 'preparing'
  return (
    <StepList
      steps={steps}
      current={current}
      failed={stage === 'error'}
      progress={progress?.progress}
      since={since}
      detail={progress?.message}
    />
  )
}
