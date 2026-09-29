/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the component and drops this line */
import type { ReactElement } from 'react'
import type { Ai33Voice } from '@shared/ai33'

export type VoiceChoicesProps = {
  voices: Ai33Voice[]
  /** "Use this voice" on a row. */
  onUse(v: Ai33Voice): void
  selectedId?: string
}

/** Voices to listen to and choose from, under a finished voice search in the chat. */
export function VoiceChoices(_props: VoiceChoicesProps): ReactElement | null {
  return null
}
