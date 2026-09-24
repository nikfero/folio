// Markdown editing commands: inline formatting, links, and tables.

import { EditorSelection, type EditorState } from "@codemirror/state";
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

type Align = "" | "l" | "c" | "r";

interface Table {
  /** First and last line numbers. */
  from: number;
  to: number;
  indent: string;
  /** Header row first, then the body rows (the delimiter row is `align`). */
  rows: string[][];
  align: Align[];
}

/** The table under `pos`, and the cursor's cell in it (row 0 is the header; the delimiter row counts as the header). */
function readTable(state: EditorState, pos: number): { table: Table; row: number; col: number; offset: number } | null {
  const range = tableAt(state, pos);
  if (!range) return null;
  const doc = state.doc;
  const lines: string[] = [];
  for (let n = range.from; n <= range.to; n++) lines.push(doc.line(n).text);
  const parsed = lines.map(splitRow);
  const cols = Math.max(...parsed.map((r) => r.length));
  const align = Array.from({ length: cols }, (_, i): Align => {
    const c = parsed[1][i] ?? "";
    return c.startsWith(":") && c.endsWith(":") ? "c" : c.endsWith(":") ? "r" : c.startsWith(":") ? "l" : "";
  });
  const rows = [parsed[0], ...parsed.slice(2)].map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
  const line = doc.lineAt(pos);
  const index = line.number - range.from;
  const cell = cellAt(line.text, pos - line.from);
  return {
    table: { from: range.from, to: range.to, indent: /^\s*/.exec(lines[0])![0], rows, align },
    row: index <= 1 ? 0 : index - 1,
    col: Math.min(cell.index, cols - 1),
    offset: cell.offset,
  };
}

/** Which cell of a table row `offset` falls in, and how far into the cell's text. */
function cellAt(line: string, offset: number): { index: number; offset: number } {
  let index = 0;
  let cellStart = 0;
  let inCode = false;
  const lead = line.length - line.trimStart().length;
  const leadingPipe = line[lead] === "|";
  for (let i = 0; i < offset && i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") i++;
    else if (ch === "`") inCode = !inCode;
    else if (ch === "|" && !inCode) {
      if (!(leadingPipe && i === lead)) index++;
      cellStart = i + 1;
    }
  }
  const text = line.slice(cellStart, offset);
  return { index, offset: text.trimStart().length };
}

/** Writes `table` back, columns aligned, with the cursor in cell (`row`, `col`). */
function writeTable(view: EditorView, table: Table, row: number, col: number, offset = 0): void {
  const { rows, align, indent } = table;
  const cols = align.length;
  const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...rows.map((r) => width(r[i] ?? ""))));
  const pad = (s: string, w: number, a: Align) => {
    const gap = w - width(s);
    if (a === "r") return " ".repeat(gap) + s;
    if (a === "c") return " ".repeat(Math.floor(gap / 2)) + s + " ".repeat(Math.ceil(gap / 2));
    return s + " ".repeat(gap);
  };
  const line = (cells: string[]) => `${indent}| ${cells.join(" | ")} |`;
  const delimiter = align.map((a, i) => {
    const dashes = "-".repeat(widths[i] - (a === "c" ? 2 : a ? 1 : 0));
    return a === "c" ? `:${dashes}:` : a === "r" ? `${dashes}:` : a === "l" ? `:${dashes}` : dashes;
  });
  const out = [line(rows[0].map((c, i) => pad(c, widths[i], align[i]))), line(delimiter)];
  for (const r of rows.slice(1)) out.push(line(r.map((c, i) => pad(c, widths[i], align[i]))));

  const doc = view.state.doc;
  const from = doc.line(table.from).from;
  const to = doc.line(table.to).to;
  const insert = out.join("\n");
  // Cursor: start of the cell's text (after right / centre padding), plus `offset`.
  const r = Math.max(0, Math.min(row, rows.length - 1));
  const c = Math.max(0, Math.min(col, cols - 1));
  const lineIndex = r === 0 ? 0 : r + 1;
  const lineStart = from + out.slice(0, lineIndex).reduce((n, l) => n + l.length + 1, 0);
  const cellStart = indent.length + 2 + widths.slice(0, c).reduce((n, w) => n + w + 3, 0);
  const text = rows[r][c] ?? "";
  const padBefore = pad(text, widths[c], align[c]).length - pad(text, widths[c], align[c]).trimStart().length;
  const anchor = lineStart + cellStart + (text ? padBefore : 0) + Math.min(offset, text.length);
  view.dispatch({
    changes: insert === doc.sliceString(from, to) ? undefined : { from, to, insert },
    selection: { anchor },
    userEvent: "input.format",
    scrollIntoView: true,
  });
  view.focus();
}

/** Aligns the columns of the Markdown table under the cursor. */
export function formatTable(view: EditorView): boolean {
  const t = readTable(view.state, view.state.selection.main.head);
  if (!t) return false;
  writeTable(view, t.table, t.row, t.col, t.offset);
  return true;
}

export type TableAction =
  | "row-above"
  | "row-below"
  | "row-delete"
  | "row-up"
  | "row-down"
  | "col-left"
  | "col-right"
  | "col-delete"
  | "col-move-left"
  | "col-move-right"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-none";

/** Which table actions make sense at the cursor (e.g. the header row can't be deleted). */
export function tableActions(state: EditorState, pos: number): Set<TableAction> | null {
  const t = readTable(state, pos);
  if (!t) return null;
  const { rows, align } = t.table;
  const ok = new Set<TableAction>(["row-below", "col-left", "col-right", "align-left", "align-center", "align-right", "align-none"]);
  if (t.row > 0) ok.add("row-above").add("row-delete");
  if (t.row > 1) ok.add("row-up");
  if (t.row > 0 && t.row < rows.length - 1) ok.add("row-down");
  if (align.length > 1) ok.add("col-delete");
  if (t.col > 0) ok.add("col-move-left");
  if (t.col < align.length - 1) ok.add("col-move-right");
  return ok;
}

/** Edits the table under the cursor: adds, removes or moves rows and columns, or sets a column's alignment. */
export function editTable(view: EditorView, action: TableAction): boolean {
  const t = readTable(view.state, view.state.selection.main.head);
  if (!t || !tableActions(view.state, view.state.selection.main.head)?.has(action)) return false;
  const { table } = t;
  let { row, col } = t;
  const rows = table.rows;
  const cols = table.align.length;
  const swap = <T>(list: T[], a: number, b: number) => ([list[a], list[b]] = [list[b], list[a]]);
  switch (action) {
    case "row-above":
      rows.splice(row, 0, Array(cols).fill(""));
      break;
    case "row-below":
      rows.splice(row + 1, 0, Array(cols).fill(""));
      row++;
      break;
    case "row-delete":
      rows.splice(row, 1);
      row = Math.min(row, rows.length - 1);
      break;
    case "row-up":
      swap(rows, row, row - 1);
      row--;
      break;
    case "row-down":
      swap(rows, row, row + 1);
      row++;
      break;
    case "col-left":
    case "col-right": {
      const at = action === "col-left" ? col : col + 1;
      for (const r of rows) r.splice(at, 0, "");
      table.align.splice(at, 0, "");
      col = at;
      break;
    }
    case "col-delete":
      for (const r of rows) r.splice(col, 1);
      table.align.splice(col, 1);
      col = Math.min(col, cols - 2);
      break;
    case "col-move-left":
    case "col-move-right": {
      const to = action === "col-move-left" ? col - 1 : col + 1;
      for (const r of rows) swap(r, col, to);
      swap(table.align, col, to);
      col = to;
      break;
    }
    default:
      table.align[col] = ({ "align-left": "l", "align-center": "c", "align-right": "r", "align-none": "" } as const)[action];
  }
  writeTable(view, table, row, col);
  return true;
}

/** Inserts an empty table (a header and two rows, three columns) at the cursor, on its own lines. */
export function insertTable(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const before = line.text.trim() ? (pos === line.from ? "" : "\n\n") : "";
  const after = line.text.slice(pos - line.from).trim() ? "\n\n" : "\n";
  const table = [
    "| Column 1 | Column 2 | Column 3 |",
    "| -------- | -------- | -------- |",
    "|          |          |          |",
    "|          |          |          |",
  ].join("\n");
  const insert = before + table + after;
  const header = pos + before.length + 2;
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: header, head: header + "Column 1".length },
    userEvent: "input.format",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}
