// Live mode, part 2: tables, math and Mermaid diagrams rendered in place.
// Multi-line blocks must be replaced from a StateField (view plugins can't
// hide line breaks); inline math uses a view plugin like the other marks.

import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { renderMarkdown } from "./markdown";
import { sanitize } from "./preview";

type MathModule = typeof import("./lazy/math");
type MermaidModule = typeof import("./lazy/mermaid");
let mathModule: Promise<MathModule> | null = null;
let mermaidModule: Promise<MermaidModule> | null = null;
const loadMath = () => (mathModule ??= import("./lazy/math"));
const loadMermaid = () => (mermaidModule ??= import("./lazy/mermaid"));
const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** Clicking a rendered block puts the cursor into its source, which reveals it. */
abstract class BlockWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof BlockWidget && other.constructor === this.constructor && other.source === this.source;
  }
  protected wrap(view: EditorView, cls: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `cm-live-block markdown-body ${cls}`;
    el.title = "Click to edit";
    el.addEventListener("mousedown", (e) => {
      if ((e.target as Element).closest("a")) return;
      e.preventDefault();
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class TableWidget extends BlockWidget {
  toDOM(view: EditorView) {
    const el = this.wrap(view, "cm-live-table");
    el.innerHTML = sanitize(renderMarkdown(this.source).html);
    return el;
  }
  get estimatedHeight() {
    return this.source.split("\n").length * 34;
  }
}

class MathBlockWidget extends BlockWidget {
  toDOM(view: EditorView) {
    const el = this.wrap(view, "cm-live-math");
    const target = document.createElement("div");
    target.className = "math display";
    target.textContent = this.source;
    el.appendChild(target);
    void loadMath().then((m) => m.renderTex(target, this.source, true));
    return el;
  }
}

class MermaidWidget extends BlockWidget {
  toDOM(view: EditorView) {
    const el = this.wrap(view, "cm-live-mermaid");
    const target = document.createElement("div");
    target.className = "mermaid";
    target.textContent = this.source;
    el.appendChild(target);
    const t = theme();
    void loadMermaid()
      .then((m) => m.mermaidSvg(this.source, t))
      .then((svg) => {
        target.innerHTML = svg;
        target.dataset.rendered = "";
      })
      .catch((e) => {
        target.classList.add("mermaid-error");
        target.textContent = `Mermaid error: ${e instanceof Error ? e.message : String(e)}`;
      });
    return el;
  }
  get estimatedHeight() {
    return 240;
  }
  // Re-render when the theme changes, since diagram colours depend on it.
  eq(other: WidgetType) {
    return super.eq(other) && (other as MermaidWidget).themeAtCreation === this.themeAtCreation;
  }
  readonly themeAtCreation = theme();
}

interface Block {
  from: number;
  to: number;
  widget: WidgetType;
}

const MATH_LANGS = new Set(["math", "katex", "latex"]);

/** Finds tables, fenced math/Mermaid blocks and $$ … $$ blocks in the whole document. */
function findBlocks(state: EditorState): Block[] {
  const doc = state.doc;
  const blocks: Block[] = [];
  const tree = syntaxTree(state);
  const lineSpan = (from: number, to: number) => ({ from: doc.lineAt(from).from, to: doc.lineAt(to).to });

  tree.iterate({
    enter: (node) => {
      if (node.name === "Table") {
        const span = lineSpan(node.from, node.to);
        blocks.push({ ...span, widget: new TableWidget(doc.sliceString(span.from, span.to)) });
        return false;
      }
      if (node.name === "FencedCode") {
        const info = node.node.getChild("CodeInfo");
        const lang = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : "";
        if (lang !== "mermaid" && !MATH_LANGS.has(lang)) return false;
        const text = node.node.getChild("CodeText");
        const source = text ? doc.sliceString(text.from, text.to) : "";
        const span = lineSpan(node.from, node.to);
        // Only replace a closed fence; an unfinished one keeps showing its source.
        if (!/^\s*(`{3,}|~{3,})\s*$/.test(doc.lineAt(node.to).text) || doc.lineAt(node.to).number === doc.lineAt(node.from).number)
          return false;
        blocks.push({ ...span, widget: lang === "mermaid" ? new MermaidWidget(source) : new MathBlockWidget(source) });
        return false;
      }
      return !["FencedCode", "CodeBlock", "HTMLBlock"].includes(node.name);
    },
  });

  // $$ … $$ display math (not part of the Markdown grammar the editor uses).
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const t = line.text.trim();
    if (!t.startsWith("$$")) continue;
    const inside = tree.resolveInner(line.from, 1);
    if (/Code|HTML/.test(inside.name) || /Code/.test(inside.parent?.name ?? "")) continue;
    if (t.length > 4 && t.endsWith("$$")) {
      blocks.push({ from: line.from, to: line.to, widget: new MathBlockWidget(t.slice(2, -2).trim()) });
      continue;
    }
    for (let m = n + 1; m <= doc.lines; m++) {
      const end = doc.line(m).text.trim();
      if (!end.endsWith("$$")) continue;
      const source = [t.slice(2), doc.sliceString(doc.line(n + 1).from, doc.line(m).from), end.slice(0, -2)]
        .join("\n")
        .trim();
      blocks.push({ from: line.from, to: doc.line(m).to, widget: new MathBlockWidget(source) });
      n = m;
      break;
    }
  }
  return blocks.sort((a, b) => a.from - b.from);
}

function blockDecorations(state: EditorState): DecorationSet {
  const touches = (from: number, to: number) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const b of findBlocks(state)) {
    if (b.from <= last || touches(b.from, b.to)) continue;
    builder.add(b.from, b.to, Decoration.replace({ widget: b.widget, block: true }));
    last = b.to;
  }
  return builder.finish();
}

/** Re-renders live blocks, e.g. after a theme change (diagram colours depend on it). */
const refreshEffect = StateEffect.define<null>();
export function refreshLiveBlocks(view: EditorView): void {
  view.dispatch({ effects: refreshEffect.of(null) });
}

const blocksField = StateField.define<DecorationSet>({
  create: blockDecorations,
  update(value, tr) {
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    const refresh = tr.effects.some((e) => e.is(refreshEffect));
    return tr.docChanged || tr.selection || treeChanged || refresh ? blockDecorations(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------- inline math

class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  eq(other: InlineMathWidget) {
    return other.tex === this.tex;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "math cm-live-inline-math";
    el.textContent = this.tex;
    void loadMath().then((m) => m.renderTex(el, this.tex, false));
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

// Same rules as the preview: no space just inside the dollars, no digit right after
// the closing one (so "costs $5 and $6" stays text), and "\$" is a literal dollar.
const INLINE_MATH = /(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![\d$])/g;

function inlineMath(view: EditorView): DecorationSet {
  const { state } = view;
  const tree = syntaxTree(state);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    for (const m of text.matchAll(INLINE_MATH)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      const node = tree.resolveInner(start, 1);
      if (/Code|HTML|URL/.test(node.name) || /Code/.test(node.parent?.name ?? "")) continue;
      if (state.selection.ranges.some((r) => r.from <= end && r.to >= start)) continue;
      builder.add(start, end, Decoration.replace({ widget: new InlineMathWidget(m[1]) }));
    }
  }
  return builder.finish();
}

const inlineMathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = inlineMath(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = inlineMath(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Rendered tables, math and diagrams for Live mode. */
export function liveBlocks(): Extension {
  return [blocksField, inlineMathPlugin];
}
