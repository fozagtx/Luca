import { MeshGradient } from '@paper-design/shaders-react'
import { useEffect, useState, type ReactElement } from 'react'
import { ErrorBoundary } from '../../components/ui/error-boundary'

const COLORS = ['#000000', '#0400ff', '#ff00d0', '#ff3a1a', '#ffe9e0']

/**
 * A still of the same gradient: deep blue up top, magenta mid, coral low, a pale glow at the
 * bottom edge on black. It sits under the shader, so it is also what shows for reduced motion
 * and when WebGL can't start — the home is never blank.
 */
const FALLBACK =
  'radial-gradient(120% 90% at 50% -10%, #0400ff 0%, transparent 55%),' +
  'radial-gradient(90% 70% at 60% 55%, #ff00d0 0%, transparent 60%),' +
  'radial-gradient(80% 60% at 45% 85%, #ff3a1a 0%, transparent 65%),' +
  'radial-gradient(70% 40% at 50% 110%, #ffe9e0 0%, transparent 70%),' +
  '#000000'

const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The home screen's animated mesh gradient, filling its (positioned) parent. */
export function HomeGradient(): ReactElement {
  const [still, setStill] = useState(reducedMotion)
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = (e: MediaQueryListEvent): void => setStill(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ background: FALLBACK }}
    >
      {still ? null : (
        <ErrorBoundary label="the home background">
          <MeshGradient
            colors={COLORS}
            distortion={0.8}
            swirl={0.1}
            speed={0.25}
            width="100%"
            height="100%"
            style={{ position: 'absolute', inset: 0 }}
          />
        </ErrorBoundary>
      )}
    </div>
  )
}
