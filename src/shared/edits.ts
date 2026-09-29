/**
 * What kind of video the person brought and what Luca does to it. Shared by the start card
 * (names, blurbs, which steps are on) and main (the edit plan that goes in the first request and
 * .luca/EDIT.md).
 */
import type { EditStepId, StartEdit, VideoTypeId } from './types'

export type EditStep = {
  id: EditStepId
  name: string
  blurb: string
  /** Works from the words that are said, so it needs a transcript (the AssemblyAI key). */
  needsWords: boolean
  /** Works on footage of a person or a screen; left out when there is only a voiceover. */
  needsPicture: boolean
  /** Makes something with ai33 (spends the person's credits), so it needs a connected key. */
  needsAi33?: boolean
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
      'B-roll: where the words name something a viewer would want to see (a product, a place, a company or its logo, an object, a person, a number), show a picture or short clip of it for 1.5–4 s with broll_search and broll_add, as a full-frame cutaway or a card over the footage, while the voice keeps playing. Only for things actually said, never as decoration or a background.'
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
    id: 'music',
    name: 'Music',
    blurb: 'Quiet music under your voice',
    needsWords: false,
    needsPicture: false,
    needsAi33: true,
    guide:
      'Music, after the cuts and titles and before the captions: call music_generate once, instrumental, calm and fitting the video type and what is said, under the whole video and quiet behind the voice. The user switched this step on, so do not ask; offer the second take in your reply.'
  },
  {
    id: 'captions',
    name: 'Captions',
    blurb: 'Word by word, big and readable',
    needsWords: true,
    needsPicture: false,
    guide:
      'Captions of everything said, last, with captions_apply, in the caption look this video type asks for; keep them clear of faces and of the titles you added.'
  }
]

export type VideoType = {
  id: VideoTypeId
  name: string
  /** Who it is for, in two or three words. */
  who: string
  blurb: string
  /** The notes box's example. */
  example: string
  /** On by default. */
  steps: EditStepId[]
  /** For Luca: what this kind of video needs from the edit. */
  guide: string
}

export const VIDEO_TYPES: VideoType[] = [
  {
    id: 'talking',
    name: 'Talking video',
    who: 'For creators',
    blurb: 'You on camera: a phone clip, a vlog, a hot take',
    example: 'e.g. “make it a snappy TikTok, highlight the key words in yellow”',
    steps: ['cut', 'hook', 'zooms', 'captions'],
    guide:
      'A creator talking to camera, for TikTok, Reels, Shorts or YouTube. Tight pacing with no dead air, a hook in the first 2 seconds, punch-in zooms on the key lines, and bold captions (2–4 words a line, the spoken word highlighted, big enough to read on a phone). Keep the person’s face clear of text.'
  },
  {
    id: 'explainer',
    name: 'Faceless explainer',
    who: 'For faceless channels',
    blurb: 'A voiceover or screen recording that explains something',
    example: 'e.g. “it’s about how compound interest works, keep it simple”',
    steps: ['cut', 'hook', 'broll', 'captions'],
    guide:
      'A faceless explainer (YouTube automation style): the voice carries it and the picture follows what is said. With only a voiceover, the whole screen is visuals: B-roll of what is said, key words and numbers as animated text, simple diagrams or charts for comparisons and steps (catalog_search); change the visual every 3–6 s and never leave an empty frame. Over a screen recording, zoom into the part being talked about and point at it with short callouts. Clean, readable captions (4–6 words a line).'
  },
  {
    id: 'founder',
    name: 'Founder video',
    who: 'For founders',
    blurb: 'An update, a story or a pitch, told by you',
    example: 'e.g. “I’m Sam, founder of Acme. This is our launch update”',
    steps: ['cut', 'zooms', 'name', 'captions'],
    guide:
      'A founder talking about their company: an update, a story, a pitch, a hiring or fundraising video. Polished and credible, never flashy: clean cuts, gentle punch-ins, the founder’s name and role on screen, the product or logo shown when it is named, calm captions (sentence case, 4–6 words a line).'
  },
  {
    id: 'product',
    name: 'Product video',
    who: 'For launches',
    blurb: 'A demo, a launch or a feature walkthrough',
    example: 'e.g. “a 30-second launch video for our new export button”',
    steps: ['cut', 'zooms', 'ending', 'captions'],
    guide:
      'A short product video: a demo, a launch or a feature walkthrough, often a screen recording with a voiceover. Show the product: zoom into the part of the screen being used, a short text callout for each feature (“1-click export”), keep it moving, and end on the product name and one call to action.'
  }
]

export function videoType(id: string | undefined): VideoType {
  return VIDEO_TYPES.find((t) => t.id === id) ?? VIDEO_TYPES[0]
}

export function editStep(id: EditStepId): EditStep {
  return EDIT_STEPS.find((s) => s.id === id)!
}

/** What a plan is written for: what can hear, what can make things, and where the words come from. */
export type EditPlanOptions = {
  canTranscribe: boolean
  voiceOnly: boolean
  /** The words are exact already (a voiceover recorded from a script): nothing to cut, and nothing to transcribe. */
  scripted?: boolean
  /** ai33 is connected, so the steps that make sound or pictures can run. */
  canGenerate?: boolean
}

/**
 * The steps that can run: in Luca's order, without the ones that need words when nothing can
 * transcribe, a picture when there is only a voiceover, or ai33 when it isn't connected. A
 * scripted video has its words and no ums to cut: `cut` is dropped and the steps that need
 * words can run.
 */
export function runnableSteps(
  steps: EditStepId[],
  opts: EditPlanOptions
): { run: EditStep[]; skipped: EditStep[] } {
  const run: EditStep[] = []
  const skipped: EditStep[] = []
  const canTranscribe = opts.canTranscribe || !!opts.scripted
  for (const s of EDIT_STEPS) {
    if (!steps.includes(s.id)) continue
    if (opts.scripted && s.id === 'cut') continue
    if (s.needsPicture && opts.voiceOnly) continue
    if ((s.needsWords && !canTranscribe) || (s.needsAi33 && !opts.canGenerate)) skipped.push(s)
    else run.push(s)
  }
  return { run, skipped }
}

/** The words on the first request, e.g. "Edit my talking video: cut ums & pauses, captions". */
export function editRequest(
  edit: StartEdit,
  opts: { voiceOnly: boolean; scripted?: boolean }
): string {
  const type = videoType(edit.type)
  const steps = EDIT_STEPS.filter(
    (s) =>
      edit.steps.includes(s.id) &&
      !(s.needsPicture && opts.voiceOnly) &&
      !(opts.scripted && s.id === 'cut')
  ).map((s) => s.name.toLowerCase())
  const what = `Edit my ${type.name.toLowerCase()}`
  return steps.length ? `${what}: ${steps.join(', ')}` : what
}

/**
 * The edit plan Luca follows, as Markdown: in the first request's brief and in .luca/EDIT.md,
 * where later turns find it.
 */
export function editGuide(edit: StartEdit, opts: EditPlanOptions): string {
  const type = videoType(edit.type)
  const { run, skipped } = runnableSteps(edit.steps, opts)
  const out = [
    '# How the user wants this video edited',
    `The user picked these when they added their footage. Keep every later edit in line with it unless they ask for something else.`,
    '',
    `## ${type.name}`,
    type.guide,
    ''
  ]
  if (run.length) {
    out.push(
      '## The first edit, in this order',
      ...run.map((s, i) => `${i + 1}. ${s.name}: ${s.guide}`),
      ''
    )
  } else {
    out.push(
      '## The first edit',
      'Nothing was switched on: look at the footage and make the smallest edit that suits this kind of video, then ask what they want next.',
      ''
    )
  }
  if (opts.scripted)
    out.push(
      'The voiceover was recorded from the user’s script; its words and times are already exact in transcript.json. Call transcribe to read them (free); never pass force and never call clean_edit. The script is in .luca/SCRIPT.md.',
      ''
    )
  const names = (list: EditStep[]): string => list.map((s) => s.name.toLowerCase()).join(', ')
  const noWords = skipped.filter((s) => !s.needsAi33)
  const noAi33 = skipped.filter((s) => s.needsAi33)
  if (noWords.length)
    out.push(
      `Skipped because Luca can’t hear the words yet (no AssemblyAI key): ${names(noWords)}. Say so in one sentence and that they can connect AssemblyAI in the Transcript tab to get them.`,
      ''
    )
  if (noAi33.length)
    out.push(
      `Skipped because ai33 isn’t connected: ${names(noAi33)}. Say so in one sentence and that they can connect it under Connections (Cmd+,).`,
      ''
    )
  const notes = edit.notes?.trim()
  if (notes) out.push('## The user’s notes', notes, '')
  out.push(
    '## Rules',
    '- The user’s footage is the video: it fills the frame. No stock or animated backgrounds behind it, no intro or outro they didn’t ask for.',
    '- Keep what they said and the order they said it in; cut only what the steps above ask for.',
    '- When you’re done, reply in 2–4 short lines: what you did, with times, and one thing they could ask for next.'
  )
  return out.join('\n').trim()
}
