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
 * An image that never shows a broken or half-loaded state: a shimmering skeleton while it
 * loads (or `placeholder`, a small still of it), a fade-in once decoded, and `fallback` if
 * there is no image or it fails.
 */
export function Thumb({
  src,
  placeholder,
  fallback,
  alt = '',
  className,
  imgClassName,
  style,
  lazy = true,
  onLoad,
  onMissing,
  children
}: {
  src?: string | null
  /** Shown while `src` loads, and in its place if it fails. */
  placeholder?: string | null
  fallback?: ReactNode
  alt?: string
  className?: string
  imgClassName?: string
  style?: CSSProperties
  lazy?: boolean
  /** `src` is decoded: its natural size is known. */
  onLoad?: (img: HTMLImageElement) => void
  /** Neither `src` nor `placeholder` could be shown. */
  onMissing?: () => void
  children?: ReactNode
}): ReactElement {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(() =>
    src && decoded.has(src) ? src : null
  )
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [failedLow, setFailedLow] = useState<string | null>(null)
  const img = useRef<HTMLImageElement>(null)
  const state: State =
    !src || failedSrc === src ? 'error' : loadedSrc === src ? 'loaded' : 'loading'
  const low = placeholder && placeholder !== src && failedLow !== placeholder ? placeholder : null

  // an image already in the cache can finish before the load listener sees it
  useEffect(() => {
    const el = img.current
    if (el && src && el.complete && el.naturalWidth > 0) {
      decoded.add(src)
      setLoadedSrc(src)
      onLoad?.(el)
    }
  }, [src, onLoad])

  return (
    <div className={cn('relative overflow-hidden bg-bg-muted', className)} style={style}>
      {state === 'loading' && !low ? (
        <div className="skeleton absolute inset-0 rounded-none" />
      ) : null}
      {state === 'error' && !low ? fallback : null}
      {low && state !== 'loaded' ? (
        <img
          src={low}
          alt={state === 'error' ? alt : ''}
          draggable={false}
          decoding="async"
          onError={() => {
            setFailedLow(low)
            if (state === 'error') onMissing?.()
          }}
          className={cn('absolute inset-0 h-full w-full object-cover', imgClassName)}
        />
      ) : null}
      {src && state !== 'error' ? (
        <img
          ref={img}
          src={src}
          alt={alt}
          draggable={false}
          loading={lazy ? 'lazy' : undefined}
          decoding="async"
          onLoad={(e) => {
            decoded.add(src)
            setLoadedSrc(src)
            onLoad?.(e.currentTarget)
          }}
          onError={() => {
            setFailedSrc(src)
            if (!low) onMissing?.()
          }}
          className={cn(
            'absolute inset-0 h-full w-full object-cover',
            // over a placeholder it swaps in at once: a fade would dim it through a transparent PNG
            !low && 'transition-opacity duration-300 ease-out',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
            imgClassName
          )}
        />
      ) : null}
      {children}
    </div>
  )
}
