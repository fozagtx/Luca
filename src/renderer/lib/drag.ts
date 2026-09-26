import type { CatalogItem, Chip } from '../../shared/types'

export const CATALOG_MIME = 'application/x-luca-catalog'

export type CatalogDrag = {
  name: string
  type: CatalogItem['type']
  title: string
  source: 'hyperframes' | 'remocn'
}

export function setCatalogDrag(dt: DataTransfer, item: CatalogDrag): void {
  dt.setData(CATALOG_MIME, JSON.stringify(item))
  dt.setData('text/plain', item.name)
  dt.effectAllowed = 'copy'
}

export function readCatalogDrag(dt: DataTransfer): CatalogDrag | null {
  const raw = dt.getData(CATALOG_MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CatalogDrag
  } catch {
    return null
  }
}

export function hasCatalogDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(CATALOG_MIME)
}

export function catalogChip(d: CatalogDrag): Chip {
  return { kind: 'catalog', name: d.name, type: d.type, title: d.title, source: d.source }
}
