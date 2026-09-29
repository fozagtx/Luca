import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import type { Checkpoint } from '../shared/types'
import { Channels, broadcast } from './ipc'

const GITIGNORE = `media/
renders/
node_modules/
.luca/cache/
.luca/audio.flac
.luca/chat.jsonl
.luca/session.json
.luca/project.json
.hyperframes/
*.mp4
*.mov
*.m4v
*.webm
*.wav
*.mp3
*.m4a
*.flac
.DS_Store
`

/** A pattern with the slashes that don't change what it ignores taken off, to compare two spellings. */
const pattern = (line: string): string => line.trim().replace(/^\/+|\/+$/g, '')

/**
 * What `.gitignore` should hold after Luca has looked at it: the whole default when there is none,
 * else the file plus the default's lines it lacks (a file written by another tool, like
 * `hyperframes init`, would otherwise leave generated sound tracked, and undo would delete it).
 * Null when nothing is missing.
 */
export function toppedUpGitignore(existing: string | null): string | null {
  if (existing === null) return GITIGNORE
  const has = new Set(existing.split('\n').map(pattern).filter(Boolean))
  const missing = GITIGNORE.split('\n').filter((l) => l.trim() && !has.has(pattern(l)))
  if (!missing.length) return null
  const lead = existing.length && !existing.endsWith('\n') ? '\n' : ''
  return `${existing}${lead}${existing.trim() ? '\n# Added by Luca\n' : ''}${missing.join('\n')}\n`
}

function git(dir: string): SimpleGit {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('GIT_') && k !== 'EDITOR' && k !== 'VISUAL') env[k] = v
  }
  return simpleGit({
    baseDir: dir,
    binary: 'git',
    maxConcurrentProcesses: 1,
    config: ['user.name=Luca', 'user.email=luca@localhost']
  }).env(env)
}

const queues = new Map<string, Promise<unknown>>()

/**
 * One writing git operation at a time per project. Checkpoints are fired and forgotten (after an
 * edit, after an agent turn), and two commits at once fail on HEAD's lock and lose one of them.
 */
function serial<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(dir)
  const next = (queues.get(key) ?? Promise.resolve()).then(fn, fn)
  const tail = next.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return next
}

export function ensureRepo(dir: string): Promise<void> {
  return serial(dir, () => ensureRepoNow(dir))
}

async function ensureRepoNow(dir: string): Promise<void> {
  const g = git(dir)
  if (!existsSync(join(dir, '.git'))) await g.init()
  const gi = join(dir, '.gitignore')
  const topped = toppedUpGitignore(existsSync(gi) ? readFileSync(gi, 'utf8') : null)
  if (topped !== null) writeFileSync(gi, topped)
  const fresh = (await g.raw(['rev-list', '--count', 'HEAD']).catch(() => '0')).trim() === '0'
  await g.add(['-A'])
  const st = await g.status()
  if (st.files.length > 0) await g.commit(fresh ? 'Import' : 'Edit: changes made outside Luca')
}

/** Commit only when something changed. Returns the new sha or null. */
export function checkpoint(dir: string, message: string): Promise<string | null> {
  return serial(dir, () => checkpointNow(dir, message))
}

async function checkpointNow(dir: string, message: string): Promise<string | null> {
  const g = git(dir)
  await g.add(['-A'])
  const st = await g.status()
  if (st.files.length === 0) return null
  const res = await g.commit(message.split('\n')[0].slice(0, 120))
  broadcast(Channels.historyChanged)
  return res.commit || null
}

export async function history(dir: string, limit = 60): Promise<Checkpoint[]> {
  const g = git(dir)
  if (!existsSync(join(dir, '.git'))) return []
  const head = (await g.revparse(['HEAD']).catch(() => '')).trim()
  if (!head) return []
  const raw = await g.raw([
    'log',
    `-${limit}`,
    '--format=%x1e%H%x1f%s%x1f%cI',
    '--name-only',
    '--root'
  ])
  return raw
    .split('\x1e')
    .filter((s) => s.trim())
    .map((chunk) => {
      const [header, ...rest] = chunk.split('\n')
      const [sha, message, date] = header.split('\x1f')
      const files = rest.filter((l) => l.trim()).length
      return { sha, shortSha: sha.slice(0, 7), message, date, files, isHead: sha === head }
    })
}

/** Check out a checkpoint's files on top of HEAD and commit; history is never rewritten. */
export function restore(dir: string, sha: string): Promise<void> {
  return serial(dir, () => restoreNow(dir, sha))
}

async function restoreNow(dir: string, sha: string): Promise<void> {
  const g = git(dir)
  await g.add(['-A'])
  if ((await g.status()).files.length > 0) await g.commit('Before restore')
  // `git read-tree -u --reset <sha>` also removes files added since `sha`.
  await g.raw(['read-tree', '-u', '--reset', sha])
  await g.add(['-A'])
  if ((await g.status()).files.length > 0) {
    await g.commit(`Restore to ${sha.slice(0, 7)}`)
  }
  broadcast(Channels.historyChanged)
}

/** ⌘Z: restore the checkpoint before HEAD (after any checkpoint still being written). */
export function undo(dir: string): Promise<void> {
  return serial(dir, async () => {
    const log = await git(dir).log({ maxCount: 2 })
    const prev = log.all[1]
    if (prev) await restoreNow(dir, prev.hash)
  })
}

export async function headSha(dir: string): Promise<string | null> {
  try {
    return (await git(dir).revparse(['HEAD'])).trim()
  } catch {
    return null
  }
}
