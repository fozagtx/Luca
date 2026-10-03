import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import { cn } from '../../lib/cn'

type State = 'loading' | 'loaded' | 'error'

/** Images already decoded this session: a remounted thumb shows them at once, no skeleton. */
const decoded = new Set<string>()

/**
 * An image that never shows a broken or half-loaded state: a frosted, grained veil while it
 * loads, the picture sharpening up through it once decoded, and `fallback` if there is no image
 * or it fails.
 */
export function Thumb({
  src,
  fallback,
  className,
  imgClassName,
  style,
  lazy = true,
  children
}: {
  src?: string | null
  fallback?: ReactNode
  className?: string
  imgClassName?: string
  style?: CSSProperties
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
    <div className={cn('relative overflow-hidden bg-bg-muted', className)} style={style}>
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
          data-loaded={state === 'loaded' || undefined}
          className={cn('media-reveal absolute inset-0 h-full w-full object-cover', imgClassName)}
        />
      ) : null}
      {state !== 'error' ? (
        <div className="media-pending" data-done={state === 'loaded' || undefined} />
      ) : null}
      {children}
    </div>
  )
}
