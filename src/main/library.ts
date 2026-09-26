import { toLibrary, type LibraryItem } from '../shared/catalog'
import type { CatalogItem, RemocnItem } from '../shared/types'
import bundledHf from './catalog/hyperframes.json'
import bundledRemocn from './catalog/remocn.json'
import { catalog } from './hyperframes'
import { remocnCatalog } from './remocn'

const TTL = 10 * 60 * 1000
let cache: { at: number; items: LibraryItem[] } | null = null

/** HyperFrames + Remocn as one list for the agent's catalog_search tool. */
export async function library(cwd: string): Promise<LibraryItem[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.items
  const [hf, rc] = await Promise.all([
    catalog({ cwd }).catch(() => bundledHf as CatalogItem[]),
    remocnCatalog().catch(() => bundledRemocn as RemocnItem[])
  ])
  cache = { at: Date.now(), items: toLibrary(hf, rc) }
  return cache.items
}

/** Drop the in-memory list so the next search sees a refreshed catalog. */
export function invalidateLibrary(): void {
  cache = null
}

const bundledTitles = new Map<string, string>([
  ...(bundledRemocn as RemocnItem[]).map((i): [string, string] => [i.name, i.title ?? i.name]),
  ...(bundledHf as CatalogItem[]).map((i): [string, string] => [i.name, i.title])
])

/** Display title for a catalog item name, from the loaded library or the bundled copy. */
export function catalogTitle(name: string): string | undefined {
  return cache?.items.find((i) => i.name === name)?.title ?? bundledTitles.get(name)
}
