/**
 * Everything generated audio needs to become part of a project: checking and saving
 * the files (media/generated), putting them on the timeline, and finding them again after an
 * undo. All placement is deterministic code here; Luca never writes an audio tag itself.
 */
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { PlaceAudio, Placed, SavedAsset } from '../shared/ai33'
import type { Project } from '../shared/types'
import { clipSrc, sourceTags } from './captions-html'
import { childEnv, run, which } from './env'
import { findTags } from './html'
import {
  clampBeds,
  findClip,
  findPlacement,
  hasVoice,
  insertAudio,
  MUSIC_FADE_IN,
  MUSIC_FADE_OUT,
  nameFromFile,
  rowFits,
  rowFor,
  SFX_VOLUME,
  withoutClip
} from './place-html'
import { ignoreGenerated } from './versions'

/** How far under the voice a bed sits, in dB, and the level it gets when there is no voice to measure. */
export const MUSIC_QUIET_DB = 16
export const MUSIC_MEDIUM_DB = 11
export const MUSIC_FALLBACK_VOLUME = 0.15
export { MUSIC_FADE_IN, MUSIC_FADE_OUT, SFX_VOLUME }

/** Sound formats the preview server names correctly; anything else is converted before it is placed. */
const PLAYABLE = new Set(['.mp3', '.m4a', '.wav', '.flac'])
const KINDS: SavedAsset['kind'][] = ['speech', 'music', 'sfx']

const r3 = (n: number): number => Math.round(n * 1000) / 1000
const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// ------------------------------------------------------------------ reading a sound file

type Probe =
  | { ok: true; seconds: number; codec: string; format: string }
  | { ok: false; why: 'missing' | 'empty' | 'silent' | 'unreadable' }

const NO_FFMPEG = 'ffmpeg isn’t available, so Luca can’t check or convert sound files.'

/** What ffprobe finds in a file: real sound with a length, or the plain reason it isn't. */
async function probeFile(file: string): Promise<Probe> {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return { ok: false, why: 'missing' }
  }
  if (size === 0) return { ok: false, why: 'empty' }
  const ffprobe = (await which('ffprobe')) ?? 'ffprobe'
  let out: { code: number | null; stdout: string }
  try {
    out = await run(
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,duration:format=duration,format_name',
        '-of',
        'json',
        // only a file on this Mac: a playlist can't send it to an address or another file
        ...['-protocol_whitelist', 'file'],
        resolve(file)
      ],
      { env: await childEnv(), timeoutMs: 30_000 }
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(NO_FFMPEG)
    return { ok: false, why: 'unreadable' }
  }
  if (out.code !== 0) return { ok: false, why: 'unreadable' }
  let j: {
    streams?: { codec_type?: string; codec_name?: string; duration?: string }[]
    format?: { duration?: string; format_name?: string }
  }
  try {
    j = JSON.parse(out.stdout || '{}')
  } catch {
    return { ok: false, why: 'unreadable' }
  }
  const audio = j.streams?.find((s) => s.codec_type === 'audio')
  if (!audio) return { ok: false, why: 'silent' }
  const seconds = Number(j.format?.duration) || Number(audio.duration) || 0
  if (!(seconds > 0)) return { ok: false, why: 'empty' }
  return { ok: true, seconds, codec: audio.codec_name ?? '', format: j.format?.format_name ?? '' }
}

const WHY: Record<Extract<Probe, { ok: false }>['why'], string> = {
  missing: 'That sound file isn’t there.',
  empty: 'That sound file is empty.',
  silent: 'That file has no sound in it.',
  unreadable: 'Luca couldn’t read that as a sound file.'
}

const WHY_GENERATED: typeof WHY = {
  missing: 'The sound ai33 made wasn’t saved.',
  empty: 'ai33 sent back an empty file.',
  silent: 'ai33 sent back a file with no sound in it.',
  unreadable: 'ai33 sent back a file Luca couldn’t read as sound.'
}

/** The length of an audio file; rejects with a plain message when it has no audio or is unreadable. */
export async function probeAudio(file: string): Promise<{ seconds: number }> {
  const r = await probeFile(file)
  if (!r.ok) throw new Error(WHY[r.why])
  return { seconds: r.seconds }
}

/** The first bytes of a file. */
function headOf(file: string): Buffer {
  const fd = openSync(file, 'r')
  const buf = Buffer.alloc(1024)
  let n: number
  try {
    n = readSync(fd, buf, 0, buf.length, 0)
  } finally {
    closeSync(fd)
  }
  return buf.subarray(0, n)
}

/**
 * Whether the first bytes are one of the sound formats ai33 sends (mp3, wav, flac, ogg, m4a). An
 * allowlist: ffprobe and ffmpeg also read playlists and scripts that name other files and
 * addresses, which nothing downloaded may be. Only the file's own bytes count, never its name.
 */
export function isSoundFile(file: string): boolean {
  const head = headOf(file)
  const at = (from: number, to: number): string => head.subarray(from, to).toString('latin1')
  return (
    at(0, 3) === 'ID3' ||
    at(0, 4) === 'fLaC' ||
    at(0, 4) === 'OggS' ||
    at(4, 8) === 'ftyp' ||
    (at(0, 4) === 'RIFF' && at(8, 12) === 'WAVE') ||
    (head.length > 1 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
  )
}

/** A page or data where a sound should be (an error answer saved under a sound's name). */
function looksLikePage(file: string): boolean {
  const text = headOf(file)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
  return /^(<|\{|\[)/.test(text)
}

// ------------------------------------------------------------------ files and names

const slugOf = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'audio'

/**
 * The part of a request hash a file name carries: the first ten characters of the hash itself,
 * and anything after a dash kept (a music take's number), so two takes never share a name.
 */
function hashPart(hash: string): string {
  const [head, ...tail] = hash
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .split('-')
  return [head.slice(0, 10) || 'x', ...tail.filter(Boolean)].join('-')
}

const generatedDir = (dir: string, kind: SavedAsset['kind']): string =>
  join(dir, 'media', 'generated', kind)

/** A path inside the project, project-relative with forward slashes. */
function inProject(dir: string, file: string): { rel: string; abs: string } {
  const abs = resolve(dir, file)
  const rel = relative(dir, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(
      'That file isn’t inside this project, so Luca can’t put it on the timeline. Ask the user to add it to the chat first.'
    )
  return { rel: rel.split(sep).join('/'), abs }
}

/** Move a file, across disks if it has to be. */
function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    copyFileSync(from, to)
    rmSync(from, { force: true })
  }
}

/** ffmpeg: `args`, failing with a plain message. */
async function ffmpeg(args: string[], timeoutMs: number): Promise<{ stderr: string }> {
  const bin = (await which('ffmpeg')) ?? 'ffmpeg'
  // every input is read as a file on this Mac by its absolute path, never as a URL or an option
  const guarded: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i' && i + 1 < args.length)
      guarded.push('-protocol_whitelist', 'file', '-i', resolve(args[++i]))
    else guarded.push(args[i])
  }
  let r: Awaited<ReturnType<typeof run>>
  try {
    r = await run(bin, ['-hide_banner', '-nostats', ...guarded], {
      env: await childEnv(),
      timeoutMs
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(NO_FFMPEG)
    throw err
  }
  if (r.code !== 0)
    throw new Error(`Luca couldn’t prepare the sound (${r.stderr.trim().slice(-200)}).`)
  return { stderr: r.stderr }
}

/** Any sound as the mp3 the preview and the export both read. */
async function toMp3(from: string, to: string): Promise<void> {
  await ffmpeg(
    [
      ...['-y', '-v', 'error', '-i', from, '-vn', '-map', '0:a:0', '-ac', '2', '-ar', '48000'],
      ...['-c:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', to]
    ],
    600_000
  )
}

// ------------------------------------------------------------------ what has been made

type Library = {
  v: 1
  files: Record<string, { kind: SavedAsset['kind']; prompt: string; seconds?: number }>
}

const libraryFile = (dir: string): string => join(dir, '.luca', 'cache', 'ai33', 'library.json')

function readLibrary(dir: string): Library {
  try {
    const raw = JSON.parse(readFileSync(libraryFile(dir), 'utf8')) as Library
    if (raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object') return raw
  } catch {
    // rebuilt from the folder and CREDITS.txt when there is none
  }
  return { v: 1, files: {} }
}

/** The library is only a cache (the files and CREDITS.txt say the same), so it never fails a save. */
function remember(dir: string, rel: string, entry: Library['files'][string]): void {
  try {
    const lib = readLibrary(dir)
    lib.files[rel] = entry
    const file = libraryFile(dir)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(lib))
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    console.warn('[place] couldn’t update the library index', err)
  }
}

/** One line in a file's credit: what it is, that ai33 made it, when, and what it was asked for. */
export function creditLine(rel: string, kind: SavedAsset['kind'], prompt: string): string {
  const said = prompt.replace(/\s+/g, ' ').trim()
  const short = said.length > 120 ? `${said.slice(0, 119)}…` : said
  const day = new Date().toISOString().slice(0, 10)
  return `${rel} · made with ai33 (${kind}) · ${day}${short ? ` · ${short}` : ''}`
}

/** Add one line to media/generated/CREDITS.txt: what the file is and that ai33 made it. */
export function appendCredit(dir: string, line: string): void {
  const folder = join(dir, 'media', 'generated')
  mkdirSync(folder, { recursive: true })
  ignoreGenerated(dir)
  const file = join(folder, 'CREDITS.txt')
  const one = line.replace(/\s+/g, ' ').trim()
  if (!one) return
  const has = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (!has.split('\n').includes(one)) appendFileSync(file, `${one}\n`)
}

/** What a saved file was asked for, from its credit line. */
function creditedPrompt(dir: string, rel: string): string {
  try {
    const line = readFileSync(join(dir, 'media', 'generated', 'CREDITS.txt'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${rel} · `))
    return line ? line.split(' · ').slice(3).join(' · ') : ''
  } catch {
    return ''
  }
}

/**
 * Check a downloaded file (real audio, not a web page saved under the wrong name) and move it
 * to media/generated/<kind>/<slug>-<hash>.mp3, converted to mp3 when it is another format.
 * `rel` is project-relative. The same hash returns the file already saved. `tmp` is used up: it
 * is moved into the project, or deleted when it is not usable (pass a copy of anything to keep).
 */
export async function importGenerated(
  p: Project,
  kind: SavedAsset['kind'],
  tmp: string,
  o: { slug: string; hash: string; prompt: string }
): Promise<{ rel: string; abs: string; seconds?: number }> {
  const rel = `media/generated/${kind}/${slugOf(o.slug)}-${hashPart(o.hash)}.mp3`
  const abs = join(p.dir, rel)
  const part = `${abs}.part`
  try {
    if (existsSync(abs)) {
      const saved = await probeFile(abs)
      if (saved.ok) return { rel, abs, seconds: r3(saved.seconds) }
    }
    if (!existsSync(tmp)) throw new Error(WHY_GENERATED.missing)
    if (statSync(tmp).size === 0) throw new Error(WHY_GENERATED.empty)
    if (!isSoundFile(tmp))
      throw new Error(
        looksLikePage(tmp)
          ? 'ai33 sent back a web page instead of a sound.'
          : WHY_GENERATED.unreadable
      )
    const found = await probeFile(tmp)
    if (!found.ok) throw new Error(WHY_GENERATED[found.why])
    mkdirSync(dirname(abs), { recursive: true })
    // before the first byte lands: a version made from now on must not track it (undo deletes what it tracks)
    ignoreGenerated(p.dir)
    let seconds = found.seconds
    if (found.codec === 'mp3' && found.format.includes('mp3')) moveFile(tmp, part)
    else {
      await toMp3(tmp, part)
      const converted = await probeFile(part)
      if (!converted.ok) throw new Error(WHY_GENERATED[converted.why])
      seconds = converted.seconds
    }
    renameSync(part, abs)
    seconds = r3(seconds)
    try {
      appendCredit(p.dir, creditLine(rel, kind, o.prompt))
    } catch (err) {
      console.warn('[place] couldn’t add the credit line', err)
    }
    remember(p.dir, rel, {
      kind,
      prompt: o.prompt.replace(/\s+/g, ' ').trim().slice(0, 240),
      seconds
    })
    return { rel, abs, seconds }
  } finally {
    rmSync(tmp, { force: true })
    rmSync(part, { force: true })
  }
}

/** Project-relative files already saved for this request hash (empty when none). */
export function findSaved(dir: string, kind: SavedAsset['kind'], hash: string): string[] {
  const [head, ...tail] = hashPart(hash).split('-')
  const re = new RegExp(
    `-${head}${tail.length ? `-${tail.join('-')}` : '(?:-[a-z0-9]+)?'}\\.(?:mp3|m4a|wav|flac)$`
  )
  try {
    return readdirSync(generatedDir(dir, kind))
      .filter((f) => re.test(f))
      .sort()
      .map((f) => `media/generated/${kind}/${f}`)
  } catch {
    return []
  }
}

/** What has been made for this project (media/generated), to put back after an undo. */
export function savedAssets(p: Project): SavedAsset[] {
  const lib = readLibrary(p.dir)
  const playing = new Map<string, string>()
  try {
    for (const t of findTags(readFileSync(join(p.dir, 'index.html'), 'utf8'), 'audio')) {
      const src = clipSrc(t)
      if (t.attrs.id && !playing.has(src)) playing.set(src, t.attrs.id)
    }
  } catch {
    // no composition yet: nothing is placed
  }
  const found: { asset: SavedAsset; at: number }[] = []
  for (const kind of KINDS) {
    let names: string[]
    try {
      names = readdirSync(generatedDir(p.dir, kind))
    } catch {
      continue
    }
    for (const name of names) {
      if (!PLAYABLE.has(extname(name).toLowerCase())) continue
      const rel = `media/generated/${kind}/${name}`
      const meta = lib.files[rel]
      const placedId = playing.get(rel)
      let at: number
      try {
        at = statSync(join(p.dir, rel)).mtimeMs
      } catch {
        continue
      }
      found.push({
        at,
        asset: {
          file: rel,
          kind,
          prompt: meta?.prompt ?? creditedPrompt(p.dir, rel),
          ...(meta?.seconds ? { seconds: meta.seconds } : {}),
          ...(placedId ? { placedId } : {})
        }
      })
    }
  }
  return found
    .sort((a, b) => b.at - a.at || a.asset.file.localeCompare(b.asset.file))
    .map((f) => f.asset)
}

// ------------------------------------------------------------------ fitting and levels

/**
 * Make audio fit a length: join `files` (two takes with a crossfade, tiled if still short) and
 * trim to `seconds`, into a new file in media/generated/<kind>/; returns it, project-relative.
 * Never loops: the export can't, so a longer file is made instead.
 */
export async function fitAudio(o: {
  project: Project
  kind: 'music' | 'sfx'
  files: string[]
  seconds: number
  slug: string
  hash: string
}): Promise<string> {
  const dir = o.project.dir
  const rel = `media/generated/${o.kind}/${slugOf(o.slug)}-${hashPart(o.hash)}.mp3`
  const abs = join(dir, rel)
  if (existsSync(abs) && (await probeFile(abs)).ok) return rel
  if (!o.files.length || !(o.seconds > 0)) throw new Error('There is no sound to fit to the video.')
  const paths = o.files.map((f) => inProject(dir, f).abs)
  const lengths = await Promise.all(paths.map(async (f) => (await probeAudio(f)).seconds))
  // a join blends the end of one take into the start of the next; never more than a third of the shortest
  const blend = r3(Math.min(o.kind === 'music' ? 2 : 0.15, Math.min(...lengths) / 3))
  const order: number[] = []
  let total = 0
  while (total < o.seconds - 0.001) {
    if (order.length >= 60)
      throw new Error('That sound is too short to stretch over this much video.')
    const i = order.length % paths.length
    total += lengths[i] - (order.length ? blend : 0)
    order.push(i)
  }
  const filters = order.map(
    (_, k) => `[${k}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[s${k}]`
  )
  let last = 's0'
  for (let k = 1; k < order.length; k++) {
    filters.push(`[${last}][s${k}]acrossfade=d=${blend}:c1=tri:c2=tri[x${k}]`)
    last = `x${k}`
  }
  filters.push(`[${last}]atrim=end=${r3(o.seconds)},asetpts=PTS-STARTPTS[out]`)
  const part = `${abs}.part`
  mkdirSync(dirname(abs), { recursive: true })
  ignoreGenerated(dir)
  try {
    await ffmpeg(
      [
        '-y',
        '-v',
        'error',
        ...order.flatMap((i) => ['-i', paths[i]]),
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[out]',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-c:a',
        'libmp3lame',
        '-q:a',
        '2',
        '-f',
        'mp3',
        part
      ],
      600_000
    )
    const made = await probeFile(part)
    if (!made.ok) throw new Error(WHY[made.why])
    renameSync(part, abs)
    const lib = readLibrary(dir)
    const source = lib.files[inProject(dir, o.files[0]).rel]
    const prompt = source?.prompt ?? ''
    appendCredit(dir, creditLine(rel, o.kind, prompt))
    remember(dir, rel, { kind: o.kind, prompt, seconds: r3(made.seconds) })
  } finally {
    rmSync(part, { force: true })
  }
  return rel
}

/** The mean level of a stretch of a file, dB, or null when it is silent or can't be measured. */
async function meanLevel(file: string, from: number, seconds: number): Promise<number | null> {
  const r = await ffmpeg(
    [
      '-ss',
      String(Math.max(0, from)),
      '-t',
      String(Math.min(Math.max(seconds, 1), 120)),
      '-i',
      file,
      '-vn',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-'
    ],
    60_000
  ).catch(() => null)
  const m = r ? /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(r.stderr) : null
  return m ? Number(m[1]) : null
}

/** The clip whose sound is "the voice": the recording the video is about, else a voice Luca placed. */
function voiceClip(
  p: Project,
  html: string
): { src: string; from: number; seconds: number; volume: number } | null {
  const audible = (t: { name: string; attrs: Record<string, string> }): boolean =>
    (t.name === 'audio' || !('muted' in t.attrs)) && num(t.attrs['data-volume'], 1) > 0
  const made = findTags(html, 'audio').filter(
    (t) => t.attrs['data-luca-role']?.trim().toLowerCase() === 'voice' && audible(t)
  )
  const hit =
    sourceTags(html, p.source)
      .filter(audible)
      .sort((a, b) => num(a.attrs['data-start'], 0) - num(b.attrs['data-start'], 0))[0] ?? made[0]
  if (!hit?.attrs.src) return null
  return {
    src: clipSrc(hit),
    from: num(hit.attrs['data-media-start'], 0),
    seconds: num(hit.attrs['data-duration'], 60),
    volume: num(hit.attrs['data-volume'], 1)
  }
}

/**
 * How loud music under this voice should be (`data-volume`, 0.04 to 0.5), measured against it:
 * the bed sits 16 dB (quiet) or 11 dB (medium) under the voice as it plays. 0.15 with no voice to
 * measure. No limiter follows in the export, so a bed never goes above 0.5.
 */
export async function measureLevel(
  p: Project,
  file: string,
  level: 'quiet' | 'medium'
): Promise<number> {
  try {
    const html = readFileSync(join(p.dir, 'index.html'), 'utf8')
    const voice = voiceClip(p, html)
    if (!voice) return MUSIC_FALLBACK_VOLUME
    const voiceFile = resolve(p.dir, voice.src)
    const music = inProject(p.dir, file).abs
    const [voiceMean, musicMean] = await Promise.all([
      existsSync(voiceFile) ? meanLevel(voiceFile, voice.from, voice.seconds) : null,
      meanLevel(music, 0, 60)
    ])
    if (voiceMean === null || musicMean === null) return MUSIC_FALLBACK_VOLUME
    const under = level === 'quiet' ? MUSIC_QUIET_DB : MUSIC_MEDIUM_DB
    const heard = voiceMean + 20 * Math.log10(voice.volume)
    const volume = 10 ** ((heard - under - musicMean) / 20)
    return Math.round(Math.min(0.5, Math.max(0.04, volume)) * 100) / 100
  } catch {
    return MUSIC_FALLBACK_VOLUME
  }
}

// ------------------------------------------------------------------ on the timeline

const indexFile = (p: Project): string => join(p.dir, 'index.html')

/** Whether the video already has a voice (audible footage, or a clip with role voice). */
export function projectHasVoice(p: Project): boolean {
  try {
    return hasVoice(readFileSync(indexFile(p), 'utf8'), p.source)
  } catch {
    return false
  }
}

/** A sound file the preview server can play: itself when it is, else an mp3 made next to it. */
async function playable(
  p: Project,
  rel: string,
  abs: string
): Promise<{ rel: string; abs: string }> {
  if (PLAYABLE.has(extname(rel).toLowerCase())) return { rel, abs }
  const stat = statSync(abs)
  const tag = createHash('sha1')
    .update(`${rel}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 10)
  const outRel = `${rel.slice(0, rel.length - extname(rel).length)}-${tag}.mp3`
  const out = join(p.dir, outRel)
  if (!existsSync(out)) {
    const part = `${out}.part`
    try {
      await toMp3(abs, part)
      renameSync(part, out)
    } finally {
      rmSync(part, { force: true })
    }
  }
  return { rel: outRel, abs: out }
}

const sentence = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Put an audio file on the timeline (validated first) and say where it went. Nothing in the
 * composition changes unless the file is real sound. Music never runs past the end of the video
 * and a sound effect is cut at it; a voice extends the video unless `extendRoot` is false.
 */
export async function placeAudio(p: Project, o: PlaceAudio): Promise<Placed> {
  const at = inProject(p.dir, o.file)
  // the file is checked before anything else, so a bad one leaves the composition alone
  const { seconds } = await probeAudio(at.abs)
  const file = await playable(p, at.rel, at.abs)

  const start = Math.max(0, r3(o.start))
  const mediaStart = Math.max(0, o.mediaStart ?? 0)
  const left = seconds - mediaStart
  if (left < 0.05)
    throw new Error(
      `That sound is only ${clock(seconds)} long, so nothing plays from ${clock(mediaStart)}.`
    )
  const want = o.until === undefined ? Infinity : o.until - start
  if (want < 0.05) throw new Error('The end of the sound has to be after its start.')

  if (!existsSync(indexFile(p)))
    throw new Error('This project has no timeline to put sound on yet.')
  const old = o.replaces ? findClip(readFileSync(indexFile(p), 'utf8'), o.replaces) : null
  const volume =
    o.volume ??
    old?.volume ??
    (o.role === 'voice'
      ? 1
      : o.role === 'sfx'
        ? SFX_VOLUME
        : await measureLevel(p, file.rel, 'quiet'))

  // from here on index.html is read and written with nothing awaited in between
  const html = readFileSync(indexFile(p), 'utf8')
  // the same sound from the same moment in the same role is already there (the same request
  // asked twice): say where it plays instead of putting a second copy on top of it
  if (!o.replaces) {
    const there = findPlacement(html, { file: file.rel, role: o.role, start })
    if (there) return there
  }
  const rootTag = findTags(html).find((t) => t.attrs['data-composition-id'] !== undefined)
  const rootLength = num(rootTag?.attrs['data-duration'], 0)
  const extend = o.role === 'voice' && (o.extendRoot ?? true)
  const room = !extend && rootLength > 0 ? rootLength - start : Infinity
  if (room < 0.05)
    throw new Error(
      `The video ends at ${clock(rootLength)}, so there is no room for this from ${clock(start)}.`
    )
  const duration = r3(Math.min(want, left, room))

  const bare = o.replaces ? withoutClip(html, o.replaces) : html
  const row =
    old && rowFits(bare, o.role, old.row, start, start + duration)
      ? old.row
      : rowFor(bare, o.role, start, start + duration)
  const named = sentence(nameFromFile(file.rel)) || (o.role === 'voice' ? 'Voiceover' : 'Sound')
  const placed = insertAudio(html, {
    ...o,
    file: file.rel,
    start,
    mediaStart,
    volume,
    fadeIn: o.fadeIn ?? old?.fadeIn,
    fadeOut: o.fadeOut ?? old?.fadeOut,
    title: o.title?.trim() || named,
    extendRoot: extend,
    row,
    duration
  })
  writeFileSync(indexFile(p), placed.html)
  return placed.placed
}

/** File lengths already read, while the file doesn't change. */
const cache = new Map<string, { sig: string; seconds: number }>()

/** A file's length, remembered while it doesn't change; undefined when it can't be read. */
async function lengthOf(file: string): Promise<number | undefined> {
  try {
    const st = statSync(file)
    const sig = `${st.size}:${st.mtimeMs}`
    const seen = cache.get(file)
    if (seen?.sig === sig) return seen.seconds
    const r = await probeFile(file)
    if (!r.ok) return undefined
    cache.set(file, { sig, seconds: r.seconds })
    return r.seconds
  } catch {
    return undefined
  }
}

/**
 * Shorten music that runs past the end of the video (after a cut or a trim), never lengthen it.
 * Runs before each version is saved; true when it changed the composition.
 */
export async function refitBeds(p: Project): Promise<boolean> {
  const file = indexFile(p)
  if (!existsSync(file)) return false
  const beds = (html: string): ReturnType<typeof findTags> =>
    findTags(html, 'audio').filter(
      (t) => t.attrs['data-luca-role']?.trim().toLowerCase() === 'music'
    )
  const first = readFileSync(file, 'utf8')
  const found = beds(first)
  if (!found.length) return false
  const fileDurations: Record<string, number> = {}
  for (const t of found) {
    const src = clipSrc(t)
    if (!src || src in fileDurations || /^[a-z][a-z0-9+.-]*:/i.test(src)) continue
    const seconds = await lengthOf(resolve(p.dir, src))
    if (seconds) fileDurations[src] = seconds
  }
  // what is on disk now: the probes above may have taken a moment
  const html = readFileSync(file, 'utf8')
  const root = findTags(html).find((t) => t.attrs['data-composition-id'] !== undefined)
  const next = clampBeds(html, {
    rootDuration: num(root?.attrs['data-duration'], 0),
    fileDurations
  })
  if (!next.changed) return false
  writeFileSync(file, next.html)
  return true
}
