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

/** A script has no file to copy: the voiceover is recorded first, then the project is built. */
const SCRIPT_STEPS: Step[] = [
  { id: 'voiceover', label: 'Recording your voiceover' },
  { id: 'scaffolding', label: 'Building the timeline' },
  { id: 'starting', label: 'Opening the project' }
]

/** Where the stages main reports land in a script's shorter list. */
const SCRIPT_STAGE: Partial<Record<CreateProgress['stage'], string>> = {
  preparing: 'voiceover',
  voiceover: 'voiceover',
  copying: 'scaffolding',
  scaffolding: 'scaffolding',
  media: 'scaffolding',
  starting: 'starting'
}

/** The real stages of making a project, as main reports them. */
export function CreateProgressList({
  kind,
  script = false,
  progress,
  seen = [],
  since
}: {
  kind: StartKind
  /** The voiceover is being recorded from a script, so the steps are its own. */
  script?: boolean
  progress: CreateProgress | null
  /** Stages reached so far; an error marks the last of them. */
  seen?: CreateProgress['stage'][]
  since?: number
}): ReactElement {
  const steps = script ? SCRIPT_STEPS : STEPS[kind]
  const stage = progress?.stage ?? 'preparing'
  // the stage as a step of this list: a script folds several stages into one step
  const stepOf = (s: CreateProgress['stage']): string | undefined =>
    script ? SCRIPT_STAGE[s] : steps.find((x) => x.id === s)?.id
  const current =
    stage === 'done'
      ? null
      : stage === 'error'
        ? ([...seen].reverse().map(stepOf).find(Boolean) ?? steps[0].id)
        : (stepOf(stage) ?? steps[0].id)
  const label = steps.find((s) => s.id === current)?.label
  return (
    <div>
      {/* said once per step, not on every percent: the list below moves all the time */}
      <span role="status" className="sr-only">
        {label ? `${label}${progress?.message ? `, ${progress.message}` : ''}` : ''}
      </span>
      <StepList
        steps={steps}
        current={current}
        failed={stage === 'error'}
        progress={progress?.progress}
        since={since}
        detail={progress?.message}
      />
    </div>
  )
}
