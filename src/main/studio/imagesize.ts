/**
 * The pixel size of an image file from its header, so Studio cards are laid out when the file is
 * written instead of after the picture loads: PNG, JPEG, GIF, WebP and SVG (its viewBox or
 * width/height). Null when the file can't be read or isn't one of those.
 */
import { closeSync, openSync, readSync } from 'node:fs'

function head(file: string, bytes: number): Buffer | null {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const n = readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, n)
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Whether the TIFF block at `t` (inside an Exif segment ending at `end`) says orientation 5–8. */
function exifTurned(b: Buffer, t: number, end: number): boolean {
  if (t + 8 > end) return false
  const le = b.toString('ascii', t, t + 2) === 'II'
  const u16 = (o: number): number => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
  const u32 = (o: number): number => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
  const ifd = t + u32(t + 4)
  if (ifd + 2 > end) return false
  for (let e = ifd + 2, k = 0, n = u16(ifd); k < n && e + 12 <= end; k++, e += 12)
    if (u16(e) === 0x0112) {
      const o = u16(e + 8)
      return o >= 5 && o <= 8
    }
  return false
}

export function imageSize(file: string): [number, number] | null {
  const b = head(file, 256 * 1024)
  if (!b || b.length < 24) return null
  // PNG: IHDR right after the signature
  if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)]
  // GIF
  if (b.toString('ascii', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)]
  // WebP
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16)
    if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
    if (kind === 'VP8L') {
      const v = b.readUInt32LE(21)
      return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]
    }
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
    return null
  }
  // JPEG: walk the markers to the first start-of-frame; a phone photo's EXIF orientation 5–8
  // turns it a quarter, as browsers draw it
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    let turned = false
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      const len = b.readUInt16BE(i + 2)
      if (marker === 0xe1 && b.toString('ascii', i + 4, i + 10) === 'Exif\0\0')
        turned = exifTurned(b, i + 10, Math.min(b.length, i + 2 + len))
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const w = b.readUInt16BE(i + 7)
        const h = b.readUInt16BE(i + 5)
        return turned ? [h, w] : [w, h]
      }
      i += 2 + len
    }
    return null
  }
  // SVG
  const text = b.toString('utf8')
  if (text.includes('<svg')) {
    const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? ''
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag)
    if (vb) return [Number(vb[1]), Number(vb[2])]
    const w = /\swidth\s*=\s*["']([\d.]+)/i.exec(tag)
    const h = /\sheight\s*=\s*["']([\d.]+)/i.exec(tag)
    if (w && h) return [Number(w[1]), Number(h[1])]
  }
  return null
}
