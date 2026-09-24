# Folio

A light, fast Markdown viewer and editor for Windows, macOS and Linux, built with [Tauri 2](https://tauri.app).

## Features

- **Four views** (<kbd>Ctrl</kbd>+<kbd>E</kbd> cycles):
  - **Read**: the rendered document
  - **Live**: edit with formatting shown in place, including tables, math and Mermaid diagrams; the Markdown syntax appears only where the cursor is, and the file is never rewritten
  - **Split**: editor and preview side by side, scrolling together
  - **Edit**: plain source
- **Tabs** you can reorder by dragging, plus **Move Tab to New Window** and **New Window**
- **Folders**: open a folder (or pass one on the command line, or drop it on the window) to browse its Markdown files in a resizable sidebar; `.git`, `node_modules` and build folders are skipped
- **File actions** in the folder tree: new file, new folder, rename, and move to the Recycle Bin / Trash (never deleted outright)
- **Search in Folder** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>): text or regular expressions, optional case matching, results grouped per file
- **Go to File** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>P</kbd>) with fuzzy search, and a **Command Palette** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, or type `>` in Go to File)
- **Change detection**: when another program (git, an AI agent, another editor) changes an open file, Folio shows a banner with **Reload** / **Ignore**. Automatic reloading can be turned on for all files in Settings, or per file with the **Auto-reload** toggle in the status bar; it never discards unsaved edits
- GitHub-flavored Markdown: tables, task lists, footnotes, autolinks, syntax-highlighted code with a copy button
- **Clickable checkboxes** that update (and save) the source file
- **Editing helpers**: shortcuts for bold, italic, inline code, strikethrough and links; paste a URL over text to link it; paste or drop an image to save it into `images/` next to the document; align table columns
- **Export** a standalone HTML file, or **Print / Save as PDF**. Export options: table of contents (top or sidebar), light / dark / follow-the-reader theme, font, text width, metadata, extra CSS; images and math fonts are embedded so the file works offline
- **Focus mode** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>): only the text in a calm centered column; the current sentence or paragraph stays bright, typewriter scrolling keeps your line mid-screen, and a small bar appears when you move the mouse
- **Full screen**: <kbd>F11</kbd> (<kbd>⌃</kbd>+<kbd>⌘</kbd>+<kbd>F</kbd> on macOS)
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
| Cycle Read / Live / Split / Edit | Ctrl+E | ⌘E |
| Go to file | Ctrl+P | ⌘P |
| Command palette | Ctrl+Shift+P | ⌘⇧P |
| Open folder | Ctrl+Alt+O | ⌘⌥O |
| Search in folder | Ctrl+Shift+F | ⌘⇧F |
| Toggle sidebar | Ctrl+\ | ⌘\ |
| Show outline | Ctrl+Shift+O | ⌘⇧O |
| Find | Ctrl+F | ⌘F |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 | ⌘= / ⌘- / ⌘0 |
| Focus mode | Ctrl+Shift+Enter (Esc exits) | ⌘⇧Enter (Esc exits) |
| Full screen | F11 | ⌃⌘F |
| Settings | Ctrl+, | ⌘, |

In the editor:

| Action | Windows / Linux | macOS |
|---|---|---|
| Bold / Italic | Ctrl+B / Ctrl+I | ⌘B / ⌘I |
| Inline code / Strikethrough | Ctrl+\` / Ctrl+Shift+X | ⌘\` / ⌘⇧X |
| Link | Ctrl+K | ⌘K |
| Align table columns | Shift+Alt+F | ⇧⌥F |

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
  app.ts             tabs, modes, open/save, reload, commands, shortcuts, windows
  editor.ts          CodeMirror 6 setup
  editing.ts         formatting commands and table alignment
  livepreview.ts     Live mode (Markdown rendered inside the editor)
  liveblocks.ts      Live mode tables, math and diagrams
  focus.ts           focus mode paragraph dimming
  markdown.ts        markdown-it setup and plugins (task lists, math, source lines)
  preview.ts         rendering, sanitizing, links, images, lazy math and diagrams
  filetree.ts        folder tree in the sidebar
  search.ts          Search in Folder panel
  palette.ts         Go to File / command palette
  export.ts          standalone HTML export
  export-options.ts  export options dialog
  scrollsync.ts      editor <-> preview position mapping
  lazy/              KaTeX and Mermaid, loaded on demand
src-tauri/           Rust backend: file I/O, folder listing and search, file
                     actions, image saving, menus, single instance, windows
.github/workflows/   CI and cross-platform release builds
```

## Releases

GitHub Actions builds installers for Windows (`.msi`, `.exe`), macOS (`.dmg` for Apple Silicon and Intel) and Linux (`.deb`, `.rpm`, `.AppImage`) into a draft release. You can start a release from the GitHub website or by pushing a `v*` tag.

See **[docs/RELEASING.md](docs/RELEASING.md)** for step-by-step instructions, troubleshooting, and notes on unsigned builds.
