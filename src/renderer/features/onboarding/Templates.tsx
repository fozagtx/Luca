import { TEMPLATES, type Template } from '@shared/styles'
import { Bookmark, Check, Heart, MessageCircle, Play, Share2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/cn'
import { useStart } from '../../stores/start'
import { useUi } from '../../stores/ui'
import { MotionText } from './Previews'
import {
  easeCss,
  fontStyle,
  highlightOf,
  MOTION_FX,
  themeOf,
  usePreviewFont,
  useReplay
} from './steps-lib'

/**
 * A template's preview video and poster: `<template id>.mp4` (or .webm, .mov, .m4v) and an
 * optional `<template id>.jpg` (or .png, .webp) in src/renderer/assets/templates/. Without a
 * video the card plays an animated storyboard of the template's beats.
 */
const FILES = import.meta.glob('../../assets/templates/*.{mp4,webm,mov,m4v,jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

function mediaOf(id: string): { video?: string; poster?: string } {
  const out: { video?: string; poster?: string } = {}
  for (const [path, url] of Object.entries(FILES)) {
    const file = path.split('/').pop() ?? ''
    const dot = file.lastIndexOf('.')
    if (file.slice(0, dot) !== id) continue
    if (/^(mp4|webm|mov|m4v)$/i.test(file.slice(dot + 1))) out.video = url
    else out.poster = url
  }
  return out
}

/** "0–1.5s" → [0, 1.5]. */
function spanOf(at: string): [number, number] {
  const m = /([\d.]+)\s*[–-]\s*([\d.]+)/.exec(at)
  return m ? [Number(m[1]), Number(m[2])] : [0, 0]
}

/** Ready-made viral workflows: pick one, say what the video is about, Luca builds it. */
export function Templates(): ReactElement | null {
  const inUse = useStart((s) => s.style.template)
  const busy = useStart((s) => s.busy)
  const applyTemplate = useStart((s) => s.applyTemplate)
  if (busy) return null

  const use = (t: Template): void => {
    applyTemplate(t.id)
    // chat's composer shares the words; the start card is where they go now
    if (!useUi.getState().chatOpen) useUi.getState().setChat(true)
    requestAnimationFrame(() => {
      const el = document.getElementById('start-prompt') as HTMLTextAreaElement | null
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.focus({ preventScroll: true })
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-0.5">
        <h2 className="text-[13px] font-semibold text-text">Templates</h2>
        <span className="text-[11px] text-text-3">
          Viral workflows: pick one, say what it’s about, Luca builds it
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {TEMPLATES.map((t, i) => (
          <TemplateCard
            key={t.id}
            t={t}
            delay={i * 40}
            active={inUse === t.id}
            onUse={() => use(t)}
            onDrop={() => applyTemplate(null)}
          />
        ))}
      </div>
    </section>
  )
}

function TemplateCard({
  t,
  delay,
  active,
  onUse,
  onDrop
}: {
  t: Template
  delay: number
  active: boolean
  onUse: () => void
  onDrop: () => void
}): ReactElement {
  const media = mediaOf(t.id)
  const [hover, setHover] = useState(false)
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        'card rise-in flex flex-col overflow-hidden transition-shadow',
        active && 'shadow-[0_0_0_2px_var(--accent)]'
      )}
    >
      <button
        type="button"
        onClick={onUse}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-label={`Use the ${t.name} template`}
        className="relative h-[176px] overflow-hidden"
      >
        {media.video ? (
          <TemplateVideo t={t} src={media.video} poster={media.poster} playing={hover} />
        ) : (
          <Storyboard t={t} />
        )}
        <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
          {t.aspect === 'portrait' ? '9:16' : t.aspect === 'square' ? '1:1' : '16:9'} · {t.duration}
          s
        </span>
      </button>
      <div className="flex flex-1 flex-col gap-2.5 p-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-text">{t.name}</span>
            <span className="truncate text-[11px] text-text-3">{t.tagline}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.45] text-text-2">{t.blurb}</p>
        </div>
        {/* the workflow, beat by beat, to scale */}
        <div className="flex gap-0.5" aria-label="How the template is built">
          {t.beats.map((b) => {
            const [a, z] = spanOf(b.at)
            return (
              <div
                key={b.name}
                title={`${b.at} · ${b.name}: ${b.what}`}
                style={{ flexGrow: Math.max(0.6, z - a), flexBasis: 0 }}
                className="min-w-0"
              >
                <div className="h-1 rounded-full bg-accent/70" />
                <div className="mt-1 truncate text-[10px] font-medium text-text-2">{b.name}</div>
              </div>
            )
          })}
        </div>
        <div className="mt-auto flex items-center gap-2">
          {active ? (
            <>
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-secondary-fg">
                <Check size={13} strokeWidth={2.5} /> In use
              </span>
              <Button variant="ghost" size="md" className="ml-auto" onClick={onDrop}>
                Remove
              </Button>
            </>
          ) : (
            <Button variant="primary" size="md" className="ml-auto" onClick={onUse}>
              Use template
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The template's own example video: its first frame, playing while hovered. */
function TemplateVideo({
  t,
  src,
  poster,
  playing
}: {
  t: Template
  src: string
  poster?: string
  playing: boolean
}): ReactElement {
  const ref = useRef<HTMLVideoElement>(null)
  const theme = themeOf(t.style.theme)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (playing) void v.play().catch(() => undefined)
    else v.pause()
  }, [playing])
  return (
    <div className="absolute inset-0" style={{ background: theme.dark ? '#0b0b0f' : theme.bg }}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        className={cn(
          'absolute inset-0 h-full w-full',
          t.aspect === 'portrait' ? 'object-contain' : 'object-cover'
        )}
      />
      {!playing ? (
        <span className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
          <Play size={12} fill="currentColor" />
        </span>
      ) : null}
    </div>
  )
}

/** No example video yet: the template's beats play one after another in its look. */
function Storyboard({ t }: { t: Template }): ReactElement {
  const n = useReplay(1800)
  const i = n % t.beats.length
  const beat = t.beats[i]
  const theme = themeOf(t.style.theme)
  const font = t.style.font ?? 'Inter'
  const motion = t.style.motion ?? 'smooth'
  usePreviewFont(font)
  const portrait = t.aspect === 'portrait'
  const words = beat.line.split(/\s+/)
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: `radial-gradient(circle at 50% 60%, color-mix(in srgb, ${theme.accent} 22%, transparent), transparent 70%), ${theme.dark ? '#0d0e12' : '#eef0f4'}`
      }}
    >
      <div
        className="relative overflow-hidden rounded-[9px] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.5)] ring-1 ring-black/10"
        style={{
          height: 146,
          width: portrait ? 82 : 260,
          background: theme.bg,
          containerType: 'size'
        }}
      >
        <div
          key={i}
          className="beat-in absolute inset-0 flex items-center justify-center p-[10%] text-center"
        >
          <MotionText
            text={beat.line}
            motion={motion}
            ease={easeCss(t.style.keyframes, (MOTION_FX[motion] ?? MOTION_FX.smooth).natural)}
            highlight={words.length - 1}
            highlightStyle={highlightOf(theme)}
            className="leading-[1.05]"
            style={{ ...fontStyle(font), color: theme.text, fontSize: portrait ? '17cqw' : '9cqw' }}
          />
        </div>
        <span className="absolute top-1.5 left-1.5 rounded-full bg-black/45 px-1.5 text-[8.5px] leading-[14px] font-medium text-white">
          {beat.name}
        </span>
        {portrait ? (
          <div className="absolute right-1.5 bottom-[18%] flex flex-col items-center gap-1.5 text-white/85">
            {[Heart, MessageCircle, Bookmark, Share2].map((Icon, k) => (
              <Icon key={k} size={8} strokeWidth={2.4} />
            ))}
          </div>
        ) : null}
        <div className="absolute inset-x-1.5 bottom-1.5 flex gap-0.5">
          {t.beats.map((b, k) => (
            <span
              key={b.name}
              className={cn(
                'h-[2px] flex-1 rounded-full transition-colors duration-300',
                k <= i
                  ? theme.dark
                    ? 'bg-white'
                    : 'bg-black/70'
                  : theme.dark
                    ? 'bg-white/30'
                    : 'bg-black/15'
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
