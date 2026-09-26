import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

export async function ensureRepo(dir: string): Promise<void> {
  const g = git(dir)
  if (!existsSync(join(dir, '.git'))) await g.init()
  const gi = join(dir, '.gitignore')
  if (!existsSync(gi)) writeFileSync(gi, GITIGNORE)
  const fresh = (await g.raw(['rev-list', '--count', 'HEAD']).catch(() => '0')).trim() === '0'
  await g.add(['-A'])
  const st = await g.status()
  if (st.files.length > 0) await g.commit(fresh ? 'Import' : 'Edit: changes made outside Luca')
}

/** Commit only when something changed. Returns the new sha or null. */
export async function checkpoint(dir: string, message: string): Promise<string | null> {
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
export async function restore(dir: string, sha: string): Promise<void> {
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

/** ⌘Z: restore the checkpoint before HEAD. */
export async function undo(dir: string): Promise<void> {
  const g = git(dir)
  const log = await g.log({ maxCount: 2 })
  const prev = log.all[1]
  if (!prev) return
  await restore(dir, prev.hash)
}

export async function headSha(dir: string): Promise<string | null> {
  try {
    return (await git(dir).revparse(['HEAD'])).trim()
  } catch {
    return null
  }
}
