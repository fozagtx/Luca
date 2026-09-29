import { Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../../../components/ui/button'
import { Tip } from '../../../components/ui/tooltip'
import { useBroll } from '../../../stores/broll'
import { useChat } from '../../../stores/chat'
import { useProject } from '../../../stores/project'
import { askLucaToPick, pickBroll } from '../../broll/actions'
import { BrollBrowser } from '../../broll/BrollBrowser'
import { EmptyPane } from '../EmptyPane'
import { PaneHead } from '../Sidebar'

export function BrollTab(): ReactElement {
  const hasProject = useProject((s) => !!s.project)
  const hasKey = useBroll((s) => s.hasKey)
  const picked = useChat((s) => s.chips.find((c) => c.kind === 'broll')?.id)
  return (
    <div className="flex h-full flex-col">
      <PaneHead title="B-roll">
        {hasProject && hasKey ? (
          <Tip label="Luca finds pictures of what you talk about and cuts to them">
            <Button size="sm" variant="ghost" onClick={askLucaToPick}>
              <Sparkles size={12} strokeWidth={1.9} /> Let Luca pick
            </Button>
          </Tip>
        ) : null}
      </PaneHead>
      {hasProject ? (
        <BrollBrowser
          onPick={pickBroll}
          pickedId={picked}
          hint="Click one, then say where or just send"
        />
      ) : (
        <EmptyPane
          title="Add your video first"
          hint="Luca finds B-roll of what you talk about once your video or voiceover is in."
        />
      )}
    </div>
  )
}
