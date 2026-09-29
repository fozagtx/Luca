import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Grant, SfxReq } from '../../shared/ai33'
import type { Ai33Ctx, Ai33Tool } from '../ai33-ctx'
import {
  costClause,
  lowNote,
  makeSfx,
  planSfx,
  SFX_LEAD,
  secs,
  settleFailure,
  sfxCredits,
  sfxLostRecently,
  videoLength,
  type SfxOutcome
} from '../ai33-sound'
import { gateSpendWith, settleSpend } from '../ai33-spend'
import { SFX_VOLUME } from '../place'
import { readProject } from '../projects'
import { fail, guarded, okJson, STILL_WORKING } from './common'

/** sfx_generate, for the ai33 MCP server (mcp-ai33.ts). */
export function sfxTools(ctx: Ai33Ctx, projectDir: string): Ai33Tool[] {
  return [
    tool(
      'sfx_generate',
      'Make short sound effects and drop each at a moment. Price is exact (50 credits per second, whole seconds). Only for a moment the user names or the plan lists (a whoosh as a title lands, a click on a number): short, dry prompts, an explicit length, at most one every 6 s, never a texture under everything, never in a founder video unless asked. Time it from the times transcribe returns.',
      {
        effects: z
          .array(
            z.object({
              what: z
                .string()
                .min(3)
                .max(450)
                .describe('the sound, short and dry ("a quick whoosh", "a soft keyboard click")'),
              at: z.number().min(0).describe('seconds into the video of the moment it marks'),
              seconds: z
                .number()
                .min(1)
                .max(30)
                .default(2)
                .describe('how long it plays; rounded to whole seconds, 50 credits each'),
              loop: z
                .boolean()
                .default(false)
                .describe('a steady sound that repeats smoothly (rain, a hum); rarely wanted'),
              level: z
                .number()
                .min(0)
                .max(1)
                .default(SFX_VOLUME)
                .describe('how loud, 0 to 1; leave the default')
            })
          )
          .min(1)
          .max(6),
        place: z
          .boolean()
          .default(true)
          .describe('false only to save the effects without putting them on the timeline')
      },
      (args, extra) =>
        guarded(ctx, 'sfx_generate', extra, async (g) => {
          const p = readProject(projectDir)
          if (!p) return fail('No project is open.')
          const req: SfxReq = { effects: args.effects, place: args.place }

          // nothing is spent on a moment the video doesn't have
          const end = videoLength(p.dir)
          const late = req.place && end > 0 ? req.effects.find((e) => e.at >= end) : undefined
          if (late)
            return fail(
              `There is no moment at ${secs(late.at)} in this video (it is ${secs(end)} long). Nothing was charged.`
            )

          // effects already saved, or already at ai33, cost nothing: only the rest is priced and asked
          const { jobs } = planSfx(req, p)
          const paid = jobs.filter((j) => !j.reuse)
          let grant: Grant | null = null
          if (paid.length) {
            const gate = await gateSpendWith(
              ctx,
              {
                kind: 'sfx',
                units: paid.length,
                summary: (paid.length === 1
                  ? `Sound effect: ${paid[0].what}`
                  : `${paid.length} sound effects: ${paid.map((j) => j.what).join(', ')}`
                ).slice(0, 80),
                // the price is exact: 50 credits a second, whole seconds
                estimate: {
                  credits: paid.reduce((n, j) => n + sfxCredits(j.seconds), 0),
                  exact: true,
                  basis: 'formula'
                },
                batch: paid.length,
                thing: paid.length === 1 ? 'a sound effect' : `${paid.length} sound effects`
              },
              { again: sfxLostRecently(paid) }
            )
            if (!gate.go) return gate.result
            grant = gate.grant
          }

          let made: SfxOutcome
          try {
            made = await makeSfx(
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

          // effects still being made are paid for at their exact price; they finish in the background
          const later = made.working ?? []
          const failed = made.failed ?? []
          if (grant) {
            const pending = later.filter((w) =>
              paid.some((j) => j.what === w.what && j.seconds === w.seconds)
            )
            settleSpend(
              ctx,
              grant,
              made.credits + pending.reduce((n, w) => n + sfxCredits(w.seconds), 0)
            )
          }

          const reused = paid.length === 0
          const cost = costClause(made.credits, made.left, reused)
          const nothingElse = !made.files.length && !failed.length
          const named = (list: { what: string; at: number }[]): string =>
            list.map((e) => `“${e.what}” at ${secs(e.at)}`).join('; ')
          const count = made.files.length
          const tell = [
            count
              ? made.placed.length
                ? `Added ${made.placed.length === 1 ? 'a sound effect' : `${made.placed.length} sound effects`} to the timeline. In your reply say what you added and when, ${cost}, and offer one next step. Never describe how it sounds.`
                : `The sound effects are saved but not on the timeline. In your reply say so, ${cost}.`
              : '',
            failed.length
              ? `These could not be made or added: ${failed.map((f) => `“${f.what}” at ${secs(f.at)} (${f.reason})`).join('; ')}. Say so in one short sentence and do not retry them on your own.`
              : '',
            later.length
              ? `Still being made: ${named(later)}. ${STILL_WORKING} Tell the user that in one short sentence and do not make them again.`
              : ''
          ]
            .filter(Boolean)
            .join(' ')

          return okJson({
            ok: true,
            kind: 'sfx',
            // nothing placed or saved yet, everything still being made: the step reads "still being made"
            ...(nothingElse && later.length ? { working: true, task: later[0].jobId } : {}),
            placed: made.placed,
            files: made.files,
            credits: made.credits,
            left: made.left,
            ...(reused && count ? { reused: true } : {}),
            ...(failed.length ? { failed } : {}),
            ...(later.length ? { later: later.map((w) => ({ what: w.what, at: w.at })) } : {}),
            tell: `${tell}${lowNote(made.left)}`,
            place: `Each effect starts ${SFX_LEAD} s before its time, on a shared Sound effects row. Never describe how it sounds.`
          })
        }),
      {
        searchHint: 'make a short sound effect (whoosh, click, hit) at a moment in the video',
        alwaysLoad: true
      }
    )
  ]
}
