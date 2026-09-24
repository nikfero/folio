// Focus mode's editor part: keeps the sentence or paragraph being written bright,
// fades the rest, and (typewriter scrolling) holds the cursor line mid-screen.

import { EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export type FocusHighlight = "sentence" | "paragraph" | "off";

export interface FocusOptions {
  highlight: FocusHighlight;
  typewriter: boolean;
}

const current = Decoration.line({ class: "cm-focus-current" });
const faded = Decoration.mark({ class: "cm-focus-faded" });

/** A line that starts a block of its own: list item, heading, quote, table row, fence. */
const blockStart = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~)/;
/** Units where sentences mean nothing: code, tables. */
const noSentences = /^\s*(?:```|~~~|\||    )/;

/** Line range of the unit around `line`: a paragraph, a list item, a heading. */
function unitAround(doc: Text, line: number): { from: number; to: number } {
  const blank = (n: number) => doc.line(n).text.trim() === "";
  if (blank(line)) return { from: line, to: line };
  const text = (n: number) => doc.line(n).text;
  let from = line;
  while (from > 1 && !blank(from - 1) && !blockStart.test(text(from))) from--;
  let to = line;
  while (to < doc.lines && !blank(to + 1) && !blockStart.test(text(to + 1))) to++;
  if (/^\s*#{1,6}\s/.test(text(from))) to = from;
  return { from, to };
}

/** Offsets (relative to `text`) of the sentence containing `at`. */
function sentenceAround(text: string, at: number): { from: number; to: number } {
  const ends = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
  let start = 0;
  for (let m; (m = ends.exec(text)); ) {
    const end = m.index + m[0].length;
    if (at <= end) return { from: start, to: end };
    start = end;
    while (start < text.length && /\s/.test(text[start])) start++;
  }
  return { from: start, to: text.length };
}

function decorate(view: EditorView, highlight: FocusHighlight): DecorationSet {
  const { doc, selection } = view.state;
  const head = selection.main.head;
  const unit = unitAround(doc, doc.lineAt(head).number);
  const out: Range<Decoration>[] = [];
  for (let n = unit.from; n <= unit.to; n++) out.push(current.range(doc.line(n).from));
  const from = doc.line(unit.from).from;
  const to = doc.line(unit.to).to;
  if (highlight === "sentence" && !noSentences.test(doc.line(unit.from).text) && to > from) {
    const s = sentenceAround(doc.sliceString(from, to), head - from);
    if (s.from > 0) out.push(faded.range(from, from + s.from));
    if (from + s.to < to) out.push(faded.range(from + s.to, to));
  }
  return Decoration.set(out, true);
}

function highlighter(highlight: FocusHighlight): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorate(view, highlight);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.selectionSet) this.decorations = decorate(u.view, highlight);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.editorAttributes.of({ class: "cm-focus-dim" }),
  ];
}

/** Scrolls typing and keyboard moves so the cursor line stays in the middle; clicks don't scroll. */
const typewriter: Extension = [
  EditorState.transactionExtender.of((tr) => {
    if (!tr.docChanged && !tr.selection) return null;
    if (!["input", "delete", "select", "undo", "redo", "move"].some((e) => tr.isUserEvent(e))) return null;
    if (tr.isUserEvent("select.pointer")) return null;
    return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) };
  }),
  EditorView.editorAttributes.of({ class: "cm-typewriter" }),
];

export function focusExtension(opts: FocusOptions): Extension {
  return [opts.highlight === "off" ? [] : highlighter(opts.highlight), opts.typewriter ? typewriter : []];
}
