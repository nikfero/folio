// Focus mode's editor part: dims every paragraph except the one being written.

import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const current = Decoration.line({ class: "cm-focus-current" });

/** Marks the lines of the paragraph (run of non-blank lines) around the cursor. */
function paragraph(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const head = doc.lineAt(view.state.selection.main.head).number;
  const blank = (n: number) => doc.line(n).text.trim() === "";
  let from = head;
  let to = head;
  if (!blank(head)) {
    while (from > 1 && !blank(from - 1)) from--;
    while (to < doc.lines && !blank(to + 1)) to++;
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (let n = from; n <= to; n++) builder.add(doc.line(n).from, doc.line(n).from, current);
  return builder.finish();
}

export function focusDimming(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = paragraph(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.selectionSet) this.decorations = paragraph(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.editorAttributes.of({ class: "cm-focus-dim" }),
  ];
}
