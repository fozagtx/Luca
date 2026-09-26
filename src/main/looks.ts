import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { Look, Project } from '../shared/types'
import { activeAgent, agentFor, onTurnEnd } from './agent'
import { addCatalogItem, snapshot } from './hyperframes'
import { readProject, slugify, writeProject } from './projects'
import { appDataDir } from './settings'

export function looksDir(): string {
  const d = join(appDataDir(), 'looks')
  mkdirSync(d, { recursive: true })
  return d
}

function lookDir(slug: string): string {
  return join(looksDir(), slug)
}

export function readLook(slug: string): Look | null {
  const f = join(lookDir(slug), 'look.json')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as Look
  } catch {
    return null
  }
}

export function listLooks(): (Look & { thumb: string | null })[] {
  return readdirSync(looksDir())
    .map((slug) => {
      const l = readLook(slug)
      if (!l) return null
      const thumb = join(lookDir(slug), 'thumb.jpg')
      return {
        ...l,
        thumb: existsSync(thumb)
          ? `data:image/png;base64,${readFileSync(thumb).toString('base64')}`
          : null
      }
    })
    .filter((l): l is Look & { thumb: string | null } => l !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

type Registry = { registryItems?: { name: string; target?: string }[] }

function registryItems(dir: string): { name: string; target?: string }[] {
  const f = join(dir, 'hyperframes.json')
  if (!existsSync(f)) return []
  try {
    return (JSON.parse(readFileSync(f, 'utf8')) as Registry).registryItems ?? []
  } catch {
    return []
  }
}

function customCompositions(dir: string): string[] {
  const comps = join(dir, 'compositions')
  if (!existsSync(comps)) return []
  const registered = new Set(
    registryItems(dir)
      .map((r) => r.target)
      .filter((t): t is string => !!t)
      .map((t) => relative(dir, join(dir, t)))
  )
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const f = join(d, name)
      if (statSync(f).isDirectory()) walk(f)
      else if (/\.html?$/i.test(name) && !registered.has(relative(dir, f))) out.push(f)
    }
  }
  walk(comps)
  return out
}

function waitForTurn(dir: string): Promise<{ isError: boolean; error?: string }> {
  return new Promise((resolve) => {
    const off = onTurnEnd((p, e) => {
      if (p.dir !== dir) return
      off()
      resolve(e)
    })
  })
}

/** Ask Claude to write LOOK.md into the look folder (rules and files, not timecodes). */
async function writeLookMd(p: Project, dest: string): Promise<void> {
  const agent = activeAgent() ?? agentFor(p)
  const target = join(dest, 'LOOK.md')
  await agent.send({
    text:
      `Write a Look style guide to \`${target}\` (Write tool, absolute path) so this project's editing style can be reproduced on a different video. ` +
      'Cover: fonts, sizes and weights; colors as hex; caption style (words per group, position, entrance, emphasis); ' +
      'transitions and motion graphics by catalog name and when to use them; pacing (pause length, how aggressive cuts are); music level and ducking. ' +
      'Refer to files and rules, never to timecodes of this video. Reply with one line when done.',
    chips: [],
    context: { look: true }
  })
  const end = await waitForTurn(p.dir)
  if (end.isError) throw new Error(end.error ?? 'Claude turn failed')
  if (!existsSync(target)) throw new Error('Claude did not write LOOK.md')
}

function lookKeyterms(p: Project): string[] {
  const f = join(p.dir, 'transcript.json')
  if (!existsSync(f)) return []
  try {
    const t = JSON.parse(readFileSync(f, 'utf8')) as { words?: { text: string }[] }
    const counts = new Map<string, number>()
    for (const w of t.words ?? []) {
      const s = w.text.replace(/[^A-Za-z0-9-]/g, '')
      if (s.length > 3 && /^[A-Z]/.test(s)) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([k]) => k)
  } catch {
    return []
  }
}

async function saveInto(p: Project, slug: string, name: string, at: number): Promise<Look> {
  const dest = lookDir(slug)
  mkdirSync(dest, { recursive: true })
  await writeLookMd(p, dest)
  const comps = join(dest, 'components')
  rmSync(comps, { recursive: true, force: true })
  mkdirSync(comps, { recursive: true })
  for (const f of customCompositions(p.dir)) {
    const rel = relative(join(p.dir, 'compositions'), f)
    mkdirSync(join(comps, rel, '..'), { recursive: true })
    copyFileSync(f, join(comps, rel))
  }
  const prev = readLook(slug)
  const look: Look = {
    name,
    slug,
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    sourceProject: p.name,
    aspect: p.aspect,
    keyterms: lookKeyterms(p),
    catalogItems: registryItems(p.dir).map((r) => r.name)
  }
  writeFileSync(join(dest, 'look.json'), JSON.stringify(look, null, 2))
  const thumbPng = join(dest, 'thumb.png')
  if (await snapshot(p.dir, at, thumbPng)) {
    // hyperframes writes PNG; keep the spec's thumb.jpg name by copying (renderer loads either)
    copyFileSync(thumbPng, join(dest, 'thumb.jpg'))
    rmSync(thumbPng, { force: true })
  }
  return look
}

export function saveLook(p: Project, name: string, at = 1): Promise<Look> {
  const base = slugify(name) || 'look'
  let slug = base
  for (let i = 2; existsSync(lookDir(slug)); i++) slug = `${base}-${i}`
  return saveInto(p, slug, name, at)
}

export function updateLook(p: Project, slug: string, at = 1): Promise<Look> {
  const prev = readLook(slug)
  if (!prev) throw new Error(`Look ${slug} not found`)
  return saveInto(p, slug, prev.name, at)
}

export async function applyLook(p: Project, slug: string): Promise<void> {
  const look = readLook(slug)
  if (!look) throw new Error(`Look ${slug} not found`)
  const dir = lookDir(slug)
  const comps = join(dir, 'components')
  if (existsSync(comps)) {
    mkdirSync(join(p.dir, 'compositions'), { recursive: true })
    cpSync(comps, join(p.dir, 'compositions'), {
      recursive: true,
      force: false,
      errorOnExist: false
    })
  }
  const failures: string[] = []
  for (const name of look.catalogItems) {
    const r = await addCatalogItem(p.dir, name)
    if (!r.ok) failures.push(`${name}: ${r.error ?? 'failed'}`)
  }
  const md = join(dir, 'LOOK.md')
  mkdirSync(join(p.dir, '.luca'), { recursive: true })
  if (existsSync(md)) copyFileSync(md, join(p.dir, '.luca', 'LOOK.md'))
  writeFileSync(
    join(p.dir, '.luca', 'look.json'),
    JSON.stringify({ slug, keyterms: look.keyterms }, null, 2)
  )
  const current = readProject(p.dir) ?? p
  writeProject({ ...current, look: slug })
  if (failures.length)
    throw new Error(`Look applied, but some catalog items failed:\n${failures.join('\n')}`)
}

export function removeLook(slug: string): void {
  rmSync(lookDir(slug), { recursive: true, force: true })
}

export function lookName(slug: string): string {
  return readLook(slug)?.name ?? basename(slug)
}
