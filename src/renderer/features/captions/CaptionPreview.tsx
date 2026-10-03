import type { CSSProperties, ReactElement } from 'react'
import { captionLook, captionTextShadow, scatterLayout } from '../../../shared/captions'
import type { CaptionConfig, CaptionGroup, ProjectFontFace } from '../../../shared/types'
import { cn } from '../../lib/cn'
import { useLoopTime } from './preview-lib'

// ------------------------------------------------------------------ the preview

/** The frame the preview stands in for, in 1080-short-side units (only the aspect matters). */
const frameDims = (portrait: boolean): { w: number; h: number } =>
  portrait ? { w: (1080 * 9) / 16, h: 1080 } : { w: (1080 * 16) / 9, h: 1080 }

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
  // the blur look brings a line in by rows: each row with its first word
  const rowStart = (j: number): number => {
    let r = j
    while (g && r > 0 && !!g.words[r].em === !!g.words[r - 1].em) r--
    return r
  }
  const scatter =
    look.layout === 'scatter' && g ? scatterLayout(g, look, cfg, frameDims(portrait), gi) : null
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
        {g && scatter ? (
          <div className="absolute inset-0">
            {g.words.map((w, j) => {
              const p = scatter[j]
              if (!p) return null
              const hero = look.hero
              const ws: CSSProperties = {
                position: 'absolute',
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                transform:
                  p.align === 'left'
                    ? 'translate(0,-50%)'
                    : p.align === 'right'
                      ? 'translate(-100%,-50%)'
                      : 'translate(-50%,-50%)',
                whiteSpace: 'nowrap',
                fontFamily: `'${p.hero ? (hero?.font ?? cfg.font) : cfg.font}', Inter, sans-serif`,
                fontWeight: p.hero ? (hero?.weight ?? 900) : look.weight,
                fontStyle: look.italic ? 'italic' : 'normal',
                fontSize: Math.max(7, p.size * k),
                lineHeight: p.hero ? 0.95 : 1.1,
                letterSpacing: p.hero ? `${hero?.letterSpacing ?? -0.02}em` : 0,
                color: p.hero ? (hero?.color ?? look.color) : look.color,
                textTransform: (p.hero ? hero?.uppercase : cfg.uppercase) ? 'uppercase' : 'none',
                textShadow: shadow || undefined
              }
              return (
                <span key={j} style={ws}>
                  {w.text}
                </span>
              )
            })}
          </div>
        ) : g ? (
          <div key={gi} className={`cap-enter cap-enter-${look.anim}`} style={lineStyle}>
            {g.words.map((w, j) => {
              const on = j === activeWord
              const spoken = j <= activeWord
              // emphasis words (a look with an emphasis face) sit on a row of their own
              const em = look.emphasis && w.em ? look.emphasis : null
              const rowBreak =
                !!look.emphasis && j > 0 && !!w.em !== !!g.words[j - 1].em ? (
                  <span style={{ display: 'block' }} />
                ) : null
              const ws: CSSProperties = {
                display: 'inline-block',
                transition:
                  'color 90ms, background-color 90ms, transform 120ms, opacity 90ms, filter 200ms',
                ...(look.wordBox ? { padding: '0.02em 0.16em', borderRadius: '0.2em' } : {}),
                ...(em
                  ? {
                      fontFamily: `'${em.font}', serif`,
                      fontStyle: em.italic ? 'italic' : 'normal',
                      fontWeight: em.weight,
                      fontSize: `${em.scale}em`,
                      letterSpacing: '-0.01em',
                      lineHeight: 1
                    }
                  : {})
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
                case 'blur': {
                  const shown = rowStart(j) === 0 || activeWord >= rowStart(j)
                  Object.assign(ws, {
                    opacity: shown ? 1 : 0,
                    filter: shown ? 'blur(0px)' : `blur(${Math.max(2, 14 * k)}px)`
                  })
                  break
                }
              }
              return (
                <span key={j}>
                  {rowBreak ?? (j > 0 ? ' ' : '')}
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
