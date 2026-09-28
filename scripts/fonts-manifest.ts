/**
 * Rebuilds src/shared/fonts.generated.ts from the files in resources/fonts/ and the hand-edited
 * overrides in resources/fonts/fonts.json. Run with `npm run fonts`.
 *
 * The SFNT parsing below is deliberately small: table directory, `name` (family/subfamily and
 * license strings), `OS/2` (weight, italic), `head` (italic fallback) and `fvar` (weight range of
 * variable fonts). No dependencies, no font library.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '../..')
const fontsDir = join(root, 'resources/fonts')
const overridesPath = join(fontsDir, 'fonts.json')
const outPath = join(root, 'src/shared/fonts.generated.ts')

/** Families Google Fonts already provides (kept in sync with BUILTIN_FONTS in src/shared/captions.ts). */
const BUILTIN_FAMILIES = [
  'Inter',
  'Montserrat',
  'Poppins',
  'Outfit',
  'Nunito',
  'Roboto',
  'Open Sans',
  'Lato',
  'Oswald',
  'League Gothic',
  'Archivo Black',
  'Playfair Display',
  'EB Garamond',
  'JetBrains Mono',
  'Space Mono',
  'IBM Plex Mono',
  'Source Code Pro',
  'Noto Sans JP'
].map((f) => f.toLowerCase())

type Overrides = {
  notes?: Record<string, string>
  families?: Record<string, string>
  /** Per-file weight override for fonts whose OS/2 usWeightClass lies ("Helvetica Light" → 300). */
  weights?: Record<string, number>
}

type Face = {
  file: string
  family: string
  subfamily: string
  weight: number
  weightMax?: number
  italic: boolean
  license: string
}

const u16 = (b: Buffer, o: number): number => b.readUInt16BE(o)
const fixed = (b: Buffer, o: number): number => b.readInt32BE(o) / 65536

function tables(buf: Buffer): Map<string, { offset: number; length: number }> | null {
  if (buf.length < 12) return null
  const magic = buf.readUInt32BE(0)
  if (![0x00010000, 0x74727565, 0x4f54544f].includes(magic)) return null // ttf, 'true', 'OTTO'
  const map = new Map<string, { offset: number; length: number }>()
  for (let i = 0, n = u16(buf, 4); i < n; i++) {
    const at = 12 + i * 16
    if (at + 16 > buf.length) break
    map.set(buf.toString('ascii', at, at + 4), {
      offset: buf.readUInt32BE(at + 8),
      length: buf.readUInt32BE(at + 12)
    })
  }
  return map
}

function nameStrings(buf: Buffer, at: number): Map<number, string> {
  const out = new Map<number, string>()
  if (at + 6 > buf.length) return out
  const count = u16(buf, at + 2)
  const storage = at + u16(buf, at + 4)
  const pick = new Map<number, { score: number; text: string }>()
  for (let i = 0; i < count; i++) {
    const r = at + 6 + i * 12
    if (r + 12 > buf.length) break
    const platform = u16(buf, r)
    const encoding = u16(buf, r + 2)
    const lang = u16(buf, r + 4)
    const id = u16(buf, r + 6)
    const len2 = u16(buf, r + 8)
    const off = storage + u16(buf, r + 10)
    if (off + len2 > buf.length) continue
    let text = ''
    let score = -1
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      const parts: string[] = []
      for (let j = 0; j + 1 < len2; j += 2) parts.push(String.fromCharCode(u16(buf, off + j)))
      text = parts.join('')
      score = lang === 0x409 ? 3 : 2
    } else if (platform === 1) {
      text = buf.toString('ascii', off, off + len2).replace(/[^\x20-\x7e]/g, '')
      score = 1
    } else if (platform === 0) {
      const parts: string[] = []
      for (let j = 0; j + 1 < len2; j += 2) parts.push(String.fromCharCode(u16(buf, off + j)))
      text = parts.join('')
      score = 1
    }
    text = text.trim()
    if (text && score > (pick.get(id)?.score ?? -1)) pick.set(id, { score, text })
  }
  for (const [id, v] of pick) out.set(id, v.text)
  return out
}

function parseFont(path: string): Face | null {
  const buf = readFileSync(path)
  const t = tables(buf)
  if (!t) return null
  const name = t.get('name')
  if (!name) return null
  const names = nameStrings(buf, name.offset)
  const family = names.get(16) ?? names.get(1)
  const subfamily = names.get(17) ?? names.get(2) ?? 'Regular'
  if (!family) return null
  let weight = 400
  let italic = /italic|oblique/i.test(subfamily)
  const os2 = t.get('OS/2')
  if (os2 && os2.offset + 64 <= buf.length) {
    weight = u16(buf, os2.offset + 4)
    const sel = u16(buf, os2.offset + 62)
    if (sel & 0x201) italic = true // fsSelection bit 0 italic, bit 9 oblique
  }
  const head = t.get('head')
  if (!os2 && head && head.offset + 46 <= buf.length) {
    if (u16(buf, head.offset + 44) & 0x2) italic = true // macStyle bit 1
  }
  let weightMax: number | undefined
  const fvar = t.get('fvar')
  if (fvar && fvar.offset + 16 <= buf.length) {
    const axisAt = fvar.offset + u16(buf, fvar.offset + 4)
    const axisCount = u16(buf, fvar.offset + 8)
    const axisSize = u16(buf, fvar.offset + 10)
    for (let i = 0; i < axisCount; i++) {
      const a = axisAt + i * axisSize
      if (a + axisSize > buf.length) break
      if (buf.toString('ascii', a, a + 4) === 'wght') {
        weight = Math.round(fixed(buf, a + 4))
        weightMax = Math.round(fixed(buf, a + 12))
        break
      }
    }
  }
  const license = [names.get(13), names.get(14)].filter(Boolean).join(' | ')
  return { file: basename(path), family, subfamily, weight, weightMax, italic, license }
}

const overrides: Overrides = existsSync(overridesPath)
  ? (JSON.parse(readFileSync(overridesPath, 'utf8')) as Overrides)
  : {}

const entries = readdirSync(fontsDir)
const faces: Face[] = []
for (const entry of entries) {
  if (entry.startsWith('._') || entry === '.DS_Store') continue
  const p = join(fontsDir, entry)
  if (statSync(p).isDirectory()) {
    if (readdirSync(p).some((f) => /\.(ttf|otf)$/i.test(f))) {
      console.error(`Font file inside a subdirectory: ${entry}/ — resources/fonts/ must stay flat`)
      process.exit(1)
    }
    continue
  }
  if (!/\.(ttf|otf)$/i.test(entry)) continue
  const face = parseFont(p)
  if (!face) {
    console.error(`Could not parse ${entry}`)
    process.exit(1)
  }
  faces.push(face)
}

console.log(`Scanned ${faces.length} font file(s):\n`)
for (const f of faces) {
  console.log(
    `  ${f.file}\n    family "${f.family}" / "${f.subfamily}", weight ${f.weight}${f.weightMax ? `-${f.weightMax}` : ''}${f.italic ? ', italic' : ''}`
  )
  if (f.license) console.log(`    license: ${f.license.slice(0, 200)}`)
}

for (const f of faces) {
  const rename = overrides.families?.[f.file]
  if (rename) f.family = rename
  const w = overrides.weights?.[f.file]
  if (w) f.weight = w
  if (BUILTIN_FAMILIES.includes(f.family.toLowerCase())) f.family = `${f.family} ${f.subfamily}`
}

const families = new Map<string, Face[]>()
for (const f of faces) {
  const list = families.get(f.family) ?? []
  list.push(f)
  families.set(f.family, list)
}

const missingNotes = [...families.keys()].filter((f) => !overrides.notes?.[f])
if (missingNotes.length)
  console.warn(
    `\nFamilies missing a note in resources/fonts/fonts.json (using "Included with Luca"):\n  ${missingNotes.join('\n  ')}`
  )

const lines: string[] = [
  '// Generated by `npm run fonts` from resources/fonts/. Do not edit by hand.',
  "import type { ProjectFontFace } from './types'",
  '',
  'export const BUNDLED_FONTS: { family: string; note: string; faces: ProjectFontFace[] }[] = ['
]
for (const family of [...families.keys()].sort((a, b) => a.localeCompare(b))) {
  const note = overrides.notes?.[family] ?? 'Included with Luca'
  lines.push('  {')
  lines.push(`    family: ${JSON.stringify(family)},`)
  lines.push(`    note: ${JSON.stringify(note)},`)
  lines.push('    faces: [')
  const sorted = families
    .get(family)!
    .sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic))
  for (const f of sorted) {
    const max = f.weightMax ? `, weightMax: ${f.weightMax}` : ''
    lines.push(
      `      { file: ${JSON.stringify(f.file)}, weight: ${f.weight}${max}, italic: ${f.italic} },`
    )
  }
  lines.push('    ]')
  lines.push('  },')
}
lines.push(']')
const last = lines[lines.length - 2]
if (last === '  },') lines[lines.length - 2] = '  }'
writeFileSync(outPath, lines.join('\n') + '\n')
execFileSync('npx', ['prettier', '--write', outPath], { stdio: 'inherit' })
console.log(`\nWrote ${outPath} — ${families.size} families, ${faces.length} faces`)
