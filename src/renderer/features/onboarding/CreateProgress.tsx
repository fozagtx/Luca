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
  ],
  brief: [
    { id: 'preparing', label: 'Getting ready' },
    { id: 'scaffolding', label: 'Building the timeline' },
    { id: 'starting', label: 'Opening the project' }
  ]
}

/** Shown only when a reference is being studied, before the project opens. */
const STUDYING: Step = { id: 'studying', label: 'Studying your reference' }

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
  const base = STEPS[kind]
  const steps = seen.includes('studying')
    ? [...base.slice(0, -1), STUDYING, base[base.length - 1]]
    : base
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
