/**
 * The choices on the start steps (design theme, font, background, motion, keyframes) and the
 * templates, with what Luca is told for each. Shared by the steps (names and blurbs) and main
 * (the guide that goes in the first request and .luca/STYLE.md).
 */
import { BUILTIN_FONTS } from './captions'
import type { Aspect, StartStyle, StyleField } from './types'

export type DesignTheme = {
  id: string
  name: string
  blurb: string
  /** CSS background for previews (a colour or a gradient). */
  bg: string
  text: string
  accent: string
  /** A second colour for boxes, rules and highlights. */
  accent2: string
  dark: boolean
  /** For Luca: the palette and the feel. */
  guide: string
}

export const THEMES: DesignTheme[] = [
  {
    id: 'clean',
    name: 'Clean & bright',
    blurb: 'Airy white space, one crisp accent',
    bg: '#FAFAF7',
    text: '#111111',
    accent: '#2563EB',
    accent2: '#E6EDFD',
    dark: false,
    guide:
      'off-white backgrounds (#FAFAF7), near-black text (#111111) and one blue accent (#2563EB) for highlights; lots of white space, thin rules, soft shadows at most'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Dark, calm and premium',
    bg: 'linear-gradient(160deg, #0B1020 0%, #1A2240 100%)',
    text: '#F5F7FF',
    accent: '#8EA2FF',
    accent2: '#26315A',
    dark: true,
    guide:
      'deep navy backgrounds (#0B1020 to #1A2240), soft white text (#F5F7FF) and a periwinkle accent (#8EA2FF); subtle glows, never pure black'
  },
  {
    id: 'neon',
    name: 'Neon pop',
    blurb: 'Electric colour on black, made for TikTok',
    bg: '#0A0A0A',
    text: '#FFFFFF',
    accent: '#39FF14',
    accent2: '#FF2E88',
    dark: true,
    guide:
      'black backgrounds (#0A0A0A), white text, electric green (#39FF14) and hot pink (#FF2E88) for highlighted words, outlines and flashes; high contrast, a glow on the key word'
  },
  {
    id: 'sunset',
    name: 'Warm sunset',
    blurb: 'Friendly, optimistic gradients',
    bg: 'linear-gradient(135deg, #FF7A59 0%, #FFB86B 55%, #FFD86F 100%)',
    text: '#2B1A12',
    accent: '#FFFFFF',
    accent2: '#C2410C',
    dark: false,
    guide:
      'warm orange-to-yellow gradients (#FF7A59 to #FFD86F), dark brown text (#2B1A12), white cards and burnt-orange accents (#C2410C); rounded shapes'
  },
  {
    id: 'bold',
    name: 'Bold poster',
    blurb: 'Loud blocks of colour, poster energy',
    bg: '#FFE600',
    text: '#0A0A0A',
    accent: '#FF3B30',
    accent2: '#0A0A0A',
    dark: false,
    guide:
      'solid bright yellow (#FFE600) and black blocks, heavy black text and red (#FF3B30) for the one word that matters; hard edges, big type that fills the frame'
  },
  {
    id: 'film',
    name: 'Cinematic',
    blurb: 'Moody and filmic, warm highlights',
    bg: 'linear-gradient(180deg, #1A1612 0%, #0C0B0A 100%)',
    text: '#F2E9DC',
    accent: '#D4A373',
    accent2: '#3A2F25',
    dark: true,
    guide:
      'near-black warm backgrounds (#1A1612), cream text (#F2E9DC) and a gold accent (#D4A373); film grain, letterboxing or a vignette are welcome, wide letter spacing on titles'
  },
  {
    id: 'pastel',
    name: 'Soft pastel',
    blurb: 'Gentle, playful and light',
    bg: 'linear-gradient(135deg, #FDE2F3 0%, #E4E9FF 50%, #D9F5EC 100%)',
    text: '#3B2F5C',
    accent: '#FF5FA2',
    accent2: '#7CC6FE',
    dark: false,
    guide:
      'pastel pink, lavender and mint gradients, deep purple text (#3B2F5C), pink (#FF5FA2) and sky-blue (#7CC6FE) accents; rounded corners, soft shadows'
  },
  {
    id: 'mono',
    name: 'Editorial mono',
    blurb: 'Black and white, magazine clean',
    bg: '#FFFFFF',
    text: '#000000',
    accent: '#000000',
    accent2: '#E5E5E5',
    dark: false,
    guide:
      'black and white only (light grey #E5E5E5 for rules and boxes), no colour; editorial layouts with strong alignment and a big contrast in type sizes'
  },
  {
    id: 'tech',
    name: 'Tech launch',
    blurb: 'A modern product-launch gradient',
    bg: 'linear-gradient(135deg, #0F172A 0%, #312E81 60%, #6D28D9 100%)',
    text: '#FFFFFF',
    accent: '#22D3EE',
    accent2: '#A78BFA',
    dark: true,
    guide:
      'dark blue-to-violet gradients (#0F172A to #6D28D9), white text, cyan highlights (#22D3EE) and glassy cards; clean grids, subtle grid lines or glow'
  }
]

/** What each built-in font is like, in the order the font step shows them. */
const FONT_NOTES: [family: string, note: string][] = [
  ['League Gothic', 'Tall and condensed, TikTok headlines'],
  ['Archivo Black', 'Heavy, poster titles'],
  ['Montserrat', 'Geometric and bold'],
  ['Poppins', 'Friendly geometric'],
  ['Inter', 'Clean and neutral'],
  ['Outfit', 'Modern and rounded'],
  ['Oswald', 'Condensed and punchy'],
  ['Playfair Display', 'Elegant serif'],
  ['EB Garamond', 'Classic book serif'],
  ['Nunito', 'Soft and rounded'],
  ['Lato', 'Warm and balanced'],
  ['Roboto', 'Everyday and neutral'],
  ['Open Sans', 'Open and readable'],
  ['Space Mono', 'Retro-tech mono'],
  ['JetBrains Mono', 'Code and tech'],
  ['IBM Plex Mono', 'Technical mono'],
  ['Source Code Pro', 'Clean mono'],
  ['Noto Sans JP', 'Japanese-ready sans']
]

export const FONTS: { family: string; note: string }[] = FONT_NOTES.filter(([f]) =>
  BUILTIN_FONTS.some((b) => b.family === f)
).map(([family, note]) => ({ family, note }))

export type Motion = { id: string; name: string; blurb: string; guide: string }

export const MOTIONS: Motion[] = [
  {
    id: 'smooth',
    name: 'Smooth fade',
    blurb: 'Calm and polished',
    guide:
      'text and elements fade in while rising about 30px (0.6–0.8s each) with a gentle 0.08s stagger between lines; scenes cross-fade'
  },
  {
    id: 'pop',
    name: 'Pop',
    blurb: 'Punchy scale-ins',
    guide:
      'elements scale in from about 0.6 to 1 with a quick fade (0.35–0.45s), words or cards staggered by 0.06s; cuts or quick zooms between scenes'
  },
  {
    id: 'kinetic',
    name: 'Kinetic type',
    blurb: 'Words slam in one by one',
    guide:
      'kinetic typography: words appear one at a time, big and centred, each slamming in from about 1.5× scale on the beat (0.2–0.3s), a new line every ~0.6s, punch-in zooms between scenes'
  },
  {
    id: 'slide',
    name: 'Slide & wipe',
    blurb: 'Clean masked reveals',
    guide:
      'text and panels revealed by masks and wipes: lines slide up from behind a mask, shapes wipe in left to right (0.5–0.7s); slide or push transitions between scenes'
  },
  {
    id: 'typewriter',
    name: 'Typewriter',
    blurb: 'Letters type on',
    guide:
      'text types on letter by letter (about 25 letters a second) with a blinking cursor, then holds; simple cuts or fades between scenes'
  },
  {
    id: 'glitch',
    name: 'Glitch',
    blurb: 'Edgy RGB jitter',
    guide:
      'elements arrive with a short glitch (RGB split, sliced jitter and flicker for 0.2–0.3s) before settling; glitch transitions between scenes, used sparingly'
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Slow, trailer-style reveals',
    guide:
      'slow reveals: titles fade up out of a blur while their letter spacing tightens (1–1.5s), slow push-ins on every shot, long cross-fades or dips to black between scenes'
  },
  {
    id: 'bounce',
    name: 'Bouncy',
    blurb: 'Playful drops and squash',
    guide:
      'elements drop in from above and bounce as they land with a little squash and stretch; playful, springy transitions between scenes'
  }
]

/** How motion speeds up and settles: the ease every keyframe uses. */
export type KeyframeStyle = {
  id: string
  name: string
  blurb: string
  /** The GSAP ease for Luca. */
  ease: string
  guide: string
}

export const KEYFRAMES: KeyframeStyle[] = [
  {
    id: 'natural',
    name: 'Natural',
    blurb: 'Fast start, gentle stop',
    ease: 'power3.out',
    guide: 'use the "power3.out" ease for entrances and moves and "power3.in" for exits'
  },
  {
    id: 'snappy',
    name: 'Snappy',
    blurb: 'Whips in, settles hard',
    ease: 'expo.out',
    guide:
      'use the "expo.out" ease for entrances and moves and "expo.in" for exits; keep them short'
  },
  {
    id: 'overshoot',
    name: 'Overshoot',
    blurb: 'Goes past, then settles back',
    ease: 'back.out(1.7)',
    guide:
      'use the "back.out(1.7)" ease so things overshoot a little and settle, "back.in(1.7)" for exits'
  },
  {
    id: 'elastic',
    name: 'Elastic',
    blurb: 'A springy wobble on arrival',
    ease: 'elastic.out(1, 0.45)',
    guide:
      'use the "elastic.out(1, 0.45)" ease for entrances so they wobble into place, and "power2.in" for exits'
  },
  {
    id: 'dreamy',
    name: 'Ease in-out',
    blurb: 'Gentle at both ends, floaty',
    ease: 'sine.inOut',
    guide: 'use the "sine.inOut" ease everywhere, with longer durations, so motion floats'
  },
  {
    id: 'linear',
    name: 'Linear',
    blurb: 'Constant speed, mechanical',
    ease: 'none',
    guide: 'use a linear ease ("none") everywhere: constant, mechanical motion'
  },
  {
    id: 'stepped',
    name: 'Stop-motion',
    blurb: 'Choppy, hand-made frames',
    ease: 'steps(6)',
    guide: 'use the "steps(6)" ease so motion jumps in a few frames, like stop-motion'
  }
]

export type TemplateBeat = {
  at: string
  name: string
  what: string
  /** On-screen words for the template's preview. */
  line: string
}

export type Template = {
  id: string
  name: string
  tagline: string
  blurb: string
  aspect: Aspect
  /** Seconds. */
  duration: number
  /** Asks what the video is about. */
  placeholder: string
  /** A headline for previews. */
  sample: string
  /** The choices it starts with; the person can change each on the steps. */
  style: Omit<StartStyle, 'template' | 'background'>
  beats: TemplateBeat[]
  /** For Luca: the workflow and its rules, beyond the beats. */
  rules: string[]
}

export const TEMPLATES: Template[] = [
  {
    id: 'tiktok-viral',
    name: 'Viral TikTok',
    tagline: 'Hook, payoff, loop',
    blurb:
      'A vertical video built the way viral TikToks are: a hook in the first second, fast beats, big captions and an ending that loops.',
    aspect: 'portrait',
    duration: 15,
    placeholder: 'What’s your TikTok about? e.g. “3 mistakes everyone makes brewing coffee”',
    sample: '3 mistakes you’re making',
    style: { theme: 'neon', font: 'League Gothic', motion: 'kinetic', keyframes: 'snappy' },
    beats: [
      {
        at: '0–1.5s',
        name: 'Hook',
        what: 'A bold claim or question on screen from the very first frame',
        line: 'Stop doing this'
      },
      {
        at: '1.5–4s',
        name: 'Tension',
        what: 'Why it matters, with a zoom punch-in',
        line: 'Nobody tells you why'
      },
      {
        at: '4–12s',
        name: 'Payoff',
        what: 'Three quick beats, a new visual every 1.5–2s',
        line: '3 quick fixes'
      },
      {
        at: '12–15s',
        name: 'Loop',
        what: 'A last line that leads back into the hook, plus a follow prompt',
        line: 'So stop doing this'
      }
    ],
    rules: [
      'Motion from the very first frame: no fade from black, no logo intro.',
      'Change the visual every 1.5–2 seconds (a cut, zoom, new background or layout) and keep each line to 3–6 words with one highlighted word.',
      'Keep everything important inside the TikTok safe area: nothing in the bottom 20% or the right 15% of the frame, and text at least 7% of the frame height.',
      'Write the on-screen words yourself from the user’s idea: punchy, second person, no filler.'
    ]
  },
  {
    id: 'explainer-viral',
    name: 'Viral explainer',
    tagline: 'Hook, problem, 3 steps, recap',
    blurb:
      'Explain anything in under a minute: a curiosity hook, the problem, three clear steps with visuals, a recap and one takeaway.',
    aspect: 'landscape',
    duration: 45,
    placeholder: 'What should the video explain? e.g. “how compound interest works”',
    sample: 'How it actually works',
    style: { theme: 'clean', font: 'Inter', motion: 'slide', keyframes: 'natural' },
    beats: [
      {
        at: '0–4s',
        name: 'Hook',
        what: 'A surprising fact or question as a big title',
        line: 'Why does this work?'
      },
      {
        at: '4–10s',
        name: 'Problem',
        what: 'What most people get wrong, with a simple diagram',
        line: 'Most people get it wrong'
      },
      {
        at: '10–36s',
        name: '3 steps',
        what: 'A scene per step: a title, one line, an icon or chart',
        line: 'Step 1 of 3'
      },
      {
        at: '36–42s',
        name: 'Recap',
        what: 'The three steps side by side',
        line: 'The recap'
      },
      {
        at: '42–45s',
        name: 'Takeaway',
        what: 'One sentence to remember and a follow prompt',
        line: 'Remember this'
      }
    ],
    rules: [
      'One idea per scene. Number the steps and keep a small progress marker (1/3, 2/3, 3/3) on screen.',
      'Every step gets a visual that animates in: an icon, a chart, a diagram or a before/after comparison (find them with catalog_search).',
      'Write the script and on-screen words yourself from what the user wants explained: short sentences, plain English, numbers and examples over abstractions.'
    ]
  }
]

/** The words a chip shows for a choice, e.g. "Neon pop". */
export function styleLabel(field: StyleField, value: string): string {
  switch (field) {
    case 'template':
      return TEMPLATES.find((t) => t.id === value)?.name ?? value
    case 'theme':
      return THEMES.find((t) => t.id === value)?.name ?? value
    case 'font':
      return value
    case 'background':
      return value === 'theme' ? 'Theme colours' : value === 'none' ? 'None' : 'Picked'
    case 'motion':
      return MOTIONS.find((m) => m.id === value)?.name ?? value
    case 'keyframes':
      return KEYFRAMES.find((k) => k.id === value)?.name ?? value
  }
}

/**
 * What Luca follows for the look the person picked, as Markdown (the first request's brief and
 * .luca/STYLE.md), or null when they left everything to Luca. Unknown ids are ignored.
 * `duration`: the target length, when the video has one (not footage).
 */
export function styleGuide(style: StartStyle | undefined, duration?: number): string | null {
  if (!style) return null
  const out: string[] = []
  const template = TEMPLATES.find((t) => t.id === style.template)
  if (template) {
    const scale =
      duration === undefined
        ? '; scale them to the video’s length if it differs'
        : duration !== template.duration
          ? `; scale them to the video’s ${duration}s`
          : ''
    out.push(
      `## Template: ${template.name}`,
      `Build the video with this workflow. The times are for ${template.duration}s${scale}.`,
      ...template.beats.map((b, i) => `${i + 1}. ${b.at} ${b.name}: ${b.what}.`),
      ...template.rules.map((r) => `- ${r}`),
      ''
    )
  }
  const lines: string[] = []
  const theme = THEMES.find((t) => t.id === style.theme)
  if (theme) lines.push(`- Design theme, ${theme.name}: ${theme.guide}.`)
  if (style.font && FONTS.some((f) => f.family === style.font))
    lines.push(
      `- Font: ${style.font} for every title and on-screen text, captions included (pass it to captions_apply). It is built in, so set font-family: '${style.font}' and nothing needs loading.`
    )
  if (style.background === 'theme')
    lines.push(
      '- Background: plain backgrounds in the theme’s colours (solid or a soft gradient); no photo or video backgrounds unless the user asks.'
    )
  else if (style.background === 'none')
    lines.push('- Background: none; the user’s footage fills the frame.')
  else if (style.background === 'picked')
    lines.push(
      '- Background: the photo or video from Pexels the user picked (it came with their first request); keep it behind the scenes.'
    )
  const motion = MOTIONS.find((m) => m.id === style.motion)
  if (motion) lines.push(`- Motion, ${motion.name}: ${motion.guide}.`)
  const keys = KEYFRAMES.find((k) => k.id === style.keyframes)
  if (keys) lines.push(`- Keyframes, ${keys.name}: ${keys.guide}.`)
  if (lines.length) out.push('## Look', ...lines, '')
  if (!out.length) return null
  return [
    '# The look the user chose',
    'The user picked these on the start screen. Follow them for every title, text, background and animation, now and in later edits, unless they ask for something else. Anything not listed is yours to choose so it fits.',
    '',
    ...out
  ]
    .join('\n')
    .trim()
}
