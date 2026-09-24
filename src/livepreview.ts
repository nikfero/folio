// "Live" mode: the editor renders Markdown formatting in place and reveals the
// syntax only where the cursor is, so the file itself is never rewritten.

import { foldable, foldedRanges, foldEffect, syntaxTree, unfoldEffect } from "@codemirror/language";
import { type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { liveBlocks } from "./liveblocks";
import { CALLOUTS, CALLOUT_MARKER } from "./markdown";

export interface LiveOptions {
  /** Turns an image `src` from the document into a URL the webview can load. */
  resolveImage(src: string): string;
  /** Follows a link (Ctrl/Cmd+click). */
  openLink(href: string): void;
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-live-bullet";
    el.textContent = "•";
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-live-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => e.preventDefault()); // don't move the cursor
    box.addEventListener("click", (e) => {
      e.preventDefault();
      // The marker is "[ ]" / "[x]"; flip the character between the brackets.
      view.dispatch({
        changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" },
        userEvent: "input.toggle-task",
      });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-live-hr";
    return el;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-live-image";
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt;
    return img;
  }
}

/** The icon (and default title) replacing a callout's `[!NOTE]` marker. */
class CalloutWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: CalloutWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-live-callout-label";
    el.textContent = this.label;
    return el;
  }
}

/** The fold arrow in the margin left of a heading (Live mode has no gutter). */
class HeadingFoldWidget extends WidgetType {
  constructor(
    readonly folded: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: HeadingFoldWidget) {
    return other.folded === this.folded && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = this.folded ? "cm-live-fold folded" : "cm-live-fold";
    el.title = this.folded ? "Unfold section" : "Fold section";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({
        effects: (this.folded ? unfoldEffect : foldEffect).of({ from: this.from, to: this.to }),
      });
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const lineClass = (cls: string) => Decoration.line({ class: cls });

/** Inline HTML elements Live mode renders, by tag name → class of the styled text. */
const htmlStyles: Record<string, string> = {
  kbd: "cm-live-kbd",
  b: "cm-live-bold",
  strong: "cm-live-bold",
  i: "cm-live-italic",
  em: "cm-live-italic",
  u: "cm-live-underline",
  ins: "cm-live-underline",
  s: "cm-live-strike",
  del: "cm-live-strike",
  strike: "cm-live-strike",
  mark: "cm-live-highlight",
  sub: "cm-live-sub",
  sup: "cm-live-sup",
  small: "cm-live-small",
  code: "cm-live-code",
  // Tags hidden without extra styling
  span: "",
  abbr: "",
  cite: "",
  dfn: "",
  font: "",
  q: "",
  samp: "",
  var: "",
};

interface HtmlTag {
  from: number;
  to: number;
  name: string;
  closing: boolean;
  /** Start of the enclosing block; tags pair only within one block. */
  block: number;
}

const inlineNodes = /^(Emphasis|StrongEmphasis|Strikethrough|Link|InlineCode|HTMLTag)$/;

/** Parses `<name ...>`, `</name>` or `<name/>`; null for comments and other tags. */
function parseTag(text: string): { name: string; closing: boolean; selfClosing: boolean } | null {
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>$/.exec(text);
  return m ? { name: m[2].toLowerCase(), closing: m[1] === "/", selfClosing: m[3] === "/" } : null;
}

/** Hides matching tag pairs (`<kbd>x</kbd>`) and styles the text between them; `<br>` is hidden. */
function htmlDecorations(
  tags: HtmlTag[],
  touches: (from: number, to: number) => boolean,
  out: Range<Decoration>[],
): void {
  tags.sort((a, b) => a.from - b.from);
  const open = new Map<string, HtmlTag[]>();
  for (const tag of tags) {
    const key = `${tag.block}:${tag.name}`;
    if (!tag.closing) {
      if (!open.has(key)) open.set(key, []);
      open.get(key)!.push(tag);
      continue;
    }
    const start = open.get(key)?.pop();
    if (!start || touches(start.from, tag.to)) continue;
    out.push(hide.range(start.from, start.to), hide.range(tag.from, tag.to));
    const cls = htmlStyles[tag.name];
    if (cls && tag.from > start.to) out.push(Decoration.mark({ class: cls }).range(start.to, tag.from));
  }
}

/** Line numbers touched by any selection range (where block syntax is revealed). */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

function build(view: EditorView, opts: LiveOptions): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const lines = activeLines(state);
  const touches = (from: number, to: number) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const lineActive = (pos: number) => lines.has(doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const htmlTags: HtmlTag[] = [];
  const eachLine = (from: number, to: number, cls: string) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) out.push(lineClass(cls).range(doc.line(n).from));
  };

  // YAML frontmatter isn't Markdown: show it as plain metadata and don't format inside it.
  const fm = /^---[ \t]*\r?\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(doc.sliceString(0, Math.min(doc.length, 20_000)));
  const fmEnd = fm ? fm[0].replace(/\r?\n$/, "").length : 0;
  if (fmEnd) eachLine(0, fmEnd, "cm-live-frontmatter");

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (node.from < fmEnd && name !== "Document") return false;
        const parent = node.node.parent;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          const line = doc.lineAt(node.from);
          out.push(lineClass(`cm-live-h${heading[1]}`).range(line.from));
          let range = foldable(state, line.from, line.to);
          let folded = false;
          foldedRanges(state).between(line.to, line.to, (from, to) => {
            range = { from, to };
            folded = true;
          });
          if (range)
            out.push(Decoration.widget({ widget: new HeadingFoldWidget(folded, range.from, range.to), side: -1 }).range(line.from));
          return;
        }
        switch (name) {
          case "HeaderMark": {
            if (!parent?.name.startsWith("ATXHeading") || lineActive(node.from)) return;
            const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            if (end > node.from) out.push(hide.range(node.from, end));
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
            if (parent && !touches(parent.from, parent.to)) out.push(hide.range(node.from, node.to));
            return;
          case "InlineCode":
            out.push(Decoration.mark({ class: "cm-live-code" }).range(node.from, node.to));
            return;
          case "CodeMark":
            if (parent?.name === "InlineCode" && !touches(parent.from, parent.to)) out.push(hide.range(node.from, node.to));
            return;
          case "Link": {
            if (touches(node.from, node.to)) return;
            const url = node.node.getChild("URL");
            const href = url ? doc.sliceString(url.from, url.to) : "";
            out.push(
              Decoration.mark({ class: "cm-live-link", attributes: { "data-href": href, title: href } }).range(node.from, node.to),
            );
            return;
          }
          case "LinkMark":
          case "URL":
          case "LinkTitle":
            if (parent?.name === "Link" && !touches(parent.from, parent.to)) out.push(hide.range(node.from, node.to));
            return;
          case "Image": {
            if (touches(node.from, node.to)) return false;
            const url = node.node.getChild("URL");
            if (!url) return false;
            const text = doc.sliceString(node.from, node.to);
            const alt = /^!\[([^\]]*)\]/.exec(text)?.[1] ?? "";
            out.push(
              Decoration.replace({ widget: new ImageWidget(opts.resolveImage(doc.sliceString(url.from, url.to)), alt) }).range(
                node.from,
                node.to,
              ),
            );
            return false;
          }
          case "ListMark": {
            if (lineActive(node.from)) return;
            const item = parent;
            const task = item?.getChild("Task");
            const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            // A task item shows only its checkbox; plain bullets become dots.
            if (task) out.push(hide.range(node.from, end));
            else if (item?.parent?.name === "BulletList") out.push(bullet.range(node.from, node.to));
            return;
          }
          case "TaskMarker": {
            if (touches(node.from, node.to)) return;
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to));
            const textFrom = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            if (checked && parent && parent.to > textFrom)
              out.push(Decoration.mark({ class: "cm-live-done" }).range(textFrom, parent.to));
            return;
          }
          case "Blockquote": {
            eachLine(node.from, node.to, "cm-live-quote");
            const first = doc.lineAt(node.from);
            const at = first.text.indexOf("[!");
            const m = at >= 0 && /^\s*(?:>\s?)+$/.test(first.text.slice(0, at)) ? CALLOUT_MARKER.exec(first.text.slice(at)) : null;
            const kind = m && CALLOUTS[m[1].toLowerCase()];
            if (!m || !kind) return;
            eachLine(node.from, node.to, `cm-live-callout cm-live-callout-${kind}`);
            out.push(lineClass("cm-live-callout-title").range(first.from));
            if (!lineActive(node.from)) {
              const title = m[3].trim();
              const end = first.from + first.text.length - m[3].length;
              const label = title ? "" : kind[0].toUpperCase() + kind.slice(1);
              out.push(Decoration.replace({ widget: new CalloutWidget(label) }).range(first.from + at, end));
            }
            return;
          }
          case "QuoteMark": {
            if (lineActive(node.from)) return;
            const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            out.push(hide.range(node.from, end));
            return;
          }
          case "HorizontalRule":
            if (!lineActive(node.from)) out.push(rule.range(node.from, node.to));
            return;
          case "FencedCode":
          case "CodeBlock":
            eachLine(node.from, node.to, "cm-live-codeblock");
            return false;
          case "HTMLTag": {
            const tag = parseTag(doc.sliceString(node.from, node.to));
            if (!tag) return;
            if (tag.name === "br") {
              if (!touches(node.from, node.to)) out.push(hide.range(node.from, node.to));
              return;
            }
            if (tag.selfClosing || !(tag.name in htmlStyles)) return;
            let block = parent;
            while (block && inlineNodes.test(block.name)) block = block.parent;
            htmlTags.push({ from: node.from, to: node.to, name: tag.name, closing: tag.closing, block: block?.from ?? 0 });
            return;
          }
        }
      },
    });
  }
  htmlDecorations(htmlTags, touches, out);
  return Decoration.set(out, true);
}

/** The live-preview extension; add it to an editor to render Markdown in place. */
export function livePreview(opts: LiveOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, opts);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state) ||
          foldedRanges(u.startState) !== foldedRanges(u.state)
        )
          this.decorations = build(u.view, opts);
      }
    },
    { decorations: (v) => v.decorations },
  );
  const links = EditorView.domEventHandlers({
    mousedown(e) {
      const link = (e.target as Element).closest<HTMLElement>(".cm-live-link");
      if (!link || !(e.ctrlKey || e.metaKey) || !link.dataset.href) return false;
      e.preventDefault();
      opts.openLink(link.dataset.href);
      return true;
    },
  });
  return [plugin, links, liveBlocks(), EditorView.editorAttributes.of({ class: "cm-live" })];
}
