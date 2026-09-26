import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '../shared/types'

const defaults = (): Settings => ({
  projectsDir: join(homedir(), 'Movies', 'Luca'),
  theme: 'light',
  renderWorkers: 2,
  defaultAspect: 'landscape',
  keyterms: [],
  recentProjects: [],
  panes: {},
  alwaysAllow: {}
})

let cache: Settings | null = null

export function appDataDir(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return dir
}

function file(): string {
  return join(appDataDir(), 'settings.json')
}

export function getSettings(): Settings {
  if (cache) return cache
  const f = file()
  if (existsSync(f)) {
    try {
      cache = { ...defaults(), ...(JSON.parse(readFileSync(f, 'utf8')) as Partial<Settings>) }
      return cache
    } catch {
      // fall through
    }
  }
  cache = defaults()
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(cache, null, 2))
  return cache
}
