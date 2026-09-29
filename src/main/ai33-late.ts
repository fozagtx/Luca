/**
 * What happens when a job that outlived its caller's wait ends in the background: its files are
 * saved into the project it was made for (under the names `ai33_status` collect uses, so the two
 * agree), and the person is told. Electron-side because it opens the project and imports files.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Ai33Kind, Ai33Notice, SavedAsset } from '../shared/ai33'
import type { Project } from '../shared/types'
import { dataDir, downloadTo, thingFor } from './ai33-client'
import { upsert, type JobEvent, type LedgerEntry } from './ai33-jobs'
import { findSaved, importGenerated } from './place'

type Settled = Extract<JobEvent, { type: 'settled' }>

const AUDIO_MAX_BYTES = 300 * 1024 * 1024
/** A download that has not finished by now is given up on (the files stay at ai33). */
const SAVE_TIMEOUT_MS = 5 * 60_000

/** What "Add it" asks Luca, by what was made. */
const REQUESTS: Record<Ai33Kind, string> = {
  music: 'Add the music that just finished under the video',
  speech: 'Add the voiceover that just finished to the video',
  dialogue: 'Add the conversation that just finished to the video',
  sfx: 'Add the sound effect that just finished to the video'
}

/**
 * The project a job was made for, or null once it is gone. Read from its own file: projects.ts
 * imports the account, so this module (which the account starts) must not import projects.ts.
 */
function projectAt(dir: string): Project | null {
  try {
    return JSON.parse(readFileSync(join(dir, '.luca', 'project.json'), 'utf8')) as Project
  } catch {
    return null
  }
}

const slugOf = (text: string, fallback: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback

/**
 * A finished job's files in its project (project-relative): downloaded now, while ai33 still
 * has them, and checked before they are kept. Files already saved are used as they are.
 */
async function saveFinished(p: Project, entry: LedgerEntry): Promise<string[]> {
  const urls = entry.urls
  const from = urls?.audios?.length ? urls.audios : urls?.audio ? [urls.audio] : []
  if (!from.length) return []
  const kind: SavedAsset['kind'] = entry.kind === 'dialogue' ? 'speech' : entry.kind
  const have = findSaved(p.dir, kind, entry.requestHash)
  if (have.length >= from.length) return have
  const incoming = join(dataDir(), 'incoming')
  mkdirSync(incoming, { recursive: true })
  const files: string[] = []
  for (const [i, url] of from.entries()) {
    const tmp = join(incoming, `${entry.jobId}-${i + 1}`)
    try {
      await downloadTo(url, tmp, {
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        maxBytes: AUDIO_MAX_BYTES
      })
      // each take is its own file, so each has its own hash
      const one = await importGenerated(p, kind, tmp, {
        slug: slugOf(entry.summary, entry.kind),
        hash: i === 0 ? entry.requestHash : `${entry.requestHash}-${i + 1}`,
        prompt: entry.summary
      })
      files.push(one.rel)
    } catch (err) {
      console.warn('[ai33] saving a finished file failed', err instanceof Error ? err.message : err)
    } finally {
      rmSync(tmp, { force: true })
    }
  }
  return files
}

/** Save what a background job made and tell the person how it ended. */
export async function announceSettled(e: Settled, send: (n: Ai33Notice) => void): Promise<void> {
  const { entry, result } = e
  const thing = thingFor(entry.kind)
  const project = entry.projectDir ? projectAt(entry.projectDir) : null
  const where = project ? { projectId: project.id } : {}
  if (result !== 'done') {
    send({
      id: entry.jobId,
      kind: 'still-working',
      text:
        entry.error ??
        (result === 'failed'
          ? `Your ${thing} didn’t work out.`
          : `Your ${thing} is taking a long time at ai33. It may still finish; ask Luca to check it later.`),
      ...where
    })
    return
  }
  let saved: string[] = []
  if (project) {
    try {
      saved = await saveFinished(project, entry)
    } catch (err) {
      console.warn('[ai33] saving a finished job failed', err instanceof Error ? err.message : err)
    }
  }
  if (saved.length) upsert({ ...entry, dest: saved })
  send({
    id: entry.jobId,
    kind: 'ready',
    text: `Your ${thing} is ready.${saved.length ? ' It’s saved with the project.' : ''}`,
    ...where,
    action: { label: 'Add it', request: REQUESTS[entry.kind] }
  })
}
