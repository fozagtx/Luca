import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type State = 'loading' | 'loaded' | 'error'

/** Images already decoded this session: a remounted thumb shows them at once, no skeleton. */
const decoded = new Set<string>()

/**
 * An image that never shows a broken or half-loaded state: a shimmering skeleton while it
 * loads, a fade-in once decoded, and `fallback` if there is no image or it fails.
 */
export function Thumb({
  src,
  fallback,
  className,
  imgClassName,
  lazy = true,
  children
}: {
  src?: string | null
  fallback?: ReactNode
  className?: string
  imgClassName?: string
  lazy?: boolean
  children?: ReactNode
}): ReactElement {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(() =>
    src && decoded.has(src) ? src : null
  )
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const img = useRef<HTMLImageElement>(null)
  const state: State =
    !src || failedSrc === src ? 'error' : loadedSrc === src ? 'loaded' : 'loading'

  // an image already in the cache can finish before the load listener sees it
  useEffect(() => {
    const el = img.current
    if (el && src && el.complete && el.naturalWidth > 0) {
      decoded.add(src)
      setLoadedSrc(src)
    }
  }, [src])

  return (
    <div className={cn('relative overflow-hidden bg-bg-muted', className)}>
      {state === 'loading' ? <div className="skeleton absolute inset-0 rounded-none" /> : null}
      {state === 'error' ? fallback : null}
      {src && state !== 'error' ? (
        <img
          ref={img}
          src={src}
          alt=""
          draggable={false}
          loading={lazy ? 'lazy' : undefined}
          decoding="async"
          onLoad={() => {
            decoded.add(src)
            setLoadedSrc(src)
          }}
          onError={() => setFailedSrc(src)}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
            imgClassName
          )}
        />
      ) : null}
      {children}
    </div>
  )
}
