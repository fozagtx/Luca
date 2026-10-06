import { describeActivity, type Activity } from '../../../shared/activity'
import type { ChatContentPart, ChatMessage } from '../../../shared/types'

export type ToolPart = Extract<ChatContentPart, { type: 'tool' }>

/**
 * The step's input as `detail` holds it, or undefined when `detail` is its output: history saved
 * before `output` existed replaced the input with the output once a step finished (except Edit
 * and Write). Every step that stops running now gets an `output`, even an empty one.
 */
export function inputOf(p: ToolPart): string | undefined {
  if (p.status === 'running' || p.output !== undefined || p.name === 'Edit' || p.name === 'Write')
    return p.detail
  // the old swap only happened when something came back, and never to a step cut off at the
  // end of a turn, so plenty of old steps still hold their input. A command matches its own
  // summary ("Ran mkdir -p media/x"); other tools' input was their arguments as indented JSON.
  const detail = p.detail ?? ''
  if (p.name === 'Bash') {
    const line = detail.split('\n')[0]
    const hf = /npx\s+hyperframes(?:@[\w.-]+)?\s+(\w+)/.exec(line)
    return p.summary === `Ran ${hf ? hf[1] : line.slice(0, 80)}` ? p.detail : undefined
  }
  return /^\{(?:\}|\n {2}")/.test(detail) ? p.detail : undefined
}

/**
 * Parts saved before activities existed get one rebuilt from what was stored: from the input
 * when `detail` still holds it (see `inputOf`), else from `summary`, which is always built from
 * the input.
 */
export function activityOf(p: ToolPart): Activity {
  if (p.activity) return p.activity
  const input = p.name !== 'Edit' && p.name !== 'Write' ? inputOf(p) : undefined
  if (input) {
    if (p.name === 'Bash') return describeActivity('Bash', { command: input })
    try {
      return describeActivity(p.name, JSON.parse(input) as Record<string, unknown>)
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
 * The request Luca is working on, what it is doing right now in plain words, and the steps of
 * the reply so far. `waiting`: Luca is stopped on an approval card in the chat.
 */
export function nowOf(messages: ChatMessage[]): {
  asked: string
  doing: string
  waiting: boolean
  steps: ToolPart[]
} {
  let asked = ''
  let doing = 'Luca is thinking…'
  let waiting = false
  let steps: ToolPart[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.pending) {
      const parts = m.parts ?? []
      steps = parts.filter((p): p is ToolPart => p.type === 'tool')
      // several steps can run at once; a finished one says nothing about now
      const running = steps.findLast((p) => p.status === 'running')
      if (parts.some((p) => p.type === 'permission' && !p.resolved)) {
        doing = 'Waiting for your OK in the chat'
        waiting = true
      } else if (running) doing = `${activityOf(running).active}…`
      else if (parts[parts.length - 1]?.type === 'text') doing = 'Luca is writing back…'
    }
    if (m.role === 'user') {
      asked = m.text
      break
    }
  }
  return { asked, doing, waiting, steps }
}
