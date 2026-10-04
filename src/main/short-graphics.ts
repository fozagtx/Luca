/**
 * The Sunroom template's ready-made graphics (src/shared/short.ts GRAPHICS): what short_layout
 * builds in a beat's slot when Luca names a kind, from the kit's classes, sized and placed for the
 * beat's layout, every item landing on the word that says it. Luca fills in the words; the file is
 * its own afterwards, to change or add to like any slot it built itself.
 */
import {
  SUNROOM,
  type GraphicKind,
  type ShortBeat,
  type ShortFace,
  type ShortGraphic
} from '../shared/short'

type Word = { text: string; start: number; end: number }

export type GraphicContext = {
  /** The slot's id, the prefix of every id in it. */
  id: string
  beat: ShortBeat & { graphic: ShortGraphic }
  /** The slot's content box in composition px. */
  area: { top: number; height: number }
  size: [number, number]
  /** What is said, in timeline seconds. */
  words: Word[]
  face: ShortFace
}

export type BuiltGraphic = { markup: string; tweens: string[] }

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const t2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2)

// ---------------------------------------------------------------- motion (the template's own)

const enter = (sel: string, at: number): string =>
  `tl.fromTo('${sel}', { opacity: 0, y: 40, scale: 0.96, filter: 'blur(8px)' }, { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.38, ease: 'power3.out' }, ${t2(at)})`
const pop = (sel: string, at: number, rotation = 0): string =>
  `tl.fromTo('${sel}', { opacity: 0, scale: 0.6, rotation: ${rotation - 10} }, { opacity: 1, scale: 1, rotation: ${rotation}, duration: 0.32, ease: 'back.out(1.8)' }, ${t2(at)})`
const blurIn = (sel: string, at: number): string =>
  `tl.fromTo('${sel}', { opacity: 0, filter: 'blur(14px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.4, ease: 'power2.out' }, ${t2(at)})`
const rise = (sel: string, at: number): string =>
  `tl.fromTo('${sel}', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, ${t2(at)})`
const drift = (sel: string, len: number): string =>
  `tl.fromTo('${sel}', { scale: 1 }, { scale: 1.02, duration: ${t2(len)}, ease: 'none' }, 0)`

// ---------------------------------------------------------------- timing from the words

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The first word of a line that could be said ("/brag yourapp.com" → "brag"). */
function firstWord(text: string): string {
  for (const part of text.split(/\s+/)) {
    const w = norm(part)
    if (w) return w
  }
  return ''
}

/**
 * When each text lands, in seconds from the beat's start: the time Luca gave, else the word that
 * starts it (in order, through the beat's words), else spread evenly over the beat.
 */
function landings(
  texts: string[],
  ctx: GraphicContext,
  opts: { first?: number; given?: number[] } = {}
): number[] {
  const { beat } = ctx
  const len = beat.end - beat.start
  const said = ctx.words.filter((w) => w.start >= beat.start - 0.05 && w.start < beat.end - 0.05)
  const out: (number | null)[] = []
  let from = 0
  texts.forEach((text, i) => {
    const given = opts.given?.[i]
    if (given !== undefined && Number.isFinite(given)) {
      out.push(given - beat.start)
      return
    }
    const w = firstWord(text)
    const k = w ? said.findIndex((s, j) => j >= from && norm(s.text) === w) : -1
    if (k >= 0) {
      out.push(said[k].start - beat.start)
      from = k + 1
    } else out.push(null)
  })
  // the ones no word placed: evenly between their neighbours (or the beat's ends)
  const first = opts.first ?? 0.3
  const last = Math.max(first, len - 0.7)
  if (out.every((t) => t === null))
    return out.map((_, i) =>
      clampTime(texts.length > 1 ? first + ((last - first) * i) / (texts.length - 1) : first, len)
    )
  return out.map((t, i) => {
    if (t !== null) return clampTime(t, len)
    let a = i - 1
    while (a >= 0 && out[a] === null) a--
    let b = i + 1
    while (b < out.length && out[b] === null) b++
    const lo = a >= 0 ? (out[a] as number) : first - (last - first) / Math.max(1, texts.length)
    const hi =
      b < out.length ? (out[b] as number) : last + (last - first) / Math.max(1, texts.length)
    const span = b - a
    return clampTime(lo + ((hi - lo) * (i - a)) / span, len)
  })
}

const clampTime = (t: number, len: number): number =>
  Math.min(Math.max(0.04, t), Math.max(0.04, len - 0.3))

/** The time a keyword is said in the beat, or null. */
function wordTime(ctx: GraphicContext, ...keys: string[]): number | null {
  const want = keys.map(norm).filter(Boolean)
  const w = ctx.words.find(
    (x) =>
      x.start >= ctx.beat.start - 0.05 &&
      x.start < ctx.beat.end - 0.05 &&
      want.includes(norm(x.text))
  )
  return w ? clampTime(w.start - ctx.beat.start, ctx.beat.end - ctx.beat.start) : null
}

// ---------------------------------------------------------------- pieces

/** A small app screen (kit .sr-app), so devices and thumbnails show something. */
function appScreen(
  opts: { name?: string; title?: string; rows?: string[]; font: number; flat?: boolean },
  rowId?: (i: number) => string
): string {
  const bars = [38, 62, 46, 80, 58, 92, 70]
    .map((h) => `<span style="height: ${h}%"></span>`)
    .join('')
  const rows = (opts.rows?.length ? opts.rows : ['', '', ''])
    .map(
      (r, i) =>
        `<div${rowId ? ` id="${rowId(i)}"` : ''} class="sr-app-row">${
          r ? `${esc(r)}<i>›</i>` : `<span class="sr-ph" style="flex: 1; height: 0.6em"></span>`
        }</div>`
    )
    .join('')
  return `<div class="sr-app${opts.flat ? ' flat' : ''}" style="font-size: ${opts.font}px"><div class="sr-app-top">${esc(opts.name ?? '')}</div><div class="sr-app-hero"><small>${esc(opts.name ? 'This week' : 'Today')}</small><b>${esc(opts.title ?? '')}</b><span class="sr-app-bars">${bars}</span></div>${rows}</div>`
}

/** Where a graphic sits: centered in the paper above the caption, or under the headline. */
function box(ctx: GraphicContext, headlineBottom: number | null): { top: number; height: number } {
  const [, h] = ctx.size
  const { beat, area } = ctx
  if (beat.layout === 'split') return { top: area.top + 34, height: area.height - 34 - 26 }
  const top = headlineBottom !== null ? headlineBottom + 50 : 150
  const bottom =
    beat.caption === false
      ? Math.round(h * 0.78)
      : Math.round(h * (SUNROOM.captionFloor.graphic - 0.06)) - 40
  return { top, height: Math.max(300, bottom - top) }
}

/** A graphic beat's headline: the main words in ink, each on the word that says it, then the sub. */
function headline(
  ctx: GraphicContext,
  g: ShortGraphic
): { markup: string; tweens: string[]; bottom: number } | null {
  if (ctx.beat.layout !== 'graphic' || !g.headline) return null
  const { id } = ctx
  const long = g.headline.length
  const size = long > 22 ? 104 : long > 14 ? 124 : 150
  const lines = long > 14 ? 2 : 1
  const subSize = (g.sub?.length ?? 0) > 22 ? 70 : 88
  // the main line comes in whole, on its first word or with the cut (a line that is still being
  // revealed sits off center), the lighter line on the word that starts it
  const first = Math.min(landings([g.headline], ctx, { first: 0.05 })[0], 0.35)
  const sub = g.sub
    ? `<span id="${id}-sub" class="sr-sub" style="font-size: ${subSize}px">${esc(g.sub)}</span>`
    : ''
  const tweens = [blurIn(`#${id}-main`, first)]
  if (g.sub) {
    const subAt = landings([g.sub], ctx, { first: first + 0.5 })[0]
    tweens.push(blurIn(`#${id}-sub`, Math.max(subAt, first + 0.3)))
  }
  const top = 150
  const bottom = top + Math.round(size * 0.98 * lines + (g.sub ? subSize * 1.15 : 0))
  return {
    markup: `<div id="${id}-head" class="sr-headline" style="position: absolute; left: 60px; right: 60px; top: ${top}px; font-size: ${size}px"><span id="${id}-main" class="sr-word">${esc(g.headline)}</span>${sub}</div>`,
    tweens,
    bottom
  }
}

// ---------------------------------------------------------------- the graphics

type Maker = (
  ctx: GraphicContext,
  g: ShortGraphic,
  b: { top: number; height: number }
) => BuiltGraphic

const fit = (ctx: GraphicContext, b: { top: number; height: number }): number =>
  ctx.beat.layout === 'split' ? Math.min(b.height, 790) : Math.min(b.height, 900)

const phone: Maker = (ctx, g, b) => {
  const { id } = ctx
  const items = g.items ?? []
  const height = Math.min(fit(ctx, b), 760)
  const width = Math.round(height * 0.49)
  const rows = items.slice(1, 6)
  const at = landings(rows, ctx, { first: 0.6 })
  // the rows the words name, then empty ones, so the screen is full
  const fill = [...rows, ...Array<string>(Math.max(0, 5 - rows.length)).fill('')]
  const markup = `<div id="${id}-phone" class="sr-phone" style="width: ${width}px; height: ${height}px"><div class="sr-screen">${appScreen({ name: g.label ?? 'Today', title: items[0] ?? g.label ?? '', rows: fill, font: Math.round(width / 16) }, (i) => `${id}-r${i}`)}</div></div>`
  const tweens = [
    enter(`#${id}-phone`, 0.04),
    `tl.fromTo('#${id}-phone .sr-app-bars > span', { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.5, ease: 'power3.out', stagger: 0.05 }, 0.3)`,
    ...(rows.length ? rows.map((_, i) => rise(`#${id}-r${i}`, at[i])) : [])
  ]
  return { markup, tweens }
}

const browser: Maker = (ctx, g, b) => {
  const { id } = ctx
  const items = g.items ?? []
  const height = Math.min(fit(ctx, b) - 80, 560)
  const title = items[0] ?? g.label ?? ''
  const button = items[1] ?? 'Get started'
  const [titleAt, buttonAt] = landings([title, button], ctx, { first: 0.35 })
  const markup = `<div id="${id}-browser" class="sr-browser" style="width: 940px"><div class="sr-bar"><i></i><i></i><i></i><span class="sr-url">${esc(g.label ?? 'yourapp.com')}</span></div><div class="sr-page" style="display: flex; gap: 36px; align-items: center; min-height: 0; height: ${height}px; padding: 44px"><div style="flex: 1; display: flex; flex-direction: column; gap: 22px"><span class="sr-label accent">${esc(g.label ? g.label.replace(/^https?:\/\//, '').split('/')[0] : 'yourapp.com')}</span><div id="${id}-title" class="sr-bold" style="font-size: ${title.length > 26 ? 50 : 62}px; line-height: 1.02; color: var(--sr-card-ink)">${esc(title)}</div><div class="sr-ph" style="width: 90%"></div><div class="sr-ph" style="width: 64%"></div><span id="${id}-cta" class="sr-pill accent" style="align-self: flex-start; font-family: var(--sr-sans); font-weight: 700">${esc(button)}</span></div><div id="${id}-shot" style="flex: none; width: 300px; height: ${height - 60}px; border-radius: 26px; overflow: hidden; border: 1.5px solid var(--sr-line); box-shadow: var(--sr-shadow)">${appScreen({ name: g.label?.split('.')[0] ?? 'app', title: '', font: 15, flat: true })}</div></div></div>`
  return {
    markup,
    tweens: [
      enter(`#${id}-browser`, 0.04),
      rise(`#${id}-title`, Math.min(titleAt, 0.3)),
      enter(`#${id}-shot`, 0.4),
      pop(`#${id}-cta`, Math.max(buttonAt, 0.6))
    ]
  }
}

const terminal: Maker = (ctx, g) => {
  const { id } = ctx
  const items = g.items?.length ? g.items : ['/start']
  const [cmd, ...rest] = items
  const longest = Math.max(...items.map((i) => i.length))
  const font = longest > 38 ? 26 : 32
  const at = landings(items, ctx, { first: 0.3, given: g.at })
  const typing = Math.min(0.7, Math.max(0.25, cmd.length * 0.045))
  const lines = rest
    .map(
      (l, i) =>
        `<div id="${id}-l${i + 1}" style="white-space: pre-wrap"><span class="ok">✓</span> ${esc(l.replace(/^[✓✔]\s*/, ''))}</div>`
    )
    .join('')
  const markup = `<div id="${id}-term" class="sr-terminal" style="width: 940px"><div class="sr-bar"><i></i><i></i><i></i><span style="margin: 0 auto">${esc(g.label ?? 'Terminal')}</span></div><div class="sr-term" style="min-height: 420px; font-size: ${font}px; white-space: normal"><div><span class="sr-prompt">›</span> <span id="${id}-cmd" class="sr-type">${esc(cmd)}</span><span id="${id}-caret" class="sr-caret"></span></div>${lines}</div></div>`
  const tweens = [
    enter(`#${id}-term`, 0.04),
    `tl.fromTo('#${id}-cmd', { width: '0ch' }, { width: '${cmd.length}ch', duration: ${t2(typing)}, ease: 'steps(${cmd.length})' }, ${t2(Math.min(at[0], 0.3))})`,
    ...rest.map((_, i) =>
      rise(`#${id}-l${i + 1}`, Math.max(at[i + 1], at[0] + typing + 0.15 * (i + 1)))
    )
  ]
  return { markup, tweens }
}

const doc: Maker = (ctx, g) => {
  const { id } = ctx
  const items = g.items?.length ? g.items : ['name: …', 'description: …']
  const at = landings(items, ctx, { first: 0.3, given: g.at })
  const line = (l: string, i: number): string => {
    const m = /^([\w .-]{1,24}):\s*(.*)$/.exec(l)
    return `<div id="${id}-l${i}">${m ? `<b>${esc(m[1])}:</b> ${esc(m[2])}` : esc(l)}</div>`
  }
  const markup = `<div id="${id}-doc" class="sr-card" style="width: 920px; padding: 44px 52px"><div class="sr-label">${esc(g.label ?? 'SKILL.md')}</div><div class="sr-code" style="margin-top: 22px; font-size: 34px"><div class="dim">---</div>${items.map(line).join('')}<div class="dim">---</div></div></div>`
  return {
    markup,
    tweens: [
      enter(`#${id}-doc`, 0.04),
      ...items.map((_, i) => rise(`#${id}-l${i}`, Math.max(at[i], 0.2 + i * 0.12)))
    ]
  }
}

const files: Maker = (ctx, g) => {
  const { id } = ctx
  const items = (
    g.items?.length ? g.items : ['index.html', 'styles.css', 'app/', 'README.md']
  ).slice(0, 6)
  const at = landings(items, ctx, { first: 0.25, given: g.at })
  // chips around the folder, then all of them into it before the beat ends
  const spots = [
    [40, 30],
    [560, 10],
    [0, 330],
    [640, 310],
    [70, 610],
    [580, 600]
  ]
  const W = 940
  const folder = { x: 270, y: 210 }
  const chips = items
    .map(
      (f, i) =>
        `<span id="${id}-f${i}" class="sr-chip" style="position: absolute; left: ${spots[i][0]}px; top: ${spots[i][1]}px; height: 74px; padding: 0 30px; font-size: 32px; border-radius: 18px">${esc(f)}</span>`
    )
    .join('')
  const len = ctx.beat.end - ctx.beat.start
  const fly = Math.max(Math.max(...at) + 0.5, len - 0.75)
  const markup = `<div id="${id}-files" style="position: relative; width: ${W}px; height: 700px"><div id="${id}-folder" class="sr-folder" style="position: absolute; left: ${folder.x}px; top: ${folder.y}px; width: 400px; height: 300px"></div><div class="sr-label" style="position: absolute; left: 0; right: 0; top: ${folder.y + 324}px; text-align: center; font-size: 30px">${esc(g.label ?? 'my-app/')}</div>${chips}</div>`
  const tweens = [
    enter(`#${id}-folder`, 0.04),
    ...items.map((_, i) => pop(`#${id}-f${i}`, at[i], i % 2 ? 4 : -4)),
    ...(fly < len - 0.2
      ? items.map(
          (_, i) =>
            `tl.to('#${id}-f${i}', { x: ${folder.x + 130 - spots[i][0]}, y: ${folder.y + 120 - spots[i][1]}, scale: 0.4, opacity: 0, duration: 0.4, ease: 'power2.in' }, ${t2(fly + i * 0.05)})`
        )
      : [])
  ]
  return { markup, tweens }
}

const folder: Maker = (ctx, g) => {
  const { id } = ctx
  const items = (g.items?.length ? g.items : ['video.mp4', 'cover.jpg', 'notes.txt']).slice(0, 6)
  const at = landings(items, ctx, { first: 0.3, given: g.at })
  const icons = ['', ' ink', ' soft', ' pale', ' pale', ' pale']
  const rows = items
    .map(
      (f, i) =>
        `<div id="${id}-r${i}" class="sr-file"><span class="sr-icon${icons[i]}"></span>${esc(f)}</div>`
    )
    .join('')
  const markup = `<div id="${id}-list" class="sr-card" style="width: 900px; padding: 0; overflow: hidden"><div class="sr-bar">${esc(g.label ?? 'output/')}</div><div class="sr-list" style="width: 100%">${rows}</div></div>`
  return {
    markup,
    tweens: [
      enter(`#${id}-list`, 0.04),
      ...items.map((_, i) => rise(`#${id}-r${i}`, Math.max(at[i], 0.2 + i * 0.1)))
    ]
  }
}

const progress: Maker = (ctx, g) => {
  const { id } = ctx
  const len = ctx.beat.end - ctx.beat.start
  const file = g.label ?? 'launch.mp4'
  const frames = [0, 1, 2, 3, 4]
    .map(
      (i) =>
        `<div id="${id}-fr${i}" class="sr-frame">${appScreen({ title: '', font: 7, flat: true, rows: i % 2 ? undefined : [''] })}</div>`
    )
    .join('')
  const run = Math.max(0.8, len - 0.9)
  const steps = [0, 11, 40, 73, 95, 100]
  const pct = steps
    .map(
      (p, i) =>
        `<span id="${id}-p${i}" style="position: absolute; right: 0; opacity: ${i === 0 ? 1 : 0}">${p}%</span>`
    )
    .join('')
  const markup = `<div id="${id}-render" style="width: 920px; display: flex; flex-direction: column; align-items: stretch; gap: 40px"><div id="${id}-film" class="sr-film">${frames}</div><div class="sr-progress" style="width: 100%"><div class="sr-progress-row" style="position: relative"><span>rendering ${esc(file)}</span><span style="position: relative; width: 90px">${pct}</span></div><div class="sr-bar-track"><div id="${id}-fill" class="sr-fill"></div></div></div><span id="${id}-done" class="sr-pill dark big" style="align-self: center">${esc(file)} ✓</span></div>`
  const tweens = [
    enter(`#${id}-film`, 0.04),
    ...[0, 1, 2, 3, 4].map(
      (i) =>
        `tl.fromTo('#${id}-fr${i}', { opacity: 0.15 }, { opacity: 1, duration: 0.2 }, ${t2(0.2 + (run * i) / 5)})`
    ),
    `tl.fromTo('#${id}-fill', { scaleX: 0 }, { scaleX: 1, duration: ${t2(run)}, ease: 'power1.inOut' }, 0.2)`,
    ...steps
      .slice(1)
      .map(
        (_, i) =>
          `tl.set('#${id}-p${i}', { opacity: 0 }, ${t2(0.2 + (run * (i + 1)) / steps.length)}); tl.set('#${id}-p${i + 1}', { opacity: 1 }, ${t2(0.2 + (run * (i + 1)) / steps.length)})`
      ),
    pop(`#${id}-done`, Math.min(len - 0.3, 0.2 + run))
  ]
  return { markup, tweens }
}

const checklist: Maker = (ctx, g, b) => {
  const { id } = ctx
  const items = (
    g.items?.length ? g.items : ['what it does', 'how it works', 'why it matters']
  ).slice(0, 4)
  const at = landings(items, ctx, { first: 0.04, given: g.at })
  const room = fit(ctx, b)
  const rowH = Math.min(240, Math.floor((room - (items.length - 1) * 22) / items.length))
  const thumbH = rowH - 40
  const serif = rowH > 200 ? 70 : 58
  const rows = items
    .map(
      (it, i) =>
        `<div id="${id}-r${i}" class="sr-step" style="width: 940px; height: ${rowH}px; padding: 20px"><div class="sr-thumb" style="width: ${Math.round(thumbH * 1.6)}px; height: ${thumbH}px">${appScreen({ title: '', font: Math.round(thumbH / 15), flat: true, rows: [''] })}</div><div style="flex: 1"><span class="sr-label accent">${String(i + 1).padStart(2, '0')}</span><div class="sr-serif" style="font-size: ${serif}px; line-height: 1">${esc(it)}</div></div><span id="${id}-k${i}" class="sr-check" style="position: absolute; right: 26px; top: 22px"></span></div>`
    )
    .join('')
  const markup = `<div id="${id}-steps" style="display: flex; flex-direction: column; gap: 22px">${rows}</div>`
  const tweens = items.flatMap((_, i) => {
    const t = i === 0 ? Math.min(at[0], 0.04) : at[i]
    return [enter(`#${id}-r${i}`, t), pop(`#${id}-k${i}`, t + 0.45)]
  })
  return { markup, tweens }
}

const tiles: Maker = (ctx, g, b) => {
  const { id } = ctx
  const items = (g.items?.length ? g.items : ['launches', 'landing pages', 'demos']).slice(0, 5)
  const at = landings(items, ctx, { first: 0.04, given: g.at })
  const h = Math.min(fit(ctx, b), 760)
  const w = Math.round(h * 0.82)
  const pic = (i: number): string => {
    const kind = i % 4
    if (kind === 1)
      return `<div style="width: ${w - 90}px; height: ${Math.round(h * 0.4)}px; border-radius: 18px; overflow: hidden; border: 1.5px solid var(--sr-line)"><div class="sr-bar" style="height: 40px"><i></i><i></i><i></i></div>${appScreen({ title: '', font: 12, flat: true })}</div>`
    if (kind === 2)
      return `<div class="sr-video" style="width: ${w - 90}px; height: ${Math.round(h * 0.4)}px"><span class="sr-play" style="right: auto; bottom: auto"></span></div>`
    return `<div class="sr-phone" style="width: ${Math.round(h * 0.25)}px; height: ${Math.round(h * 0.5)}px; padding: 8px; border-radius: 34px"><div class="sr-screen" style="border-radius: 28px">${appScreen({ title: '', font: Math.round(h * 0.016), rows: kind === 3 ? undefined : [''] })}</div></div>`
  }
  const cards = items
    .map(
      (it, i) =>
        `<div id="${id}-t${i}" class="sr-tile" style="position: absolute; left: 50%; top: 50%; width: ${w}px; height: ${h}px; margin: ${-h / 2}px 0 0 ${-w / 2}px"><span class="sr-label">${String(i + 1).padStart(2, '0')}/${String(items.length).padStart(2, '0')}</span>${pic(i)}<div class="sr-serif" style="font-size: ${it.length > 14 ? 64 : 76}px">${esc(it)}</div></div>`
    )
    .join('')
  const markup = `<div id="${id}-deck" style="position: relative; width: ${w + 80}px; height: ${h + 40}px">${cards}</div>`
  const tweens = items.flatMap((_, i) => {
    const t = i === 0 ? Math.min(at[0], 0.04) : at[i]
    const out = [
      `tl.fromTo('#${id}-t${i}', { opacity: 0, x: 140, rotation: 6, filter: 'blur(6px)' }, { opacity: 1, x: ${(i % 2 ? 1 : -1) * 6}, rotation: ${(i % 2 ? 1 : -1) * 1.5}, filter: 'blur(0px)', duration: 0.4, ease: 'power3.out' }, ${t2(t)})`
    ]
    if (i > 0)
      out.push(
        `tl.to('#${id}-t${i - 1}', { scale: 0.95, y: -26, duration: 0.4, ease: 'power3.out' }, ${t2(t)})`
      )
    return out
  })
  return { markup, tweens }
}

const clock: Maker = (ctx, g) => {
  const { id } = ctx
  const len = ctx.beat.end - ctx.beat.start
  const words = g.label
    ? `<div id="${id}-words" class="sr-serif" style="font-size: 96px; line-height: 1; color: var(--sr-ink); text-align: center">${esc(g.label)}</div>`
    : ''
  const markup = `<div style="display: flex; flex-direction: column; align-items: center; gap: 50px"><div id="${id}-clock" class="sr-clock" style="width: 420px; height: 420px"><div id="${id}-hh" class="sr-hand h" style="height: 112px"></div><div id="${id}-mh" class="sr-hand m" style="height: 160px"></div></div>${words}</div>`
  const at = g.label ? landings([g.label], ctx, { first: 0.5 })[0] : 0
  return {
    markup,
    tweens: [
      enter(`#${id}-clock`, 0.04),
      `tl.fromTo('#${id}-mh', { rotation: 0 }, { rotation: 1440, duration: ${t2(len)}, ease: 'power1.inOut' }, 0)`,
      `tl.fromTo('#${id}-hh', { rotation: 60 }, { rotation: 180, duration: ${t2(len)}, ease: 'power1.inOut' }, 0)`,
      ...(g.label ? [blurIn(`#${id}-words`, at)] : [])
    ]
  }
}

const editor: Maker = (ctx, g, b) => {
  const { id } = ctx
  const len = ctx.beat.end - ctx.beat.start
  const viewer = Math.min(380, fit(ctx, b) - 330)
  const tracks: [string, [number, number, string][]][] = [
    [
      'V1',
      [
        [2, 18, ' strong'],
        [22, 30, ''],
        [55, 25, ' strong']
      ]
    ],
    [
      'V2',
      [
        [10, 22, ' ink'],
        [40, 16, ' pale'],
        [70, 24, ' ink']
      ]
    ],
    [
      'A1',
      [
        [2, 60, ' pale'],
        [66, 30, '']
      ]
    ]
  ]
  let n = 0
  const rows = tracks
    .map(
      ([name, clips]) =>
        `<div class="sr-track"><b>${name}</b>${clips
          .map(
            ([left, width, tone]) =>
              `<div id="${id}-c${n++}" class="sr-clip${tone}" style="left: calc(70px + ${left}% * 0.86); width: calc(${width}% * 0.86)"></div>`
          )
          .join('')}</div>`
    )
    .join('')
  const markup = `<div id="${id}-editor" class="sr-editor" style="width: 940px"><div class="sr-viewer" style="height: ${viewer}px; border-style: solid; display: flex; justify-content: center; align-items: center"><div style="width: ${Math.round(viewer * 1.6)}px; height: ${viewer - 40}px; border-radius: 12px; overflow: hidden">${appScreen({ title: '', font: Math.round(viewer / 22), flat: true })}</div><span class="sr-label" style="position: absolute; left: 20px; top: 14px; font-size: 22px">${esc(g.label ?? 'untitled_launch.mp4')}</span></div><div class="sr-tracks">${rows}<div id="${id}-ph" class="sr-playhead" style="left: 70px"></div></div></div>`
  const tweens = [
    enter(`#${id}-editor`, 0.04),
    ...Array.from(
      { length: n },
      (_, i) =>
        `tl.fromTo('#${id}-c${i}', { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: 0.3, ease: 'power2.out' }, ${t2(0.25 + (i * Math.max(0.6, len - 1)) / n)})`
    ),
    `tl.fromTo('#${id}-ph', { x: 0 }, { x: 760, duration: ${t2(len)}, ease: 'none' }, 0)`
  ]
  return { markup, tweens }
}

const video: Maker = (ctx, g) => {
  const { id } = ctx
  const name = g.label ?? 'Your app'
  const markup = `<div id="${id}-video" class="sr-video" style="width: 920px; height: 518px"><b>${esc(name)}</b>${g.items?.[0] ? `<span>${esc(g.items[0])}</span>` : ''}<span id="${id}-play" class="sr-play"></span></div>`
  return { markup, tweens: [enter(`#${id}-video`, 0.04), pop(`#${id}-play`, 0.5)] }
}

const share: Maker = (ctx, g) => {
  const { id } = ctx
  const at = wordTime(ctx, 'share', 'send', 'show', 'showcase') ?? 0.6
  const markup = `<div style="display: flex; flex-direction: column; align-items: center; gap: 34px"><div id="${id}-video" class="sr-video" style="width: 760px; height: 428px"><b>${esc(g.label ?? 'Your app')}</b><span class="sr-play"></span></div><div id="${id}-sheet" class="sr-share">${['Message', 'Mail', 'Copy link', 'More'].map((l) => `<span><i></i>${l}</span>`).join('')}</div></div>`
  return {
    markup,
    tweens: [enter(`#${id}-video`, 0.04), enter(`#${id}-sheet`, Math.max(0.35, at))]
  }
}

const follow: Maker = (ctx, g) => {
  const { id } = ctx
  const chips = (g.items ?? []).slice(0, 4)
  const click = wordTime(ctx, 'follow', 'following', 'subscribe') ?? 0.5
  const at = landings(chips, ctx, { first: click + 0.5, given: g.at })
  const markup = `<div style="display: flex; flex-direction: column; align-items: center; gap: 56px"><div id="${id}-btn" style="position: relative"><span class="sr-button">Follow</span><span id="${id}-on" class="sr-button dark" style="position: absolute; inset: 0; padding: 0; opacity: 0">Following ✓</span><div id="${id}-cur" class="sr-cursor" style="left: 70%; top: 58%"></div></div><div class="sr-row-center" style="gap: 20px; flex-wrap: wrap; max-width: 940px">${chips.map((c, i) => `<span id="${id}-c${i}" class="sr-pill big">${esc(c)}</span>`).join('')}</div></div>`
  const tweens = [
    enter(`#${id}-btn`, 0.04),
    `tl.fromTo('#${id}-cur', { opacity: 0, x: 240, y: 220 }, { opacity: 1, x: 0, y: 0, duration: 0.4, ease: 'power2.out' }, ${t2(Math.max(0.1, click - 0.45))})`,
    `tl.to('#${id}-cur', { scale: 0.8, duration: 0.08, yoyo: true, repeat: 1 }, ${t2(click)})`,
    `tl.to('#${id}-on', { opacity: 1, duration: 0.1 }, ${t2(click + 0.06)})`,
    ...chips.map((_, i) => pop(`#${id}-c${i}`, Math.max(at[i], click + 0.3 + i * 0.15)))
  ]
  return { markup, tweens }
}

const graph: Maker = (ctx, g) => {
  const { id } = ctx
  const items = (g.items?.length ? g.items : ['screens', 'features', 'brand', 'copy']).slice(0, 6)
  const at = landings(items, ctx, { first: 0.35, given: g.at })
  const W = 940
  const H = 640
  const c = { x: W / 2, y: H / 2 }
  const spots = [
    [150, 110],
    [790, 110],
    [150, 530],
    [790, 530],
    [470, 60],
    [470, 590]
  ]
  const lines = items
    .map((_, i) => {
      const [x, y] = spots[i]
      const len = Math.round(Math.hypot(x - c.x, y - c.y))
      return `<line id="${id}-e${i}" x1="${c.x}" y1="${c.y}" x2="${x}" y2="${y}" stroke-dasharray="${len}" stroke-dashoffset="${len}"></line>`
    })
    .join('')
  // a zero-width holder centers a node on its point without a transform GSAP would fight
  const at0 = (x: number, y: number, inner: string): string =>
    `<div style="position: absolute; left: ${x}px; top: ${y}px; width: 0; height: 0; display: flex; align-items: center; justify-content: center">${inner}</div>`
  const nodes = items
    .map((it, i) =>
      at0(
        spots[i][0],
        spots[i][1],
        `<span id="${id}-n${i}" class="sr-pill" style="flex: none">${esc(it)}</span>`
      )
    )
    .join('')
  const hub = at0(
    c.x,
    c.y,
    `<span id="${id}-hub" class="sr-pill dark big" style="flex: none">${esc(g.label ?? 'your app')}</span>`
  )
  const markup = `<div id="${id}-graph" style="position: relative; width: ${W}px; height: ${H}px"><svg class="sr-links" viewBox="0 0 ${W} ${H}">${lines}</svg>${nodes}${hub}</div>`
  const tweens = [
    pop(`#${id}-hub`, 0.04),
    ...items.flatMap((_, i) => [
      `tl.to('#${id}-e${i}', { attr: { 'stroke-dashoffset': 0 }, duration: 0.3, ease: 'power2.out' }, ${t2(at[i])})`,
      `tl.fromTo('#${id}-n${i}', { opacity: 0 }, { opacity: 1, duration: 0.25 }, ${t2(at[i] + 0.2)})`
    ])
  ]
  return { markup, tweens }
}

const slides: Maker = (ctx) => {
  const { id } = ctx
  const len = ctx.beat.end - ctx.beat.start
  const slide = (i: number, rot: number, x: number, y: number, title: string): string =>
    `<div id="${id}-s${i}" class="sr-slide" style="position: absolute; left: ${x}px; top: ${y}px; rotate: ${rot}deg"><span class="sr-label">${title}</span><div class="sr-ph box"></div><div class="sr-ph" style="width: 60%"></div></div>`
  const markup = `<div id="${id}-deck" style="position: relative; width: 900px; height: 600px">${slide(0, -6, 40, 40, 'Slide 3')}${slide(1, 4, 220, 10, 'Slide 2')}${slide(2, -1, 120, 150, 'Untitled presentation')}<div id="${id}-q" class="sr-serif" style="position: absolute; right: 0; top: -40px; font-size: 200px; line-height: 1; color: var(--sr-ink)">?</div><div id="${id}-cur" class="sr-cursor" style="left: 600px; top: 420px"></div></div>`
  return {
    markup,
    tweens: [
      enter(`#${id}-s0`, 0.04),
      enter(`#${id}-s1`, 0.12),
      enter(`#${id}-s2`, 0.2),
      `tl.fromTo('#${id}-cur', { x: -260, y: 60 }, { x: 0, y: 0, duration: ${t2(Math.min(1.2, len * 0.5))}, ease: 'power2.inOut' }, 0.2)`,
      pop(`#${id}-q`, Math.min(len - 0.4, 0.8), 8)
    ]
  }
}

const link: Maker = (ctx, g) => {
  const { id } = ctx
  const url = g.items?.[0] ?? 'github.com/…'
  const sent = g.items?.[1] ?? 'sent to your DMs'
  const markup = `<div id="${id}-link" class="sr-card" style="width: 900px; padding: 44px 48px; display: flex; flex-direction: column; gap: 30px"><div style="display: flex; align-items: center; gap: 24px"><span style="flex: none; width: 76px; height: 76px; border-radius: 20px; background: var(--sr-accent)"></span><span class="sr-bold" style="font-size: 50px; color: var(--sr-card-ink)">${esc(g.label ?? 'The link')}</span></div><div id="${id}-url" class="sr-input" style="width: 100%; height: 88px; box-shadow: none; border: 2px solid var(--sr-line); font-family: var(--sr-mono); font-weight: 400; font-size: 32px; color: var(--sr-ink-soft)"><span>${esc(url)}</span></div><span id="${id}-sent" class="sr-label">${esc(sent)}</span></div>`
  const at = wordTime(ctx, 'send', 'link', 'dm', 'dms') ?? 0.6
  return {
    markup,
    tweens: [
      enter(`#${id}-link`, 0.04),
      rise(`#${id}-url`, 0.3),
      rise(`#${id}-sent`, Math.max(0.5, at))
    ]
  }
}

// ---------------------------------------------------------------- stickers (full beats)

type Sticker = (ctx: GraphicContext, g: ShortGraphic) => BuiltGraphic

/** The face in composition px and where captions start on a full beat. */
function around(ctx: GraphicContext): { fx: number; fy: number; floor: number; W: number } {
  const [W, H] = ctx.size
  return {
    W,
    fx: Math.round(ctx.face.x * W),
    fy: Math.round(ctx.face.y * H),
    // just under the caption line, on the shirt
    floor: Math.round(H * SUNROOM.captionFloor.full) + 26
  }
}

const stickerAt = (ctx: GraphicContext, g: ShortGraphic, ...keys: string[]): number =>
  g.at?.[0] !== undefined
    ? clampTime(g.at[0] - ctx.beat.start, ctx.beat.end - ctx.beat.start)
    : (wordTime(ctx, ...(g.label ? [firstWord(g.label)] : []), ...keys) ?? 0.25)

const tag: Sticker = (ctx, g) => {
  const { id } = ctx
  const { fx, fy, W } = around(ctx)
  const left = Math.min(W - 330, fx + 230)
  const markup = `<span id="${id}-tag" class="sr-tag sr-sticker" style="position: absolute; left: ${left}px; top: ${fy + 190}px; padding: 18px 38px; font-size: 84px; border-radius: 22px">${esc(g.label ?? '$0')}</span>`
  return { markup, tweens: [pop(`#${id}-tag`, stickerAt(ctx, g, 'free', 'price', 'cost'), -8)] }
}

const pill: Sticker = (ctx, g) => {
  const { id } = ctx
  const { fx, floor, W } = around(ctx)
  const text = g.label ?? '/keyword'
  const markup = `<div style="position: absolute; left: 0; width: ${W}px; top: ${floor}px; display: flex; justify-content: center"><span id="${id}-pill" class="sr-pill accent big sr-sticker" style="margin-left: ${Math.round((fx - W / 2) * 0.5)}px">${esc(text)}</span></div>`
  return { markup, tweens: [pop(`#${id}-pill`, stickerAt(ctx, g, 'comment'), -4)] }
}

const comment: Sticker = (ctx, g) => {
  const { id } = ctx
  const { floor, W } = around(ctx)
  const text = g.label ?? 'YES'
  const at = stickerAt(ctx, g, 'comment')
  const markup = `<div id="${id}-box" class="sr-input sr-sticker" style="position: absolute; left: ${(W - 860) / 2}px; top: ${floor}px; width: 860px"><i style="background: var(--sr-ink-soft)"></i><span><span id="${id}-type" class="sr-type" style="font-family: var(--sr-mono)">${esc(text)}</span><span class="sr-caret" style="margin-left: 4px"></span></span><i></i></div>`
  return {
    markup,
    tweens: [
      enter(`#${id}-box`, Math.max(0.04, at - 0.3)),
      `tl.fromTo('#${id}-type', { width: '0ch' }, { width: '${text.length + 1}ch', duration: ${t2(Math.min(0.6, 0.08 * text.length + 0.1))}, ease: 'steps(${text.length + 1})' }, ${t2(at + 0.1)})`
    ]
  }
}

const notify: Sticker = (ctx, g) => {
  const { id } = ctx
  const { W } = around(ctx)
  const at = stickerAt(ctx, g, 'send', 'dm', 'message')
  const markup = `<div id="${id}-note" class="sr-notify sr-sticker" style="position: absolute; left: ${(W - 900) / 2}px; top: 70px"><i></i><div><b>${esc(g.label ?? 'New message')}</b><span>${esc(g.items?.[0] ?? 'Here’s the link')}</span></div></div>`
  return {
    markup,
    tweens: [
      `tl.fromTo('#${id}-note', { opacity: 0, y: -200 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' }, ${t2(at)})`
    ]
  }
}

const bookmark: Sticker = (ctx, g) => {
  const { id } = ctx
  const { fx, fy, W } = around(ctx)
  const left = Math.min(W - 160, fx + 320)
  const at = stickerAt(ctx, g, 'save', 'saved', 'bookmark')
  const markup = `<div style="position: absolute; left: ${left}px; top: ${fy - 200}px; display: flex; flex-direction: column; align-items: center; gap: 14px"><div id="${id}-mark" class="sr-sticker" style="position: relative; width: 104px; height: 136px"><span class="sr-bookmark" style="position: absolute; inset: 0"></span><span id="${id}-on" class="sr-bookmark on" style="position: absolute; inset: 0; opacity: 0"></span></div><span id="${id}-saved" class="sr-pill dark" style="height: 48px; padding: 0 20px; font-family: var(--sr-sans); font-size: 24px; font-weight: 700">${esc(g.label ?? 'Saved')}</span></div>`
  return {
    markup,
    tweens: [
      pop(`#${id}-mark`, Math.max(0.04, at - 0.35)),
      `tl.to('#${id}-on', { opacity: 1, duration: 0.12 }, ${t2(at)})`,
      pop(`#${id}-saved`, at + 0.1)
    ]
  }
}

const timer: Sticker = (ctx, g) => {
  const { id } = ctx
  const { fx, fy, W } = around(ctx)
  const len = ctx.beat.end - ctx.beat.start
  const left = Math.min(W - 210, fx + 300)
  const markup = `<div id="${id}-timer" class="sr-clock sr-sticker" style="position: absolute; left: ${left}px; top: ${fy + 150}px; width: 170px; height: 170px; border-width: 7px"><div id="${id}-mh" class="sr-hand m" style="height: 62px; width: 6px; margin-left: -3px"></div></div>`
  return {
    markup,
    tweens: [
      pop(`#${id}-timer`, stickerAt(ctx, g, 'minutes', 'seconds', 'fast', 'quick', 'quickly')),
      `tl.fromTo('#${id}-mh', { rotation: 0 }, { rotation: 720, duration: ${t2(len)}, ease: 'none' }, 0)`
    ]
  }
}

const MAKERS: Record<GraphicKind, Maker | Sticker> = {
  phone,
  browser,
  terminal,
  doc,
  files,
  folder,
  progress,
  checklist,
  tiles,
  clock,
  editor,
  video,
  share,
  follow,
  graph,
  slides,
  link,
  tag,
  pill,
  comment,
  notify,
  bookmark,
  timer
}

/** A beat's ready-made graphic, as markup for its area and tweens for its timeline. */
export function buildGraphic(ctx: GraphicContext): BuiltGraphic {
  const g = ctx.beat.graphic
  const len = ctx.beat.end - ctx.beat.start
  if (ctx.beat.layout === 'full') return (MAKERS[g.kind] as Sticker)(ctx, g)
  const head = headline(ctx, g)
  const b = box(ctx, head?.bottom ?? null)
  const made = (MAKERS[g.kind] as Maker)(ctx, g, b)
  const { id } = ctx
  return {
    markup: `${head?.markup ?? ''}<div id="${id}-g" class="sr-stack" style="top: ${b.top}px; bottom: auto; height: ${b.height}px">${made.markup}</div>`,
    tweens: [...(head?.tweens ?? []), ...made.tweens, drift(`#${id}-g`, len)]
  }
}
