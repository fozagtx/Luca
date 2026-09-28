import type { ColorState } from '@shared/types'
import { Check, Contrast } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { BUNDLED_LUTS } from '../../../shared/luts'
import { Sheet } from '../../components/ui/sheet'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { errorMessage, useProject } from '../../stores/project'
import { useUi } from '../../stores/ui'
import { gradePoster, loadLut } from './preview-lut'

/**
 * Color grades for the footage: a grid of the LUTs that come with Luca, each shown on the
 * project's own poster frame, plus an intensity slider. Clicking a card grades every clip of the
 * user's footage live; "None" lifts the grade.
 */
export function ColorStudio(): ReactElement {
  const open = useUi((s) => s.colorOpen)
  const setOpen = useUi((s) => s.setColor)
  const project = useProject((s) => s.project)
  return (
    <Sheet
      open={open && !!project}
      onOpenChange={setOpen}
      title="Color"
      description="A look for your footage — pick one, then dial it in."
      width={780}
    >
      {open && project ? <Studio key={project.id} /> : null}
    </Sheet>
  )
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => fail(new Error('image failed'))
    img.src = src
  })

function Studio(): ReactElement {
  const project = useProject((s) => s.project)!
  const previewVersion = useProject((s) => s.previewVersion)
  const recent = useProject((s) => s.recent)
  const [state, setState] = useState<ColorState | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [intensity, setIntensity] = useState(85)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const poster = recent.find((r) => r.dir === project.dir)?.thumb ?? null
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let live = true
    luca.color
      .state()
      .then((s) => {
        if (!live) return
        setState(s)
        setSelected(s.grade?.lut ?? null)
        if (s.grade) setIntensity(Math.round(s.grade.intensity * 100))
      })
      .catch((e) => live && setError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [previewVersion])

  // thumbnails: one LUT per idle slice so 22 cards don't freeze the sheet
  useEffect(() => {
    if (!poster) return
    let live = true
    let img: HTMLImageElement
    void loadImage(poster).then((i) => {
      img = i
      const next = (index: number): void => {
        if (!live || index >= BUNDLED_LUTS.length) return
        const lut = BUNDLED_LUTS[index]
        void loadLut(lut.file)
          .then((parsed) => gradePoster(img, parsed))
          .then(
            (url) => live && url && setThumbs((t) => ({ ...t, [lut.id]: url })),
            () => undefined
          )
          .finally(() => {
            const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 16))
            idle(() => next(index + 1))
          })
      }
      next(0)
    })
    return () => {
      live = false
    }
  }, [poster])

  const apply = async (lut: string, value: number, checkpoint = true): Promise<void> => {
    setError(null)
    try {
      const s = await luca.color.apply({ lut, intensity: value / 100 }, checkpoint)
      setState(s)
      setSelected(lut)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const pick = (lut: string | null): void => {
    if (lut === null) {
      void luca.color
        .remove()
        .then((s) => {
          setState(s)
          setSelected(null)
          toast('Color grade removed', {
            action: { label: 'Undo', onClick: () => void luca.history.undo() }
          })
        })
        .catch((e) => setError(errorMessage(e)))
      return
    }
    const name = BUNDLED_LUTS.find((l) => l.id === lut)?.name ?? lut
    void apply(lut, intensity).then(() =>
      toast(`${name} on your footage · ${intensity}%`, {
        action: { label: 'Undo', onClick: () => void luca.history.undo() }
      })
    )
  }

  const slide = (value: number): void => {
    setIntensity(value)
    if (!selected) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void apply(selected, value, false), 250)
  }

  const commitSlide = (value: number): void => {
    if (debounce.current) clearTimeout(debounce.current)
    if (selected) void apply(selected, value, true)
  }

  const empty = state !== null && state.targets === 0

  return (
    <div className="flex flex-col gap-4">
      {empty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-[12px] bg-secondary text-secondary-fg">
            <Contrast size={20} strokeWidth={1.7} />
          </span>
          <div className="text-[14px] font-semibold text-text">No footage to grade</div>
          <p className="max-w-[420px] text-[12.5px] leading-[1.55] text-text-2">
            Add your footage first, then grade it here.
          </p>
        </div>
      ) : (
        <div className="-mx-5 max-h-[calc(100vh-330px)] min-h-[170px] overflow-y-auto border-b border-border bg-bg-subtle px-5 py-3 scroll">
          <div className="grid grid-cols-4 gap-2.5">
            <LutCard
              name="None"
              note="Original footage"
              selected={selected === null}
              onClick={() => pick(null)}
            >
              {poster ? (
                <img src={poster} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-zinc-300 to-zinc-500" />
              )}
            </LutCard>
            {BUNDLED_LUTS.map((l) => (
              <LutCard
                key={l.id}
                name={l.name}
                note={l.note}
                selected={selected === l.id}
                onClick={() => pick(l.id)}
              >
                {thumbs[l.id] ? (
                  <img src={thumbs[l.id]} alt="" className="h-full w-full object-cover" />
                ) : poster ? (
                  <img src={poster} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-zinc-300 to-zinc-500" />
                )}
              </LutCard>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-2.5">
        <span className="text-[12px] font-medium text-text-2">Intensity</span>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={intensity}
            disabled={!selected || empty}
            aria-label="Intensity"
            onChange={(e) => slide(Number(e.target.value))}
            onPointerUp={(e) => commitSlide(Number((e.target as HTMLInputElement).value))}
            className="min-w-0 flex-1 accent-[var(--accent)] disabled:opacity-40"
          />
          <span className="w-9 text-right text-[12px] text-text-2 tabular-nums">{intensity}%</span>
        </div>
        <span />
        <span className="text-[11px] text-text-3">
          {state
            ? state.targets
              ? `Applies to ${state.targets} clip${state.targets === 1 ? '' : 's'}`
              : ''
            : ''}
        </span>
      </div>
      {error ? <p className="text-[12px] text-danger select-text">{error}</p> : null}
    </div>
  )
}

function LutCard({
  name,
  note,
  selected,
  onClick,
  children
}: {
  name: string
  note: string
  selected: boolean
  onClick: () => void
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rise-in group overflow-hidden rounded-[10px] bg-bg text-left ring-1 transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5',
        selected
          ? 'shadow-[0_0_0_2px_var(--accent)] ring-transparent'
          : 'ring-border hover:ring-border-strong'
      )}
    >
      <div className="relative aspect-video overflow-hidden">
        {children}
        {selected ? (
          <span className="pop-in absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-white shadow">
            <Check size={11} strokeWidth={3} />
          </span>
        ) : null}
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate text-[12px] font-semibold text-text">{name}</div>
        <div className="line-clamp-2 text-[10.5px] leading-[1.35] text-text-3">{note}</div>
      </div>
    </button>
  )
}
