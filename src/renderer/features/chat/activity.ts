import { describeActivity, type Activity } from '../../../shared/activity'
import type { ChatContentPart } from '../../../shared/types'

export type ToolPart = Extract<ChatContentPart, { type: 'tool' }>

/** Parts saved before activities existed get one from their name and raw input. */
export function activityOf(p: ToolPart): Activity {
  if (p.activity) return p.activity
  let input: Record<string, unknown> = {}
  if (p.name === 'Bash') input = { command: p.detail ?? '' }
  else {
    try {
      input = JSON.parse(p.detail ?? '{}') as Record<string, unknown>
    } catch {
      input = {}
    }
  }
  return describeActivity(p.name, input)
}

export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)
