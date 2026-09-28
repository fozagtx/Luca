import { BUNDLED_LUTS } from './luts.generated'

/**
 * LUTs (color grades) that come with Luca: .cube files in resources/luts/, served to previews at
 * /luts/ and copied into a project as `luts/<file>` when applied — so a graded project exports
 * without needing the app's copy. To add one, drop its .cube in resources/luts/, give it a note in
 * resources/luts/luts.json and run `npm run luts`.
 */
export { BUNDLED_LUTS }

export function bundledLut(id: string): (typeof BUNDLED_LUTS)[number] | undefined {
  const want = id.trim().toLowerCase()
  return BUNDLED_LUTS.find(
    (l) => l.id === want || l.file.toLowerCase() === `${want}.cube` || l.name.toLowerCase() === want
  )
}

/** The color grade on the footage now: which LUT that comes with Luca and how strong (0–1). */
export type ColorGrade = { lut: string; intensity: number } | null
