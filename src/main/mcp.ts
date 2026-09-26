import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { CATEGORIES, categoryLabel, searchLibrary, type LibraryItem } from '../shared/catalog'
import { library } from './library'
import { installComponent, placeComponent, studioStatus } from './remocn'

const text = (data: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }]
})

const categoryIds = CATEGORIES.map((c) => c.id) as [
  LibraryItem['category'],
  ...LibraryItem['category'][]
]

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
      add: `npx hyperframes add ${i.name} --json`
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
          note: 'Needs the one-time Remocn setup, which is not done. Prefer a HyperFrames item; suggest the setup only if the user wants this exact component.'
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
      'then call remocn_place. Re-run remocn_place with the same clipId after editing the wrapper.',
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
        'remocn_install',
        'Install a remocn component into the shared Remotion studio (once per component). Returns the import path and docs URL.',
        { name: z.string().describe('remocn component name, e.g. kinetic-title') },
        async ({ name }) => {
          const st = studioStatus()
          if (!st.ready)
            return text({
              ok: false,
              error: `Remocn studio not ready (${st.step ?? 'unknown'}). Pick a HyperFrames item from catalog_search instead; only if the user wants this exact component, ask them to set up Remocn from Catalog › Remocn (about two minutes).`
            })
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
