import type { LibraryItem } from '../../../../shared/catalog'
import { catalogChip, type CatalogDrag } from '../../../lib/drag'
import { useChat } from '../../../stores/chat'
import { useUi } from '../../../stores/ui'

export function dragOf(i: LibraryItem): CatalogDrag {
  return { name: i.name, type: i.type, title: i.title, source: i.source }
}

/** Attach an item to the chat composer and hand focus there. */
export function askLuca(i: LibraryItem): void {
  const chat = useChat.getState()
  chat.addChip(catalogChip(dragOf(i)))
  if (!chat.draft.trim()) chat.setDraft(`Add ${i.title} `)
  if (!useUi.getState().chatOpen) useUi.getState().toggleChat()
  requestAnimationFrame(() => document.getElementById('chat-composer')?.focus())
}
