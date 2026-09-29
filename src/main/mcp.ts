import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  BUILTIN_FONTS,
  BUNDLED_FONTS,
  CAPTION_ANIMATIONS,
  CAPTION_STYLES,
  captionStyle,
  configFor,
  type CaptionAnim
} from '../shared/captions'
import { CATEGORIES, categoryLabel, searchLibrary, type LibraryItem } from '../shared/catalog'
import { BUNDLED_LUTS } from '../shared/luts'
import type { CaptionConfig, Cut, CutReason } from '../shared/types'
import { applyColor, footageVideos, removeColor } from './color'
import {
  addFontByName,
  addGoogleFont,
  applyCaptions,
  captionState,
  hasTranscript,
  knownFont
} from './captions'
import {
  cleanEditInTurn,
  EditRefused,
  placeVoiceover,
  transcribeInTurn,
  type Heard,
  type Phrase
} from './clean'
import { library } from './library'
import { HYPERFRAMES } from './env'
import { addBroll, hasPexelsKey, searchBroll } from './pexels'
import { readProject } from './projects'
import { installComponent, placeComponent, setupStudio, studioStatus } from './remocn'

const text = (data: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }]
})

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** How many broll_search results come with a preview Luca can look at. */
const PREVIEWS = 8

const NO_PEXELS =
  'B-roll is not connected yet (no Pexels key). If the user asked for B-roll or a stock picture or clip, tell them in one short sentence to connect Pexels in the B-roll panel; otherwise show it another way (a title, a callout, a graphic from catalog_search) and do not mention this.'

/** Where B-roll goes: over the footage while it keeps playing, never behind it. */
const BROLL_PLACE =
  'on a track above the footage where the thing is mentioned: full frame (object-fit: cover) for 1.5–4 s as a cutaway, in and out with a quick cut or a ~0.2 s fade, while the voice keeps playing. When the speaker should stay visible, show it as a card or picture-in-picture instead (rounded corners, a soft shadow, clear of the face). Never put it behind the footage.'

/** With only a voiceover there is nothing under B-roll: it is the picture. */
const BROLL_SCENE =
  'where the words name it, full frame (object-fit: cover), as one of the video’s scenes: there is no footage under it, so B-roll and the other visuals (animated key words, simple diagrams) play back to back, each on screen while what it shows is said, and the frame is never empty.'

/** Whether index.html plays footage the user brought, which B-roll cuts away from. */
function hasFootage(projectDir: string): boolean {
  try {
    return footageVideos(readFileSync(join(projectDir, 'index.html'), 'utf8')).length > 0
  } catch {
    return true
  }
}

/** A small still as an image block, or null when it can't be fetched quickly. */
async function preview(url: string): Promise<Content | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    // only image types Claude reads; anything else would fail the whole turn
    const mimeType = /^image\/(jpeg|png|gif|webp)\b/.exec(
      res.headers.get('content-type') ?? ''
    )?.[0]
    if (!res.ok || !mimeType) return null
    const data = Buffer.from(await res.arrayBuffer()).toString('base64')
    return { type: 'image', data, mimeType }
  } catch {
    return null
  }
}

const categoryIds = CATEGORIES.map((c) => c.id) as [
  LibraryItem['category'],
  ...LibraryItem['category'][]
]

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// ------------------------------------------------------------------ captions

const styleIds = CAPTION_STYLES.map((s) => s.id) as [string, ...string[]]
const animationIds = CAPTION_ANIMATIONS.map((a) => a.id) as [CaptionAnim, ...CaptionAnim[]]
const cssColor = z.string().describe('a CSS color, e.g. "#FFE14D" or "rgba(0,0,0,0.6)"')

const NO_TRANSCRIPT =
  'This video has no transcript yet, so there are no words to caption. Call transcribe first, then captions_apply again. Do not write captions by hand.'
const NO_SPEECH =
  'This project has no video or audio with speech, so there is nothing to caption. Offer animated titles or text instead.'
const OFF_TIMELINE =
  'The video the transcript belongs to is no longer on the timeline, so there are no words to caption. Tell the user in one short sentence.'

// ------------------------------------------------------------------ words and cuts

/** What Luca says (or does) when transcribe or clean_edit can't run. */
const REFUSALS: Record<EditRefused['reason'], string> = {
  'no-key':
    'Luca can’t hear the words yet (no AssemblyAI key). Tell the user in one short sentence that they can connect AssemblyAI in the Transcript tab to get them. Do not write captions or guess what is said.',
  'no-source':
    'This project has no video or voiceover with speech, so there are no words to hear or cut. Say so in one short sentence if it matters for what they asked; do not guess what is said.',
  'no-speech':
    'No speech was heard in this video, so there are no words to caption or cut. Say so in one short sentence if it matters for what they asked; do not guess what is said.',
  busy: 'The Transcript tab is cleaning this video right now. If it asked you to review its cut list, write edl.json as it asked; otherwise tell the user in one short sentence to let it finish, then ask again.',
  'already-cut':
    'The ums and pauses are already cut: a clean edit is on the timeline, and it runs once. Call transcribe for the words as they play now. If the user wants more cut, tell them in one short sentence they can change the cuts in the Transcript tab.',
  'off-timeline':
    'The original recording is no longer on the timeline, so there is nothing to cut. Tell the user in one short sentence.',
  'over-footage':
    'The voice is a separate voiceover playing over the footage, so cutting ums and pauses out of it would pull it out of step with the picture. Do not cut it; tell the user in one short sentence that they can trim pauses themselves in the timeline.'
}

const refusal = (err: unknown): string =>
  err instanceof EditRefused ? REFUSALS[err.reason] : message(err)

/** About as much of the words as goes back to Luca at once; the rest stays in transcript.json. */
const MAX_WORDS_TEXT = 12_000

const at = (n: number): string => n.toFixed(2)

/** One line per phrase, `[12.30–15.80] and that's why it works`. */
function phraseLines(phrases: Phrase[]): string {
  const out: string[] = []
  let size = 0
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i]
    const line = `[${at(p.start)}–${at(p.end)}] ${p.text}`
    if (out.length && size + line.length > MAX_WORDS_TEXT) {
      const last = phrases[phrases.length - 1]
      out.push(
        `…${phrases.length - i} more lines, to ${at(last.end)} s, left out here: the rest of the words are in transcript.json (times in the recording).`
      )
      break
    }
    out.push(line)
    size += line.length + 1
  }
  return out.join('\n')
}

/** The summary on its first line, then what is said as timed lines. */
function heardResult(summary: Record<string, unknown>, h: Heard): { content: Content[] } {
  const notes = [
    h.placed
      ? `The voiceover wasn’t on the timeline, so it is now: an audio clip from 0 to ${at(h.seconds)} s, and the video is at least that long. Build the visuals over it.`
      : '',
    h.onTimeline
      ? ''
      : 'No clip on the timeline plays this recording, so these are times in the recording itself.',
    h.cut ? 'A clean edit is on: the times follow the cut video.' : '',
    h.shifted
      ? 'The recording is trimmed or moved on the timeline, so these times differ from its own: clean_edit takes the recording’s own times, which are in transcript.json.'
      : '',
    h.firstClipOnly
      ? 'Only the first clip the user started from is transcribed: the clips after it have no words here, so captions and cuts cover the first clip only.'
      : ''
  ].filter(Boolean)
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ...summary, ...(notes.length ? { note: notes.join(' ') } : {}) })
      },
      {
        type: 'text',
        text: h.phrases.length
          ? `What is said, as [start–end] seconds ${h.onTimeline ? 'on the timeline' : 'in the recording'}:\n${phraseLines(h.phrases)}`
          : 'No words play on the timeline now.'
      }
    ]
  }
}

const SIZES: Record<CaptionConfig['size'], string> = { sm: 'small', md: 'medium', lg: 'large' }

/** What the captions look like now, for Luca to put in its own words. */
function describeCaptions(cfg: CaptionConfig, lines: number): string {
  const o = cfg.overrides
  const parts = [
    `${lines} caption lines in the ${captionStyle(cfg.style).name} style`,
    `font ${cfg.font}`,
    `${SIZES[cfg.size]} size`,
    `${cfg.position} of the frame`,
    cfg.uppercase ? 'all caps' : '',
    cfg.accent ? `highlight color ${cfg.accent}` : '',
    o ? `customized: ${Object.keys(o).join(', ')}` : ''
  ]
  return parts.filter(Boolean).join(', ')
}

/**
 * Set extras up quietly the first time Luca reaches for one: the person only describes what they
 * want, so there is no setup screen and no setup error to show them. A failure is logged and
 * the next request tries again.
 */
function prepareExtras(): void {
  void setupStudio().then(
    (r) => {
      if (!r.ok) console.warn('[extras] setup failed:', r.error)
    },
    (err: unknown) => console.warn('[extras] setup failed:', err)
  )
}

function describe(i: LibraryItem, remocnReady: boolean): Record<string, unknown> {
  const base = {
    name: i.name,
    source: i.source,
    kind: i.type,
    title: i.title,
    category: categoryLabel(i.category),
    description: i.description.length > 240 ? `${i.description.slice(0, 240)}…` : i.description
  }
  if (i.source === 'hyperframes')
    return {
      ...base,
      ...(i.duration ? { durationSeconds: Math.round(i.duration * 10) / 10 } : {}),
      add: `npx ${HYPERFRAMES} add ${i.name} --json`
    }
  return {
    ...base,
    useFor: i.remocn?.useFor,
    avoidFor: i.remocn?.avoidFor,
    length: i.remocn?.naturalLength,
    docs: i.remocn?.docs,
    ...(remocnReady
      ? { add: `remocn_install {"name":"${i.name}"}, write remocn/<clipId>.tsx, then remocn_place` }
      : {
          ready: false,
          note: 'Not available yet: Luca sets extras up by itself in the background the first time one is asked for. Use a HyperFrames item now, and never mention the setup to the user.'
        })
  }
}

/**
 * Luca's in-process MCP server: the words and the clean edit, catalog search, B-roll, captions and
 * fonts, plus the remocn tools described in the spec.
 */
export function lucaMcpServer(projectDir: string): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'luca',
    version: '1.0.0',
    instructions:
      'catalog_search finds ready-made HyperFrames blocks/components and Remocn components by ' +
      'plain words ("lower third", "text reveal", "logo intro", "bar chart"). Use it ' +
      'before building any visual from scratch; never grep or script the catalog yourself. ' +
      'Remocn components are React/Remotion. Never put React in the HyperFrames HTML. ' +
      'Install with remocn_install, read the returned docs URL, write remocn/<clipId>.tsx in the ' +
      'project (default export rendering the component with props, plus `export const durationInFrames`), ' +
      'then call remocn_place. Re-run remocn_place with the same clipId after editing the wrapper. ' +
      'transcribe returns what is said in the footage or voiceover as timed lines (transcribing it ' +
      'the first time); clean_edit cuts the ums, pauses and retakes out of it and returns the words ' +
      're-timed to the cut video. ' +
      'broll_search finds free stock photos and short clips (Pexels) of things that are mentioned, ' +
      'to show as B-roll, with previews of the best ones; broll_add downloads the chosen one into ' +
      'media/broll, sized for this video, and returns the path to use and how to place it (over ' +
      'the footage, never behind it; with only a voiceover, as the scenes themselves). ' +
      'captions_apply puts captions of what is said on the video (from the transcript) and changes ' +
      'their look; Luca keeps them in sync with every cut, so never write or edit them by hand. ' +
      'font_add adds a font that comes with Luca, or downloads a Google Fonts font, into the project ' +
      'so any text can use it offline. ' +
      'lut_apply grades the footage with a LUT that comes with Luca (a color look) or removes it.',
    tools: [
      tool(
        'transcribe',
        'Hear what is said in the footage or voiceover. Transcribes it the first time (a minute or two for a long video; the user sees the progress in the Transcript tab), then returns the word count, the length and the words as timed lines, [start–end] in seconds on the timeline, broken at sentence ends and pauses; after a clean edit they follow the cut video. Call it before anything that depends on the words (cuts, a hook title, B-roll of what is mentioned, a name title, captions) and never guess what is said.',
        {
          force: z
            .boolean()
            .optional()
            .describe(
              'transcribe it again even if it was; only when the user says the words are wrong'
            )
        },
        async ({ force }) => {
          const p = readProject(projectDir)
          if (!p) return text({ ok: false, error: 'No project is open.' })
          try {
            const h = await transcribeInTurn(p, { force })
            return heardResult({ ok: true, words: h.words, seconds: h.seconds }, h)
          } catch (err) {
            return text({ ok: false, error: refusal(err) })
          }
        }
      ),
      tool(
        'clean_edit',
        [
          'Cut the ums, uhs, long pauses, retakes and false starts out of the footage or voiceover, in one go. It transcribes first if needed, finds every filler and long pause by itself, adds the cuts you pass, renders a clean version and puts it on the timeline in place of the original (captions and everything after each cut follow).',
          'Read what is said with transcribe first and pass the retakes and false starts you find: when a line is said again, cut the earlier attempt and keep the last good take. Never cut what changes the meaning.',
          'It runs once per video, before anything else is added. Returns the cuts made, the seconds removed, the new length and the words re-timed to the cut video: place titles, zooms and B-roll with those times.'
        ].join('\n'),
        {
          cuts: z
            .array(
              z.object({
                start: z.number().min(0),
                end: z.number().min(0),
                reason: z.enum(['retake', 'false_start', 'manual']),
                text: z.string().optional().describe('the words cut, e.g. "so the first thing"')
              })
            )
            .max(300)
            .optional()
            .describe(
              'retakes and false starts to cut besides the fillers and pauses it finds itself; times in seconds as transcribe listed them before any cut (word-exact times are in transcript.json)'
            )
        },
        async ({ cuts }, extra) => {
          const p = readProject(projectDir)
          if (!p) return text({ ok: false, error: 'No project is open.' })
          const signal = (extra as { signal?: AbortSignal } | undefined)?.signal
          try {
            const own: Cut[] = (cuts ?? []).map((c) => ({ ...c, text: c.text ?? '' }))
            const r = await cleanEditInTurn(p, own, signal)
            const kinds: Partial<Record<CutReason, number>> = {}
            for (const c of r.cuts) kinds[c.reason] = (kinds[c.reason] ?? 0) + 1
            return heardResult(
              r.cuts.length
                ? {
                    ok: true,
                    cuts: r.cuts.length,
                    kinds,
                    removed: r.removed,
                    secondsBefore: r.before,
                    seconds: r.seconds,
                    words: r.words
                  }
                : {
                    ok: true,
                    cuts: 0,
                    seconds: r.seconds,
                    words: r.words,
                    tell: 'There was nothing to cut: no ums, long pauses or retakes.'
                  },
              r
            )
          } catch (err) {
            return text({ ok: false, error: refusal(err) })
          }
        }
      ),
      tool(
        'catalog_search',
        'Search every ready-made HyperFrames block/component and Remocn component by what it looks like or does. Returns the best matches with what each is for and how to add it.',
        {
          query: z
            .string()
            .describe('plain words, e.g. "lower third", "kinetic text", "logo intro"'),
          source: z.enum(['all', 'hyperframes', 'remocn']).optional().describe('default all'),
          category: z
            .enum(categoryIds)
            .optional()
            .describe(`narrow to one group: ${CATEGORIES.map((c) => c.id).join(', ')}`),
          limit: z.number().int().min(1).max(40).optional().describe('default 12')
        },
        async ({ query, source, category, limit }) => {
          const items = await library(projectDir)
          let hits = searchLibrary(items, query, { source: source ?? 'all', category })
          const remocnReady = studioStatus().ready
          // without the studio, Remocn items can't be placed yet: list usable ones first
          if (!remocnReady && (source ?? 'all') === 'all')
            hits = [
              ...hits.filter((i) => i.source === 'hyperframes'),
              ...hits.filter((i) => i.source === 'remocn')
            ]
          return text({
            query,
            total: hits.length,
            ...(remocnReady ? {} : { remocnReady: false }),
            results: hits.slice(0, limit ?? 12).map((i) => describe(i, remocnReady))
          })
        }
      ),
      tool(
        'broll_search',
        'Search free stock photos and short clips (Pexels) of something that is mentioned, to show as B-roll: a product, a place, a company or its logo, an object, an animal, an idea made visual. Returns the best matches with their ids, plus small previews of the first ones so you can see them. Pick the one that shows exactly what is said, then add it with broll_add. Never use it for a background.',
        {
          query: z
            .string()
            .min(1)
            .describe(
              'what the picture should show, in plain words: "electric car charging", "tokyo street at night", "stock market chart", "coffee beans", "person typing on a laptop"'
            ),
          media: z
            .enum(['any', 'photo', 'video'])
            .optional()
            .describe('default any; videos are short clips, shown muted for a few seconds'),
          limit: z.number().int().min(1).max(24).optional().describe('default 12')
        },
        async ({ query, media, limit }) => {
          if (!hasPexelsKey()) return text({ ok: false, error: NO_PEXELS })
          try {
            const res = await searchBroll({
              query,
              media: media === 'photo' || media === 'video' ? media : 'all',
              orientation: readProject(projectDir)?.aspect ?? 'landscape'
            })
            const hits = res.items.slice(0, limit ?? 12)
            const content: Content[] = [
              {
                type: 'text',
                text: JSON.stringify({
                  query,
                  total: hits.length,
                  results: hits.map((b) => ({
                    id: b.id,
                    media: b.media,
                    shows: b.title,
                    ...(b.duration ? { seconds: b.duration } : {}),
                    size: `${b.width}x${b.height}`,
                    by: b.author
                  })),
                  ...(hits.length
                    ? { previews: `The first ${Math.min(PREVIEWS, hits.length)} follow, in order.` }
                    : {})
                })
              }
            ]
            const shots = await Promise.all(hits.slice(0, PREVIEWS).map((b) => preview(b.thumb)))
            shots.forEach((shot, i) => {
              if (!shot) return
              content.push({ type: 'text', text: `${hits[i].id}: ${hits[i].title}` }, shot)
            })
            return { content }
          } catch (err) {
            return text({ ok: false, error: message(err) })
          }
        }
      ),
      tool(
        'broll_add',
        'Download B-roll found with broll_search (or picked by the user) into the project, sized for this video. Returns the project path to use and how to place it.',
        {
          id: z.string().describe('the id from broll_search or the user’s pick, e.g. "video:123"')
        },
        async ({ id }) => {
          if (!hasPexelsKey()) return text({ ok: false, error: NO_PEXELS })
          try {
            const added = await addBroll(
              projectDir,
              id,
              readProject(projectDir)?.aspect ?? 'landscape'
            )
            const where = hasFootage(projectDir) ? BROLL_PLACE : BROLL_SCENE
            return text({
              ok: true,
              ...added,
              place:
                added.media === 'video'
                  ? `Show it as a muted video clip ${where}`
                  : `Show it with a slow push-in ${where}`
            })
          } catch (err) {
            return text({ ok: false, error: message(err) })
          }
        }
      ),
      tool(
        'captions_apply',
        [
          'Put captions of what is said in the video on the timeline, or change how they look. Use it whenever the user asks for captions or subtitles, or to change their style, font, size, position, colors, outline, box, shadow or animation, including matching a reference image they attached: read its text color, highlight, weight, case, outline, box and shadow off the image and pass them as overrides (and the closest style and font).',
          'The words come from the transcript, cleaned of ums and stutters, and Luca keeps the captions in sync with every cut, trim or move, so never write or edit captions by hand.',
          'Leave style out to adjust the captions already on the video (only what you pass changes, overrides merge); pass style to start fresh from that look.',
          'Styles:',
          ...CAPTION_STYLES.map((s) => `- ${s.id}: ${s.blurb}`)
        ].join('\n'),
        {
          style: z.enum(styleIds).optional().describe('start from this look'),
          font: z
            .string()
            .optional()
            .describe(
              `a font family. Built in: ${BUILTIN_FONTS.map((f) => f.family).join(', ')}. Comes with Luca: ${BUNDLED_FONTS.map((f) => f.family).join(', ')}. Any other Google Fonts family name is downloaded into the project first.`
            ),
          size: z.enum(['sm', 'md', 'lg']).optional(),
          position: z.enum(['bottom', 'middle', 'top']).optional(),
          wordsPerLine: z
            .enum(['short', 'normal', 'long'])
            .optional()
            .describe('short = 2–3 words per line, normal = 4–5, long = 6–8'),
          uppercase: z.boolean().optional(),
          accent: cssColor
            .optional()
            .describe('highlight color of the word being spoken (or of its pill)'),
          clean: z
            .boolean()
            .optional()
            .describe('drop ums, stutters and false starts (default true)'),
          overrides: z
            .object({
              color: cssColor.optional().describe('text color'),
              activeColor: cssColor
                .optional()
                .describe('text color of the spoken word on its highlight pill'),
              weight: z
                .number()
                .int()
                .min(100)
                .max(900)
                .optional()
                .describe('400 regular, 700 bold, 900 black'),
              italic: z.boolean().optional(),
              letterSpacing: z.number().min(-0.1).max(0.5).optional().describe('em, e.g. 0.04'),
              outline: z
                .object({
                  color: cssColor,
                  width: z.number().min(0).max(24).describe('px at 1080p: thin 3, bold 6, heavy 10')
                })
                .nullable()
                .optional()
                .describe('outline around the letters; null removes the style’s outline'),
              box: z
                .object({
                  color: cssColor,
                  opacity: z.number().min(0).max(1).optional(),
                  radius: z
                    .number()
                    .min(0)
                    .max(999)
                    .optional()
                    .describe('corner radius px at 1080p; 999 makes a pill'),
                  padding: z.number().min(0).max(3).optional().describe('em left and right')
                })
                .nullable()
                .optional()
                .describe('box behind each line; null removes the style’s box'),
              shadow: z
                .object({
                  color: cssColor,
                  blur: z.number().min(0).max(80).describe('px at 1080p'),
                  y: z.number().min(-40).max(40).optional().describe('px down; 0 makes a glow')
                })
                .nullable()
                .optional()
                .describe('shadow under the letters; null removes the style’s shadow'),
              animation: z
                .enum(animationIds)
                .optional()
                .describe(CAPTION_ANIMATIONS.map((a) => `${a.id}: ${a.blurb}`).join('; ')),
              layout: z
                .enum(['line', 'scatter'])
                .optional()
                .describe('line = centered lines; scatter = words spread across the frame'),
              hero: z
                .object({
                  scale: z
                    .number()
                    .min(1.5)
                    .max(8)
                    .describe('× the caption size; the one key word per phrase drawn huge'),
                  weight: z.number().int().min(100).max(900).optional(),
                  font: z.string().max(60).optional().describe('display font for the hero word'),
                  uppercase: z.boolean().optional(),
                  color: cssColor.optional(),
                  letterSpacing: z.number().min(-0.1).max(0.5).optional().describe('em')
                })
                .nullable()
                .optional()
                .describe(
                  'hero = the one key word per phrase drawn huge; scale 1.5–8. Only for scatter layouts; null removes it'
                )
            })
            .optional()
            .describe('a custom look on top of the style; anything set here wins')
        },
        async (args) => {
          const p = readProject(projectDir)
          if (!p) return text({ ok: false, error: 'No project is open.' })
          // a voiceover's words play once it is on the timeline
          await placeVoiceover(p).catch(() => false)
          const state = captionState(p)
          if (!state.words)
            return text({
              ok: false,
              error: hasTranscript(p.dir)
                ? OFF_TIMELINE
                : state.hasAudio
                  ? NO_TRANSCRIPT
                  : NO_SPEECH
            })
          const base: CaptionConfig = args.style
            ? configFor(args.style, state.applied ?? undefined)
            : (state.applied ?? configFor(CAPTION_STYLES[0].id))
          let font = base.font
          if (args.font) {
            try {
              font = knownFont(p.dir, args.font) ?? (await addGoogleFont(p.dir, args.font))[0]
            } catch (err) {
              return text({
                ok: false,
                error: `Couldn't use the font “${args.font}”: ${message(err)} Pick a built-in font or another Google Fonts family.`
              })
            }
          }
          const cfg: CaptionConfig = {
            ...base,
            font,
            size: args.size ?? base.size,
            position: args.position ?? base.position,
            wordsPerLine: args.wordsPerLine ?? base.wordsPerLine,
            uppercase: args.uppercase ?? base.uppercase,
            clean: args.clean ?? base.clean,
            accent: args.accent ?? base.accent,
            overrides: args.overrides ? { ...base.overrides, ...args.overrides } : base.overrides
          }
          try {
            // Luca's turn is saved as one version when it ends
            const res = await applyCaptions(p, cfg, { checkpoint: false })
            return text({
              ok: true,
              captions: describeCaptions(res.config, res.lines),
              config: res.config,
              tell: 'Say in a sentence what the captions look like now; the user can fine-tune them with the Captions button in the toolbar.'
            })
          } catch (err) {
            return text({ ok: false, error: message(err) })
          }
        }
      ),
      tool(
        'font_add',
        `Add a font to the project so captions, titles and any text can use it, and it shows in the preview and exports without internet: one that comes with Luca (${BUNDLED_FONTS.map((f) => f.family).join(', ')}) is copied in, any other is downloaded from Google Fonts. Use it before using any font that is not built in, e.g. when the user pastes a Google Fonts link or names a font. Returns the family names to use in font-family.`,
        {
          font: z
            .string()
            .describe(
              'the name of a font that comes with Luca, a fonts.google.com link, a fonts.googleapis.com stylesheet link (or its <link> code), or a family name like "Bebas Neue"'
            )
        },
        async ({ font }) => {
          try {
            const families = await addFontByName(projectDir, font)
            return text({
              ok: true,
              families,
              use: `Declared in index.html; use font-family: '${families[0]}'. For captions pass it as font to captions_apply.`
            })
          } catch (err) {
            return text({ ok: false, error: message(err) })
          }
        }
      ),
      tool(
        'lut_apply',
        [
          "Grade the user's own footage with a LUT that comes with Luca (a color look), or remove it.",
          'Use it when the user asks for a look, a mood, a cinematic/film/moody/warm/cool/black-and-white feel, or names a LUT.',
          'LUTs:',
          ...BUNDLED_LUTS.map((l) => `- ${l.id}: ${l.name} — ${l.note}`)
        ].join('\n'),
        {
          lut: z
            .enum(['none', ...BUNDLED_LUTS.map((l) => l.id)] as [string, ...string[]])
            .describe('the LUT id, or "none" to remove the grade'),
          intensity: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe('how strong the look is, 0–1; default 0.85, lower for subtle')
        },
        async ({ lut, intensity }) => {
          try {
            const p = readProject(projectDir)
            if (!p) return text({ ok: false, error: 'No project' })
            if (lut === 'none') {
              await removeColor(p)
              return text('Removed the color grade')
            }
            const info = BUNDLED_LUTS.find((l) => l.id === lut)
            const level = intensity ?? 0.85
            const state = await applyColor(p, { lut, intensity: level })
            return text(
              `Applied ${info?.name ?? lut} at ${Math.round(level * 100)}% to ${state.targets} clip${state.targets === 1 ? '' : 's'}`
            )
          } catch (err) {
            return text({ ok: false, error: message(err) })
          }
        }
      ),
      tool(
        'remocn_install',
        'Install a remocn component into the shared Remotion studio (once per component). Returns the import path and docs URL.',
        { name: z.string().describe('remocn component name, e.g. kinetic-title') },
        async ({ name }) => {
          if (!studioStatus().ready) {
            prepareExtras()
            return text({
              ok: false,
              error:
                'Extras are being set up in the background and are not ready yet. Use the closest HyperFrames item from catalog_search for this request. Do not tell the user about the setup or this error.'
            })
          }
          return text(await installComponent(name))
        }
      ),
      tool(
        'remocn_place',
        'Render remocn/<clipId>.tsx from the project to a transparent WebM (reused if the wrapper is unchanged) and insert or update the clip in index.html at `start` seconds.',
        {
          clipId: z.string().describe('wrapper file name without .tsx'),
          start: z.number().min(0).describe('start time in seconds'),
          track: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('data-track-index; default: overlay track above the footage')
        },
        async ({ clipId, start, track }) =>
          text(await placeComponent(projectDir, { clipId, start, track }))
      )
    ]
  })
}
