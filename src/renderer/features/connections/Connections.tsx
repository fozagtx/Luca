import { CircleAlert, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Ai33HealthMap } from '@shared/ai33'
import { Button } from '../../components/ui/button'
import { Sheet } from '../../components/ui/sheet'
import { Tip } from '../../components/ui/tooltip'
import { useAi33 } from '../../stores/ai33'
import { useUi } from '../../stores/ui'
import { Ai33KeyCard } from '../ai33/Ai33KeyCard'

/**
 * A plain line about the voice services, only when they are not in good shape (null otherwise:
 * a service nobody has checked yet is not a problem to report).
 */
function healthLine(health: Ai33HealthMap): string | null {
  const states = [health.elevenlabs, health.minimax]
  if (states.includes('overloaded'))
    return 'Studio voices are busy right now. Standard voices still work, or try again in a few minutes.'
  if (states.includes('degraded')) return 'Studio voices are slower than usual right now.'
  return null
}

/**
 * The Connections sheet (⌘,): the ai33 key and account in one place. The key card does the
 * connecting, changing and disconnecting; the sheet adds a way to read the balance again and
 * says how ai33 is doing.
 */
export function Connections(): ReactElement {
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.setSettings)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Connections"
      description="The account Luca uses to make voices, music and sound."
      width={440}
    >
      {open ? <Account /> : null}
    </Sheet>
  )
}

function Account(): ReactElement {
  const hasKey = useAi33((s) => s.hasKey)
  const health = useAi33((s) => s.health)
  const refresh = useAi33((s) => s.refresh)
  const [refreshing, setRefreshing] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // the balance is read again every time the sheet opens
  useEffect(() => {
    void refresh()
  }, [refresh])

  // opened with no key (⌘, then paste): the key field is what they came for, but the sheet puts
  // the focus on Close as it opens, so this waits a beat for that
  useEffect(() => {
    let stale = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      const state = useAi33.getState()
      if (state.hasKey ?? (await state.checkKey())) return
      if (stale) return
      timer = setTimeout(() => box.current?.querySelector('input')?.focus(), 250)
    })()
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [])

  const reload = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const trouble = hasKey === true ? healthLine(health) : null
  return (
    <div ref={box} className="flex flex-col gap-3 pt-1 text-[12px] leading-[1.5] text-text-2">
      <section aria-labelledby="ai33-row">
        <div className="mb-1.5 flex items-center">
          <h3 id="ai33-row" className="text-[12px] font-semibold text-text">
            ai33
          </h3>
          {hasKey === true ? (
            <Tip label="Refresh credits">
              <Button
                variant="icon"
                aria-label="Refresh credits"
                loading={refreshing}
                onClick={() => void reload()}
                className="ml-auto"
              >
                <RefreshCw size={13} strokeWidth={1.5} />
              </Button>
            </Tip>
          ) : null}
        </div>
        <Ai33KeyCard context="sheet" />
        {trouble ? (
          <p className="mt-2 flex items-start gap-1.5 text-text-3" role="status">
            <CircleAlert size={12} className="mt-0.5 shrink-0 text-warning" />
            <span>{trouble}</span>
          </p>
        ) : null}
      </section>
      <p className="text-text-3">
        Credits are ai33’s own unit. Luca shows what each job used, so you can see the scale.
      </p>
      <p className="text-text-3">
        AssemblyAI, Pexels and Gemini keys are still added where you use them.
      </p>
      <p className="border-t border-border pt-3 text-[11px] text-text-3">
        Music, voices and sound effects made with ai33 have terms of use. If you sell your videos,
        check ai33’s terms. Luca keeps a note of each one in your project folder.
      </p>
    </div>
  )
}
