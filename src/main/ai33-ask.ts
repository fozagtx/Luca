/**
 * Asking the person a question from main when no chat exists yet (the start card): the ask goes
 * to the window, the answer comes back through the `ai33AskReply` handler.
 */
import { randomUUID } from 'node:crypto'
import type { Ai33Ask } from '../shared/ai33'
import { hasAi33Key, onKeyConnected } from './ai33-account'
import { ASK_TIMEOUT_MS } from './ai33-spend'
import { broadcast, Channels, notifyInBackground } from './ipc'

/** Open questions by id, each with how to answer it. */
const open = new Map<string, { kind: Ai33Ask['kind']; answer: (d: 'allow' | 'deny') => void }>()

/**
 * Show `ask` in the window and wait: 'allow' or 'deny'. Aborting the signal, or the wait running
 * out, answers 'deny' and tells the window the card is closed.
 */
export function askViaWindow(ask: Ai33Ask, signal?: AbortSignal): Promise<'allow' | 'deny'> {
  if (signal?.aborted) return Promise.resolve('deny')
  return new Promise((resolve) => {
    const id = randomUUID()
    const finish = (decision: 'allow' | 'deny', closeCard: boolean): void => {
      if (!open.delete(id)) return
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      stopListening?.()
      if (closeCard) broadcast(Channels.ai33AskClosed, { id })
      resolve(decision)
    }
    const onAbort = (): void => finish('deny', true)
    const timer = setTimeout(() => finish('deny', true), ASK_TIMEOUT_MS)
    // a key saved somewhere else answers a question that was only asking for one (and closes its card)
    const stopListening =
      ask.kind === 'connect' ? onKeyConnected(() => finish('allow', true)) : null
    open.set(id, { kind: ask.kind, answer: (d) => finish(d, false) })
    signal?.addEventListener('abort', onAbort, { once: true })
    broadcast(Channels.ai33Ask, { id, ask })
    if (ask.kind === 'connect')
      notifyInBackground('Luca needs your ai33 key', 'Open Luca to connect it.')
    else notifyInBackground('Luca needs your OK', ask.title)
  })
}

/**
 * The window's answer to an ask (the `ai33AskReply` handler); an unknown or closed id is ignored.
 * Nothing but a saved key answers a request for one: an IPC `allow` cannot make the work go on
 * without it.
 */
export function answerAsk(id: string, decision: 'allow' | 'deny'): void {
  const q = open.get(id)
  if (!q) return
  if (q.kind === 'connect' && decision !== 'deny' && !hasAi33Key()) return
  q.answer(decision === 'allow' ? 'allow' : 'deny')
}
