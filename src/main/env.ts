import { execFile, spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { HYPERFRAMES } from '../shared/hyperframes'
import type { EnvStatus } from '../shared/types'
import { hasSecret } from './secrets'

const execFileP = promisify(execFile)

let loginPath: string | null = null

/** Apps opened from Finder get a short PATH; read the login shell's PATH once. */
export async function loginShellPath(): Promise<string> {
  if (loginPath) return loginPath
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await execFileP(shell, ['-ilc', 'echo -n "$PATH"'], {
      timeout: 8000,
      env: { ...process.env, TERM: 'dumb' }
    })
    const p = stdout.trim().split('\n').pop() ?? ''
    if (p.length > 0) loginPath = p
  } catch {
    // fall through to a sensible default
  }
  const extras = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.bun', 'bin'),
    join(homedir(), '.npm-global', 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]
  const parts = new Set([...(loginPath ?? process.env.PATH ?? '').split(delimiter), ...extras])
  parts.delete('')
  loginPath = [...parts].join(delimiter)
  process.env.PATH = loginPath
  return loginPath
}

/** Environment for child processes: login PATH, no ANTHROPIC_API_KEY (it would override the subscription login). */
export async function childEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const PATH = await loginShellPath()
  const env: NodeJS.ProcessEnv = { ...process.env, PATH, ...extra }
  delete env.ANTHROPIC_API_KEY
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

const isExecutable = (p: string): boolean => {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function which(bin: string): Promise<string | null> {
  const PATH = await loginShellPath()
  for (const dir of PATH.split(delimiter)) {
    const p = join(dir, bin)
    if (isExecutable(p)) return p
  }
  return null
}

export type RunResult = { code: number | null; stdout: string; stderr: string }

export function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    input?: string
    signal?: AbortSignal
    /** Streamed output, e.g. ffmpeg's `-progress pipe:1` lines. */
    onStdout?: (chunk: string) => void
  } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      const text = d.toString()
      stdout += text
      opts.onStdout?.(text)
    })
    child.stderr.on('data', (d) => (stderr += d.toString()))
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
        }, opts.timeoutMs)
      : null
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    if (opts.input !== undefined) child.stdin.write(opts.input)
    child.stdin.end()
  })
}

/** The HyperFrames CLI that Luca and its agent both run, pinned so every project reads the same. */
export { HYPERFRAMES }

let hyperframesBinP: Promise<string | null> | null = null

/**
 * The CLI's own executable in npx's cache, resolved (and installed, the first time) once.
 * Going through `npx` costs about 0.6 s of npm start-up on every call, and Luca calls the CLI
 * for every timeline read and edit.
 */
async function hyperframesBin(env: NodeJS.ProcessEnv): Promise<string | null> {
  const seen = hyperframesBinP
  const cached = seen ? await seen : null
  if (cached && isExecutable(cached)) return cached
  // first use, or npx's cache was cleared since: resolve again, once for every waiting caller
  if (!hyperframesBinP || hyperframesBinP === seen) {
    hyperframesBinP = (async () => {
      const npx = (await which('npx')) ?? 'npx'
      const r = await run(
        npx,
        ['--yes', '--package', HYPERFRAMES, '-c', 'command -v hyperframes'],
        {
          cwd: homedir(),
          env,
          timeoutMs: 300_000
        }
      )
      const bin = r.code === 0 ? (r.stdout.trim().split('\n').pop() ?? '') : ''
      return bin && isExecutable(bin) ? bin : null
    })().catch(() => null)
  }
  const p = hyperframesBinP
  const bin = await p
  // not resolvable right now (offline, no npx): try again next time
  if (!bin && hyperframesBinP === p) hyperframesBinP = null
  return bin
}

const hyperframesEnv = (extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> =>
  childEnv({ HYPERFRAMES_SKIP_SKILLS: '1', CI: '1', NO_COLOR: '1', ...extra })

/** Resolve (and if needed install) the CLI in the background so the first project doesn't wait. */
export async function prewarmHyperframes(): Promise<void> {
  await hyperframesBin(await hyperframesEnv())
}

/** Run a HyperFrames CLI command with the login PATH. */
export async function runHyperframes(
  args: string[],
  opts: {
    cwd: string
    timeoutMs?: number
    env?: Record<string, string>
    signal?: AbortSignal
    onStdout?: (chunk: string) => void
  }
): Promise<RunResult> {
  const env = await hyperframesEnv(opts.env)
  const runOpts = {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 120_000,
    signal: opts.signal,
    onStdout: opts.onStdout
  }
  const bin = await hyperframesBin(env)
  if (bin) {
    // as under npx, the CLI's own dependencies' executables come first on PATH
    return run(bin, args, {
      ...runOpts,
      env: { ...env, PATH: dirname(bin) + delimiter + env.PATH }
    })
  }
  const npx = (await which('npx')) ?? 'npx'
  return run(npx, ['--yes', HYPERFRAMES, ...args], { ...runOpts, env })
}

/** Duration (s) and overall bitrate (bit/s) of a media file, from ffprobe. */
export async function probeMedia(file: string): Promise<{ duration: number; bitrate: number }> {
  const ffprobe = (await which('ffprobe')) ?? 'ffprobe'
  const r = await run(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration,bit_rate', '-of', 'json', file],
    { env: await childEnv(), timeoutMs: 30_000 }
  )
  const j = JSON.parse(r.stdout || '{}') as { format?: { duration?: string; bit_rate?: string } }
  return {
    duration: Number(j.format?.duration ?? 0),
    bitrate: Number(j.format?.bit_rate ?? 0)
  }
}

/**
 * Run ffmpeg and report real progress (0..1) from its `-progress` stream against the length of
 * the output in seconds.
 */
export async function ffmpegProgress(
  args: string[],
  outputSeconds: number,
  onProgress: (p: number) => void,
  opts: { timeoutMs?: number } = {}
): Promise<RunResult> {
  const ffmpeg = (await which('ffmpeg')) ?? 'ffmpeg'
  let buf = ''
  let last = -1
  return run(ffmpeg, ['-progress', 'pipe:1', '-nostats', ...args], {
    env: await childEnv(),
    timeoutMs: opts.timeoutMs,
    onStdout: (chunk) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
        let p: number | null = null
        if (m && outputSeconds > 0) p = Math.min(1, Number(m[1]) / 1e6 / outputSeconds)
        else if (line.startsWith('progress=end')) p = 1
        // ~100 updates at most; IPC and React don't need every frame
        if (p !== null && (p - last >= 0.01 || p === 1)) {
          last = p
          onProgress(p)
        }
      }
    }
  })
}

/** Parse the JSON object/array from possibly noisy CLI output. */
export function parseJsonOutput<T>(text: string): T {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as T
  } catch {
    const firstObj = trimmed.indexOf('{')
    const firstArr = trimmed.indexOf('[')
    const candidates = [firstObj, firstArr].filter((i) => i >= 0)
    if (candidates.length === 0) throw new Error(`No JSON in output: ${trimmed.slice(0, 200)}`)
    const start = Math.min(...candidates)
    const open = trimmed[start]
    const close = open === '{' ? '}' : ']'
    const end = trimmed.lastIndexOf(close)
    return JSON.parse(trimmed.slice(start, end + 1)) as T
  }
}

export async function checkClaude(): Promise<{
  ok: boolean
  loggedIn: boolean
  error?: string
  path: string | null
}> {
  const path = await which('claude')
  if (!path) return { ok: false, loggedIn: false, error: 'claude not found on PATH', path: null }
  try {
    const env = await childEnv()
    const res = await run(path, ['-p', 'Reply with exactly: ok', '--output-format', 'text'], {
      env,
      timeoutMs: 45_000,
      cwd: homedir()
    })
    const out = (res.stdout + '\n' + res.stderr).trim()
    if (
      /not logged in|\/login|authentication|invalid api key|please run/i.test(out) ||
      res.code !== 0
    ) {
      return { ok: true, loggedIn: false, error: out.split('\n').slice(-3).join('\n'), path }
    }
    return { ok: true, loggedIn: true, path }
  } catch (err) {
    return { ok: true, loggedIn: false, error: String(err), path }
  }
}

export async function envStatus(): Promise<EnvStatus> {
  const [claudePath, ffmpeg, git] = await Promise.all([
    which('claude'),
    which('ffmpeg'),
    which('git')
  ])
  let nodeVersion = process.versions.node
  const nodeBin = await which('node')
  if (nodeBin) {
    try {
      const { stdout } = await execFileP(nodeBin, ['--version'])
      nodeVersion = stdout.trim().replace(/^v/, '')
    } catch {
      // ignore
    }
  }
  const major = Number(nodeVersion.split('.')[0])
  return {
    node: { ok: major >= 22, version: nodeVersion },
    claude: { ok: !!claudePath, path: claudePath, loggedIn: null },
    ffmpeg: { ok: !!ffmpeg, path: ffmpeg },
    git: { ok: !!git, path: git },
    assemblyaiKey: hasSecret('assemblyai'),
    chrome: process.versions.chrome
  }
}

/** Open Terminal.app running `claude` so the user can complete /login in Anthropic's own flow. */
export async function openClaudeLoginTerminal(): Promise<void> {
  const script = `tell application "Terminal"
  activate
  do script "claude /login"
end tell`
  await execFileP('osascript', ['-e', script])
}
