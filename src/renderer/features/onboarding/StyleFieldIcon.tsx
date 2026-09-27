import type { StyleField } from '@shared/types'
import { CaseSensitive, LayoutTemplate, Palette, Sparkles, Spline, Wallpaper } from 'lucide-react'
import type { ReactElement } from 'react'

/** The icon of a start step (and of its chip on the first request). */
export function StyleFieldIcon({
  field,
  size = 13
}: {
  field: StyleField
  size?: number
}): ReactElement {
  const props = { size, strokeWidth: 1.8 }
  switch (field) {
    case 'template':
      return <LayoutTemplate {...props} />
    case 'theme':
      return <Palette {...props} />
    case 'font':
      return <CaseSensitive {...props} />
    case 'background':
      return <Wallpaper {...props} />
    case 'motion':
      return <Sparkles {...props} />
    case 'keyframes':
      return <Spline {...props} />
  }
}
