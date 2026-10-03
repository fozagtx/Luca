/**
 * What kind of video the person brought and what Luca does to it. Shared by the start card
 * (names, blurbs, which steps are on) and main (the edit plan that goes in the first request and
 * .luca/EDIT.md).
 */
import { MOTION_GUIDE } from './motion'
import { palettePreset, SUNROOM_GUIDE } from './short'
import type { EditStepId, StartEdit, StyleId, VideoTypeId } from './types'

export type EditStep = {
  id: EditStepId
  name: string
  blurb: string
  /** Works from the words that are said, so it needs a transcript (the AssemblyAI key). */
  needsWords: boolean
  /** Works on footage of a person or a screen; left out when there is only a voiceover. */
  needsPicture: boolean
  /** For Luca: what to do. */
  guide: string
}

/** Everything Luca can do on the first edit, in the order it does them. */
export const EDIT_STEPS: EditStep[] = [
  {
    id: 'cut',
    name: 'Cut ums & pauses',
    blurb: 'Fillers, dead air and retakes, gone',
    needsWords: true,
    needsPicture: false,
    guide:
      'Clean edit first, before anything else, so everything after it lands on the cut timeline: call transcribe, read what is said, then call clean_edit with the retakes and false starts you find (keep the last good take). It cuts every um, uh and long pause by itself.'
  },
  {
    id: 'hook',
    name: 'Hook title',
    blurb: 'A bold line in the first seconds',
    needsWords: false,
    needsPicture: false,
    guide:
      'A hook title from the first frame to about 2.5 s: the video’s promise in 3–7 words, taken from what is said, big and high in the frame so it never covers a face, gone before the first point lands.'
  },
  {
    id: 'zooms',
    name: 'Punch-in zooms',
    blurb: 'Keeps a single shot moving',
    needsWords: false,
    needsPicture: true,
    guide:
      'Punch-in zooms on the footage: on a key line, cut the shot in to about 1.15–1.25× (a quick 0.15 s move, not a slow drift) and back out on the next sentence, every 4–8 s, so one long shot never feels static. On a screen recording, zoom into the part of the screen being talked about instead. Never crop a face at the top of the frame.'
  },
  {
    id: 'broll',
    name: 'B-roll images',
    blurb: 'Pictures of what you talk about',
    needsWords: true,
    needsPicture: false,
    guide:
      'B-roll: where the words name something a viewer would want to see (a product, a place, a company or its logo, an object, a person, a number), show a picture or short clip of it for 1.5–4 s with broll_search and broll_add, as a full-frame cutaway or a card over the footage (with only a voiceover, full frame as the scenes themselves), while the voice keeps playing. Only for things actually said, never as decoration or a background.'
  },
  {
    id: 'name',
    name: 'Name title',
    blurb: 'Your name and role when you first appear',
    needsWords: false,
    needsPicture: true,
    guide:
      'A lower third with the speaker’s name and role for 3–4 s in the first 10 s. Take them from the user’s notes or from what is said; if you can’t find them, leave this out and ask for them in your reply.'
  },
  {
    id: 'ending',
    name: 'Ending card',
    blurb: 'Your logo or call to action to close',
    needsWords: false,
    needsPicture: false,
    guide:
      'An ending card for the last 2–3 s: the product or channel name (or the logo, if the user added one) and one call to action taken from what is said or the notes.'
  },
  {
    id: 'captions',
    name: 'Captions',
    blurb: 'Word by word, big and readable',
    needsWords: true,
    needsPicture: false,
    guide:
      'Captions of everything said, last, with captions_apply, in the caption look this video type asks for; keep them clear of faces and of the titles you added.'
  },
  {
    id: 'plan',
    name: 'Beat map & stills first',
    blurb: 'Plans every beat, shows 4 frames before building',
    needsWords: false,
    needsPicture: false,
    guide:
      'Before building: write the beat map (what happens on each beat, how each scene turns into the next, the camera move, the colors, the fonts) to .luca/PLAN.md, then render 4 stills (the opening, the main composition, the fastest transition, the end card) and look at each one zoomed in: hierarchy, spacing, type size, palette drift, stray shapes, cut-off text, overlaps. Fix them, then build the film.'
  },
  {
    id: 'motion',
    name: 'Morphing motion',
    blurb: 'Nothing fades or cuts; scenes grow out of each other',
    needsWords: false,
    needsPicture: false,
    guide:
      'The motion follows .luca/MOTION.md: one continuous take, every scene made out of the previous one, springs that land soft, one camera move per scene, something on every beat.'
  },
  {
    id: 'sound',
    name: 'Music & sound on the beat',
    blurb: 'Every click, whoosh and drop has a real sound',
    needsWords: false,
    needsPicture: false,
    guide:
      'Sound: the music the user gave is the clock (find its BPM and its drop; the biggest change lands on the drop). A sound effect for every event (a click on the press, a whoosh with the move, an impact on a reveal), placed by its peak, from the files the user gave; never synthesize one. Mix music under speech with sound_mix. If there is no music or no sound effects, say so in one line and ask the user to drop them in the chat.'
  },
  {
    id: 'layout',
    name: 'Split-screen layout',
    blurb: 'You, a split screen or a graphic, cut on the words',
    needsWords: true,
    needsPicture: true,
    guide:
      'The layout, as .luca/TEMPLATE.md says: choose the beats from the word times (full, split or graphic, a new one every 1.5–4 s, cut at the start of a word), choose the palette, and lay them out with short_layout, which moves the speaker and puts the paper and a slot for each graphic on the timeline.'
  },
  {
    id: 'graphics',
    name: 'Clean graphics',
    blurb: 'A mock-up or headline for every point',
    needsWords: true,
    needsPicture: false,
    guide:
      'The graphics: build each slot short_layout returned, from the template’s kit, colored only with its theme tokens, each item landing on the word that names it.'
  },
  {
    id: 'critique',
    name: 'Director’s review',
    blurb: 'Checks its own work frame by frame before you see it',
    needsWords: false,
    needsPicture: false,
    guide:
      'Before showing the user: review it like a harsh motion director who did not build it. Step through every fast moment frame by frame with snapshots and flag any fast move followed by a dead stop, text moving before it is readable, a sound off its hit, anything that fades, anything that looks like a template. Make the 5 fixes that improve it most, then reply.'
  }
]

/** How Luca builds the video: morphing motion design, or a classic edit. */
export type Style = {
  id: StyleId
  name: string
  blurb: string
  /** For Luca: the look and the way scenes move. */
  guide: string
}

export const STYLES: Style[] = [
  {
    id: 'motion',
    name: 'Motion',
    blurb: 'Apple-keynote motion design: nothing cuts, everything morphs, on the beat',
    guide: MOTION_GUIDE
  },
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'A clean edit: cuts, captions, zooms and B-roll',
    guide:
      'A classic edit of the footage or voiceover: clean cuts, punch-in zooms, titles, B-roll and captions. Polished and readable, never flashy.'
  }
]

export function styleOf(id: string | undefined): Style {
  return STYLES.find((s) => s.id === id) ?? STYLES[0]
}

export type VideoType = {
  id: VideoTypeId
  name: string
  /** Who it is for, in two or three words. */
  who: string
  blurb: string
  /** The brief box's example. */
  example: string
  /** On by default, for each way of building the video. */
  steps: Record<StyleId, EditStepId[]>
  /** For Luca: what this kind of video needs from the edit. */
  guide: string
  /** What a step means for this kind of video, where it differs from the step's own guide. */
  stepGuides?: Partial<Record<EditStepId, string>>
  /** A template it follows: the look and the structure, in place of a style. */
  template?: Template
}

/** A template a video type follows, saved to .luca/<file> so later turns keep to it. */
export type Template = {
  name: string
  file: string
  /** For Luca: the whole template. */
  guide: string
}

/** Steps of a tutorial short, whichever way it is built: the template is its style. */
const SHORT_STEPS: EditStepId[] = ['cut', 'hook', 'layout', 'graphics', 'captions']

export const VIDEO_TYPES: VideoType[] = [
  {
    id: 'launch',
    name: 'Product launch',
    who: 'For launches',
    blurb: 'A launch film or feature reveal for your product',
    example: 'e.g. “Acme, an AI that orders food for you — acme.app. 15 seconds, lime accent”',
    steps: {
      motion: ['plan', 'motion', 'sound', 'ending', 'critique'],
      classic: ['cut', 'zooms', 'ending', 'captions']
    },
    guide:
      'A product launch film: show the product doing its one thing. A user’s request goes in, the result comes out, the product’s real screens or a clean UI you draw in HTML stand in for it, and it ends on the product name and one call to action. Short (15–30 s unless asked), one idea per beat.'
  },
  {
    id: 'concept',
    name: 'Concept explainer',
    who: 'For faceless channels & educators',
    blurb: 'Explain how something works: an idea, a process, a number',
    example: 'e.g. “how compound interest works, for beginners, keep it simple”',
    steps: {
      motion: ['plan', 'motion', 'broll', 'sound', 'captions', 'critique'],
      classic: ['cut', 'hook', 'broll', 'captions']
    },
    guide:
      'A concept explainer: the picture follows the idea. Key words and numbers as animated text, simple diagrams and charts for comparisons and steps, B-roll of what is named, one visual per idea and a new one every 3–6 s; never an empty frame. With a voiceover the voice carries it; without one the words on screen do.'
  },
  {
    id: 'tutorial',
    name: 'Tutorial',
    who: 'For makers',
    blurb: 'A screen recording walked through step by step',
    example: 'e.g. “how to set up the export button, 3 steps, number them”',
    steps: {
      motion: ['plan', 'zooms', 'motion', 'sound', 'ending', 'critique'],
      classic: ['cut', 'zooms', 'hook', 'ending', 'captions']
    },
    guide:
      'A tutorial over a screen recording: zoom into the part of the screen being used, a short callout for each step (“1. Pick a file”), numbered steps, the cursor’s clicks made visible, and an ending card with what the viewer can now do.'
  },
  {
    id: 'talking',
    name: 'Talking video',
    who: 'For creators & founders',
    blurb: 'You on camera: a take, an update, a pitch',
    example: 'e.g. “I’m Sam, founder of Acme, this is our launch update”',
    steps: {
      motion: ['cut', 'hook', 'motion', 'name', 'captions'],
      classic: ['cut', 'hook', 'zooms', 'name', 'captions']
    },
    guide:
      'A person talking to camera: a creator’s take, a founder’s update or pitch. Tight pacing with no dead air, a hook in the first 2 seconds, the speaker’s name and role on screen, the product or logo shown when it is named, captions that stay clear of the face.'
  },
  {
    id: 'short',
    name: 'Tutorial short',
    who: 'For creators teaching on camera',
    blurb: 'The Sunroom template: split screen, clean UI graphics, serif captions',
    example: 'e.g. “60 seconds on my notes app, brand color #6C5CE7, end with ‘comment NOTES’”',
    steps: { motion: SHORT_STEPS, classic: SHORT_STEPS },
    guide:
      'A tutorial short: a person explains a tool or a how-to to camera, vertical, 30–90 s, edited exactly in the Sunroom template (.luca/TEMPLATE.md): the speaker full frame, in a card under a graphic, or off screen for a graphic, cut on the words, with clean UI graphics and serif-accented captions.',
    stepGuides: {
      hook: 'The hook is the first beat: from 0 s, a split (or graphic) beat whose graphic shows what the video is about within half a second.',
      captions:
        'Captions last, with captions_apply style "sunroom" and 3–8 emphasis words (the word of a sentence that carries it, with the time it is said); they follow the layout by themselves.'
    },
    template: { name: 'Sunroom', file: 'TEMPLATE.md', guide: SUNROOM_GUIDE }
  }
]

/** Old type ids still mean their new kind: a saved card or an old project keeps working. */
const LEGACY_TYPE: Record<string, VideoTypeId> = {
  product: 'launch',
  explainer: 'concept',
  founder: 'talking'
}

export function videoType(id: string | undefined): VideoType {
  return VIDEO_TYPES.find((t) => t.id === id || t.id === LEGACY_TYPE[id ?? '']) ?? VIDEO_TYPES[0]
}

export function editStep(id: EditStepId): EditStep {
  return EDIT_STEPS.find((s) => s.id === id)!
}

/**
 * The steps that can run, in the order the type puts them, without the ones that need words
 * when nothing can transcribe, or a picture when there is only a voiceover.
 */
export function runnableSteps(
  steps: EditStepId[],
  opts: { canTranscribe: boolean; voiceOnly: boolean }
): { run: EditStep[]; skipped: EditStep[] } {
  const run: EditStep[] = []
  const skipped: EditStep[] = []
  for (const id of steps) {
    const s = editStep(id)
    if (s.needsPicture && opts.voiceOnly) continue
    if (s.needsWords && !opts.canTranscribe) skipped.push(s)
    else run.push(s)
  }
  return { run, skipped }
}

/** The words on the first request, e.g. "Make my product launch: beat map & stills first, …". */
export function editRequest(
  edit: StartEdit,
  opts: { voiceOnly: boolean; brief?: boolean }
): string {
  const type = videoType(edit.type)
  const steps = edit.steps
    .map(editStep)
    .filter((s) => !(s.needsPicture && opts.voiceOnly))
    .map((s) => s.name.toLowerCase())
  // Luca builds motion films and briefs; it edits classic footage and voiceovers
  const what = `${edit.style === 'motion' || opts.brief ? 'Make' : 'Edit'} my ${type.name.toLowerCase()}`
  return steps.length ? `${what}: ${steps.join(', ')}` : what
}

/**
 * The edit plan Luca follows, as Markdown: in the first request's brief and in .luca/EDIT.md,
 * where later turns find it.
 */
export function editGuide(
  edit: StartEdit,
  opts: { canTranscribe: boolean; voiceOnly: boolean; hearNothing?: boolean }
): string {
  const type = videoType(edit.type)
  const style = styleOf(edit.style)
  const template = type.template
  const { run, skipped } = runnableSteps(edit.steps, opts)
  const out = [
    '# How the user wants this video edited',
    `The user picked these when they described their video. Keep every later edit in line with it unless they ask for something else.`,
    '',
    `## ${type.name}`,
    type.guide,
    ''
  ]
  if (template) {
    const picked = edit.palette ? palettePreset(edit.palette) : null
    out.push(
      `## The ${template.name} template`,
      `This video follows the ${template.name} template in .luca/${template.file}: the look, the three layouts, the palette, pacing, the graphic kit and the order of work. Read it before your first edit in a session and keep every edit in it.`,
      picked
        ? `Palette: the user picked ${picked.name} (${picked.blurb.toLowerCase()}) on the start card: pass palette {"preset": "${picked.id}"}, with a brand color from the brief as the accent if they gave one.`
        : `Palette: choose it from the brief, their product, logo or screenshots (their brand color as the accent), or a color they named; ${palettePreset(undefined).name} only when nothing suggests one.`,
      ''
    )
  } else out.push(`## ${style.name} style`, style.guide, '')
  if (run.length) {
    out.push(
      '## The first edit, in this order',
      ...run.map((s, i) => `${i + 1}. ${s.name}: ${type.stepGuides?.[s.id] ?? s.guide}`),
      ''
    )
  } else {
    out.push(
      '## The first edit',
      'Nothing was switched on: look at what there is and make the smallest edit that suits this kind of video, then ask what they want next.',
      ''
    )
  }
  if (skipped.length)
    out.push(
      opts.hearNothing
        ? `Left out, as this video has no voice or footage sound to hear: ${skipped.map((s) => s.name.toLowerCase()).join(', ')}.`
        : `Skipped because Luca can’t hear the words yet (no AssemblyAI key): ${skipped.map((s) => s.name.toLowerCase()).join(', ')}. Say so in one sentence and that they can connect AssemblyAI in the Transcript tab to get them.`,
      ''
    )
  const notes = edit.notes?.trim()
  if (notes) out.push('## The user’s brief', notes, '')
  out.push(
    '## Rules',
    opts.voiceOnly
      ? '- There is no footage to play: every frame needs a visual that follows what is said or asked (B-roll, animated key words, simple diagrams, clean UI drawn in code). No intro or outro they didn’t ask for.'
      : template
        ? `- The speaker’s footage and voice are never cut or retimed beyond the clean edit: the ${template.name} layout only moves and crops the picture, and its paper is the only background. No intro or outro they didn’t ask for.`
        : '- The user’s footage is the video: it fills the frame. No stock or animated backgrounds behind it, no intro or outro they didn’t ask for.',
    '- Keep what they said and the order they said it in; cut only what the steps above ask for.',
    '- When you’re done, reply in 2–4 short lines: what you did, with times, and one thing they could ask for next.'
  )
  return out.join('\n').trim()
}
