import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { installComponent, placeComponent, studioStatus } from './remocn'

const text = (data: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }]
})

/** Luca's in-process MCP server: the remocn tools described in the spec. */
export function lucaMcpServer(projectDir: string): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'luca',
    version: '1.0.0',
    instructions:
      'Remocn components are React/Remotion. Never put React in the HyperFrames HTML. ' +
      'Install with remocn_install, read the returned docs URL, write remocn/<clipId>.tsx in the ' +
      'project (default export rendering the component with props, plus `export const durationInFrames`), ' +
      'then call remocn_place. Re-run remocn_place with the same clipId after editing the wrapper.',
    tools: [
      tool(
        'remocn_install',
        'Install a remocn component into the shared Remotion studio (once per component). Returns the import path and docs URL.',
        { name: z.string().describe('remocn component name, e.g. kinetic-title') },
        async ({ name }) => {
          const st = studioStatus()
          if (!st.ready)
            return text({
              ok: false,
              error: `Remocn studio not ready (${st.step ?? 'unknown'}). Ask the user to set it up from the Catalog › Remocn tab.`
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
