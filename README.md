# Folio

A light, fast Markdown viewer and editor for Windows, macOS and Linux, built with [Tauri 2](https://tauri.app).

## Features

- **Read / Split / Edit** modes (<kbd>Ctrl</kbd>+<kbd>E</kbd> cycles) with synced scrolling in Split
- **Tabs** you can reorder by dragging, plus **Move Tab to New Window** and **New Window**
- **Live reload**: files changed by other programs (git, AI agents, other editors) reload automatically; if you have unsaved edits, Folio asks first
- GitHub-flavored Markdown: tables, task lists, footnotes, autolinks, syntax-highlighted code with a copy button
- **Clickable checkboxes** that update (and save) the source file
- **Jump to source**: <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+click in the preview (or double-click in Split) moves the editor to that line
- **Math** (KaTeX) and **Mermaid** diagrams, loaded only when a document uses them
- YAML frontmatter shown as a tidy metadata table
- Outline sidebar that follows your position, Find in the preview, word count and reading time
- Light/dark/system themes and zoom
- **Remembers your session**: open tabs, view mode, scroll position and window size come back on the next launch
- **Settings** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>,</kbd>): default view, auto-save, editor font size, line numbers, line wrapping, preview font and text width
- Native menu bar on macOS; optional on Windows and Linux (off by default, turn it on in Settings)
- Relative links to other `.md` files open in a new tab; relative images just work
- Keeps each file's line endings (LF/CRLF) and BOM exactly as they were
- Opens files from the command line, from drag & drop, and from "Open with" (a single running instance receives them)

## Keyboard shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Open file | Ctrl+O | ⌘O |
| Save / Save As | Ctrl+S / Ctrl+Shift+S | ⌘S / ⌘⇧S |
| New tab / Close tab | Ctrl+T / Ctrl+W | ⌘T / ⌘W |
| New window | Ctrl+Shift+N | ⌘⇧N |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | same |
| Go to tab 1–9 | Ctrl+1…9 | ⌘1…9 |
| Cycle Read / Split / Edit | Ctrl+E | ⌘E |
| Toggle outline | Ctrl+Shift+O | ⌘⇧O |
| Find | Ctrl+F | ⌘F |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 | ⌘= / ⌘- / ⌘0 |
| Settings | Ctrl+, | ⌘, |

## Development

Prerequisites: [Node.js](https://nodejs.org) LTS, [Rust](https://rustup.rs), and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev          # run the desktop app
npm run tauri dev -- -- path/to/file.md   # ...and open a file
npm run dev                # UI only, in a browser, with a fake backend
npm run tauri build        # build an installer for this OS
```

`npm run dev` on its own serves the UI at http://localhost:1420 with an in-memory mock of the backend (`src/dev-mock.ts`), which makes working on the interface quick.

### Project layout

```
src/                 frontend (TypeScript, no framework)
  app.ts             tabs, modes, open/save, reload, shortcuts, window handling
  editor.ts          CodeMirror 6 setup
  markdown.ts        markdown-it setup and plugins (task lists, math, source lines)
  preview.ts         rendering, sanitizing, links, images, lazy math and diagrams
  scrollsync.ts      editor ↔ preview position mapping
  lazy/              KaTeX and Mermaid, loaded on demand
src-tauri/           Rust backend: file I/O, single instance, file hand-off between windows
.github/workflows/   CI and cross-platform release builds
```

## Releases

GitHub Actions builds installers for Windows (`.msi`, `.exe`), macOS (`.dmg` for Apple Silicon and Intel) and Linux (`.deb`, `.rpm`, `.AppImage`) into a draft release. You can start a release from the GitHub website or by pushing a `v*` tag.

See **[docs/RELEASING.md](docs/RELEASING.md)** for step-by-step instructions, troubleshooting, and notes on unsigned builds.
