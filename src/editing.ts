// Markdown editing commands: inline formatting, links, and table formatting.

import { EditorSelection, type ChangeSpec, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Toggles an inline marker (`**`, `*`, `` ` ``, `~~`) around every selection.
 * An empty selection inserts the pair with the cursor in between; a selection
 * that is already wrapped (inside or just outside) is unwrapped.
 */
export function toggleInline(view: EditorView, marker: string): boolean {
  const { state } = view;
  const m = marker.length;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const before = state.sliceDoc(range.from - m, range.from);
    const after = state.sliceDoc(range.to, range.to + m);
    // For "*", make sure the surrounding marker isn't half of "**" (bold).
    const lone = (pos: number) => marker !== "*" || state.sliceDoc(pos - 1, pos) !== "*";
    if (before === marker && after === marker && lone(range.from - m) && lone(range.to + m + 1)) {
      return {
        changes: [
          { from: range.from - m, to: range.from },
          { from: range.to, to: range.to + m },
        ],
        range: EditorSelection.range(range.from - m, range.to - m),
      };
    }
    if (text.length >= 2 * m && text.startsWith(marker) && text.endsWith(marker)) {
      return {
        changes: { from: range.from, to: range.to, insert: text.slice(m, -m) },
        range: EditorSelection.range(range.from, range.to - 2 * m),
      };
    }
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: EditorSelection.range(range.from + m, range.to + m),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

const URL_RE = /^(https?:\/\/|mailto:|www\.)\S+$/i;

/**
 * Turns the selection into a link. A selected URL becomes `[](url)` with the
 * cursor in the text; selected text becomes `[text](…)` with the cursor in the
 * URL (pre-filled from the clipboard when it holds one).
 */
export function insertLink(view: EditorView, clipboard = ""): boolean {
  const { state } = view;
  const clipUrl = URL_RE.test(clipboard.trim()) ? clipboard.trim() : "";
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (URL_RE.test(text)) {
      const insert = `[](${text})`;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}](${clipUrl})`;
    const urlStart = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text
        ? EditorSelection.range(urlStart, urlStart + clipUrl.length)
        : EditorSelection.cursor(range.from + 1),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

// ---------------------------------------------------------------- tables

const DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cell += "\\|";
      i++;
    } else if (ch === "`") {
      inCode = !inCode;
      cell += ch;
    } else if (ch === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** Display width, counting wide (CJK, emoji) characters as two columns. */
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  return w;
}

/** The line range of the table around `pos`, or null if the cursor isn't in one. */
export function tableAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const doc = state.doc;
  const isRow = (n: number) => n >= 1 && n <= doc.lines && doc.line(n).text.includes("|");
  const line = doc.lineAt(pos).number;
  if (!isRow(line)) return null;
  let start = line;
  let end = line;
  while (isRow(start - 1)) start--;
  while (isRow(end + 1)) end++;
  // A real table has a delimiter row right after its header.
  if (end - start < 1 || !DELIMITER.test(doc.line(start + 1).text)) return null;
  return { from: start, to: end };
}

/** Aligns the columns of the Markdown table under the cursor. */
export function formatTable(view: EditorView): boolean {
  const { state } = view;
  const table = tableAt(state, state.selection.main.head);
  if (!table) return false;
  const doc = state.doc;
  const lines: string[] = [];
  for (let n = table.from; n <= table.to; n++) lines.push(doc.line(n).text);
  const indent = /^\s*/.exec(lines[0])![0];
  const rows = lines.map(splitRow);
  const cols = Math.max(...rows.map((r) => r.length));
  const align = rows[1].map((c) => (c.startsWith(":") && c.endsWith(":") ? "c" : c.endsWith(":") ? "r" : c.startsWith(":") ? "l" : ""));
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(3, ...rows.map((r, ri) => (ri === 1 ? 0 : width(r[i] ?? "")))),
  );
  const pad = (s: string, w: number, a: string) => {
    const gap = w - width(s);
    if (a === "r") return " ".repeat(gap) + s;
    if (a === "c") return " ".repeat(Math.floor(gap / 2)) + s + " ".repeat(Math.ceil(gap / 2));
    return s + " ".repeat(gap);
  };
  const out = rows.map((r, ri) => {
    const cells = Array.from({ length: cols }, (_, i) => {
      if (ri === 1) {
        const a = align[i] ?? "";
        const dashes = "-".repeat(widths[i] - (a === "c" ? 2 : a ? 1 : 0));
        return a === "c" ? `:${dashes}:` : a === "r" ? `${dashes}:` : a === "l" ? `:${dashes}` : dashes;
      }
      return pad(r[i] ?? "", widths[i], align[i] ?? "");
    });
    return `${indent}| ${cells.join(" | ")} |`;
  });
  const from = doc.line(table.from).from;
  const to = doc.line(table.to).to;
  const insert = out.join("\n");
  if (insert === doc.sliceString(from, to)) return true;
  // Keep the cursor on the same row, as close to its column as the new layout allows.
  const head = doc.lineAt(state.selection.main.head);
  const col = state.selection.main.head - head.from;
  const changes: ChangeSpec = { from, to, insert };
  const rowStart = from + out.slice(0, head.number - table.from).reduce((n, l) => n + l.length + 1, 0);
  const rowLength = out[head.number - table.from].length;
  view.dispatch({
    changes,
    selection: { anchor: rowStart + Math.min(col, rowLength) },
    userEvent: "input.format",
    scrollIntoView: true,
  });
  return true;
}
