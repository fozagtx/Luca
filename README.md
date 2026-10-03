<p align="center">
  <img src="./docs/hero.png" alt="Luca editing a launch video: live preview, timeline and chat while Luca styles the title" />
</p>

<p align="center">
  <a href="https://github.com/fozagtx/Luca/releases"><img src="https://img.shields.io/badge/version-0.1.0-7C5CFF" alt="Version 0.1.0" /></a>
  <a href="https://fozagtx.github.io/Luca/"><img src="https://img.shields.io/badge/website-fozagtx.github.io%2FLuca-111111" alt="Website" /></a>
  <img src="https://img.shields.io/badge/macOS-13%2B%20%C2%B7%20Apple%20silicon-000000?logo=apple&logoColor=white" alt="macOS 13+ on Apple silicon" />
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/runs%20on-Claude%20Code-D97757?logo=claude&logoColor=white" alt="Runs on Claude Code" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" />
</p>

# <img src="docs/logo.png" alt="" width="36" align="top" /> Luca

Luca makes explainer videos for you. Describe it — or drop a voiceover, footage or screenshots — pick Motion or Classic, and Luca makes the whole video for you: launch films, concept explainers, tutorials and talking videos. Drop a reference video and Luca studies it frame by frame, then builds yours the same way. Then keep talking to change anything: “make the captions yellow”, “zoom in when I say the price”, “show our logo at the end”.

Built for people who make content and don’t want to spend the evening editing it:

- **Founders** launching products: launch films and feature reveals.
- **Faceless channels** and educators: explainers that make an idea, a process or a number clear.
- **Makers** documenting tutorials and screen demos, step by step.
- **Creators** on camera: takes, updates and pitches.

## Why Luca

- **Describe it, get a video.** A written brief, a voiceover, footage or screenshots — pick Motion (Apple-keynote motion design) or Classic (a clean edit) and Luca plans the beats, builds every visual and mixes the sound.
- **Show it a reference.** Drop a video you like: Luca studies its frames and builds yours the same way, keeping the motion and changing the content.
- **Talk instead of keyframing.** Describe the change in plain words, or click anything in the preview and say what should change right there. Luca does the work and asks before anything unusual.
- **Watch it change live.** The preview plays exactly what will export and updates within a second of every edit, without losing your place.
- **Nothing is ever lost.** Every change, Luca’s or yours, is saved as a version you can restore or undo with ⌘Z. Your original footage is never modified.
- **Your Mac, your subscription.** Luca runs on your own Claude subscription through Claude Code and never sees your credentials. Projects are plain folders on your disk.
- **A real editor underneath.** Timeline with trim, split and snapping, Caption Studio, clean edits that cut ums and retakes, color grades, B-roll, voice control and MP4 export.

## Installation

Luca runs on Claude Code, so set that up first:

```bash
brew install node ffmpeg git
npm install -g @anthropic-ai/claude-code
claude          # then type /login and sign in with your Claude subscription
```

Then download the latest `luca-<version>-arm64.dmg` from [Releases](https://github.com/fozagtx/Luca/releases) (Apple silicon, macOS 13+) and drag Luca to Applications. The build isn’t signed yet: the first time, right-click `Luca.app` → **Open**, or allow it under System Settings → Privacy & Security.

That’s the only download: Luca keeps itself up to date. It looks for a newer version when it starts, every 15 minutes and when you come back to it, downloads it in the background and says **Luca x.y.z is ready** with a Restart button (or it goes in when you quit). **Luca → Check for Updates…** checks right away. While the repository is private, GitHub shows its releases only with a token: make a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for this repository with read-only Contents and paste it in Check for Updates….

Optional keys, all entered inside the app and kept in the macOS Keychain:

- [AssemblyAI](https://www.assemblyai.com/) so Luca can hear what’s said: cutting ums and pauses, captions, B-roll that matches your words, and voice input. Strongly recommended; without it Luca can still zoom, title and grade.
- [Pexels](https://www.pexels.com/api/) (free) for B-roll: photos and short clips of what you talk about.

## Edit your first video

1. **Describe it or drop what you have.** A brief alone (“Acme, an AI that orders food for you. 15 seconds, lime accent”), a voiceover, one clip or several (they play back to back). A logo, screenshots and music can come along too.
2. **Pick Motion or Classic, and the kind of video:** Product launch, Concept explainer, Tutorial / screen demo or Talking video. Luca switches on the steps that suit it (beat map & stills, morphing motion, sound on the beat, director’s review; or cut ums & pauses, zooms, B-roll, ending card, captions); change any of them, add a reference video if you like, and pick the shape.
3. **Watch Luca edit it, then keep talking.** “Make the captions bigger.” “Cut the part where I cough.” Press **G** to grab anything in the preview and comment on it.
4. **Export.** Press ⌘E for an MP4, rendered in the background.

## Built with

Luca is free and MIT-licensed. It stands on these tools, and couldn’t exist without them.

<!-- built-with:start -->
<table align="center">
  <tbody>
    <tr>
      <td colspan="15" width="850" align="center"><a href="https://claude.com/claude-code"><img src="docs/logos/claude.svg" alt="" height="44" align="middle" /> <b>Claude Code</b></a><br /><sub>The brain: Luca plans and makes every edit through it</sub></td>
    </tr>
    <tr>
      <td colspan="5" width="283" align="center"><a href="https://github.com/heygen-com/hyperframes"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/logos/hyperframes-dark.svg" /><img src="docs/logos/hyperframes.svg" alt="HeyGen HyperFrames" height="40" align="middle" /></picture></a><br /><sub>Preview and render</sub></td>
      <td colspan="5" width="283" align="center"><a href="https://www.remotion.dev/"><img src="docs/logos/remotion.png" alt="" height="40" align="middle" /> <b>Remotion</b></a><br /><sub>Animated components</sub></td>
      <td colspan="5" width="283" align="center"><a href="https://remocn.dev/"><img src="docs/logos/remocn.svg" alt="" height="40" align="middle" /> <b>remocn</b></a><br /><sub>Titles, transitions and effects</sub></td>
    </tr>
    <tr>
      <td colspan="3" width="170" align="center"><a href="https://www.assemblyai.com/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/logos/assemblyai-dark.png" /><img src="docs/logos/assemblyai.png" alt="AssemblyAI" height="26" align="middle" /></picture></a><br /><sub>Transcripts and voice</sub></td>
      <td colspan="3" width="170" align="center"><a href="https://www.pexels.com/"><img src="docs/logos/pexels.svg" alt="" height="30" align="middle" /> <b>Pexels</b></a><br /><sub>B-roll</sub></td>
      <td colspan="3" width="170" align="center"><a href="https://www.electronjs.org/"><img src="docs/logos/electron.svg" alt="" height="30" align="middle" /> <b>Electron</b></a><br /><sub>The Mac app</sub></td>
      <td colspan="3" width="170" align="center"><a href="https://ffmpeg.org/"><img src="docs/logos/ffmpeg.svg" alt="" height="30" align="middle" /> <b>FFmpeg</b></a><br /><sub>Footage and audio</sub></td>
      <td colspan="3" width="170" align="center"><a href="https://ui.shadcn.com/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/logos/shadcnui-dark.svg" /><img src="docs/logos/shadcnui.svg" alt="" height="30" align="middle" /></picture> <b>shadcn/ui</b></a><br /><sub>Interface</sub></td>
    </tr>
  </tbody>
</table>
<!-- built-with:end -->

Building a tool Luca should talk to? [Open an issue](https://github.com/fozagtx/Luca/issues) and it could live here.

## Everything Luca can do

<details>
<summary>Every feature, in one table</summary>

|     |                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Projects**             | Start from your footage (one or more videos, played back to back), a voiceover, or only a written brief — Luca makes every visual — portrait or landscape, with a logo, screenshots and music as extras. Drop them on the start card or the chat, press ⌘N, or open them from Finder. The project takes the shape of your footage, or pick another (a landscape video becomes a vertical short, cropped to fit), and iPhone HEVC and HDR clips just work. While Luca edits, light circles the preview and a cover says what Luca is doing and about how long is left (Watch Luca edit lifts the cover). Reopen, forget or trash recent projects; Home (⇧⌘W) goes back to the start screen. Your footage is never modified. |
| F1b | **Video types**          | Pick **Motion** (morphing motion design, on the beat) or **Classic** (a clean edit), say what kind of video it is — **Product launch**, **Concept explainer**, **Tutorial** or **Talking video** — and Luca does the first edit right away. Add a reference video and Luca studies it frame by frame and builds yours the same way. Switch any step on or off and write the brief. The plan stays with the project (.luca/EDIT.md, MOTION.md, REFERENCE.md), so later edits keep to it.                                                                                                                         |
| F2  | **Live preview**         | Plays your video exactly as it will export; updates within a second of every change and keeps your place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3  | **Timeline**             | Tracks, clips, captions and audio waveform; playhead, zoom, snapping; press and drag anywhere on the ruler to scrub; drag to move, trim, split; a selection bar and right-click menu to split, trim to the playhead or delete; track mute and lock; undo toasts.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F4  | **Chat**                 | Luca works on your own Claude subscription, shows what it is doing in plain words (“Luca is adding a lower third…”); the message box and the preview's edges glow in Luca's red and orange while it works, streams replies and asks before unusual steps. Drop, paste or attach videos, audio and images in the chat: Luca adds them to the video or uses them as a reference (“make the captions like this”). ⌘↩ allows, ⌘. stops.                                                                                                                                                                                                                                                                      |
| F4b | **Queue**                | Keep going while Luca works: new requests line up in a queue above the message box instead of piling into the conversation. See what Luca is doing now and what's next; edit, remove or hold anything still waiting.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F5  | **Comment on the video** | Click Grab (G), click anything in the preview, and write what should change in the box that opens right there; it goes to Luca with that part of the video attached. ⌥-click comments on the whole frame.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F5b | **Move & resize**        | Click anything in the preview (or select its clip) to get handles: drag to move, drag a corner to resize, or click Comment to tell Luca what to change. Animations keep playing on top.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F6  | **Components**           | Every ready-made title, lower third, callout, chart and transition, found and picked by Luca from what you describe; there is nothing to browse. Extras set themselves up in the background the first time Luca needs one.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F6b | **B-roll**               | Photos and short clips from Pexels of the things you talk about, shown as a cutaway or a card while you keep talking. Luca finds them itself on explainers, or search the B-roll tab (⌘2), switch between Photos and Videos and click one to tell Luca where it goes. Never used as a background: your footage fills the frame.                                                                                                                                                                                                                                                                                                                                                 |
| F7  | **Clean edit**           | A word-by-word transcript, then cuts for ums, pauses and retakes, applied to make a clean master with captions that follow. Luca does it as part of the first edit, or run it from the Transcript tab; every step shows real progress.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F7b | **Captions**             | Caption Studio: words cleaned of ums, stutters and false starts, grouped into lines; ten animated styles previewed live, each with its own colours, outline, box and weight; built-in fonts, the ones included with Luca (Helvetica, Montserrat Thin, Mermaid and more), your own, or any Google font from a pasted link or its name (saved with the project, so it exports offline); one click puts them on the timeline, or ask Luca to match a look. Captions stay in sync as you split, trim, move or clean up the video.                                                                                                                                                   |
| F7c | **Color**                | Grade the footage with a look that comes with Luca (Color in the toolbar), each previewed on your own frame with an intensity slider, or ask Luca for “something warmer”.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F8  | **Looks**                | Save a project's style as a named Look and apply it to a new project in one click.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F9  | **Versions**             | Every change Luca or you make is saved as a version: browse history, restore, ⌘Z.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F10 | **Export**               | Render MP4 (Draft or Final) in the background with progress and cancel, then Reveal in Finder. Bigger Macs render with more parallel workers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F13 | **Voice**                | Talk to Luca hands-free or dictate, with live speech-to-text; nothing reaches Luca until you approve it. Voice mode: press ↩ or ⌘↩, click Send, or just say “send it” (“scratch that” drops it), and replies are read aloud while an orb shows Luca listening, working and talking back. Dictation: press ↩ when you're done, then approve the card with ⌘↩ or Send.                                                                                                                                                                                                                                                                                                            |
| F14 | **Keyboard**             | `/` to type to Luca, `?` for every shortcut, ⌘K for commands. A notification tells you when Luca finishes or needs your OK while you're in another app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

</details>

## Run from source

Prerequisites: everything under [Installation](#installation) (with Node 22+), plus the HyperFrames browser (`npx hyperframes browser ensure`). For development you can also set `PEXELS_API_KEY` in the environment, or `MAIN_VITE_PEXELS_API_KEY` in a git-ignored `.env` to build a key into the app (anyone with the build can read it).

```bash
npm install
npm run dev        # launch the app
npm run typecheck && npm run lint
npm run dist       # unsigned .dmg + .zip in dist/
```

**Releases.** Every push to `main` (except docs-only changes) builds the app on GitHub Actions and publishes it as the latest release, `v0.1.<run number>`: the dmg, the zip and `latest-mac.json` (the zip’s version, size and SHA-512), which is what running copies update from. A `v*` tag releases that exact version instead. Bump `major.minor` in `package.json` to start a new series; the patch number is the build’s. Updates only reach an installed app: `npm run dev` never updates itself.

**Website.** The landing page is the static `site/` folder (plain HTML, CSS and one small script for the scrolling tour of the app, no build). Every push to `main` that touches it deploys to [fozagtx.github.io/Luca](https://fozagtx.github.io/Luca/) through GitHub Pages (`.github/workflows/pages.yml`); preview it locally with `python3 -m http.server -d site 4173`. One-time setup: in the repository’s Settings → Pages, set Source to **GitHub Actions**.

<details>
<summary><b>How it works</b> (for developers)</summary>

The app itself never names the tools below; they are here for people building Luca from source.

- **HyperFrames HTML is the composition.** `index.html` plus `compositions/*.html` are the single source of truth for the timeline; Luca reads them through the `hyperframes` CLI and never invents a second format. Sources stay immutable in `media/`.
- **Electron main owns side effects**: a loopback HTTP server (Range requests, per-session cookie token — never `file://`) serves the project to the preview; a file watcher hot-reloads and re-seeks; `ffmpeg` and the HyperFrames CLI run as subprocesses.
- **Claude Code via the Agent SDK.** The stock `claude` binary runs in the project directory with a Luca MCP server (`transcribe` and `clean_edit` for the words and the cuts, `catalog_search` over HyperFrames + Remocn, the remocn tools, `captions_apply` for Caption Studio's captions, `font_add` for Google Fonts, `lut_apply` for color and the B-roll tools below) and permission callbacks that surface as approval cards in chat. The composer's approval pill switches Luca to full access, which runs every step without asking (the project-folder and media/renders guards still apply).
- **Catalog data.** The HyperFrames catalog comes from `hyperframes catalog --json` and the Remocn index from remocn.dev, cached daily; copies bundled in `src/main/catalog/` keep both available offline. Search and categories live in `src/shared/catalog.ts`.
- **The first edit.** The video types and edit steps live in `src/shared/edits.ts`, with what Luca is told for each. The start card's picks go to `startProject`, which saves the plan as `.luca/EDIT.md` and adds it to the first request; later turns point Luca back to that file (an applied Look still wins). Luca works through it in one turn: `transcribe` (AssemblyAI, progress in the Transcript tab) gives it the words with times, `clean_edit` cuts the fillers and long pauses it finds plus the retakes Luca names, then titles, zooms, B-roll and `captions_apply` land on the cut timeline.
- **B-roll** comes from the Pexels API, called only from main (`src/main/pexels.ts`) so the key never reaches the renderer. Luca's MCP server adds `broll_search` (the best photos and short clips, with small previews Luca looks at before choosing) and `broll_add`, which downloads the pick into `media/broll/` sized for the composition (photos cropped to the frame, videos as the smallest MP4 that fills it) and credits it in `media/broll/CREDITS.txt`. The agent is told to use it only for things that are said, as cutaways over the footage, never as a background.
- **Included fonts** live in `resources/fonts/` and are listed in `BUNDLED_FONTS` (generated by `npm run fonts` into `src/shared/fonts.generated.ts`); to add one, drop its .ttf/.otf there, give the family a note in `resources/fonts/fonts.json` and run `npm run fonts`. They show in Caption Studio, previews load them from the Luca server (`/fonts/`), and a project that uses one gets a copy in `fonts/`, declared in `index.html` like any font added from a file, so exports never need the app.
- **Git is the version store.** Each agent turn or manual edit becomes a commit; History restores any checkpoint.
- **Voice** is AssemblyAI streaming speech-to-text with the Universal-3.5 Pro model (`universal-3-5-pro`) over WebSocket. The renderer captures the mic in an AudioWorklet (16 kHz PCM, 50 ms chunks) and streams it over IPC to main, which holds the socket, so the key never reaches the renderer. Dictation and voice mode both put what was said in the request queue (`src/renderer/stores/queue.ts`) for approval; approved requests go to Luca one at a time when it is free, and in voice mode the reply is read aloud sentence by sentence with the system voice (`src/renderer/lib/speech.ts` is the seam to bring your own TTS). The voice orb is shadercn's ORB-25 on WebGPU (`src/renderer/components/orbs/`, rendered with vgpu and TypeGPU); its shader is by XorDev, for non-commercial use with attribution, and the level meter stands in where WebGPU is unavailable.
- **Updates** (`src/main/updater.ts`) come from GitHub Releases through the REST API (with the saved token for a private repository; the file downloads go to GitHub’s storage without it). The build isn’t signed, and Electron’s Squirrel updater installs only signed apps, so Luca checks the zip against `latest-mac.json`, unpacks it with `ditto` into `~/Library/Application Support/Luca/updates/` and, once Luca has quit, a small script swaps the app bundle and opens it again (putting the old one back if anything fails; `updates/install.log` says what happened). An app running from the disk image or Downloads is offered a move to Applications first.
- **Export** runs `@hyperframes/producer` in an Electron `utilityProcess` (parallel workers sized to the Mac, VideoToolbox) and writes `renders/<name>-<date>.mp4`.
- **UI**: React 19, TypeScript, Tailwind v4, shadcn Base UI, three resizable panes (Transcript/B-roll/Looks · Preview/Timeline · Chat); the sidebar starts hidden (⇧⌘S) and stays hidden on Home, where the start card takes its place. Chat patterns (shimmering status text, steps, prompt input, suggestions, scroll button) are adapted from [prompt-kit](https://www.prompt-kit.com/) (MIT).

</details>

## License

MIT © fozagtx. HyperFrames, Remotion and remocn are subject to their own licenses, and so are the fonts in `resources/fonts/`.
