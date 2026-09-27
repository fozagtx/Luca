import type { Background } from '@shared/types'
import { backgroundChip } from '../../stores/backgrounds'
import { useChat } from '../../stores/chat'
import { useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'

const focus = (id: string): void => {
  requestAnimationFrame(() => document.getElementById(id)?.focus())
}

/**
 * Use a background: in a project it goes to Luca with a request to put it in (the person can
 * change the words before sending); on Home it waits on the start card for the new video. One
 * background at a time, so a new pick replaces the last one.
 */
export function pickBackground(b: Background): void {
  const chat = useChat.getState()
  const others = chat.chips.filter((c) => c.kind !== 'background')
  if (others.length !== chat.chips.length) useChat.setState({ chips: others })
  if (!useProject.getState().project) {
    useChat.getState().addChip(backgroundChip(b))
    focus('start-prompt')
    return
  }
  useChat.getState().fillDraft('Use this as the background of the video ', backgroundChip(b))
  if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
  focus('chat-composer')
}

/** Have Luca restyle a background with Gemini: the person finishes the sentence with the look. */
export function restyleBackground(b: Background): void {
  const chat = useChat.getState()
  const others = chat.chips.filter((c) => c.kind !== 'background')
  if (others.length !== chat.chips.length) useChat.setState({ chips: others })
  useChat.getState().fillDraft('Restyle this background to look like ', backgroundChip(b))
  if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
  focus('chat-composer')
}

/** Ask Luca to find a background that suits the open video. */
export function askLucaToPick(): void {
  useChat.getState().fillDraft('Find a background that suits this video and put it in ')
  if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
  focus('chat-composer')
}
