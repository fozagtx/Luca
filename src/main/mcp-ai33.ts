/**
 * Luca's ai33 tools as one list for the in-process MCP server (lucaMcpServer in mcp.ts): voices,
 * music, sound effects, placing a saved sound and the account. Each tool file owns
 * its tools; this puts them together, gives each the metadata the model finds tools by, and makes
 * sure no tool can ever throw at the model.
 */
import type { Ai33Ctx, Ai33Tool } from './ai33-ctx'
import { musicTools } from './tools/music-tool'
import { fail } from './tools/common'
import { placeTools } from './tools/place-tool'
import { sfxTools } from './tools/sfx-tool'
import { speechTools } from './tools/speech-tool'
import { statusTools } from './tools/status-tool'
import { plainError } from './ai33-client'

/** Words a request for each tool is likely to use, so a deferred tool is still found by them. */
const SEARCH_HINTS: Record<string, string> = {
  speech_generate:
    'record a voiceover, read a script aloud, a spoken line, text to speech, narration, a conversation between voices',
  voice_search: 'find, browse or listen to voices, narrators, a different voice',
  music_generate:
    'make music, a soundtrack, background music, an instrumental, a song for the video',
  sfx_generate: 'make a sound effect, a whoosh, a hit, a click, an ambience, a sound at a moment',
  audio_place: 'put a saved sound on the timeline, swap music, put audio back after an undo',
  ai33_status:
    'ai33 credits left, saved generated audio, collect a finished voiceover, music or sound'
}

/** Made often enough that the model should never have to search for them. */
const ALWAYS_LOADED = new Set(['speech_generate', 'music_generate', 'sfx_generate'])
const READ_ONLY = new Set(['voice_search'])

/** A tool as the model finds it: the tool file's own settings win over these defaults. */
function withMetadata(t: Ai33Tool): Ai33Tool {
  const meta: Record<string, unknown> = { ...t._meta }
  const hint = SEARCH_HINTS[t.name]
  if (hint && meta['anthropic/searchHint'] === undefined) meta['anthropic/searchHint'] = hint
  if (ALWAYS_LOADED.has(t.name) && meta['anthropic/alwaysLoad'] === undefined)
    meta['anthropic/alwaysLoad'] = true
  return {
    ...t,
    _meta: Object.keys(meta).length ? meta : undefined,
    annotations:
      READ_ONLY.has(t.name) && t.annotations?.readOnlyHint === undefined
        ? { ...t.annotations, readOnlyHint: true }
        : t.annotations,
    // a tool that forgot to guard itself still answers in words instead of throwing at the model
    handler: async (args, extra) => {
      try {
        return await t.handler(args, extra)
      } catch (err) {
        return fail(plainError(err).userMessage)
      }
    }
  }
}

export function ai33Tools(ctx: Ai33Ctx, projectDir: string): Ai33Tool[] {
  return [
    ...speechTools(ctx, projectDir),
    ...musicTools(ctx, projectDir),
    ...sfxTools(ctx, projectDir),
    ...placeTools(ctx, projectDir),
    ...statusTools(ctx, projectDir)
  ].map(withMetadata)
}
