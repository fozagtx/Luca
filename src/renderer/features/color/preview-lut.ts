/**
 * LUT thumbnails for the Color panel: .cube files served by the Luca server at /luts/, parsed
 * locally (importing @hyperframes/core in the renderer drags Node builtins into the bundle),
 * applied to the project's poster frame per pixel with trilinear interpolation. Parsed LUTs are
 * cached for the session; thumbnails always show full strength.
 */

export type ParsedLut = {
  size: number
  data: Float32Array
  domainMin: [number, number, number]
  domainMax: [number, number, number]
}

/** Minimal .cube reader: TITLE/DOMAIN_MIN/DOMAIN_MAX/LUT_3D_SIZE + rows of 3 floats, red fastest. */
export function parseCubeLut(text: string): ParsedLut | null {
  let size = 0
  let i = 0
  let data: Float32Array | null = null
  const domainMin: [number, number, number] = [0, 0, 0]
  const domainMax: [number, number, number] = [1, 1, 1]
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const key = parts[0].toUpperCase()
    if (key === 'LUT_3D_SIZE') {
      size = parseInt(parts[1], 10)
      data = new Float32Array(size * size * size * 3)
    } else if (key === 'LUT_1D_SIZE' || key === 'LUT_2D_SIZE') {
      return null
    } else if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      const d = key === 'DOMAIN_MIN' ? domainMin : domainMax
      for (let c = 0; c < 3; c++) d[c] = parseFloat(parts[c + 1])
    } else if (!/^[A-Z_]+/i.test(key) && data) {
      for (let c = 0; c < 3; c++) data[i * 3 + c] = parseFloat(parts[c])
      i++
    }
  }
  if (!size || !data || i !== size * size * size) return null
  return { size, data, domainMin, domainMax }
}

const cache = new Map<string, Promise<ParsedLut | null>>()

export function loadLut(file: string): Promise<ParsedLut | null> {
  let p = cache.get(file)
  if (!p) {
    p = fetch(`/luts/${encodeURIComponent(file)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`LUT ${file}: ${r.status}`)
        return r.text()
      })
      .then(parseCubeLut)
    cache.set(file, p)
    p.catch(() => cache.delete(file))
  }
  return p
}

/** The poster frame (any drawable image) with the LUT on it, as a data URL. */
export function gradePoster(
  img: HTMLImageElement,
  lut: ParsedLut | null,
  width = 240
): string | null {
  if (!lut) return null
  const w = width
  const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w) || w)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h)
  const { data, size, domainMin, domainMax } = lut
  const n1 = size - 1
  const d = px.data
  const sr = 1 / Math.max(1e-6, domainMax[0] - domainMin[0])
  const sg = 1 / Math.max(1e-6, domainMax[1] - domainMin[1])
  const sb = 1 / Math.max(1e-6, domainMax[2] - domainMin[2])
  for (let i = 0; i < d.length; i += 4) {
    const r = Math.min(1, Math.max(0, (d[i] / 255 - domainMin[0]) * sr)) * n1
    const g = Math.min(1, Math.max(0, (d[i + 1] / 255 - domainMin[1]) * sg)) * n1
    const b = Math.min(1, Math.max(0, (d[i + 2] / 255 - domainMin[2]) * sb)) * n1
    const r0 = Math.floor(r)
    const g0 = Math.floor(g)
    const b0 = Math.floor(b)
    const fr = r - r0
    const fg = g - g0
    const fb = b - b0
    const r1 = Math.min(r0 + 1, n1)
    const g1 = Math.min(g0 + 1, n1)
    const b1 = Math.min(b0 + 1, n1)
    const i000 = (r0 + g0 * size + b0 * size * size) * 3
    const i100 = (r1 + g0 * size + b0 * size * size) * 3
    const i010 = (r0 + g1 * size + b0 * size * size) * 3
    const i110 = (r1 + g1 * size + b0 * size * size) * 3
    const i001 = (r0 + g0 * size + b1 * size * size) * 3
    const i101 = (r1 + g0 * size + b1 * size * size) * 3
    const i011 = (r0 + g1 * size + b1 * size * size) * 3
    const i111 = (r1 + g1 * size + b1 * size * size) * 3
    for (let c = 0; c < 3; c++) {
      const v00 = data[i000 + c] * (1 - fr) + data[i100 + c] * fr
      const v10 = data[i010 + c] * (1 - fr) + data[i110 + c] * fr
      const v01 = data[i001 + c] * (1 - fr) + data[i101 + c] * fr
      const v11 = data[i011 + c] * (1 - fr) + data[i111 + c] * fr
      d[i + c] = Math.round(
        Math.min(
          255,
          Math.max(0, (v00 * (1 - fg) + v10 * fg) * (1 - fb) + (v01 * (1 - fg) + v11 * fg) * fb) *
            255
        )
      )
    }
  }
  ctx.putImageData(px, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.8)
}
