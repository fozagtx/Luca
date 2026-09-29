import { HYPERFRAMES } from './hyperframes'

/**
 * The motion-design guide Luca follows on motion-style projects: written to .luca/MOTION.md
 * when a project starts, and into its edit guide. Keep it short and opinionated — it is the
 * difference between a morphing launch film and a slideshow with fades.
 */
export const MOTION_GUIDE = `# Motion style

This video is 2D motion design in the Apple-keynote / Dribbble register, built in code on the HyperFrames timeline: one paused root GSAP timeline, every element with data-start and a duration, everything a pure function of time (no timers, no randomness, no CSS transitions).

Look, unless the user or a reference says otherwise: warm white canvas (#f5f5f2), near-black UI (#0e0e10), one accent color, one clean font (Geist or Inter; a serif only for the product name on the end card). 2D only. No dark 3D, no glows, no particles, no gradients on UI chrome, nothing that looks like a template.

The rules, in the order they matter:
1. Nothing fades in and nothing cuts. Every scene is made out of the previous one: a button grows into the next page, text rises out of a mask line, a color floods out of one object edge to edge (about 0.35 s, past the corners) and later shrinks back into another. Tween transform, clip-path and border-radius, and carry a shared element across every handoff.
2. Something happens on every beat. Work to a beat grid: the music's BPM, or 120 BPM when there is no music. Changes land on the beat or 2 frames before it; morphs start about 4 frames early; the biggest change lands on the drop.
3. Arrive fast, land soft: expo.out or power4.out, or a spring with a tiny overshoot (back.out(1.2) at most). Never linear, never a dead stop. Every move lasts at least 0.3 s; big moves 0.5–0.75 s.
4. Nothing freezes: a hold keeps a slow push (about 0.25 % of scale per frame). No hold longer than 1 s.
5. The camera makes one move per scene on eased keyframes, never zooms in and out back to back, and never chases a text cursor.
6. Stagger grouped elements 2–4 frames apart. Text stays still at least 8 frames before it moves again. One focal point per frame.
7. Real sound: a sound effect for every event (a click on the press, a whoosh with the move, an impact on a reveal), placed by its peak, music mixed under with sound_mix. Never synthesize a sound; use the files the user gave, or ask for them.
8. Show before you build: write the beat map to .luca/PLAN.md, then render 4 stills with \`npx ${HYPERFRAMES} snapshot --at <t>\` (the opening, the main composition, the fastest transition, the end card) and look at them zoomed in: hierarchy, spacing, type size, palette drift, stray shapes, cut-off text, overlaps. Fix, then build the film.
9. Review like a harsh motion director who did not build it: step through the fast moments frame by frame with snapshots; flag any fast move followed by a dead stop, text moving before it is readable, a sound off its hit, anything fading. Make the 5 fixes that improve it most before you show the user.`

/**
 * What goes in the first request's brief when the project starts from words alone: no footage
 * and no voiceover, so every visual is built in code and the words on screen carry the story.
 */
export const BRIEF_ONLY = `This project starts from words only: no footage and no voiceover. Build the whole picture from the brief below: on-screen text, the product's screenshots or logo where the user added them, clean UI you draw in HTML, shapes and color. There is no voice, so the words on screen carry the story: short lines, one idea per beat, readable. If the user added music it is the clock; otherwise plan at 120 BPM and tell the user in one line that a track and sound effects would make it land, asking them to drop them in the chat. Aim for 15–30 s unless the brief says otherwise. Set the root composition's duration yourself.`

/**
 * The brief for a project with a reference video: the contact sheets `studyReference` pulled
 * (2 frames a second) and the job — reverse-engineer its structure, keep the motion, change
 * the content.
 */
export const REFERENCE_STUDY = (sheets: string[], seconds: number): string =>
  `The user added a reference video (${seconds} s). Luca pulled 2 frames per second into contact sheets, in order: ${sheets.join(', ')}. Before you plan anything, read every sheet and reverse-engineer the video: break it into beats — what happens on each, how each scene turns into the next, the camera move, how long each move takes, the colors and the fonts. Write it to .luca/REFERENCE.md as a shot list with times. Then split it: KEEP (timing, cuts, camera, easing, positions, transitions) and CHANGE (brand, logo, colors, fonts, copy, product screens, platform UI), and build the same structure for the user's video. The frames are the truth: where the user's words disagree with them, the frames win for motion and the user wins for content. Tell the user in one line what you took from the reference.`
