import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
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
import type { CaptionConfig } from '../shared/types'
import {
  addFontByName,
  addGoogleFont,
  applyCaptions,
  captionState,
  hasTranscript,
  knownFont
} from './captions'
import { library } from './library'
import { HYPERFRAMES } from './env'
import {
  generateVideo,
  hasGeminiKey,
  MAX_EXTENDED_SECONDS,
  MAX_SECONDS,
  MIN_SECONDS,
  RESOLUTIONS,
  type MadeVideo,
  type VideoResolution
} from './gemini'
import { addBackground, hasPexelsKey, searchBackgrounds } from './pexels'
import { readProject } from './projects'
import { installComponent, placeComponent, setupStudio, studioStatus } from './remocn'

const text = (data: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }]
})

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** How many background_search results come with a preview Luca can look at. */
const PREVIEWS = 8

const NO_PEXELS =
  'Stock backgrounds are not connected yet (no Pexels key). If the user asked for a photo or video background, tell them in one short sentence to connect Pexels in the Backgrounds panel; otherwise build the background another way and do not mention this.'

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

// ------------------------------------------------------------------ generated video

const NO_GEMINI =
  'Gemini is not connected yet (no API key). Tell the user in one short sentence to click Gemini in the toolbar and paste their Gemini API key, then ask again. Do not make the video another way.'

const secs = (n: number): string => `${Math.round(n * 10) / 10} s`

/** Where a new clip goes, in words Luca can act on. */
function placement(v: MadeVideo): string {
  const general =
    'It has its own sound; keep it unless it fights the voice or music already there (then mute or lower it).'
  const f = v.from
  if (!f)
    return `Put it on the timeline where it belongs, as a full-frame video clip (object-fit: cover) unless it is meant to be smaller. ${general}`
  const end = f.start + f.seconds
  if (f.mode === 'edit')
    return `It is the changed version of ${f.file} from ${secs(f.start)} to ${secs(end)} of that file. Put it where that part of the clip plays now, in its place (same track, position and size), or wherever the user asked. ${general}`
  return f.includesSource
    ? `It starts with ${f.file} from ${secs(f.start)} on (lightly adjusted so the join is seamless) and then continues it. Put it in place of ${f.file} from that point, so the video carries straight on. ${general}`
    : `It continues ${f.file} from its end (${secs(end)} into that file). Put it straight after that clip on the same track. ${general}`
}

// ------------------------------------------------------------------ captions

const styleIds = CAPTION_STYLES.map((s) => s.id) as [string, ...string[]]
const animationIds = CAPTION_ANIMATIONS.map((a) => a.id) as [CaptionAnim, ...CaptionAnim[]]
const cssColor = z.string().describe('a CSS color, e.g. "#FFE14D" or "rgba(0,0,0,0.6)"')

const NO_TRANSCRIPT =
  'This video has no transcript yet, so there are no words to caption. Ask the user, in one short sentence, to open the Transcript tab and click Transcribe (it needs their AssemblyAI key), then ask you again. Do not transcribe it yourself and do not write captions by hand.'
const NO_SPEECH =
  'This project has no video or audio with speech, so there is nothing to caption. Offer animated titles or text instead.'
const OFF_TIMELINE =
  'The video the transcript belongs to is no longer on the timeline, so there are no words to caption. Tell the user in one short sentence.'

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
 * Luca's in-process MCP server: catalog search, backgrounds, captions and fonts, plus the remocn
 * tools described in the spec.
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
      'background_search finds free stock photos and short videos (Pexels) for backgrounds and shows ' +
      'previews of the best ones; background_add downloads the chosen one into media/backgrounds, ' +
      'sized for this video, and returns the path to use. ' +
      'captions_apply puts captions of what is said on the video (from the transcript) and changes ' +
      'their look; Luca keeps them in sync with every cut, so never write or edit them by hand. ' +
      'font_add adds a font that comes with Luca, or downloads a Google Fonts font, into the project ' +
      'so any text can use it offline. ' +
      'video_generate makes a new video clip with Gemini Omni, or edits or continues a clip in the ' +
      'project, and saves it in media/generated.',
    tools: [
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
        'background_search',
        'Search free stock photos and short videos (Pexels) to use as the background of the video or a scene. Returns the best matches with their ids, plus small previews of the first ones so you can see them. Pick what fits the video’s subject and mood, then add it with background_add.',
        {
          query: z
            .string()
            .describe(
              'what the background should show, in plain words: "soft abstract light", "modern office", "city at night", "ocean waves", "coffee beans"'
            ),
          media: z
            .enum(['any', 'photo', 'video'])
            .optional()
            .describe('default any; videos are short clips that keep moving behind everything'),
          limit: z.number().int().min(1).max(24).optional().describe('default 12')
        },
        async ({ query, media, limit }) => {
          if (!hasPexelsKey()) return text({ ok: false, error: NO_PEXELS })
          try {
            const res = await searchBackgrounds({
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
        'background_add',
        'Download a background found with background_search (or picked by the user) into the project, sized for this video. Returns the project path to use and how to place it.',
        {
          id: z
            .string()
            .describe('the id from background_search or the user’s pick, e.g. "video:123"')
        },
        async ({ id }) => {
          if (!hasPexelsKey()) return text({ ok: false, error: NO_PEXELS })
          try {
            const added = await addBackground(
              projectDir,
              id,
              readProject(projectDir)?.aspect ?? 'landscape'
            )
            return text({
              ok: true,
              ...added,
              place:
                added.media === 'video'
                  ? 'Put it behind everything as a full-frame, muted video clip on the lowest track (object-fit: cover) across the scenes it belongs to. If a scene runs longer than the clip, loop or repeat it. Keep text readable over it with a soft dark or light overlay.'
                  : 'Put it behind everything as a full-frame image on the lowest track (object-fit: cover) across the scenes it belongs to; a slow push-in or drift keeps it alive. Keep text readable over it with a soft dark or light overlay.'
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
                .describe(CAPTION_ANIMATIONS.map((a) => `${a.id}: ${a.blurb}`).join('; '))
            })
            .optional()
            .describe('a custom look on top of the style; anything set here wins')
        },
        async (args) => {
          const p = readProject(projectDir)
          if (!p) return text({ ok: false, error: 'No project is open.' })
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
        'video_generate',
        [
          'Make a video clip with Gemini Omni (it comes with sound), or change or continue a clip in the project. It spends the user’s Gemini credits and takes a few minutes, so use it only when they ask for a generated or edited clip, and make one clip per request unless they ask for more.',
          `- New footage: a prompt. ${MIN_SECONDS}–${MAX_SECONDS} s per clip.`,
          '- From pictures: firstFrame starts the clip on a picture; add lastFrame to end on another one (the same picture for both makes a loop). To restyle a still (a photo background, a picture the user attached) and bring it to life, pass it in images and describe the new look and the motion.',
          '- People, products, a look or a motion to use from pictures or clips: images / videoRefs, referred to in the prompt as <IMAGE_REF_0>, <IMAGE_REF_1>… and <VIDEO_REF_0>… in the order given.',
          `- Change a clip (restyle it, relight it, add or remove something, change the weather or season): video. Omni reads up to ${MAX_SECONDS} s of it, from start. Keep edit prompts short and end them with "Keep everything else the same." To restyle a stock background, add it with background_add first and pass its file.`,
          `- Continue a clip: extend. Adds up to ${MAX_SECONDS} s each time, up to ${MAX_EXTENDED_SECONDS} s in all.`,
          'Clips made here are edited and continued from Gemini’s own copy, so pass their media/generated file as it is.',
          'Prompting: describe subject, action, setting, camera, light and sound like a director. Omni cuts between several shots unless you say "a single continuous shot, no cuts". Say what the sound should be (music, ambience, "no dialogue"). Timing works in words ("after 3 s…") or as "[0-3s] … [3-6s] …". Text on screen is rendered as written.',
          'Returns the file, its size, length and frames from it to look at. If it clearly misses what the user asked, say so and offer to try again rather than retrying on your own.'
        ].join('\n'),
        {
          prompt: z.string().describe('what to make or change, in plain words'),
          video: z
            .string()
            .optional()
            .describe('a clip in the project to change (project path, e.g. media/backgrounds/…)'),
          extend: z.string().optional().describe('a clip in the project to continue'),
          start: z
            .number()
            .min(0)
            .optional()
            .describe(
              `seconds into video/extend where the part Omni reads begins; default: the start of a clip to change, the last ${MAX_SECONDS} s of a clip to continue`
            ),
          firstFrame: z.string().optional().describe('a picture in the project to start on'),
          lastFrame: z.string().optional().describe('a picture to end on (needs firstFrame)'),
          images: z
            .array(z.string())
            .max(8)
            .optional()
            .describe('pictures in the project to use as references (<IMAGE_REF_n>)'),
          videoRefs: z
            .array(z.string())
            .max(5)
            .optional()
            .describe(
              'clips in the project to use as references (<VIDEO_REF_n>); about 3 s each is ideal, up to 3 clips'
            ),
          seconds: z
            .number()
            .int()
            .min(MIN_SECONDS)
            .max(MAX_SECONDS)
            .optional()
            .describe('length of the new clip (or of the part added); default: Gemini picks'),
          aspect: z
            .enum(['16:9', '9:16'])
            .optional()
            .describe(
              'Omni makes 16:9 or 9:16; default: the one nearest this video’s shape (or the clip being changed)'
            ),
          resolution: z
            .enum(RESOLUTIONS as [VideoResolution, ...VideoResolution[]])
            .optional()
            .describe(
              'default: enough for this video (1080p); 720p and 360p are quicker and cheaper, 4k is the slowest'
            ),
          width: z
            .number()
            .int()
            .min(64)
            .max(4096)
            .optional()
            .describe(
              'exact width in pixels when the user asks for a size (with height); Omni’s frame is cropped and scaled to it. Default: this video’s frame (a square video is cropped from 16:9)'
            ),
          height: z.number().int().min(64).max(4096).optional(),
          sound: z
            .enum(['keep', 'new'])
            .optional()
            .describe(
              'for video/extend: keep the clip’s own sound (default) or have Omni make all-new sound'
            )
        },
        async (args, extra) => {
          if (!hasGeminiKey()) return text({ ok: false, error: NO_GEMINI })
          const p = readProject(projectDir)
          if (!p) return text({ ok: false, error: 'No project is open.' })
          const signal = (extra as { signal?: AbortSignal } | undefined)?.signal
          try {
            const v = await generateVideo(projectDir, p.aspect, args, signal)
            const content: Content[] = [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: true,
                  file: v.file,
                  size: `${v.width}x${v.height}`,
                  seconds: v.seconds,
                  sound: v.hasSound,
                  made: `${v.resolution} ${v.aspect}${v.reframed ? `, cropped and scaled to ${v.width}x${v.height}` : ''}`,
                  ...(v.from ? { from: v.from } : {}),
                  place: placement(v),
                  ...(v.frames.length
                    ? { frames: 'Frames from its start, middle and end follow.' }
                    : {})
                })
              },
              ...v.frames.map((data): Content => ({ type: 'image', data, mimeType: 'image/jpeg' }))
            ]
            return { content }
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
