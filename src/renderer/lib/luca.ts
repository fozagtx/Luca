import type { LucaApi } from '@shared/api'

export const luca: LucaApi = window.luca

/** Establish the HttpOnly token cookie for the Luca server (project files and, in production, the UI). */
export async function establishSession(): Promise<void> {
  const token = new URLSearchParams(window.location.search).get('token')
  if (!token) return
  try {
    await fetch(`/api/session?token=${encodeURIComponent(token)}`, { credentials: 'include' })
  } catch {
    // dev proxy may not be up yet; the player will retry on load
  }
  const url = new URL(window.location.href)
  url.searchParams.delete('token')
  window.history.replaceState({}, '', url.pathname + url.search)
}
