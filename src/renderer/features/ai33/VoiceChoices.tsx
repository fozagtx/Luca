import type { Ai33Voice } from '@shared/ai33'
import { useState, type ReactElement } from 'react'
import { VoiceList } from './VoiceList'

export type VoiceChoicesProps = {
  voices: Ai33Voice[]
  /** "Use this voice" on a row. */
  onUse(v: Ai33Voice): void
  selectedId?: string
}

/** The chat has room for a few voices to compare, not a catalogue. */
const MAX_ROWS = 4

/** Voices to listen to and choose from, under a finished voice search in the chat. */
export function VoiceChoices({
  voices,
  onUse,
  selectedId
}: VoiceChoicesProps): ReactElement | null {
  // the one just chosen is marked at once, and a second press can't ask for it twice
  const [picked, setPicked] = useState<string | null>(null)
  // the caller's own idea of the voice in use wins again once it changes
  const [seen, setSeen] = useState(selectedId)
  if (seen !== selectedId) {
    setSeen(selectedId)
    setPicked(null)
  }
  const shown = voices.slice(0, MAX_ROWS)

  if (shown.length === 0) {
    return (
      <p className="mt-1.5 text-[12px] text-text-3" role="status">
        No voices match that. Try fewer words.
      </p>
    )
  }
  return (
    <div className="card mt-1.5 p-1">
      <VoiceList
        groups={[{ key: 'found', voices: shown }]}
        ariaLabel="Voices to choose from"
        useLabel="Use this voice"
        chosenLabel="Chosen"
        selectedId={picked ?? selectedId}
        onUse={(v) => {
          if (v.id === (picked ?? selectedId)) return
          setPicked(v.id)
          onUse(v)
        }}
      />
    </div>
  )
}
