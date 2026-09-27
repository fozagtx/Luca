import { Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../../../components/ui/button'
import { Tip } from '../../../components/ui/tooltip'
import { useBackgrounds } from '../../../stores/backgrounds'
import { useChat } from '../../../stores/chat'
import { useGemini } from '../../../stores/gemini'
import { useProject } from '../../../stores/project'
import { askLucaToPick, pickBackground, restyleBackground } from '../../backgrounds/actions'
import { BackgroundBrowser } from '../../backgrounds/BackgroundBrowser'
import { PaneHead } from '../Sidebar'

export function BackgroundsTab(): ReactElement {
  const hasProject = useProject((s) => !!s.project)
  const hasKey = useBackgrounds((s) => s.hasKey)
  const picked = useChat((s) => s.chips.find((c) => c.kind === 'background')?.id)
  const gemini = useGemini((s) => s.hasKey)
  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Backgrounds">
        {hasProject && hasKey ? (
          <Tip label="Luca looks at your video and picks a background that suits it">
            <Button size="sm" variant="ghost" onClick={askLucaToPick}>
              <Sparkles size={12} strokeWidth={1.9} /> Let Luca pick
            </Button>
          </Tip>
        ) : null}
      </PaneHead>
      <BackgroundBrowser
        onPick={pickBackground}
        onRestyle={hasProject && gemini ? restyleBackground : undefined}
        pickedId={picked}
        hint={hasProject ? 'Click to use it' : 'Click to start on it'}
      />
    </div>
  )
}
