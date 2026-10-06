import { useEffect } from 'react'
import { toast } from 'sonner'
import type { UpdateStatus } from '@shared/types'
import { luca } from '../../lib/luca'
import { useUpdates } from '../../stores/updates'

/**
 * Tells you about updates wherever you are: a toast with Restart once a newer Luca is
 * downloaded, one to move Luca to Applications when it can't update itself where it runs, and
 * one on the first start after an update.
 */
export function useUpdateNotices(): void {
  useEffect(() => {
    let told: string | null = null
    let greeted = false
    const onStatus = (s: UpdateStatus): void => {
      useUpdates.setState({ status: s })
      if (s.updatedFrom && !greeted) {
        greeted = true
        toast.success(`Luca is updated to ${s.current}`, {
          // one toast even when the status arrives twice (the first answer and an event)
          id: 'luca-updated',
          description: `From ${s.updatedFrom}. Everything you had open is as you left it.`
        })
      }
      if (!s.version || told === s.version) return
      if (s.state === 'ready') {
        told = s.version
        toast(`Luca ${s.version} is ready`, {
          id: 'luca-update',
          description: 'Restart to use it, or keep working: it goes in when you quit.',
          duration: Infinity,
          action: { label: 'Restart', onClick: () => void useUpdates.getState().install() }
        })
      } else if (s.state === 'available' && s.needsMove) {
        told = s.version
        toast(`Luca ${s.version} is out`, {
          id: 'luca-update',
          description: 'Move Luca to Applications so it can update itself.',
          duration: Infinity,
          action: {
            label: 'Move',
            onClick: () => void useUpdates.getState().moveToApplications()
          }
        })
      }
    }
    void luca.updates
      .status()
      .then(onStatus)
      .catch(() => undefined)
    return luca.updates.onStatus(onStatus)
  }, [])
}
