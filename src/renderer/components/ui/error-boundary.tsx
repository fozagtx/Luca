import { Component, type ReactNode } from 'react'

/** Keeps one pane's render error from blanking the whole window. */
export class ErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error(`[luca] ${this.props.label} crashed`, error)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-[13px] font-medium text-text-2">
          Something went wrong in {this.props.label}
        </div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="rounded-[6px] border border-border bg-bg px-2.5 py-1 text-[12px] text-text hover:bg-hover"
        >
          Try again
        </button>
      </div>
    )
  }
}
