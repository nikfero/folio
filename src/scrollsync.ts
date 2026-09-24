import { EditorView } from "@codemirror/view";

interface Anchor {
  line: number; // 0-based source line
  top: number; // offset inside the preview scroller
}

/**
 * Maps between editor source lines and preview scroll offsets using the
 * `data-line` attributes on rendered blocks. Offsets are cached and must be
 * invalidated whenever the preview's layout changes.
 */
export class ScrollMap {
  private anchors: Anchor[] | null = null;

  constructor(private scroller: HTMLElement) {}

  invalidate(): void {
    this.anchors = null;
  }

  private build(): Anchor[] {
    if (this.anchors) return this.anchors;
    const base = this.scroller.getBoundingClientRect().top - this.scroller.scrollTop;
    const raw: Anchor[] = [{ line: 0, top: 0 }];
    for (const el of this.scroller.querySelectorAll<HTMLElement>("[data-line]")) {
      if (!el.offsetParent) continue; // hidden (e.g. collapsed <details>)
      raw.push({ line: Number(el.dataset.line), top: el.getBoundingClientRect().top - base });
    }
    raw.sort((a, b) => a.line - b.line || a.top - b.top);
    // Keep anchors monotonic in both line and offset so interpolation is well defined.
    const out: Anchor[] = [];
    for (const a of raw) {
      const last = out[out.length - 1];
      if (last && (a.line <= last.line || a.top < last.top)) continue;
      out.push(a);
    }
    return (this.anchors = out);
  }

  topForLine(line: number): number {
    const a = this.build();
    let i = 0;
    while (i + 1 < a.length && a[i + 1].line <= line) i++;
    const cur = a[i];
    const next = a[i + 1];
    if (!next) return cur.top;
    return cur.top + ((line - cur.line) / (next.line - cur.line)) * (next.top - cur.top);
  }

  lineForTop(top: number): number {
    const a = this.build();
    let i = 0;
    while (i + 1 < a.length && a[i + 1].top <= top) i++;
    const cur = a[i];
    const next = a[i + 1];
    if (!next || next.top === cur.top) return cur.line;
    return cur.line + ((top - cur.top) / (next.top - cur.top)) * (next.line - cur.line);
  }
}

/** Fractional 0-based source line at the top of the editor viewport. */
export function editorTopLine(view: EditorView): number {
  const y = view.scrollDOM.scrollTop - view.documentPadding.top;
  const block = view.lineBlockAtHeight(Math.max(0, y));
  const lineNo = view.state.doc.lineAt(block.from).number;
  const frac = block.height ? Math.min(1, Math.max(0, (y - block.top) / block.height)) : 0;
  return lineNo - 1 + frac;
}

export function scrollEditorToLine(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const lineNo = Math.min(doc.lines, Math.max(1, Math.floor(line) + 1));
  const block = view.lineBlockAt(doc.line(lineNo).from);
  view.scrollDOM.scrollTop = block.top + (line - Math.floor(line)) * block.height + view.documentPadding.top;
}

/**
 * Puts `line` at the top of the editor. Unlike `scrollEditorToLine` this goes
 * through CodeMirror's measure cycle, so it is safe right after the editor
 * becomes visible.
 */
export function revealLine(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const pos = doc.line(Math.min(doc.lines, Math.max(1, Math.floor(line) + 1))).from;
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
}
