import type { ReactElement } from 'react'
import { EmptyPane } from '../EmptyPane'

export function TranscriptTab(): ReactElement {
  return <EmptyPane title="Transcript" hint="Run a clean edit to transcribe this video." />
}
