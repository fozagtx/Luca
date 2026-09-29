import { useEffect } from 'react'
import { toast } from 'sonner'
import type { Ai33Notice } from '@shared/ai33'
import { luca } from '../../lib/luca'
import { useChat } from '../../stores/chat'
import { useProject } from '../../stores/project'
import { useQueue } from '../../stores/queue'
import { addedSummary } from './tool-result'

const openProjectId = (): string | undefined => useProject.getState().project?.id

/** A notice about a job in a project that isn't the open one can't act on this chat. */
const isHere = (n: Ai33Notice): boolean => !n.projectId || n.projectId === openProjectId()

function show(n: Ai33Notice): void {
  const action = isHere(n) ? n.action : undefined
  toast(n.text, {
    id: `ai33-${n.id}`,
    // something finished for you to add stays until you answer, like the update toast; it can
    // also just be closed (a job for a project you have left has nothing to answer)
    duration: action ? Infinity : 8000,
    closeButton: true,
    // sonner's close button is drawn in light greys; this keeps it in Luca's colors in dark mode too
    classNames: { closeButton: 'bg-bg! border-border! text-text-2! hover:text-text!' },
    ...(action
      ? {
          action: {
            label: action.label,
            onClick: () => {
              // the project may have changed since the toast came up
              if (!isHere(n)) toast('Open that project, then ask Luca to add it')
              else useQueue.getState().enqueue(action.request, [], 'typed')
            }
          }
        }
      : {})
  })
}

/**
 * Tells you what ai33 did while you were elsewhere: a toast when a job that outlived its wait is
 * ready (with an action to add it), and one after a turn that put sound on the timeline (with
 * Undo).
 */
export function useAi33Notices(): void {
  useEffect(() => {
    const off = luca.ai33.onNotice(show)
    // a reply that stops being pending is a turn that has ended: only then is there something to
    // undo, and never a toast while Luca is still working
    const unsubscribe = useChat.subscribe((s, prev) => {
      if (s.messages === prev.messages) return
      const before = prev.messages.findLast((m) => m.role === 'assistant')
      if (!before?.pending) return
      const now = s.messages.findLast((m) => m.id === before.id)
      // a failed turn is not checkpointed, so there would be nothing to undo
      if (!now || now.pending || now.isError) return
      const added = addedSummary(now.parts ?? [])
      if (added)
        toast(`Added ${added}`, {
          id: 'ai33-added',
          action: { label: 'Undo', onClick: () => void luca.history.undo() }
        })
    })
    return () => {
      off()
      unsubscribe()
    }
  }, [])
}
