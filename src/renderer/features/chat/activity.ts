import { describeActivity, type Activity } from '../../../shared/activity'
import type { ChatContentPart, ChatMessage } from '../../../shared/types'

export type ToolPart = Extract<ChatContentPart, { type: 'tool' }>

/**
 * Parts saved before activities existed get one rebuilt from what was stored. `detail` is the
 * tool input only while a step runs (it is replaced by the output when it finishes), so a
 * finished part is described from `summary`, which is always built from the input.
 */
export function activityOf(p: ToolPart): Activity {
  if (p.activity) return p.activity
  if (p.status === 'running' && p.name !== 'Edit' && p.name !== 'Write') {
    if (p.name === 'Bash') return describeActivity('Bash', { command: p.detail ?? '' })
    try {
      return describeActivity(p.name, JSON.parse(p.detail ?? '{}') as Record<string, unknown>)
    } catch {
      // fall through to the summary
    }
  }
  const file = /^(?:Read|Edited|Wrote) (.+)$/.exec(p.summary)?.[1]
  if (file) return describeActivity(p.name, { file_path: file })
  if (p.name === 'Bash') {
    const hf = /^Ran hyperframes (\w+)/.exec(p.summary)
    const command = hf ? `npx hyperframes ${hf[1]}` : p.summary.replace(/^Ran /, '')
    return describeActivity('Bash', { command })
  }
  return describeActivity(p.name, {})
}

export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * The request Luca is working on and what it is doing right now, in plain words. `waiting`: Luca
 * is stopped on an approval card in the chat.
 */
export function nowOf(messages: ChatMessage[]): { asked: string; doing: string; waiting: boolean } {
  let asked = ''
  let doing = 'Luca is thinking…'
  let waiting = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.pending) {
      const parts = m.parts ?? []
      const last = parts[parts.length - 1]
      if (last?.type === 'text') doing = 'Luca is writing back…'
      else if (last?.type === 'permission' && !last.resolved) {
        doing = 'Waiting for your OK in the chat'
        waiting = true
      } else if (last?.type === 'tool') doing = `${activityOf(last).active}…`
    }
    if (m.role === 'user') {
      asked = m.text
      break
    }
  }
  return { asked, doing, waiting }
}
