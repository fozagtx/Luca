import type { Project } from '../shared/types'

let current: Project | null = null
let onChange: ((p: Project | null) => void)[] = []

export function currentProject(): Project | null {
  return current
}

export function requireProject(): Project {
  if (!current) throw new Error('No project is open')
  return current
}

export function setCurrentProject(p: Project | null): void {
  current = p
  for (const cb of onChange) cb(p)
}

export function onProjectChange(cb: (p: Project | null) => void): () => void {
  onChange.push(cb)
  return () => {
    onChange = onChange.filter((c) => c !== cb)
  }
}
