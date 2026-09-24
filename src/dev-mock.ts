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

export function installMock(): void {
  mockWindows("main");
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
            .filter((p) => p.toLowerCase().startsWith(root.toLowerCase()))
            .sort()
            .map((p) => ({ path: p, rel: p.slice(root.length).replace(/\\/g, "/") }));
          return { files: entries, truncated: false };
        }
        case "plugin:dialog|save":
          return "C:\\docs\\new-file.md";
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
