import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { childEnv, probeMedia, run, which } from './env'

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
    .filter((f) => /^sheet-\d+\.png$/.test(f))
    .sort()
    .map((f) => `.luca/reference/${f}`)
  return { path: `.luca/reference/reference${ext}`, seconds, sheets }
}
