import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Grant, MusicReq, MusicResult } from '../../shared/ai33'
import type { Ai33Ctx, Ai33Tool } from '../ai33-ctx'
import {
  costClause,
  lowNote,
  makeMusic,
  musicAlongside,
  musicIsFree,
  musicLostRecently,
  musicRange,
  secs,
  settleFailure
} from '../ai33-sound'
import { gateSpendWith, holdSpend, settleSpend } from '../ai33-spend'
import { readProject } from '../projects'
import { fail, guarded, okJson, STILL_WORKING } from './common'

/** music_generate, for the ai33 MCP server (mcp-ai33.ts). */
export function musicTools(ctx: Ai33Ctx, projectDir: string): Ai33Tool[] {
  return [
    tool(
      'music_generate',
      'Make instrumental music (two takes come back) and put the first quietly under the video. Spends the user’s ai33 credits (thousands) and takes a minute or two. Use only when the user asks for music or the plan switches it on, after the cuts and titles so it fits the final length, one request per video, never when the user attached their own music, never vocals, never a named artist or song. Say what you are making before you call.',
      {
        mood: z
          .string()
          .min(3)
          .max(500)
          .describe(
            'what the music should feel like, in plain words ("calm piano, slow and warm"); no artist or song names'
          ),
        instrumental: z.boolean().default(true).describe('leave true: the music has no singing'),
        from: z
          .number()
          .min(0)
          .default(0)
          .describe('seconds into the video where the music starts'),
        to: z
          .number()
          .optional()
          .describe('seconds where it ends; default: the end of the video, and never later'),
        level: z
          .enum(['quiet', 'medium'])
          .default('quiet')
          .describe('how far under the voice: quiet (about 16 dB) or medium (about 11 dB)'),
        place: z
          .boolean()
          .default(true)
          .describe('false only to save the music without putting it on the timeline')
      },
      (args, extra) =>
        guarded(ctx, 'music_generate', extra, async (g) => {
          const p = readProject(projectDir)
          if (!p) return fail('No project is open.')
          const req: MusicReq = {
            mood: args.mood,
            instrumental: args.instrumental,
            from: args.from,
            to: args.to,
            level: args.level,
            place: args.place
          }

          // nothing is spent on music that has nowhere to go
          if (req.place) {
            const range = musicRange(p.dir, req.from, req.to)
            if (typeof range === 'string') return fail(`${range} Nothing was charged.`)
          }

          // music already made for this request is free: no card, and nothing reserved
          let grant: Grant | null = null
          if (!(await musicIsFree(req, p))) {
            const gate = await gateSpendWith(
              ctx,
              {
                kind: 'music',
                units: 1,
                summary: `Music: ${req.mood.replace(/\s+/g, ' ').trim()}`.slice(0, 80),
                thing: 'music'
              },
              { again: musicLostRecently(req), tool: 'music_generate' }
            )
            if (!gate.go) return gate.result
            grant = gate.grant
          }

          let made: MusicResult
          try {
            made = await makeMusic(
              req,
              {
                project: p,
                signal: g.signal,
                stop: g.stop,
                onProgress: g.progress
              },
              { approved: grant !== null }
            )
          } catch (err) {
            if (grant) settleFailure(ctx, grant, err)
            throw err
          }

          // a job still running at ai33 keeps its estimate: what it costs isn't known yet, so no
          // price is learned from it either
          if (made.working) {
            if (grant) holdSpend(ctx, grant)
            return okJson({
              ok: true,
              kind: 'music',
              working: true,
              task: made.working.jobId,
              tell: `${STILL_WORKING} Tell the user that in one short sentence. Do not make the music again.`
            })
          }
          if (grant) settleSpend(ctx, grant, made.credits)

          const cost = costClause(made.credits, made.left, made.reused)
          const placed = made.placed
          const second = made.files[1]
          const notes: string[] = []
          if (made.fitted === 'joined')
            notes.push(
              'The first take was shorter than the video, so both takes were joined to cover it.'
            )
          const also = placed ? musicAlongside(p.dir, placed) : []
          if (also.length)
            notes.push(
              `There was already music playing there (${also.join(', ')}), so two pieces of music play together now. Tell the user in one short sentence and offer to take the old one out.`
            )
          return okJson({
            ok: true,
            kind: 'music',
            files: made.files,
            seconds: made.seconds,
            credits: made.credits,
            left: made.left,
            reused: made.reused,
            placed,
            fitted: made.fitted,
            tell: placed
              ? `The music is on the timeline. In your reply say what you made, where it plays and for how long, ${cost}, and offer ${second ? 'the second take' : 'a different mood'} as your one next step. Never describe how it sounds.${lowNote(made.left)}`
              : `The music is saved but not on the timeline. In your reply say so, ${cost}, and offer to put it under the video.${lowNote(made.left)}`,
            place: placed
              ? `Take 1 is under the video from ${secs(placed.start)} to ${secs(placed.end)} at level ${placed.volume} with a ${placed.fadeIn ?? 0} s fade in and ${placed.fadeOut ?? 0} s fade out.${
                  second
                    ? ` The second take is saved (${second}): to switch, call audio_place with its file and replaces set to ${placed.id}.`
                    : ' Only one take came back.'
                } Do not describe how it sounds.`
              : `${second ? 'Both takes are' : 'The take is'} saved: to use one, call audio_place with its file and role music. Do not describe how it sounds.`,
            ...(notes.length ? { note: notes.join(' ') } : {})
          })
        }),
      {
        searchHint: 'make instrumental background music under the video',
        alwaysLoad: true
      }
    )
  ]
}
