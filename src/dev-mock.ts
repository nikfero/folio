// Browser-only stand-in for the Tauri backend, used by `npm run dev` outside the app.
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";

const SAMPLE = `---
title: Folio sample
tags: markdown, demo
---

# Folio sample document

Folio renders **GitHub-flavored Markdown** with _live preview_, ~~no clutter~~ and [links](guide.md#usage).

## Task list

- [x] Render Markdown
- [ ] Tick me in the preview
- [ ] Nested
  - [ ] child task

## Table

| Feature | Status |
|:--------|-------:|
| Tabs    | ✅ |
| Math    | ✅ |

## Code

\`\`\`ts
function greet(name: string): string {
  return \`Hello, \${name}!\`; // comment
}
\`\`\`

## Math

Inline $e^{i\\pi} + 1 = 0$ and a costs $5 and $6 example.

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Diagram

\`\`\`mermaid
graph LR
  A[Open] --> B{Edit?}
  B -- yes --> C[Split view]
  B -- no --> D[Read view]
\`\`\`

## Quote & footnote

> Simplicity is prerequisite for reliability.[^1]

[^1]: Edsger W. Dijkstra.

<details><summary>HTML details</summary>

Hidden content with <kbd>Ctrl</kbd>+<kbd>S</kbd>.

</details>
${Array.from({ length: 12 }, (_, i) => `\n## Section ${i + 1}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n`).join("")}`;

const files = new Map<string, { text: string; mtime: number }>([
  ["C:\\docs\\README.md", { text: SAMPLE, mtime: 1 }],
  ["C:\\docs\\guides\\setup.md", { text: "# Setup\n\nInstall Folio and open a folder.\n", mtime: 1 }],
  ["C:\\docs\\guides\\advanced\\tips.md", { text: "# Tips\n\nPress **Ctrl+P** to jump to any file.\n", mtime: 1 }],
  ["C:\\docs\\notes\\ideas.md", { text: "# Ideas\n\n- [ ] Folder sidebar\n", mtime: 1 }],
  ["C:\\docs\\guide.md", { text: "# Guide\n\n## Usage\n\nOpen a file with **Ctrl+O**.\n\n[Back to README](README.md)\n", mtime: 1 }],
]);

let clipboard = "";
const emptyDirs = new Set<string>();
const under = (p: string, dir: string) => p.toLowerCase().startsWith(dir.toLowerCase().replace(/[\\/]+$/, "") + "\\");

export function installMock(): void {
  mockWindows("main");
  // Recovery files survive a page reload, which stands in for a crash and restart.
  const previous = JSON.parse(localStorage.getItem("mock.recovery") ?? "{}") as Record<string, string>;
  const recovery = { previous, now: { ...previous } };
  mockConvertFileSrc("windows");
  mockIPC(
    (cmd, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "read_text": {
          const f = files.get(args.path as string);
          if (!f) throw new Error("file not found");
          return { text: f.text, bom: false, mtime: f.mtime };
        }
        case "write_text": {
          const mtime = Date.now();
          files.set(args.path as string, { text: args.text as string, mtime });
          return mtime;
        }
        case "file_mtime":
          return files.get(args.path as string)?.mtime ?? null;
        case "frontend_ready":
          return [{ path: "C:\\docs\\README.md", content: null }];
        case "plugin:dialog|open":
          return (args as { options?: { directory?: boolean } }).options?.directory ? "C:\\docs" : ["C:\\docs\\guide.md"];
        case "list_folder": {
          const root = String(args.root).replace(/[\\/]+$/, "") + "\\";
          const entries = [...files.keys()]
            .filter((p) => p.toLowerCase().startsWith(root.toLowerCase()) && /\.md$/i.test(p))
            .sort()
            .map((p) => ({ path: p, rel: p.slice(root.length).replace(/\\/g, "/") }));
          const dirs = [...emptyDirs]
            .filter((d) => d.toLowerCase().startsWith(root.toLowerCase()) && ![...files.keys()].some((f) => under(f, d)))
            .map((d) => d.slice(root.length).replace(/\\/g, "/"));
          return { files: entries, dirs, truncated: false };
        }
        case "search_folder": {
          const root = String(args.root).replace(/[\\/]+$/, "") + "\\";
          const q = String(args.query);
          const flags = args.caseSensitive ? "g" : "gi";
          let re: RegExp;
          try {
            re = new RegExp(args.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
          } catch (e) {
            throw new Error(`Invalid regular expression: ${e}`);
          }
          let total = 0;
          const out: { path: string; rel: string; matches: unknown[] }[] = [];
          for (const [path, f] of files) {
            if (!path.toLowerCase().startsWith(root.toLowerCase())) continue;
            const matches: { line: number; col: number; len: number; text: string }[] = [];
            f.text.split(/\r?\n/).forEach((text, i) => {
              for (const m of text.matchAll(re)) if (m[0]) matches.push({ line: i + 1, col: m.index!, len: m[0].length, text });
            });
            total += matches.length;
            if (matches.length) out.push({ path, rel: path.slice(root.length).replace(/\\/g, "/"), matches });
          }
          return { files: out, total, truncated: false };
        }
        case "create_file": {
          const path = String(args.path);
          if (files.has(path)) throw new Error("File exists");
          files.set(path, { text: "", mtime: Date.now() });
          return null;
        }
        case "create_dir":
          emptyDirs.add(String(args.path));
          return null;
        case "rename_path": {
          const from = String(args.from);
          const to = String(args.to);
          if (files.has(to)) throw new Error("Something with that name already exists.");
          for (const [p, f] of [...files]) {
            if (p === from) {
              files.delete(p);
              files.set(to, f);
            } else if (under(p, from)) {
              files.delete(p);
              files.set(to + p.slice(from.length), f);
            }
          }
          if (emptyDirs.delete(from)) emptyDirs.add(to);
          return null;
        }
        case "trash_path": {
          const path = String(args.path);
          for (const p of [...files.keys()]) if (p === path || under(p, path)) files.delete(p);
          emptyDirs.delete(path);
          return null;
        }
        case "plugin:clipboard-manager|write_text":
          clipboard = String((args as { text?: string }).text ?? "");
          return null;
        case "plugin:clipboard-manager|read_text":
          return clipboard;
        case "save_image":
          return `images/${String(args.fileName)}`;
        case "plugin:dialog|save":
          return "C:\\docs\\new-file.md";
        case "recovery_save":
          recovery.now[args.id as string] = args.data as string;
          localStorage.setItem("mock.recovery", JSON.stringify(recovery.now));
          return null;
        case "recovery_remove":
          delete recovery.now[args.id as string];
          delete recovery.previous[args.id as string];
          localStorage.setItem("mock.recovery", JSON.stringify(recovery.now));
          return null;
        case "recovery_list":
          return Object.values(recovery.previous);
        // Pretend an update exists: window.__mockUpdate = { rid: 1, currentVersion: "0.4.0", version: "0.5.0", rawJson: {} }
        case "plugin:updater|check":
          return (window as unknown as { __mockUpdate?: unknown }).__mockUpdate ?? null;
        case "write_examples": {
          const folder = `${args.dir as string}\\Folio themes`;
          for (const [rel, text] of args.files as [string, string][])
            files.set(`${folder}\\${rel.replace(/\//g, "\\")}`, { text, mtime: Date.now() });
          return folder;
        }
        case "copy_image":
          return `images/${String((args as { source: string }).source).split(/[\\/]/).pop()}`;
        case "plugin:opener|open_url":
          window.open(String((args as { url?: string }).url), "_blank");
          return null;
        default:
          console.debug("[mock] unhandled", cmd, args);
          return null;
      }
    },
    { shouldMockEvents: true },
  );

  // Simulate another program editing a file: __folio.touch("C:\\docs\\README.md", "# changed")
  Object.assign(window, {
    __folio: {
      files,
      touch(path: string, text: string) {
        files.set(path, { text, mtime: Date.now() });
      },
      remove(path: string) {
        files.delete(path);
      },
      emit,
    },
  });
}
