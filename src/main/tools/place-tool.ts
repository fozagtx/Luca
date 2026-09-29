import { tool } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Ai33Ctx, Ai33Tool } from '../ai33-ctx'
import { placeAudio, projectHasVoice } from '../place'
import { findClip } from '../place-html'
import { readProject } from '../projects'
import { fail, okJson } from './common'

const ROW_NAME = {
  voice: 'the Voiceover row',
  music: 'the Music row',
  sfx: 'the Sound effects row'
}

const ALREADY_A_VOICE =
  'There is already a voice in this video. Give this line a start time (at) so it doesn’t talk over it.'

const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** audio_place, for the ai33 MCP server (mcp-ai33.ts). It needs no ai33 key and costs nothing. */
export function placeTools(_ctx: Ai33Ctx, projectDir: string): Ai33Tool[] {
  return [
    tool(
      'audio_place',
      'Put a saved sound file on the timeline safely, or swap one for another, with no new credits. Use it for the other music take, to put something back after an undo (ai33_status saved lists what is saved), and for audio the user attached in the chat (their music, a recording). It checks the file first and sets the row, level and fades itself: never write audio tags by hand, because one unreadable file makes the whole export fail.',
      {
        file: z
          .string()
          .describe('the project file, e.g. media/generated/music/calm-piano-91ab0c33de-2.mp3'),
        role: z
          .enum(['voice', 'music', 'sfx'])
          .describe('voice: someone speaking; music: a bed under the video; sfx: one short effect'),
        at: z
          .number()
          .min(0)
          .optional()
          .describe(
            'start on the timeline, seconds. Music defaults to 0 (or the clip it replaces); a voice defaults to 0 only while the video has no voice; a sound effect needs it'
          ),
        until: z
          .number()
          .optional()
          .describe(
            'end on the timeline, seconds. Music defaults to the end of the video (or the clip it replaces) and never runs past it'
          ),
        volume: z
          .number()
          .min(0)
          .max(2)
          .optional()
          .describe(
            'only when the user asks for a level; music is set quietly under the voice by itself'
          ),
        replaces: z
          .string()
          .optional()
          .describe('the id of a clip of the same role to take out; the new one keeps its place')
      },
      async ({ file, role, at, until, volume, replaces }) => {
        const p = readProject(projectDir)
        if (!p) return fail('No project is open.')
        try {
          const html = readFileSync(join(p.dir, 'index.html'), 'utf8')
          const old = replaces ? findClip(html, replaces) : null
          if (replaces && !old)
            return fail(
              `There is no sound called “${replaces}” on the timeline. Read the timeline for the clip’s id.`
            )
          const voiceBefore = role === 'voice' && !old && projectHasVoice(p)
          if (voiceBefore && at === undefined) return fail(ALREADY_A_VOICE)
          const start = at ?? old?.start ?? (role === 'sfx' ? undefined : 0)
          if (start === undefined)
            return fail('Say when the sound effect should play (at, in seconds).')
          const placed = await placeAudio(p, {
            file,
            role,
            start,
            // a swapped-in bed covers the range of the one it replaces; a voice or effect is as long as its file
            until: until ?? (role === 'music' ? (old?.end ?? undefined) : undefined),
            volume,
            replaces
          })
          const level = placed.volume === undefined ? '' : ` at level ${placed.volume}`
          return okJson({
            ok: true,
            kind: 'place',
            placed,
            credits: 0,
            tell: `Put “${placed.title ?? 'the sound'}” on ${ROW_NAME[role]} from ${clock(placed.start)} to ${clock(placed.end)}${level}. No credits used. You cannot hear it: report the times only.`,
            ...(voiceBefore
              ? {
                  place:
                    'Captions and transcript still follow the original recording, not this voice. The original audio keeps playing: if the user wants only the new voice, tell them they can mute the original row in the timeline.'
                }
              : {})
          })
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      },
      {
        searchHint:
          'put a saved sound on the timeline, swap the other music take, put music back after undo, add the user’s own audio or music'
      }
    )
  ]
}
