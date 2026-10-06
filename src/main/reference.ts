import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { extname, join } from 'node:path'
import { childEnv, probeMedia, run, which } from './env'

const SHEET = /^sheet-\d+\.png$/

/**
 * Study a reference video: a copy in .luca/reference/ and tiled contact sheets it can read —
 * 2 frames a second, 20 frames (10 s) to a sheet. Returns the sheets as project-relative
 * paths, in order, and the video's length.
 */
export async function studyReference(
  dir: string,
  file: string,
  report?: (message: string) => void
): Promise<{ path: string; seconds: number; sheets: string[] }> {
  const refDir = join(dir, '.luca', 'reference')
  mkdirSync(refDir, { recursive: true })
  const ext = extname(file) || '.mp4'
  const dest = join(refDir, `reference${ext}`)
  report?.('Copying the reference')
  copyFileSync(file, dest)
  const seconds =
    Math.round(
      (await probeMedia(dest).then(
        (m) => m.duration,
        () => 0
      )) * 10
    ) / 10
  report?.('Pulling frames')
  // the sheets of a reference studied before (a longer one leaves more) aren't this one's
  for (const f of readdirSync(refDir)) if (SHEET.test(f)) rmSync(join(refDir, f), { force: true })
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  const r = await run(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-i',
      dest,
      '-vf',
      'fps=2,scale=320:-2,tile=5x4',
      join(refDir, 'sheet-%02d.png')
    ],
    { env: await childEnv(), timeoutMs: 120_000 }
  )
  if (r.code !== 0) throw new Error(r.stderr.trim().slice(-400) || 'Could not read the video')
  const sheets = readdirSync(refDir)
    .filter((f) => SHEET.test(f))
    // sheet-100 (past 16 minutes) comes after sheet-99
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((f) => `.luca/reference/${f}`)
  return { path: `.luca/reference/reference${ext}`, seconds, sheets }
}
