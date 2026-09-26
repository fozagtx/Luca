import { useChat } from '../../stores/chat'
import { useProject } from '../../stores/project'

/**
 * Close the project and go back to the start screen (recent projects, start from anything)
 * without quitting. Luca's reply in progress would be stopped, so that asks first.
 */
export async function goHome(): Promise<void> {
  const { project, close } = useProject.getState()
  if (!project) return
  if (
    useChat.getState().state === 'working' &&
    !window.confirm('Luca is still working on your last request. Go Home and stop it?')
  )
    return
  await close()
}
