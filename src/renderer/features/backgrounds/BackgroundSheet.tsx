import type { ReactElement } from 'react'
import { Sheet } from '../../components/ui/sheet'
import { cn } from '../../lib/cn'
import { useBackgrounds } from '../../stores/backgrounds'
import { useChat } from '../../stores/chat'
import { useGemini } from '../../stores/gemini'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'
import { pickBackground, restyleBackground } from './actions'
import { BackgroundBrowser } from './BackgroundBrowser'

/** The background picker opened from the start card (and the command palette). */
export function BackgroundSheet(): ReactElement {
  const open = useUi((s) => s.backgroundsOpen)
  const setOpen = useUi((s) => s.setBackgrounds)
  const hasProject = useProject((s) => !!s.project)
  const hasKey = useBackgrounds((s) => s.hasKey)
  const picked = useChat((s) => s.chips.find((c) => c.kind === 'background')?.id)
  const gemini = useGemini((s) => s.hasKey)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      width={760}
      title="Choose a background"
      description={
        hasProject
          ? 'Free photos and short videos from Pexels. Luca puts the one you pick behind your video.'
          : 'Free photos and short videos from Pexels. Your new video starts on the one you pick, or leave it to Luca.'
      }
    >
      {/* the grid scrolls inside a fixed height; the connect card is only as tall as itself */}
      <div
        className={cn(
          '-mx-5 -mb-4 flex flex-col',
          hasKey !== false && 'h-[min(620px,calc(100vh-190px))]'
        )}
      >
        <BackgroundBrowser
          columns={3}
          autoFocus
          pickedId={picked}
          hint="Click one to use it"
          onPick={(b) => {
            pickBackground(b)
            setOpen(false)
          }}
          onRestyle={
            hasProject && gemini
              ? (b) => {
                  restyleBackground(b)
                  setOpen(false)
                }
              : undefined
          }
        />
      </div>
    </Sheet>
  )
}
