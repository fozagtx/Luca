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

  const go = (): void => {
    const t = parseTimecode(value, fps)
    if (t !== null) {
      seek(t)
      setOpen(false)
      setValue('')
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
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
          className="timecode h-8 text-[13px]"
          placeholder="00:00:12:04 or 12.5"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </form>
    </Sheet>
  )
}
