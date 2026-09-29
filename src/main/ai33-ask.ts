/* eslint-disable @typescript-eslint/no-unused-vars -- stub: the owning slice writes the function bodies and drops this line */
/**
 * Asking the person a question from main when no chat exists yet (the start card): the ask goes
 * to the window, the answer comes back through the `ai33AskReply` handler.
 */
import type { Ai33Ask } from '../shared/ai33'

/**
 * Show `ask` in the window and wait: 'allow' or 'deny'. Aborting the signal, or the wait running
 * out, answers 'deny' and tells the window the card is closed.
 */
export function askViaWindow(_ask: Ai33Ask, _signal?: AbortSignal): Promise<'allow' | 'deny'> {
  throw new Error('not implemented')
}

/** The window's answer to an ask (the `ai33AskReply` handler); an unknown or closed id is ignored. */
export function answerAsk(_id: string, _decision: 'allow' | 'deny'): void {
  throw new Error('not implemented')
}
