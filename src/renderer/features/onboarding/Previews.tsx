import type { DesignTheme } from '@shared/styles'
import type { Aspect, StartStyle } from '@shared/types'
import { Bookmark, Heart, MessageCircle, Share2 } from 'lucide-react'
import { Fragment, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import {
  curvePath,
  easeCss,
  EASES,
  fontStyle,
  highlightOf,
  MOTION_FX,
  themeOf,
  usePreviewFont,
  useReplay
} from './steps-lib'
import './steps.css'

/**
 * Words entering the way a motion style does, with a keyframe style's ease, replaying on a loop:
 * whole line, word by word or letter by letter. `highlight` marks one word (the key word).
 */
export function MotionText({
  text,
  motion,
  ease,
  highlight,
  highlightStyle,
  className,
  style,
  after
}: {
  text: string
  motion: string
  /** CSS ease for each entrance. */
  ease: string
  highlight?: number
  highlightStyle?: CSSProperties
  className?: string
  style?: CSSProperties
  /** Shown under the words and replayed with them (an accent bar). */
  after?: ReactNode
}): ReactElement {
  const fx = MOTION_FX[motion] ?? MOTION_FX.smooth
  const words = text.split(/\s+/).filter(Boolean)
  // where each word's letters start, for letter-by-letter timing
  const starts = words.map((_, i) => words.slice(0, i).reduce((n, w) => n + w.length, 0))
  const parts =
    fx.split === 'line' ? 1 : fx.split === 'words' ? words.length : text.replace(/\s+/g, '').length
  const enter = fx.ms + fx.stagger * Math.max(0, parts - 1)
  const loop = Math.max(2600, enter + 1900)
  const n = useReplay(loop)
  const timing = fx.ease ?? ease
  const part = (i: number): CSSProperties => ({
    animationDuration: `${fx.ms}ms`,
    animationDelay: `${i * fx.stagger}ms`,
    animationTimingFunction: timing
  })
  const mark = (i: number): CSSProperties | undefined =>
    i === highlight ? highlightStyle : undefined

  const body =
    fx.split === 'line' ? (
      <span className="mo-part" style={part(0)}>
        {words.map((w, i) => (
          <Fragment key={i}>
            {i ? ' ' : ''}
            <span style={mark(i)}>{w}</span>
          </Fragment>
        ))}
      </span>
    ) : fx.split === 'words' ? (
      words.map((w, i) => (
        <Fragment key={i}>
          {i ? ' ' : ''}
          <span className="mo-part" style={{ ...part(i), ...mark(i) }}>
            {w}
          </span>
        </Fragment>
      ))
    ) : (
      words.map((w, i) => (
        <Fragment key={i}>
          {i ? ' ' : ''}
          <span className="whitespace-nowrap" style={mark(i)}>
            {[...w].map((ch, j) => (
              <span key={j} className="mo-part" style={part(starts[i] + j)}>
                {ch}
              </span>
            ))}
          </span>
        </Fragment>
      ))
    )

  return (
    <span
      key={`${motion}|${timing}|${n}`}
      className={cn('mo-root', `mo-${motion}`, `mo-split-${fx.split}`, className)}
      style={{ ...style, animationDelay: `${loop - 380}ms` }}
    >
      <span>{body}</span>
      {after}
    </span>
  )
}

/** The picked Pexels background as the stage shows it. */
export type StageBackground = { thumb: string; video?: string }

/**
 * The live preview on the start steps: the idea's headline in the picked theme, font, background,
 * motion and keyframes, shaped like the video.
 */
export function Stage({
  aspect,
  headline,
  style,
  background,
  footage,
  tiktok,
  className
}: {
  aspect: Aspect
  headline: string
  style: StartStyle
  background: StageBackground | null
  /** A still of the person's own video or first photo. */
  footage: string | null
  /** Show TikTok's side buttons (the template's safe area). */
  tiktok?: boolean
  className?: string
}): ReactElement {
  const theme = themeOf(style.theme)
  const font = style.font ?? 'Inter'
  const motion = style.motion ?? 'smooth'
  const ease = easeCss(style.keyframes, (MOTION_FX[motion] ?? MOTION_FX.smooth).natural)
  usePreviewFont(font)
  const words = headline.split(/\s+/).filter(Boolean)
  // the person's own footage shows unless a background or the theme's colours go behind it
  const showFootage = !!footage && !background && style.background !== 'theme'
  const width = aspect === 'portrait' ? 9 / 16 : aspect === 'square' ? 1 : 16 / 9
  // a vertical frame gets a little more height so its words stay readable
  const height = aspect === 'portrait' ? 196 : 158

  return (
    <div
      className={cn(
        'relative mx-auto overflow-hidden rounded-[12px] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/10',
        className
      )}
      style={{
        height,
        width: Math.round(height * width),
        containerType: 'size',
        background: theme.bg
      }}
    >
      {background ? (
        <>
          {background.video ? (
            <video
              key={background.video}
              src={background.video}
              poster={background.thumb}
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <img
              src={background.thumb}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0" style={{ background: theme.bg, opacity: 0.42 }} />
        </>
      ) : showFootage ? (
        <>
          <img src={footage!} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/25" />
        </>
      ) : null}
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center p-[9%] text-center',
          // TikTok's buttons sit on the right: words stay clear of them
          tiktok && 'pr-[20%]'
        )}
      >
        <MotionText
          text={words.join(' ')}
          motion={motion}
          ease={ease}
          highlight={words.length - 1}
          highlightStyle={highlightOf(theme)}
          className="flex flex-col items-center gap-[0.35em] leading-[1.05]"
          style={{
            ...fontStyle(font),
            color: theme.text,
            fontSize: aspect === 'portrait' ? 'min(15cqw, 9cqh)' : 'min(10cqw, 16cqh)',
            textShadow: background || showFootage ? '0 2px 12px rgba(0,0,0,0.35)' : undefined
          }}
          after={
            <span
              className="mo-bar block h-[3px] w-[22%] rounded-full"
              style={{ background: theme.accent, animationTimingFunction: ease }}
            />
          }
        />
      </div>
      {tiktok ? (
        <div className="pointer-events-none absolute right-[5%] bottom-[16%] flex flex-col items-center gap-[7%] text-white/85">
          {[Heart, MessageCircle, Bookmark, Share2].map((Icon, i) => (
            <Icon key={i} size={11} strokeWidth={2.2} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** A theme as a small card: its background, type and accents. */
export function ThemeSwatch({ theme, font }: { theme: DesignTheme; font?: string }): ReactElement {
  return (
    <div
      className="flex h-full w-full flex-col justify-between p-2"
      style={{ background: theme.bg }}
    >
      <span
        className="text-[22px] leading-none"
        style={{ ...fontStyle(font ?? 'Inter'), color: theme.text }}
      >
        A<span style={highlightOf(theme)}>a</span>
      </span>
      <span className="flex gap-1">
        {[theme.text, theme.accent, theme.accent2].map((c, i) => (
          <span
            key={i}
            className="size-2.5 rounded-full ring-1 ring-black/10"
            style={{ background: c }}
          />
        ))}
      </span>
    </div>
  )
}

/** A keyframe style's curve, with a dot riding it in real time. */
export function EaseCurve({ id, color }: { id: string; color?: string }): ReactElement {
  const w = 104
  const h = 56
  const pad = 0.28
  const span = 1 + 2 * pad
  const inset = (pad / span) * 100
  return (
    <div className="relative" style={{ width: w, height: h }}>
      <svg width={w} height={h} className="absolute inset-0 overflow-visible">
        <line
          x1={0}
          x2={w}
          y1={h * (1 - inset / 100)}
          y2={h * (1 - inset / 100)}
          stroke="currentColor"
          strokeOpacity={0.15}
        />
        <line
          x1={0}
          x2={w}
          y1={h * (inset / 100)}
          y2={h * (inset / 100)}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeDasharray="2 3"
        />
        <path
          d={curvePath(id, w, h, pad)}
          fill="none"
          stroke={color ?? 'currentColor'}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="absolute inset-x-0" style={{ top: `${inset}%`, bottom: `${inset}%` }}>
        <span
          className="ease-dot absolute -mb-[5px] -ml-[5px] block size-2.5 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
          style={{ animationTimingFunction: `linear, ${easeCss(id, EASES.natural.css)}` }}
        />
      </div>
    </div>
  )
}
