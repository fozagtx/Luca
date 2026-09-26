import type { CSSProperties, ReactElement } from 'react'
import { captionStyle, isBuiltinFont, nearestWeight } from '../../../shared/captions'
import type { CaptionConfig, CaptionGroup } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { useLoopTime } from './preview-lib'

// ------------------------------------------------------------------ the preview

function outline(px: number): string {
  const out: string[] = []
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2
    out.push(
      `${(Math.cos(t) * px).toFixed(1)}px ${(Math.sin(t) * px).toFixed(1)}px 0 rgba(0,0,0,0.92)`
    )
  }
  return out.join(', ')
}

const SIZE: Record<CaptionConfig['size'], number> = { sm: 0.82, md: 1, lg: 1.22 }

/**
 * Plays caption lines in a style, the way the composition Luca writes will: same fonts, sizes
 * (scaled to the preview), colors, boxes and word animation, driven by the lines' real timings.
 */
export function CaptionPreview({
  cfg,
  groups,
  height,
  portrait = false,
  active = true,
  background,
  zoom = 1,
  className
}: {
  cfg: CaptionConfig
  groups: CaptionGroup[]
  /** Preview height in px; type sizes scale from the 1080 px short side. */
  height: number
  /** Enlarges the type beyond true scale, for small gallery cards. */
  zoom?: number
  portrait?: boolean
  active?: boolean
  background?: string | null
  className?: string
}): ReactElement {
  const style = captionStyle(cfg.style)
  const period = groups.length ? groups[groups.length - 1].end + 0.8 : 3
  const t = useLoopTime(period, active)
  const gi = groups.findIndex((g) => t >= g.start && t < g.end)
  const g = gi >= 0 ? groups[gi] : null
  const k = ((portrait ? (height * 9) / 16 : height) / 1080) * zoom
  const size = Math.max(7, style.size * SIZE[cfg.size] * k)
  const weight = isBuiltinFont(cfg.font) ? nearestWeight(cfg.font, style.weight) : style.weight
  const accent = cfg.accent ?? style.accent
  const shadow = [
    style.outline ? outline(Math.max(0.6, style.outline * k)) : '',
    style.shadow ?? ''
  ]
    .filter(Boolean)
    .join(', ')
  const pill = style.box?.radius === 999
  const lineStyle: CSSProperties = {
    fontFamily: `'${cfg.font}', Inter, sans-serif`,
    fontWeight: weight,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontSize: size,
    lineHeight: 1.18,
    letterSpacing: `${style.letterSpacing ?? 0}em`,
    color: style.color,
    textTransform: cfg.uppercase ? 'uppercase' : 'none',
    textShadow: shadow || undefined,
    background: style.box?.bg,
    borderRadius: style.box ? (pill ? 999 : Math.max(2, style.box.radius * k)) : undefined,
    padding: style.box ? (pill ? '0.28em 0.9em' : '0.2em 0.55em') : undefined,
    maxWidth: portrait ? '86%' : '80%',
    textAlign: 'center'
  }
  const activeWord = g ? g.words.reduce((a, w, j) => (t >= w.start ? j : a), -1) : -1
  const pos =
    cfg.position === 'top'
      ? 'items-start'
      : cfg.position === 'middle'
        ? 'items-center'
        : 'items-end'
  const pad = (portrait ? 0.27 : 0.1) * height

  return (
    <div
      className={cn('relative overflow-hidden bg-[#111]', className)}
      style={{
        height,
        backgroundImage: background
          ? `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.25)), url(${background})`
          : 'radial-gradient(120% 90% at 30% 20%, #3b3f52 0%, #16171d 60%, #0c0c0f 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <div
        className={cn('absolute inset-0 flex justify-center', pos)}
        style={{ paddingTop: pad, paddingBottom: pad, paddingLeft: '6%', paddingRight: '6%' }}
      >
        {g ? (
          <div key={gi} className={`cap-enter cap-enter-${style.anim}`} style={lineStyle}>
            {g.words.map((w, j) => {
              const on = j === activeWord
              const spoken = j <= activeWord
              const ws: CSSProperties = {
                display: 'inline-block',
                transition: 'color 90ms, background-color 90ms, transform 120ms, opacity 90ms',
                ...(style.wordBox ? { padding: '0.02em 0.16em', borderRadius: '0.2em' } : {})
              }
              switch (style.anim) {
                case 'pop':
                  if (on) Object.assign(ws, { color: accent, transform: 'scale(1.12)' })
                  break
                case 'karaoke':
                  if (on)
                    Object.assign(ws, {
                      background: accent,
                      color: style.activeText ?? style.color
                    })
                  break
                case 'highlight':
                  if (on)
                    Object.assign(ws, {
                      background: accent,
                      color: style.activeText ?? style.color,
                      transform: 'scale(1.06)'
                    })
                  break
                case 'typewriter':
                  Object.assign(ws, { opacity: spoken ? 1 : 0, color: on ? accent : undefined })
                  break
                case 'slam':
                  Object.assign(ws, {
                    opacity: spoken ? 1 : 0,
                    transform: spoken ? 'scale(1)' : 'scale(1.6)',
                    color: on ? accent : undefined
                  })
                  break
                case 'glow':
                  if (on) ws.color = accent
                  break
              }
              return (
                <span key={j}>
                  {j > 0 ? ' ' : ''}
                  <span style={ws}>{w.text}</span>
                </span>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
