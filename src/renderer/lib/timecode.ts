const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** HH:MM:SS:FF */
export function timecode(seconds: number, fps = 30): string {
  const s = Math.max(0, seconds)
  const totalFrames = Math.round(s * fps)
  const f = totalFrames % fps
  const total = Math.floor(totalFrames / fps)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return `${pad(h)}:${pad(m)}:${pad(sec)}:${pad(f)}`
}

/** M:SS or H:MM:SS for durations */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/** Parse "12", "1:02", "00:01:02:04" or "12.5" into seconds. */
export function parseTimecode(input: string, fps = 30): number | null {
  const t = input.trim()
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  const parts = t.split(':').map(Number)
  if (parts.some((p) => Number.isNaN(p))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / fps
  return null
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
