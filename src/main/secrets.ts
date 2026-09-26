import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type SecretName = 'assemblyai'

function file(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'secrets.bin')
}

function readAll(): Record<string, string> {
  const f = file()
  if (!existsSync(f)) return {}
  try {
    const buf = readFileSync(f)
    if (buf.length === 0) return {}
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8')
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, string>): void {
  const json = JSON.stringify(data)
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  writeFileSync(file(), buf)
}

export function getSecret(name: SecretName): string | null {
  return readAll()[name] ?? null
}

export function setSecret(name: SecretName, value: string): void {
  const all = readAll()
  if (value.trim().length === 0) delete all[name]
  else all[name] = value.trim()
  writeAll(all)
}

export function hasSecret(name: SecretName): boolean {
  return (getSecret(name)?.length ?? 0) > 0
}
