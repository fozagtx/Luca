import { categorize, toLibrary, type LibraryItem } from '../shared/catalog'
import type { CatalogItem, RemocnItem } from '../shared/types'
import bundledHf from './catalog/hyperframes.json'
import bundledRemocn from './catalog/remocn.json'
import { catalog } from './hyperframes'
import { remocnCatalog } from './remocn'
import { LUCA_TREATMENTS } from './treatments'

const TTL = 10 * 60 * 1000
let cache: { at: number; items: LibraryItem[] } | null = null

/** HyperFrames + Remocn + Luca's treatments as one list for the agent's catalog_search tool. */
export async function library(cwd: string): Promise<LibraryItem[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.items
  const [hf, rc] = await Promise.all([
    catalog({ cwd }).catch(() => bundledHf as CatalogItem[]),
    remocnCatalog().catch(() => bundledRemocn as RemocnItem[])
  ])
  const items = toLibrary(hf, rc)
  for (const t of LUCA_TREATMENTS) {
    items.push({
      source: 'luca',
      name: t.name,
      type: 'component',
      title: t.title,
      description: t.description,
      tags: t.tags,
      category: categorize(t.name, t.tags),
      duration: 5
    })
  }
  cache = { at: Date.now(), items }
  return cache.items
}

const bundledTitles = new Map<string, string>([
  ...(bundledRemocn as RemocnItem[]).map((i): [string, string] => [i.name, i.title ?? i.name]),
  ...(bundledHf as CatalogItem[]).map((i): [string, string] => [i.name, i.title])
])

/** Display title for a catalog item name, from the loaded library or the bundled copy. */
export function catalogTitle(name: string): string | undefined {
  return cache?.items.find((i) => i.name === name)?.title ?? bundledTitles.get(name)
}
