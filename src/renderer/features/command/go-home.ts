import { toast } from 'sonner'
import { luca } from '../../lib/luca'
import { useChat } from '../../stores/chat'
import { errorMessage, useProject } from '../../stores/project'

/** Luca's reply in progress would be stopped: ask first. True to go ahead. */
function leaveWork(question: string): boolean {
  return useChat.getState().state !== 'working' || window.confirm(question)
}

/**
 * Close the project and go back Home (the start card for your next video, recent projects)
 * without quitting. Luca's reply in progress would be stopped, so that asks first.
 */
export async function goHome(): Promise<void> {
  const { project, close } = useProject.getState()
  if (!project) return
  if (!leaveWork('Luca is still working on your last request. Go Home and stop it?')) return
  await close()
}

/**
 * Open a project folder (Recent, ⌘O, the palette). One that can't open (moved, deleted, not a
 * Luca project) says why instead of doing nothing, and a Recent one can be taken off the list.
 */
export async function openProject(dir: string): Promise<void> {
  const { project, open, recent } = useProject.getState()
  if (project?.dir === dir) return
  if (
    project &&
    !leaveWork('Luca is still working on your last request. Open the other project and stop it?')
  )
    return
  try {
    await open(dir)
  } catch (err) {
    const listed = recent.some((r) => r.dir === dir)
    toast.error('Couldn’t open the project', {
      description: errorMessage(err),
      ...(listed
        ? {
            action: {
              label: 'Remove from Recent',
              onClick: () => void luca.project.forget(dir)
            }
          }
        : {})
    })
  }
}
