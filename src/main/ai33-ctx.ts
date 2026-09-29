/**
 * What Luca's ai33 tools are given by the agent for one session: where to report progress, how
 * to ask the person (a connect card, a cost card) and the turn they run in. Types only.
 */
import type { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { Ai33Ask } from '../shared/ai33'
import type { Project } from '../shared/types'

/**
 * One tool of Luca's MCP server, as `tool(...)` returns it. (SdkMcpToolDefinition[] alone rejects
 * tools with typed inputs; this is the element type createSdkMcpServer accepts.)
 */
export type Ai33Tool = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>[number]

export type ToolName =
  | 'speech_generate'
  | 'voice_search'
  | 'music_generate'
  | 'sfx_generate'
  | 'audio_place'
  | 'ai33_status'

/** One turn of the conversation: what its jobs may spend, and the signals that end them. */
export type Ai33Turn = {
  id: number
  /** Aborted when the person presses Stop: jobs are cancelled at ai33 too. */
  stop: AbortSignal
  /** Aborted when the project closes or the session restarts: polling stops, the job carries on. */
  detach: AbortSignal
  /** What the turn has spent so far (credits reserved or used, paid calls, units by kind). */
  spent: { credits: number; paid: number; byKind: Record<string, number> }
}

export type Ai33Ctx = {
  projectDir: string
  projectId: string
  /** Where the running step is; `pct` is null while ai33 gives no progress. */
  progress(tool: ToolName, p: { pct: number | null; note?: string }): void
  /** Awaits a card in the chat; Stop or a timeout answers 'deny'. */
  ask(ask: Ai33Ask): Promise<'allow' | 'deny'>
  /** Awaits the ai33 key card: true once connected, false on Not now, Stop or a timeout. */
  connect(): Promise<boolean>
  turn(): Ai33Turn
}

/** What the spend policy needs: the same asks and turn, and no project when a script starts one. */
export type SpendCtx = Pick<Ai33Ctx, 'ask' | 'turn'> & { projectDir: string | null }

/** Reports how far a job is; `pct` is null while ai33 gives no progress. */
export type ProgressFn = (p: { pct: number | null; note?: string }) => void

/** What making music or sound effects needs from the tool that asked for it. */
export type MakeCtx = {
  project: Project
  /** Aborted by Stop, the project closing or a restart: stop waiting. */
  signal: AbortSignal
  /** Aborted only by Stop: cancel the job at ai33 too. */
  stop?: AbortSignal
  onProgress?: ProgressFn
}
