import type { EffectInfo } from '@shared/effects'
import type { EffectPreviewResult, EffectsStatus, Project } from '@shared/types'
import { CircleAlert, LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { sizeOf } from '../../../shared/aspect'
import { clock } from '../../lib/timecode'
import { luca } from '../../lib/luca'
import { usePlayer } from '../../stores/player'

const previewCache = new Map<string, EffectPreviewResult>()

function cacheKey(fx: string, at: number): string {
  return `${fx}@${Math.round(at * 2) / 2}`
}

export function EffectsMenu({
  effects,
  selectedIndex,
  onSelect,
  onPick,
  project
}: {
  effects: EffectInfo[]
  selectedIndex: number
  onSelect: (index: number) => void
  onPick: (effect: EffectInfo) => void
  project: Project
}): ReactElement {
  const [status, setStatus] = useState<EffectsStatus | null>(null)
  const [preview, setPreview] = useState<{ key: string; result: EffectPreviewResult } | null>(null)
  const selected = effects[selectedIndex] ?? effects[0] ?? null
  const at = usePlayer.getState().currentTime
  const key = selected ? cacheKey(selected.id, at) : ''
  const activePreview =
    preview?.key === key ? preview.result : key ? previewCache.get(key) : undefined
  const selectedRow = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void luca.effects
      .status()
      .then((next) => {
        setStatus(next)
        if (next.state === 'unknown' || next.state === 'error')
          void luca.effects.setup().then(setStatus)
      })
      .catch(() =>
        setStatus({ state: 'error', message: 'Effects could not be checked. Please try again.' })
      )
    return luca.effects.onStatus(setStatus)
  }, [])

  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  useEffect(() => {
    if (!selected) return
    const requestedAt = usePlayer.getState().currentTime
    const requestKey = cacheKey(selected.id, requestedAt)
    const timeout = window.setTimeout(() => {
      void luca.effects
        .preview({ fx: selected.id, at: requestedAt })
        .then((result) => {
          if (!result.ok && result.message === 'superseded') return
          if (result.ok || result.reason === 'no-footage') previewCache.set(requestKey, result)
          setPreview({ key: requestKey, result })
        })
        .catch((error: unknown) =>
          setPreview({
            key: requestKey,
            result: {
              ok: false,
              reason: 'error',
              message: error instanceof Error ? error.message : String(error)
            }
          })
        )
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [project.dir, selected, status?.state])

  const [width, height] = sizeOf(project.aspect)
  const readyVideo = activePreview?.ok ? activePreview.url : null
  const unavailable =
    activePreview && !activePreview.ok && activePreview.reason === 'no-footage'
      ? activePreview.message
      : status &&
          status.state !== 'ready' &&
          status.state !== 'unknown' &&
          status.state !== 'installing'
        ? status.message
        : activePreview && !activePreview.ok && activePreview.reason === 'error'
          ? activePreview.message
          : null
  const settingUp =
    !status ||
    status.state === 'unknown' ||
    status.state === 'installing' ||
    (activePreview && !activePreview.ok && activePreview.reason === 'setup')

  return (
    <div
      role="dialog"
      aria-label="Effects"
      onMouseDown={(event) => event.preventDefault()}
      className="tip-popup absolute right-3 bottom-full z-50 mb-2 flex max-h-[360px] min-h-[240px] w-[calc(100%-24px)] overflow-hidden rounded-[10px] border border-border bg-bg shadow-popover"
    >
      <section className="flex min-w-0 flex-[1.15] flex-col border-r border-border">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] font-medium text-text-2">
          <Sparkles size={12} className="text-accent" />
          <span>Effects</span>
          <span className="ml-auto text-[10.5px] font-normal text-text-3">{effects.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {effects.length ? (
            effects.map((effect, index) => (
              <button
                key={effect.id}
                ref={index === selectedIndex ? selectedRow : undefined}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => onSelect(index)}
                onClick={() => onPick(effect)}
                className={`block w-full rounded-[6px] px-2.5 py-1.5 text-left transition-colors ${
                  index === selectedIndex ? 'bg-hover' : 'hover:bg-hover/70'
                }`}
              >
                <span className="block truncate text-[12.5px] font-medium leading-[1.35] text-text">
                  {effect.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] leading-[1.3] text-text-3">
                  {effect.description}
                </span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-3 text-[11.5px] text-text-3">No effects match that name.</div>
          )}
        </div>
      </section>
      <section className="flex w-[44%] min-w-0 flex-col gap-2 p-2.5">
        {selected ? (
          <>
            <div
              className="relative flex w-full shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-bg-muted"
              style={{ aspectRatio: `${width} / ${height}`, maxHeight: 166 }}
            >
              {readyVideo ? (
                <video
                  key={readyVideo}
                  src={readyVideo}
                  muted
                  autoPlay
                  loop
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : unavailable ? (
                <div className="flex max-w-[190px] items-center gap-1.5 px-3 text-center text-[10.5px] leading-[1.4] text-text-3">
                  <CircleAlert size={13} className="shrink-0" />
                  <span>{unavailable}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 text-[10.5px] text-text-3">
                  <LoaderCircle size={13} className="shrink-0 animate-spin" />
                  <span>
                    {settingUp
                      ? 'Setting up effects — one time, about 2 minutes'
                      : 'Making a preview on your video…'}
                  </span>
                </div>
              )}
            </div>
            <div className="min-h-0 overflow-y-auto px-0.5">
              <div className="text-[12px] font-medium text-text">{selected.title}</div>
              <p className="mt-0.5 text-[10.5px] leading-[1.4] text-text-2">
                {selected.description}
              </p>
              <div className="mt-1.5 text-[10px] text-text-3">
                Preview on your video at {clock(at)}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[11px] text-text-3">
            Type an effect name to see a preview.
          </div>
        )}
      </section>
    </div>
  )
}
