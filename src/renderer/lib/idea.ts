import type { Aspect } from '@shared/types'

/** "a 15 second video", "15s", "30-sec", "1 minute" → seconds; null when no length is named. */
export function durationFrom(text: string): number | null {
  const m = /\b(\d{1,3}(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s|minutes?|mins?)\b/i.exec(text)
  if (!m) return null
  const n = Number(m[1]) * (/^m/i.test(m[2]) ? 60 : 1)
  return n >= 3 && n <= 600 ? Math.round(n) : null
}

/** The shape the words ask for: "a TikTok…" is vertical, "a square post…" square. */
export function aspectFrom(text: string): Aspect | null {
  if (/\b(tik ?toks?|reels?|shorts|vertical|portrait|stor(y|ies)|9:16)\b/i.test(text))
    return 'portrait'
  if (/\b(square|1:1|instagram post)\b/i.test(text)) return 'square'
  if (/\b(landscape|widescreen|horizontal|16:9)\b/i.test(text)) return 'landscape'
  return null
}

const LEAD_IN = new RegExp(
  [
    "^(?:(?:please|pls|can you|could you|i want|i'd like|i need)\\s+)*",
    '(?:(?:create|make|build|generate|produce|do|give)\\s+(?:me\\s+|us\\s+)?)?',
    '(?:(?:a|an|the|my|one)\\s+)?',
    '(?:\\d+(?:\\.\\d+)?\\s*-?\\s*(?:seconds?|secs?|s|minutes?|mins?)\\s+(?:long\\s+)?)?',
    '(?:(?:short|quick|vertical|viral|fun|simple|cool|animated|tik ?tok|instagram|youtube|video|clip|reel|explainer|teaser|ad|promo)\\s+)*',
    '(?:(?:showing|that shows|which shows|to show|about|on|explaining|that explains|to explain|of|for|where)\\s+)?'
  ].join(''),
  'i'
)

/** A few words for a preview title: "create me a 15 second video showing how to brew coffee" → "How to brew coffee". */
export function headlineFrom(text: string, fallback = 'Your video'): string {
  const rest = text
    .trim()
    .replace(LEAD_IN, '')
    .replace(/[.!?,;:]+$/, '')
  const words = rest.split(/\s+/).filter(Boolean).slice(0, 6)
  if (!words.length) return fallback
  const line = words.join(' ').replace(/[.!?,;:]+$/, '')
  return line[0].toUpperCase() + line.slice(1)
}
