/**
 * Luca's ai33 tools as one list for the in-process MCP server (lucaMcpServer in mcp.ts): voices,
 * music, sound effects, pictures, placing a saved sound and the account. Each tool file owns
 * its tools; this only puts them together.
 */
import type { Ai33Ctx, Ai33Tool } from './ai33-ctx'
import { imageTools } from './tools/image-tool'
import { musicTools } from './tools/music-tool'
import { placeTools } from './tools/place-tool'
import { sfxTools } from './tools/sfx-tool'
import { speechTools } from './tools/speech-tool'
import { statusTools } from './tools/status-tool'

export function ai33Tools(ctx: Ai33Ctx, projectDir: string): Ai33Tool[] {
  return [
    ...speechTools(ctx, projectDir),
    ...musicTools(ctx, projectDir),
    ...sfxTools(ctx, projectDir),
    ...imageTools(ctx, projectDir),
    ...placeTools(ctx, projectDir),
    ...statusTools(ctx, projectDir)
  ]
}
