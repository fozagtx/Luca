import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Keeps a chat scrolled to the newest content while the reader is at the bottom (streaming
 * text, steps expanding), and lets them scroll up without being pulled back (prompt-kit
 * ChatContainer / use-stick-to-bottom behaviour).
 */
export function useStickToBottom(): {
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  isAtBottom: boolean
  scrollToBottom: (behavior?: ScrollBehavior) => void
} {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
    const el = scrollRef.current
    if (!el) return
    pinned.current = true
    setIsAtBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    let lastTop = el.scrollTop
    const onScroll = (): void => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      const scrolledUp = el.scrollTop < lastTop - 2
      lastTop = el.scrollTop
      if (gap < 24) pinned.current = true
      else if (scrolledUp) pinned.current = false
      setIsAtBottom(gap < 24)
    }
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight
      setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
    })
    ro.observe(content)
    ro.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    el.scrollTop = el.scrollHeight
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  return { scrollRef, contentRef, isAtBottom, scrollToBottom }
}
