import { describeActivity, type Activity } from '../../../shared/activity'
import type { ChatContentPart } from '../../../shared/types'

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
