import type { ReactElement } from 'react'

export function Chat(): ReactElement {
  return (
    <section className="flex h-full flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center border-b border-border px-3 text-[12px] font-medium text-text-2">
        Chat
      </header>
      <div className="flex flex-1 items-center justify-center text-[12px] text-text-3">
        Claude will appear here.
      </div>
    </section>
  )
}
