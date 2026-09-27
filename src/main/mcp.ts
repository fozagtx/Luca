import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { CATEGORIES, categoryLabel, searchLibrary, type LibraryItem } from '../shared/catalog'
import { library } from './library'
import { HYPERFRAMES } from './env'
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

/** Luca's in-process MCP server: catalog search plus the remocn tools described in the spec. */
export function lucaMcpServer(projectDir: string): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'luca',
    version: '1.0.0',
    instructions:
      'catalog_search finds ready-made HyperFrames blocks/components and Remocn components by ' +
      'plain words ("lower third", "text reveal", "captions", "logo intro", "bar chart"). Use it ' +
      'before building any visual from scratch; never grep or script the catalog yourself. ' +
      'Remocn components are React/Remotion. Never put React in the HyperFrames HTML. ' +
      'Install with remocn_install, read the returned docs URL, write remocn/<clipId>.tsx in the ' +
      'project (default export rendering the component with props, plus `export const durationInFrames`), ' +
      'then call remocn_place. Re-run remocn_place with the same clipId after editing the wrapper. ' +
      'background_search finds free stock photos and short videos (Pexels) for backgrounds and shows ' +
      'previews of the best ones; background_add downloads the chosen one into media/backgrounds, ' +
      'sized for this video, and returns the path to use.',
    tools: [
      tool(
        'catalog_search',
        'Search every ready-made HyperFrames block/component and Remocn component by what it looks like or does. Returns the best matches with what each is for and how to add it.',
        {
          query: z
            .string()
            .describe('plain words, e.g. "lower third", "kinetic text", "captions", "logo intro"'),
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
            return text({ ok: false, error: err instanceof Error ? err.message : String(err) })
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
            return text({ ok: false, error: err instanceof Error ? err.message : String(err) })
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
