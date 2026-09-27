import type { CSSProperties, ReactElement } from 'react'
import { captionLook, captionTextShadow } from '../../../shared/captions'
import type { CaptionConfig, CaptionGroup, ProjectFontFace } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { useLoopTime } from './preview-lib'

// ------------------------------------------------------------------ the preview

/**
 * Plays caption lines in a style, the way the composition Luca writes will: the same look (style
 * plus custom overrides), fonts, sizes (scaled to the preview), colors, outlines, boxes and word
 * animation, driven by the lines' real timings.
 */
export function CaptionPreview({
  cfg,
  faces,
  groups,
  height,
  portrait = false,
  active = true,
  background,
  zoom = 1,
  className
}: {
  cfg: CaptionConfig
  /** The project's files for a font added to it, so weights match the video's. */
  faces?: ProjectFontFace[]
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
  const look = captionLook(cfg, faces)
  const period = groups.length ? groups[groups.length - 1].end + 0.8 : 3
  const t = useLoopTime(period, active)
  const gi = groups.findIndex((g) => t >= g.start && t < g.end)
  const g = gi >= 0 ? groups[gi] : null
  const k = ((portrait ? (height * 9) / 16 : height) / 1080) * zoom
  const size = Math.max(7, look.size * k)
  const accent = look.accent
  const shadow = captionTextShadow(look, k, 12)
  const box = look.box
  const lineStyle: CSSProperties = {
    fontFamily: `'${cfg.font}', Inter, sans-serif`,
    fontWeight: look.weight,
    fontStyle: look.italic ? 'italic' : 'normal',
    fontSize: size,
    lineHeight: 1.18,
    letterSpacing: `${look.letterSpacing}em`,
    color: look.color,
    textTransform: cfg.uppercase ? 'uppercase' : 'none',
    textShadow: shadow || undefined,
    background: box?.bg,
    borderRadius: box ? (box.radius >= 999 ? 999 : Math.max(2, box.radius * k)) : undefined,
    padding: box?.padding,
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
          <div key={gi} className={`cap-enter cap-enter-${look.anim}`} style={lineStyle}>
            {g.words.map((w, j) => {
              const on = j === activeWord
              const spoken = j <= activeWord
              const ws: CSSProperties = {
                display: 'inline-block',
                transition: 'color 90ms, background-color 90ms, transform 120ms, opacity 90ms',
                ...(look.wordBox ? { padding: '0.02em 0.16em', borderRadius: '0.2em' } : {})
              }
              switch (look.anim) {
                case 'pop':
                  if (on) Object.assign(ws, { color: accent, transform: 'scale(1.12)' })
                  break
                case 'karaoke':
                  if (on)
                    Object.assign(ws, {
                      background: accent,
                      color: look.activeText
                    })
                  break
                case 'highlight':
                  if (on)
                    Object.assign(ws, {
                      background: accent,
                      color: look.activeText,
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
