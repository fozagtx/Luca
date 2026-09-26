<h1><img src="docs/logo.png" alt="" width="40" align="top" /> Luca</h1>

A personal macOS video editor where Claude does the editing and HyperFrames HTML is the timeline.

![Luca with a project loaded](docs/screenshots/editor-light.png)

## What it does

|     |                  |                                                                                                                                                |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Projects**     | New project from a video file (drag from Finder or ⌘O); reopen recent projects. Source media is never modified.                                |
| F2  | **Live preview** | Plays the composition in the same Chromium engine that renders the export; hot-reloads within 1 s of any file change and keeps the playhead.   |
| F3  | **Timeline**     | Tracks, clips, captions and audio waveform; playhead, zoom, snapping; drag to move, trim, split.                                               |
| F4  | **Chat**         | Claude Code agent signed in with your own Claude subscription; streams replies and tool activity; approve or deny risky commands; Stop.        |
| F5  | **Grab**         | Hover the preview, click an element or a frame, and a reference chip lands in the chat composer.                                               |
| F6  | **Catalog**      | Grid of all HyperFrames blocks and components with hover previews; search, filter, drag onto the timeline or into chat.                        |
| F7  | **Clean edit**   | AssemblyAI transcript with fillers kept, then an agent-reviewed cut list applied with ffmpeg to produce a clean master with remapped captions. |
| F8  | **Looks**        | Save a project's style (`LOOK.md`, components, catalog items) as a named Look; apply it to a new project in one click.                         |
| F9  | **Versions**     | Every agent turn and manual edit is a git checkpoint: browse history, restore, ⌘Z.                                                             |
| F10 | **Export**       | Render MP4 (Draft or Final) in a background process with progress and cancel, then Reveal in Finder.                                           |
| F11 | **Remocn**       | Browse Remocn's Remotion components beside the HyperFrames catalog; placed components render to transparent WebM clips on the timeline.        |

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
- Optional: an [AssemblyAI](https://www.assemblyai.com/) API key for Clean edit — entered in the Transcript tab and kept in macOS Keychain via Electron `safeStorage`.

```bash
npm install
npm run dev        # launch the app
npm run typecheck && npm run lint
npm run dist       # unsigned .dmg + .zip in dist/
```

## How it works

- **HyperFrames HTML is the composition.** `index.html` plus `compositions/*.html` are the single source of truth for the timeline; Luca reads them through the `hyperframes` CLI and never invents a second format. Sources stay immutable in `media/`.
- **Electron main owns side effects**: a loopback HTTP server (Range requests, per-session cookie token — never `file://`) serves the project to the preview; a file watcher hot-reloads and re-seeks; `ffmpeg` and the HyperFrames CLI run as subprocesses.
- **Claude Code via the Agent SDK.** The stock `claude` binary runs in the project directory with a Luca MCP server (grab, timeline, remocn tools) and permission callbacks that surface as approval cards in chat.
- **Git is the version store.** Each agent turn or manual edit becomes a commit; History restores any checkpoint.
- **Export** runs `@hyperframes/producer` in an Electron `utilityProcess` (2 workers, VideoToolbox) and writes `renders/<name>-<date>.mp4`.
- **UI**: React 19, TypeScript, Tailwind v4, shadcn Base UI, three resizable panes (Files/Catalog/Transcript/Looks · Preview/Timeline · Chat).

## License

MIT © fozagtx. HyperFrames, Remotion and Remocn are subject to their own licenses.
