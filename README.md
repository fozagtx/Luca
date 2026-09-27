<h1><img src="docs/logo.png" alt="" width="40" align="top" /> Luca</h1>

Talk to your video. Luca is a personal macOS video editor: say or type what you want, approve it, and watch the preview change.

![Luca with a project loaded](docs/screenshots/editor-light.png)

## What it does

|     |                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Projects**             | Start from anything: an idea, one photo, many images, an audio track, or one or more videos played one after another (drop them on the start card or the chat). The project takes the shape of your footage (a vertical phone clip makes a vertical video), and iPhone HEVC and HDR clips just work. Describe what you want and Luca picks the titles, effects and animations itself. Reopen, forget or trash recent projects; Home (⇧⌘W) goes back to the start screen. Your footage is never modified. |
| F2  | **Live preview**         | Plays your video exactly as it will export; updates within a second of every change and keeps your place.                                                                                                                                                                                                                                                                                                                                                                                                |
| F3  | **Timeline**             | Tracks, clips, captions and audio waveform; playhead, zoom, snapping; drag to move, trim, split; a selection bar and right-click menu to split, trim to the playhead or delete; track mute and lock; undo toasts.                                                                                                                                                                                                                                                                                        |
| F4  | **Chat**                 | Luca works on your own Claude subscription, shows what it is doing in plain words (“Luca is adding a lower third…”), streams replies and asks before unusual steps. Drop, paste or attach videos, audio and images in the chat: Luca adds them to the video or uses them as a reference (“make the captions like this”). ⌘↩ allows, ⌘. stops.                                                                                                                                                            |
| F4b | **Queue**                | Keep going while Luca works: new requests line up in a queue above the message box instead of piling into the conversation. See what Luca is doing now and what's next; edit, remove or hold anything still waiting.                                                                                                                                                                                                                                                                                     |
| F5  | **Comment on the video** | Click Grab (G), click anything in the preview, and write what should change in the box that opens right there; it goes to Luca with that part of the video attached. ⌥-click comments on the whole frame.                                                                                                                                                                                                                                                                                                |
| F5b | **Move & resize**        | Click anything in the preview (or select its clip) to get handles: drag to move, drag a corner to resize, or click Comment to tell Luca what to change. Animations keep playing on top.                                                                                                                                                                                                                                                                                                                  |
| F6  | **Components**           | Every ready-made title, caption, transition and effect, plus extras, found and picked by Luca from what you describe; there is nothing to browse. Extras set themselves up in the background the first time Luca needs one.                                                                                                                                                                                                                                                                              |
| F6b | **Backgrounds**          | Free photos and short video loops from Pexels to put behind your video: search or pick a topic (Abstract, Tech, Workspace…), show only videos or photos, hover a video to watch it, click to use it. Pick one on the start card and the new video starts on it, or click Let Luca pick and Luca chooses one that suits what you're making. The home screen plays one too (shuffle for another).                                                                                                          |
| F7  | **Clean edit**           | A word-by-word transcript, then cuts for ums, pauses and retakes that Luca reviews, applied to make a clean master with captions that follow. Every step shows real progress.                                                                                                                                                                                                                                                                                                                            |
| F7b | **Captions**             | Caption Studio: words cleaned of ums, stutters and false starts, grouped into lines; ten animated styles previewed live, each with its own colours, outline, box and weight; built-in fonts, your own, or any Google font from a pasted link or its name (saved with the project, so it exports offline); one click puts them on the timeline, or ask Luca to match a look. Captions stay in sync as you split, trim, move or clean up the video.                                                        |
| F8  | **Looks**                | Save a project's style as a named Look and apply it to a new project in one click.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F9  | **Versions**             | Every change Luca or you make is saved as a version: browse history, restore, ⌘Z.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F10 | **Export**               | Render MP4 (Draft or Final) in the background with progress and cancel, then Reveal in Finder. Bigger Macs render with more parallel workers.                                                                                                                                                                                                                                                                                                                                                            |
| F12 | **Inspiration**          | Ready-made ideas (titles, captions, transitions, social cards) with previews; one click puts the idea in the chat for you to finish.                                                                                                                                                                                                                                                                                                                                                                     |
| F13 | **Voice**                | Talk to Luca hands-free or dictate, with live speech-to-text; nothing reaches Luca until you approve it. Voice mode: press ↩ or ⌘↩, click Send, or just say “send it” (“scratch that” drops it), and replies are read aloud. Dictation: press ↩ when you're done, then approve the card with ⌘↩ or Send.                                                                                                                                                                                                 |
| F14 | **Keyboard**             | `/` to type to Luca, `?` for every shortcut, ⌘K for commands. A notification tells you when Luca finishes or needs your OK while you're in another app.                                                                                                                                                                                                                                                                                                                                                  |

## Screenshots

| Empty state                                      | Dark mode (toolbar toggle, View → Appearance, ⇧⌘D) |
| ------------------------------------------------ | -------------------------------------------------- |
| ![Empty state](docs/screenshots/empty-state.png) | ![Editor, dark](docs/screenshots/editor-dark.png)  |

| Timeline with a selected clip                                      | Chat                               |
| ------------------------------------------------------------------ | ---------------------------------- |
| ![Timeline, selected clip](docs/screenshots/timeline-selected.png) | ![Chat](docs/screenshots/chat.png) |

| Catalog                                  | Looks                                | Transcript                                     |
| ---------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| ![Catalog](docs/screenshots/catalog.png) | ![Looks](docs/screenshots/looks.png) | ![Transcript](docs/screenshots/transcript.png) |

| Export sheet                                       |
| -------------------------------------------------- |
| ![Export sheet](docs/screenshots/export-sheet.png) |

## Download

Grab the latest `luca-<version>-arm64.dmg` from [Releases](https://github.com/fozagtx/Luca/releases) (Apple silicon, macOS 13+).

The build is not signed or notarized. The first time, right-click `Luca.app` → **Open** (or allow it under System Settings → Privacy & Security). Luca still needs `ffmpeg`, `git` and the `claude` CLI on your PATH (see below).

## Run from source

Prerequisites:

- Node 22+, ffmpeg, git (`brew install node ffmpeg git`)
- Claude Code: `npm install -g @anthropic-ai/claude-code`, then `claude` → `/login` with your Claude subscription. Luca never stores your credentials.
- HyperFrames browser: `npx hyperframes browser ensure`
- Optional: an [AssemblyAI](https://www.assemblyai.com/) API key for Clean edit and voice input — entered in the Transcript tab (or when you first click the mic) and kept in the macOS Keychain via Electron `safeStorage`.
- Optional: a free [Pexels](https://www.pexels.com/api/) API key for backgrounds — entered in the Backgrounds tab (⌘4) or the start card's Background picker, checked with Pexels and kept the same way. For development you can instead set `PEXELS_API_KEY` in the environment, or `MAIN_VITE_PEXELS_API_KEY` in a git-ignored `.env` to build a key into the app (anyone with the build can read it).

```bash
npm install
npm run dev        # launch the app
npm run typecheck && npm run lint
npm run dist       # unsigned .dmg + .zip in dist/
```

## How it works (for developers)

The app itself never names the tools below; they are here for people building Luca from source.

- **HyperFrames HTML is the composition.** `index.html` plus `compositions/*.html` are the single source of truth for the timeline; Luca reads them through the `hyperframes` CLI and never invents a second format. Sources stay immutable in `media/`.
- **Electron main owns side effects**: a loopback HTTP server (Range requests, per-session cookie token — never `file://`) serves the project to the preview; a file watcher hot-reloads and re-seeks; `ffmpeg` and the HyperFrames CLI run as subprocesses.
- **Claude Code via the Agent SDK.** The stock `claude` binary runs in the project directory with a Luca MCP server (`catalog_search` over HyperFrames + Remocn, the remocn tools, `captions_apply` for Caption Studio's captions and `font_add` for Google Fonts) and permission callbacks that surface as approval cards in chat.
- **Catalog data.** The HyperFrames catalog comes from `hyperframes catalog --json` and the Remocn index from remocn.dev, cached daily; copies bundled in `src/main/catalog/` keep both available offline. Search and categories live in `src/shared/catalog.ts`, shared by the Catalog tab and the agent.
- **Backgrounds** come from the Pexels API, called only from main (`src/main/pexels.ts`) so the key never reaches the renderer. Luca's MCP server adds `background_search` (the best photos and short videos, with small previews Luca looks at before choosing) and `background_add`, which downloads the pick into `media/backgrounds/` sized for the composition (photos cropped to the frame, videos as the smallest MP4 that fills it) and credits it in `media/backgrounds/CREDITS.txt`. The agent is told to use these instead of plain gradients.
- **Git is the version store.** Each agent turn or manual edit becomes a commit; History restores any checkpoint.
- **Voice** is AssemblyAI streaming speech-to-text with the Universal-3.5 Pro model (`universal-3-5-pro`) over WebSocket. The renderer captures the mic in an AudioWorklet (16 kHz PCM, 50 ms chunks) and streams it over IPC to main, which holds the socket, so the key never reaches the renderer. Dictation and voice mode both put what was said in the request queue (`src/renderer/stores/queue.ts`) for approval; approved requests go to Luca one at a time when it is free, and in voice mode the reply is read aloud sentence by sentence with the system voice (`src/renderer/lib/speech.ts` is the seam to bring your own TTS).
- **Export** runs `@hyperframes/producer` in an Electron `utilityProcess` (parallel workers sized to the Mac, VideoToolbox) and writes `renders/<name>-<date>.mp4`.
- **UI**: React 19, TypeScript, Tailwind v4, shadcn Base UI, three resizable panes (Inspiration/Catalog/Transcript/Looks · Preview/Timeline · Chat). Chat patterns (shimmering status text, steps, prompt input, suggestions, scroll button) are adapted from [prompt-kit](https://www.prompt-kit.com/) (MIT).

**Coming soon:** Higgsfield, to find and generate media right from chat.

## License

MIT © fozagtx. HyperFrames, Remotion and Remocn are subject to their own licenses.
