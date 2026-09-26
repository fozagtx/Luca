import type { ReactElement, ReactNode } from 'react'

export function EmptyPane({
  title,
  hint,
  action
}: {
  title: string
  hint?: string
  action?: ReactNode
}): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-[13px] font-medium text-text-2">{title}</div>
      {hint && <div className="text-[12px] leading-relaxed text-text-3">{hint}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
