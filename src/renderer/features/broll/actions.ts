import type { Background } from '@shared/types'
import { brollChip } from '../../stores/broll'
import { useChat } from '../../stores/chat'
import { useUi } from '../../stores/ui'

/** Open the chat if it's hidden and put the caret in the message box. */
const focusComposer = (): void => {
  if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
  requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
}

/**
 * Use a photo or clip as B-roll: it goes to Luca with a request to show it (the person can say
 * where before sending; the playhead goes with the message). One pick at a time, so a new pick
 * replaces the last one.
 */
export function pickBroll(b: Background): void {
  const chat = useChat.getState()
  const others = chat.chips.filter((c) => c.kind !== 'broll')
  if (others.length !== chat.chips.length) useChat.setState({ chips: others })
  useChat.getState().fillDraft('Show this as B-roll ', brollChip(b))
  focusComposer()
}

/** Ask Luca to find B-roll for what is said in the open video. */
export function askLucaToPick(): void {
  useChat.getState().fillDraft('Add B-roll of the things I talk about ')
  focusComposer()
}
