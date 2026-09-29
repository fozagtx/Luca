/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the component and drops this line */
import type { ReactElement } from 'react'

export type AudioPreviewProps = {
  voiceId: string
  /** What the play button is called for screen readers, e.g. "Hear Ryan". */
  label?: string
}

/** A play button that plays one voice's sample (one sample at a time, app-wide). */
export function AudioPreview(_props: AudioPreviewProps): ReactElement | null {
  return null
}
