import { useEffect, useState } from 'react'
import { luca } from '../../../lib/luca'
import { useProject } from '../../../stores/project'

/** The footage, images and audio in the project, reloaded whenever the project changes. */
export function useProjectMedia(): string[] | null {
  const project = useProject((s) => s.project)
  const version = useProject((s) => s.version)
  const [media, setMedia] = useState<string[] | null>(null)
  useEffect(() => {
    if (!project) return
    let live = true
    void luca.project
      .files()
      .then((files) => {
        if (live)
          setMedia(
            files
              .filter((f) => f.kind === 'media' && !f.path.startsWith('renders/'))
              .map((f) => f.path)
          )
      })
      .catch(() => live && setMedia([]))
    return () => {
      live = false
    }
  }, [project, version])
  return project ? media : null
}
