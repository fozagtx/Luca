/**
 * The two small files ai33 keeps in a project, and the only code that writes them (so a choice
 * saved here is never lost to another writer): `.luca/ai33.json` (the voice, the words to say a
 * certain way, a record of what the first turn may make without asking) and `.luca/script.json` (this
 * project's words come from a script, so they are exact). Plain files, versioned with the
 * project, so undo puts them back with everything else. Pure fs: nothing here imports Electron.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectAi33, ScriptMeta } from '../shared/ai33'

const AI33_FILE = 'ai33.json'
const SCRIPT_FILE = 'script.json'

const fileIn = (dir: string, name: string): string => join(dir, '.luca', name)

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Written to a temp file first, so a crash never leaves half a file behind. */
function writeJson(dir: string, name: string, data: unknown): void {
  mkdirSync(join(dir, '.luca'), { recursive: true })
  const file = fileIn(dir, name)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  renameSync(tmp, file)
}

/** This project's ai33 choices ({} when there are none, or the file can't be read). */
export function readProjectAi33(dir: string): ProjectAi33 {
  return (readJson(fileIn(dir, AI33_FILE)) ?? {}) as ProjectAi33
}

/**
 * Change some of this project's ai33 choices and keep the rest: a top-level merge (an array is
 * replaced whole, a key the patch sets to undefined is dropped, keys this version doesn't know
 * are kept). Returns what was saved.
 */
export function patchProjectAi33(dir: string, patch: Partial<ProjectAi33>): ProjectAi33 {
  const next: Record<string, unknown> = { ...readJson(fileIn(dir, AI33_FILE)), ...patch, v: 1 }
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k]
  writeJson(dir, AI33_FILE, next)
  return next as ProjectAi33
}

/** Where this project's words come from, or null when it isn't recorded from a script. */
export function readScriptMeta(dir: string): ScriptMeta | null {
  const raw = readJson(fileIn(dir, SCRIPT_FILE))
  return raw ? (raw as ScriptMeta) : null
}

export function writeScriptMeta(dir: string, m: ScriptMeta): void {
  writeJson(dir, SCRIPT_FILE, { ...m, v: 1 })
}

/**
 * The words in this project are exact (recorded from a script): nothing to transcribe or clean,
 * and captions keep every word. False for every project made from footage.
 */
export function isScriptProject(dir: string): boolean {
  return existsSync(fileIn(dir, SCRIPT_FILE))
}
