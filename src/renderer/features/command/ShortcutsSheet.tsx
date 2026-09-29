import type { ReactElement } from 'react'
import { Sheet } from '../../components/ui/sheet'
import { useUi } from '../../stores/ui'

type Row = [keys: string, what: string]

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'Talk to Luca',
    rows: [
      ['/', 'Type to Luca'],
      ['↩', 'Send, or add to the queue while Luca works'],
      ['⌘↩', 'Approve what you said or dictated'],
      ['⌘↩', 'Allow a step Luca asks about (⇧⌘↩ always)'],
      ['⌘.', 'Stop Luca'],
      ['G', 'Click something in the video to comment on it']
    ]
  },
  {
    title: 'Play',
    rows: [
      ['Space', 'Play or pause'],
      ['J  K  L', 'Back a second, pause, forward a second'],
      ['←  →', 'One frame back or forward (⇧ for a second)'],
      ['Home  End', 'Go to the start or the end'],
      ['⌘G', 'Go to a timecode'],
      ['M', 'Mute']
    ]
  },
  {
    title: 'Timeline',
    rows: [
      ['S', 'Split the selected clip at the playhead'],
      ['[  ]', 'Trim the start or end to the playhead'],
      ['⌫', 'Delete the selected clip'],
      ['⌘=  ⌘-  ⌘0', 'Zoom in, out, reset'],
      ['⌘Z', 'Undo the last change']
    ]
  },
  {
    title: 'Projects',
    rows: [
      ['⌘N', 'Edit a video or a voiceover'],
      ['⌘O', 'Open a project'],
      ['⇧⌘W', 'Home: close the project'],
      ['⇧⌘R', 'Show the project in Finder'],
      ['⇧⌘E', 'Clean edit'],
      ['⌘Y', 'Versions'],
      ['⌘,', 'Connections']
    ]
  },
  {
    title: 'Everywhere',
    rows: [
      ['⌘K', 'Search commands'],
      ['⌘E', 'Export'],
      ['⌘1 – ⌘4', 'Transcript, B-roll, Looks, Sound'],
      ['⇧⌘S  ⇧⌘C', 'Show or hide the sidebar and the chat'],
      ['⇧⌘D', 'Light or dark'],
      ['?  ⌘/', 'This list']
    ]
  }
]

/** Every keyboard shortcut on one page (? or ⌘/). */
export function ShortcutsSheet(): ReactElement {
  const open = useUi((s) => s.shortcutsOpen)
  const setOpen = useUi((s) => s.setShortcuts)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Keyboard shortcuts"
      description="Most of Luca works without the mouse."
      width={560}
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-1">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1 text-[12px] font-semibold text-text">{g.title}</h3>
            <dl className="flex flex-col">
              {g.rows.map(([keys, what], i) => (
                <div
                  key={i}
                  className="flex items-baseline gap-3 border-b border-border py-1.5 last:border-0"
                >
                  <dt className="min-w-0 flex-1 text-[12px] leading-[1.4] text-text-2">{what}</dt>
                  <dd className="shrink-0 font-mono text-[11px] whitespace-pre text-text tabular-nums">
                    {keys}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  )
}
