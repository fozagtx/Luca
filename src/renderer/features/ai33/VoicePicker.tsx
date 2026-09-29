/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the component and drops this line */
import type { ReactElement } from 'react'
import type { VoiceRef } from '@shared/ai33'

export type VoicePickerProps = {
  value: VoiceRef | null
  onChange(v: VoiceRef): void
  /** Voices for this language first. */
  language?: string
  open?: boolean
  onOpenChange?(open: boolean): void
}

/** Search, filter and hear every voice, and pick one (the start card's "More voices…"). */
export function VoicePicker(_props: VoicePickerProps): ReactElement | null {
  return null
}
