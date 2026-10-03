import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { findTags, setAttrs } from './html'
import { PREVIEW_SYNC_SCRIPT } from './preview-sync'

const RUNTIME_PATH = '/hf/runtime.js'
let runtimeFile: string | null = null
/**
 * The preview runtime that plays the footage, its sound and the animations on one clock. The
 * package's exports map hides dist/ (resolving the file itself throws), but its package.json is
 * exported, so the file is found beside it. Without it the player only moves the animations: the
 * footage stands still and nothing is heard.
 */
function hyperframesRuntime(): string | null {
  if (runtimeFile) return runtimeFile
  try {
    const pkg = require.resolve('@hyperframes/core/package.json')
    const file = join(dirname(pkg), 'dist', 'hyperframe.runtime.iife.js')
    runtimeFile = existsSync(file) ? file : null
  } catch {
    runtimeFile = null
  }
  if (!runtimeFile) console.warn('[luca] the preview runtime is missing: footage will not play')
  return runtimeFile
}

/** Mirror what HyperFrames Studio does for preview: make sure the runtime and the
 *  `window.__timelines` registry exist before the composition's own scripts run. Luca's
 *  footage-in-step guard (preview-sync.ts) goes in right after the runtime, and `swap` may point
 *  a `<video>` or `<audio>` at an edit-friendly copy of its file (preview-media.ts). */
export function prepareCompositionHtml(
  html: string,
  swap?: (src: string) => string | null
): string {
  let out = swap ? swapMedia(html, swap) : html
  const head = (tag: string): void => {
    out = /<head\b[^>]*>/i.test(out)
      ? out.replace(/<head\b[^>]*>/i, (m) => `${m}\n${tag}`)
      : `${tag}\n${out}`
  }
  if (!out.includes('data-luca-preview-sync')) {
    head(`<script data-luca-preview-sync="1">${PREVIEW_SYNC_SCRIPT}</script>`)
  }
  if (!/hyperframe\.runtime|hyperframes-preview-runtime/.test(out)) {
    head(`<script data-hyperframes-preview-runtime="1" src="${RUNTIME_PATH}"></script>`)
  }
  const init = '<script>window.__timelines=window.__timelines||{};</script>'
  out = /<body\b[^>]*>/i.test(out)
    ? out.replace(/<body\b[^>]*>/i, (m) => `${m}\n${init}`)
    : `${init}\n${out}`
  return out
}

/** The page with each `<video>`/`<audio>` src that `swap` answers for replaced. */
function swapMedia(html: string, swap: (src: string) => string | null): string {
  let out = ''
  let at = 0
  for (const tag of findTags(html)) {
    if ((tag.name !== 'video' && tag.name !== 'audio') || !tag.attrs.src) continue
    const src = swap(tag.attrs.src)
    if (!src) continue
    out += html.slice(at, tag.start) + setAttrs(tag, { src })
    at = tag.end
  }
  return at === 0 ? html : out + html.slice(at)
}

/** Where a project page's media can play from instead (see preview-media.ts). */
export type PreviewMedia = (projectDir: string, htmlRel: string, src: string) => string | null

export const DEV_PORT = Number(process.env.LUCA_DEV_PORT ?? 41733)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream'
}

export type ProjectResolver = (id: string) => string | null

export class LucaServer {
  readonly token = randomBytes(24).toString('hex')
  private server: Server | null = null
  private port = 0
  constructor(
    private uiDir: string | null,
    private resolveProject: ProjectResolver,
    /** The fonts that come with Luca, for previews outside a project. */
    private fontsDir: string | null = null,
    /** The LUTs that come with Luca, for previews outside a project. */
    private lutsDir: string | null = null,
    /** Edit-friendly copies of the footage the preview plays instead (never the export). */
    private previewMedia: PreviewMedia | null = null
  ) {}

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(preferredPort = 0): Promise<string> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(`Server error: ${String(err)}`)
      })
    })
    await new Promise<void>((ok, fail) => {
      this.server!.once('error', fail)
      this.server!.listen(preferredPort, '127.0.0.1', () => ok())
    })
    this.port = (this.server.address() as AddressInfo).port
    return this.baseUrl
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private hasToken(req: IncomingMessage, url: URL): boolean {
    if (url.searchParams.get('token') === this.token) return true
    const cookie = req.headers.cookie ?? ''
    return cookie.split(';').some((c) => c.trim() === `luca=${this.token}`)
  }

  private setCookie(res: ServerResponse): void {
    res.setHeader('Set-Cookie', `luca=${this.token}; Path=/; HttpOnly; SameSite=Lax`)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl)
    const host = req.headers.host ?? ''
    // Only the renderer (same origin, or the Vite dev proxy) may talk to us.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    if (url.pathname === '/api/session') {
      if (!this.hasToken(req, url)) {
        res.writeHead(401).end('Unauthorized')
        return
      }
      this.setCookie(res)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }))
      return
    }

    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }))
      return
    }

    if (!this.hasToken(req, url)) {
      res.writeHead(401, { 'content-type': 'text/plain' }).end('Unauthorized')
      return
    }

    if (url.pathname === RUNTIME_PATH) {
      const file = hyperframesRuntime()
      if (!file) {
        res.writeHead(404).end('Preview engine not found')
        return
      }
      this.sendFile(req, res, resolve(file, '..'), 'hyperframe.runtime.iife.js', {})
      return
    }

    if (url.pathname.startsWith('/p/')) {
      const [, , id, ...rest] = url.pathname.split('/')
      const dir = id ? this.resolveProject(decodeURIComponent(id)) : null
      if (!dir) {
        res.writeHead(404).end('Unknown project')
        return
      }
      const rel = rest.map(decodeURIComponent).join('/') || 'index.html'
      if (rel.toLowerCase().endsWith('.html')) {
        this.sendHtml(res, dir, rel)
        return
      }
      this.sendFile(req, res, dir, rel, { noStore: true })
      return
    }

    if (url.pathname.startsWith('/fonts/') && this.fontsDir) {
      const rel = decodeURIComponent(url.pathname.slice('/fonts/'.length))
      this.sendFile(req, res, this.fontsDir, rel, {})
      return
    }

    if (url.pathname.startsWith('/luts/') && this.lutsDir) {
      const rel = decodeURIComponent(url.pathname.slice('/luts/'.length))
      this.sendFile(req, res, this.lutsDir, rel, {})
      return
    }

    if (this.uiDir) {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      if (url.pathname === '/' || url.searchParams.has('token')) this.setCookie(res)
      this.sendFile(req, res, this.uiDir, rel, { fallbackIndex: true })
      return
    }

    res.writeHead(404).end('Not found')
  }

  private sendHtml(res: ServerResponse, root: string, rel: string): void {
    const rootAbs = resolve(root)
    const abs = normalize(join(rootAbs, rel))
    if (!abs.startsWith(rootAbs + sep)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    let html: string
    try {
      html = readFileSync(abs, 'utf8')
    } catch {
      res.writeHead(404).end('Not found')
      return
    }
    const media = this.previewMedia
    const body = prepareCompositionHtml(html, media ? (src) => media(root, rel, src) : undefined)
    res.writeHead(200, {
      'content-type': MIME['.html'],
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(body))
    })
    res.end(body)
  }

  private sendFile(
    req: IncomingMessage,
    res: ServerResponse,
    root: string,
    rel: string,
    opts: { noStore?: boolean; fallbackIndex?: boolean }
  ): void {
    const rootAbs = resolve(root)
    let abs = normalize(join(rootAbs, rel))
    if (!abs.startsWith(rootAbs + sep) && abs !== rootAbs) {
      res.writeHead(403).end('Forbidden')
      return
    }
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(abs)
      if (st.isDirectory()) {
        abs = join(abs, 'index.html')
        st = statSync(abs)
      }
    } catch {
      if (opts.fallbackIndex) {
        abs = join(rootAbs, 'index.html')
        try {
          st = statSync(abs)
        } catch {
          res.writeHead(404).end('Not found')
          return
        }
      } else {
        res.writeHead(404).end('Not found')
        return
      }
    }

    const type = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
    const size = st.size
    const headers: Record<string, string> = {
      'content-type': type,
      'accept-ranges': 'bytes',
      'cache-control': opts.noStore ? 'no-store' : 'no-cache',
      'last-modified': st.mtime.toUTCString()
    }

    const range = req.headers.range
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!m) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }).end()
        return
      }
      let start = m[1] ? Number(m[1]) : NaN
      let end = m[2] ? Number(m[2]) : NaN
      if (Number.isNaN(start)) {
        // suffix range: last N bytes
        start = Math.max(0, size - end)
        end = size - 1
      } else if (Number.isNaN(end)) {
        end = size - 1
      }
      end = Math.min(end, size - 1)
      if (start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }).end()
        return
      }
      headers['content-range'] = `bytes ${start}-${end}/${size}`
      headers['content-length'] = String(end - start + 1)
      res.writeHead(206, headers)
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(abs, { start, end }).pipe(res)
      return
    }

    headers['content-length'] = String(size)
    res.writeHead(200, headers)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(abs).pipe(res)
  }
}
