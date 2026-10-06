import { useState, type ReactElement } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Sheet } from '../../components/ui/sheet'
import { parseTimecode } from '../../lib/timecode'
import { usePlayer } from '../../stores/player'
import { useUi } from '../../stores/ui'

export function GotoSheet(): ReactElement {
  const open = useUi((s) => s.gotoOpen)
  const setOpen = useUi((s) => s.setGoto)
  const seek = usePlayer((s) => s.seek)
  const fps = usePlayer((s) => s.fps)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)

  const go = (): void => {
    const t = parseTimecode(value, fps)
    // a time that can't be read says so instead of doing nothing
    if (t === null) {
      setInvalid(true)
      return
    }
    seek(t)
    setOpen(false)
    setValue('')
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setInvalid(false)
      }}
      title="Go to timecode"
      width={360}
      footer={
        <Button variant="primary" onClick={go}>
          Go
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
      >
        <Input
          autoFocus
          aria-label="Timecode"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'goto-error' : undefined}
          className="timecode h-8 text-[13px]"
          placeholder="00:00:12:04 or 12.5"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setInvalid(false)
          }}
        />
        {invalid ? (
          <p id="goto-error" className="fade-in mt-1.5 text-[11px] text-danger">
            Type a time like 00:00:12:04, 1:02 or 12.5
          </p>
        ) : null}
      </form>
    </Sheet>
  )
}
