/**
 * GSAP from Luca itself, so the preview and the export work offline.
 *
 * Compositions load GSAP from a CDN (`hyperframes init` writes jsDelivr's gsap@3.14.2 into
 * index.html, and the captions do the same). Without a network the preview had nothing to animate
 * and the export failed (`sub_timeline_script_failure … gsap.min.js`). Luca ships GSAP: the page
 * the preview loads gets Luca's copy (/vendor/gsap/<file>), and the export's renderer is handed the
 * same bytes when it fetches a GSAP CDN URL, so both play the same GSAP. The project's HTML keeps
 * its CDN link, and anything that isn't a GSAP 3 file Luca has still comes from the network.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const GSAP_ROUTE = '/vendor/gsap/'

/** jsDelivr, unpkg and cdnjs links to a GSAP 3 file. */
const CDN =
  /^https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/gsap@3[^/]*\/dist|unpkg\.com\/gsap@3[^/]*\/dist|cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/3[^/]*)\/([\w.-]+\.js)(?:[?#].*)?$/i

let dir: string | null | undefined
/** The dist/ folder of the GSAP that comes with Luca, or null when it is missing. */
export function gsapDir(): string | null {
  if (dir !== undefined) return dir
  try {
    dir = dirname(require.resolve('gsap/dist/gsap.min.js'))
  } catch {
    dir = null
  }
  return dir
}

/** Luca's copy of the GSAP file a CDN URL asks for, or null. */
export function localGsap(url: string): string | null {
  const m = CDN.exec(url.trim())
  const d = m ? gsapDir() : null
  if (!m || !d) return null
  const file = join(d, basename(m[1]))
  return existsSync(file) ? file : null
}

/**
 * Answer the export renderer's fetches of GSAP CDN files from Luca's copy (it downloads every
 * external script to inline it into the page it renders); everything else goes to the network.
 */
export function serveGsapToFetch(): void {
  const network = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const file = localGsap(url)
    if (file) {
      try {
        const body = await readFile(file)
        return new Response(body, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })
      } catch {
        // unreadable: try the network
      }
    }
    return network(input, init)
  }
}
