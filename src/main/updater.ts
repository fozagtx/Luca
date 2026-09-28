import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  accessSync,
  constants,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { UpdateStatus } from '../shared/types'
import { activeAgent } from './agent'
import { run } from './env'
import { exportProgress } from './export'
import { Channels, broadcast, notifyInBackground } from './ipc'
import { getSecret, setSecret } from './secrets'
import { getSettings, updateSettings } from './settings'

/**
 * Luca updates itself from its GitHub releases. Every push to main builds one (see
 * .github/workflows/release.yml): the Mac zip, plus latest-mac.json saying its version, size and
 * SHA-512. Luca asks GitHub now and then, downloads a newer build in the background and swaps
 * its own app bundle when you restart, or when you quit. The build isn't signed, and Squirrel
 * (Electron's own updater) installs only signed apps, so Luca replaces the bundle itself.
 */
const REPO = 'fozagtx/Luca'
const API = `https://api.github.com/repos/${REPO}`
const MANIFEST = 'latest-mac.json'

const FIRST_CHECK = 20_000
const EVERY = 15 * 60_000
/** Coming back to Luca checks again when the last check is at least this old. */
const ON_FOCUS = 5 * 60_000

type Asset = { id: number; name: string; size: number }
type Release = { tag_name: string; body?: string | null; html_url: string; assets: Asset[] }
type Manifest = { version: string; file: string; size: number; sha512: string }

class NeedsToken extends Error {
  constructor() {
    super(
      `GitHub shows ${REPO}’s releases only to people signed in to it. Add a GitHub token that can read the repository, or make the repository public.`
    )
  }
}

let status: UpdateStatus = { current: app.getVersion(), state: 'idle', hasToken: false }
/** The downloaded Luca, ready to replace this one. */
let staged: { app: string; version: string } | null = null
/** The swap was started (Luca is quitting into it). */
let swapping = false
let checking: Promise<UpdateStatus> | null = null
let lastCheck = 0
/** GitHub's last answer, reused while it says nothing changed (304s don't count as requests). */
let latest: { etag: string; release: Release; manifest: Manifest } | null = null

const token = (): string | null => getSecret('github')

function snapshot(): UpdateStatus {
  return { ...status, hasToken: !!token() }
}

function setStatus(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch }
  const s = snapshot()
  broadcast(Channels.updatesStatusPush, s)
  return s
}

function headers(accept: string, key = token()): Record<string, string> {
  return {
    Accept: accept,
    'User-Agent': `Luca/${status.current}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(key ? { Authorization: `Bearer ${key}` } : {})
  }
}

/** a > b for versions like 0.1.42 (anything after a "-" is ignored). */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

const updatesDir = (): string => join(app.getPath('userData'), 'updates')

/** /Applications/Luca.app, from …/Luca.app/Contents/MacOS/Luca. */
const bundlePath = (): string => resolve(app.getPath('exe'), '../../..')

/** Why Luca can't replace itself where it runs, or null when it can. */
function cantReplace(): string | null {
  const bundle = bundlePath()
  if (!bundle.endsWith('.app')) return 'Luca isn’t running from its app, so it can’t update itself.'
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/'))
    return 'Luca is running from the disk image or from Downloads, where it can’t update itself. Move it to Applications.'
  try {
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
  } catch {
    return `Luca can’t replace itself in ${dirname(bundle)}. Move it to Applications.`
  }
  return null
}

// ------------------------------------------------------------------------------ GitHub

/** A release file: through the API (which takes the token), then from GitHub's storage without it. */
async function assetResponse(a: Asset, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${API}/releases/assets/${a.id}`, {
    headers: headers('application/octet-stream'),
    redirect: 'manual',
    signal
  })
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel()
    const to = res.headers.get('location')
    if (!to) throw new Error(`GitHub didn’t say where ${a.name} is.`)
    const file = await fetch(to, { signal })
    if (!file.ok) throw new Error(`Couldn’t download ${a.name} (${file.status}).`)
    return file
  }
  if (!res.ok) throw new Error(`Couldn’t download ${a.name} (${res.status}).`)
  return res
}

/** The newest release and its manifest; null when there is none yet (or it is still uploading). */
async function latestRelease(): Promise<{ release: Release; manifest: Manifest } | null> {
  const res = await fetch(`${API}/releases/latest`, {
    headers: {
      ...headers('application/vnd.github+json'),
      ...(latest ? { 'If-None-Match': latest.etag } : {})
    },
    signal: AbortSignal.timeout(20_000)
  })
  if (res.status === 304 && latest) return latest
  if (res.status === 404) {
    // a private repository reads as missing to anyone who can't see it
    const repo = await fetch(API, {
      headers: headers('application/vnd.github+json'),
      signal: AbortSignal.timeout(20_000)
    })
    if (repo.ok) return null
    if (!token()) throw new NeedsToken()
    throw new Error(
      `The GitHub token can’t read ${REPO}. Make one that can read its contents (Check for Updates… in the Luca menu).`
    )
  }
  if (res.status === 401)
    throw new Error(
      'GitHub didn’t accept the token for updates. Add a new one under Check for Updates….'
    )
  if (res.status === 403 || res.status === 429)
    throw new Error('GitHub asked Luca to slow down. It checks again in a little while.')
  if (!res.ok) throw new Error(`GitHub answered ${res.status} when Luca looked for updates.`)
  const release = (await res.json()) as Release
  const asset = release.assets?.find((a) => a.name === MANIFEST)
  if (!asset) return null
  const m = (await (await assetResponse(asset, AbortSignal.timeout(20_000))).json()) as Manifest
  if (!m?.version || !m.file || !m.sha512 || !(m.size > 0))
    throw new Error(`The release’s ${MANIFEST} isn’t complete.`)
  const etag = res.headers.get('etag')
  latest = etag ? { etag, release, manifest: m } : null
  return { release, manifest: m }
}

// ------------------------------------------------------------------------------ downloading

/** Download the zip, check it, and unpack the new Luca.app next to it. */
async function fetchUpdate(release: Release, m: Manifest): Promise<void> {
  const asset = release.assets.find((a) => a.name === m.file)
  if (!asset) throw new Error(`The release has no ${m.file}.`)
  staged = null
  const dir = join(updatesDir(), m.version)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  setStatus({
    state: 'downloading',
    version: m.version,
    progress: 0,
    notes: release.body?.trim() || undefined,
    url: release.html_url,
    needsMove: false,
    needsToken: false,
    message: undefined
  })

  const zip = join(dir, m.file)
  const res = await assetResponse(asset, AbortSignal.timeout(30 * 60_000))
  if (!res.body) throw new Error('GitHub sent an empty download.')
  const hash = createHash('sha512')
  const out = createWriteStream(zip)
  let got = 0
  let shown = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      got += chunk.length
      if (!out.write(chunk)) await once(out, 'drain')
      const p = Math.min(1, got / m.size)
      if (p - shown >= 0.01) {
        shown = p
        setStatus({ progress: p })
      }
    }
    out.end()
    await once(out, 'finish')
  } catch (err) {
    out.destroy()
    throw err
  }
  if (got !== m.size || hash.digest('hex') !== m.sha512.toLowerCase())
    throw new Error('The download was damaged. Luca tries again at the next check.')

  const unzip = await run('/usr/bin/ditto', ['-x', '-k', zip, dir], { timeoutMs: 600_000 })
  rmSync(zip, { force: true })
  const name = readdirSync(dir).find((f) => f.endsWith('.app'))
  if (unzip.code !== 0 || !name) throw new Error('Couldn’t unpack the new Luca.')
  const next = join(dir, name)
  const plist = join(next, 'Contents', 'Info.plist')
  const v = existsSync(plist)
    ? await run('/usr/bin/plutil', [
        '-extract',
        'CFBundleShortVersionString',
        'raw',
        '-o',
        '-',
        plist
      ])
    : null
  if (v?.stdout.trim() !== m.version)
    throw new Error(`The download isn’t Luca ${m.version}. Luca tries again at the next check.`)
  // made by Luca itself, so macOS shouldn't ask about it on first open
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', next]).catch(() => undefined)

  staged = { app: next, version: m.version }
  setStatus({ state: 'ready', progress: 1 })
  notifyInBackground(`Luca ${m.version} is ready`, 'Restart Luca to use it.')
}

async function check(): Promise<UpdateStatus> {
  if (status.state === 'downloading') return snapshot()
  lastCheck = Date.now()
  if (status.state !== 'ready') setStatus({ state: 'checking', message: undefined })
  try {
    const found = await latestRelease()
    const checkedAt = Date.now()
    // a release still uploading has no manifest yet: keep what is downloaded
    if (!found && staged) return setStatus({ checkedAt })
    const m = found?.manifest
    if (!found || !m || !isNewer(m.version, status.current)) {
      // the release it came from is gone (taken back): don't install it on quit
      staged = null
      return setStatus({
        state: 'idle',
        version: undefined,
        progress: undefined,
        notes: undefined,
        url: undefined,
        needsToken: false,
        needsMove: false,
        checkedAt
      })
    }
    if (staged && !isNewer(m.version, staged.version)) return setStatus({ checkedAt })
    const blocked = cantReplace()
    if (blocked)
      return setStatus({
        state: 'available',
        version: m.version,
        notes: found.release.body?.trim() || undefined,
        url: found.release.html_url,
        needsMove: true,
        needsToken: false,
        message: blocked,
        checkedAt
      })
    setStatus({ checkedAt })
    await fetchUpdate(found.release, m)
    return snapshot()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // a newer Luca that is already downloaded stays ready whatever this check ran into
    if (staged) return setStatus({ state: 'ready', version: staged.version, progress: 1 })
    return setStatus({
      state: 'error',
      progress: undefined,
      needsToken: err instanceof NeedsToken,
      message: /fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT|timeout|network/i.test(message)
        ? 'Couldn’t reach GitHub to look for updates. Check your internet connection.'
        : message
    })
  }
}

// ------------------------------------------------------------------------------ installing

/** Swaps the app bundle once Luca's process has ended, then opens it again when asked. */
const INSTALL_SH = `#!/bin/sh
pid="$1"; app="$2"; new="$3"; relaunch="$4"; log="$5"
exec >>"$log" 2>&1
echo "$(date) installing $new over $app"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 1200 ]; then echo "Luca didn't quit; nothing changed"; exit 1; fi
  sleep 0.1
done
old="$new.previous"
rm -rf "$old"
if ! mv "$app" "$old"; then echo "couldn't move the old app aside"; exit 1; fi
if ! mv "$new" "$app"; then
  echo "couldn't put the new app in place; putting the old one back"
  mv "$old" "$app"
  [ "$relaunch" = 1 ] && /usr/bin/open "$app"
  exit 1
fi
rm -rf "$old"
echo "$(date) installed"
[ "$relaunch" = 1 ] && /usr/bin/open "$app"
exit 0
`

function swap(relaunch: boolean): boolean {
  if (!staged || swapping) return false
  const dir = updatesDir()
  mkdirSync(dir, { recursive: true })
  const script = join(dir, 'install.sh')
  writeFileSync(script, INSTALL_SH, { mode: 0o755 })
  const args = [script, String(process.pid), bundlePath(), staged.app, relaunch ? '1' : '0']
  spawn('/bin/sh', [...args, join(dir, 'install.log')], { detached: true, stdio: 'ignore' }).unref()
  swapping = true
  return true
}

// ------------------------------------------------------------------------------ public

export function updateStatus(): UpdateStatus {
  return snapshot()
}

export function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'off') return Promise.resolve(snapshot())
  checking ??= check().finally(() => {
    checking = null
  })
  return checking
}

/** Quit and open the downloaded Luca. */
export function installUpdate(): void {
  if (!staged) throw new Error('No update is ready yet.')
  if (exportProgress().status === 'running')
    throw new Error('An export is running. Restart when it’s done.')
  if (activeAgent()?.status().state === 'working')
    throw new Error('Luca is still working. Restart when it’s done.')
  if (swap(true)) app.quit()
}

/** Check a GitHub token (for a private repository) and save it; an empty one removes it. */
export async function saveUpdateToken(value: string): Promise<UpdateStatus> {
  const key = value.trim()
  if (key) {
    const res = await fetch(API, {
      headers: headers('application/vnd.github+json', key),
      signal: AbortSignal.timeout(10_000)
    }).catch(() => null)
    if (res?.status === 401)
      throw new Error('GitHub didn’t accept this token. Check that you copied all of it.')
    if (res && [403, 404].includes(res.status))
      throw new Error(
        `This token can’t read ${REPO}. Give it access to the repository, with read-only Contents.`
      )
  }
  setSecret('github', key)
  latest = null
  setStatus({ needsToken: false, message: undefined })
  return checkForUpdates()
}

export function moveToApplications(): boolean {
  // moves the app, then opens it again from Applications
  return app.moveToApplicationsFolder()
}

/** Start looking for updates: soon after launch, every 15 minutes, and when you come back to Luca. */
export function startUpdates(): void {
  const s = getSettings()
  if (s.lastVersion && s.lastVersion !== status.current) status.updatedFrom = s.lastVersion
  if (s.lastVersion !== status.current) updateSettings({ lastVersion: status.current })

  if (!app.isPackaged || process.platform !== 'darwin') {
    status = {
      ...status,
      state: 'off',
      message: 'Luca updates itself when it runs as the installed app, not in development.'
    }
    return
  }
  // what earlier updates left behind: unpacked apps and the previous bundle (the log stays)
  const dir = updatesDir()
  if (existsSync(dir))
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory()) rmSync(join(dir, e.name), { recursive: true, force: true })

  setTimeout(() => void checkForUpdates(), FIRST_CHECK)
  setInterval(() => void checkForUpdates(), EVERY)
  app.on('browser-window-focus', () => {
    if (Date.now() - lastCheck >= ON_FOCUS) void checkForUpdates()
  })
  // "Later": a downloaded update goes in when Luca quits
  app.on('will-quit', () => {
    swap(false)
  })
}
