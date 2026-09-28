/**
 * One-off: resample a .cube LUT to a smaller LUT_3D_SIZE with trilinear interpolation.
 *   node scripts/lut-resample.ts <in.cube> <out.cube> <size>
 * Used for resources/luts/BasicGrade.cube (1JF_BASIC_GRADE.cube is size 65 → 33).
 */
import { parseCubeLut } from '@hyperframes/core'
import { readFileSync, writeFileSync } from 'node:fs'

const [src, dst, sizeArg] = process.argv.slice(2)
const size = Number(sizeArg)
if (!src || !dst || !Number.isInteger(size) || size < 2) {
  console.error('usage: node scripts/lut-resample.ts <in.cube> <out.cube> <size>')
  process.exit(1)
}

const lut = parseCubeLut(readFileSync(src, 'utf8'), { maxSize: 128 })
if (size >= lut.size) {
  console.error(`target size ${size} must be smaller than ${lut.size}`)
  process.exit(1)
}

const n = lut.size
const d = lut.data
const at = (r: number, g: number, b: number): [number, number, number] => {
  const i = (r + g * n + b * n * n) * 3 // .cube rows: red fastest, then green, then blue
  return [d[i], d[i + 1], d[i + 2]]
}

const scale = (n - 1) / (size - 1)
const rows: string[] = []
for (let b = 0; b < size; b++) {
  for (let g = 0; g < size; g++) {
    for (let r = 0; r < size; r++) {
      const rr = Math.min(r * scale, n - 1)
      const gg = Math.min(g * scale, n - 1)
      const bb = Math.min(b * scale, n - 1)
      const [r0, g0, b0] = [Math.floor(rr), Math.floor(gg), Math.floor(bb)]
      const [fr, fg, fb] = [rr - r0, gg - g0, bb - b0]
      const [r1, g1, b1] = [
        Math.min(r0 + 1, n - 1),
        Math.min(g0 + 1, n - 1),
        Math.min(b0 + 1, n - 1)
      ]
      const out = [0, 0, 0]
      for (let c = 0; c < 3; c++) {
        const v00 = at(r0, g0, b0)[c] * (1 - fr) + at(r1, g0, b0)[c] * fr
        const v01 = at(r0, g0, b1)[c] * (1 - fr) + at(r1, g0, b1)[c] * fr
        const v10 = at(r0, g1, b0)[c] * (1 - fr) + at(r1, g1, b0)[c] * fr
        const v11 = at(r0, g1, b1)[c] * (1 - fr) + at(r1, g1, b1)[c] * fr
        out[c] = (v00 * (1 - fg) + v10 * fg) * (1 - fb) + (v01 * (1 - fg) + v11 * fg) * fb
      }
      rows.push(out.map((v) => v.toFixed(6)).join(' '))
    }
  }
}
writeFileSync(dst, `TITLE "Basic Grade"\nLUT_3D_SIZE ${size}\n${rows.join('\n')}\n`)
const check = parseCubeLut(readFileSync(dst, 'utf8'))
console.log(
  `resampled ${src} (${lut.size}³) → ${dst} (${check.size}³, ${check.data.length / 3} rows)`
)
