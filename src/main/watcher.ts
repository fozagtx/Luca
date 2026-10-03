import chokidar, { type FSWatcher } from 'chokidar'
import { relative, sep } from 'node:path'
import type { ProjectChanged } from '../shared/types'
import { Channels, broadcast } from './ipc'

let watcher: FSWatcher | null = null
let version = 0
let pending = new Set<string>()
let timer: NodeJS.Timeout | null = null
let listeners: ((e: ProjectChanged) => void)[] = []

/** Never read by the preview or the timeline: the agent's frame grabs (`snapshot`) among them. */
const IGNORED_TOP = new Set([
  '.hyperframes',
  '.thumbnails',
  '.waveform-cache',
  'media',
  'renders',
  'snapshots',
  '.git',
  'node_modules'
])

/**
 * What Luca and the agent keep beside the composition that the preview never loads: Luca's own
 * state, the cut list and the words (transcript.json), remocn wrapper sources (their render lands
 * in index.html) and project notes. Changing only these doesn't need a preview reload or a
 * timeline re-read.
 */
const METADATA_TOP = new Set(['.luca', '.claude', 'remocn'])
const METADATA_FILES = new Set([
  'edl.json',
  'transcript.json',
  'CLAUDE.md',
  'AGENTS.md',
  'meta.json',
  'package.json',
  'package-lock.json',
  '.gitignore'
])

export function affectsComposition(rel: string): boolean {
  return !METADATA_TOP.has(rel.split(sep)[0]) && !METADATA_FILES.has(rel)
}

export function onProjectChanged(cb: (e: ProjectChanged) => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

export function watchProject(dir: string): void {
  stopWatching()
  watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    persistent: true,
    ignored: (path) => {
      const rel = relative(dir, path)
      if (!rel || rel.startsWith('..')) return false
      const [top, second] = rel.split(sep)
      if (IGNORED_TOP.has(top)) return true
      if (
        top === '.luca' &&
        (second === 'cache' || second === 'audio.flac' || second === 'chat.jsonl')
      )
        return true
      if (top === '.luca' && second === 'session.json') return true
      return false
    },
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 }
  })
  const queue = (path: string): void => {
    pending.add(relative(dir, path))
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 150)
  }
  watcher.on('add', queue).on('change', queue).on('unlink', queue)
}

function flush(): void {
  timer = null
  if (pending.size === 0) return
  version += 1
  const paths = [...pending]
  const e: ProjectChanged = { paths, version, composition: paths.some(affectsComposition) }
  pending = new Set()
  broadcast(Channels.projectChanged, e)
  for (const l of listeners) l(e)
}

/**
 * Reload the preview for something only it sees (an edit-friendly copy of a clip is ready). Like
 * any change it keeps the playhead and whether it was playing.
 */
export function refreshPreview(path: string): void {
  if (!watcher) return
  version += 1
  const e: ProjectChanged = { paths: [path], version, composition: true }
  broadcast(Channels.projectChanged, e)
  for (const l of listeners) l(e)
}

export function stopWatching(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = new Set()
  watcher?.close()
  watcher = null
}

export function currentVersion(): number {
  return version
}
