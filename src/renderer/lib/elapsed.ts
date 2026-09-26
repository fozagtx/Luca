import { useEffect, useState } from 'react'

/** Seconds since `since`, ticking once a second. */
export function useElapsed(since: number | undefined, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || !since) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active, since])
  return since ? Math.max(0, Math.round((now - since) / 1000)) : 0
}

export function formatElapsed(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
