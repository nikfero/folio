import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: "var(--syn-heading)", fontWeight: "700", fontSize: "1.2em" },
  { tag: t.heading2, color: "var(--syn-heading)", fontWeight: "700", fontSize: "1.1em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: "var(--syn-heading)", fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--syn-link)" },
  { tag: t.url, color: "var(--syn-url)" },
  { tag: t.monospace, color: "var(--syn-code)" },
  { tag: t.quote, color: "var(--syn-quote)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: "var(--syn-meta)" },
  // Code inside fenced blocks
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.comment, t.meta], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-function)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syn-property)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--syn-tag)" },
  { tag: t.invalid, color: "var(--danger)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--fg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-content": { padding: "16px 0 50vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 20px 0 12px" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--fg-faint)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 14px", minWidth: "2.5em" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-muted)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-selectionMatch": { backgroundColor: "var(--match)" },
  ".cm-searchMatch": { backgroundColor: "var(--match)", outline: "1px solid var(--match-strong)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--match-strong)" },
  ".cm-panels": { backgroundColor: "var(--bg-alt)", color: "var(--fg)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 10px", fontFamily: "var(--font-ui)" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": { fontFamily: "var(--font-ui)", fontSize: "12px" },
  ".cm-textfield": {
    backgroundColor: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    color: "var(--fg)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    color: "var(--fg)",
  },
  ".cm-panel.cm-search [name=close]": { color: "var(--fg-muted)" },
});

let updateHandler: (u: ViewUpdate) => void = () => {};

const extensions: Extension[] = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  history(),
  drawSelection(),
  dropCursor(),
  indentOnInput(),
  bracketMatching(),
  highlightSelectionMatches(),
  search({ top: true }),
  EditorView.lineWrapping,
  markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
  syntaxHighlighting(highlightStyle),
  theme,
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  EditorView.updateListener.of((u) => updateHandler(u)),
];

export function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions });
}

export function createEditor(parent: HTMLElement, onUpdate: (u: ViewUpdate) => void): EditorView {
  updateHandler = onUpdate;
  return new EditorView({ parent, state: makeState("") });
}

/** Replaces the document with `text`, touching only the region that differs so the cursor stays put. */
export function minimalReplace(state: EditorState, text: string) {
  const old = state.doc.toString();
  if (old === text) return null;
  let start = 0;
  const max = Math.min(old.length, text.length);
  while (start < max && old.charCodeAt(start) === text.charCodeAt(start)) start++;
  let endOld = old.length;
  let endNew = text.length;
  while (endOld > start && endNew > start && old.charCodeAt(endOld - 1) === text.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  return { from: start, to: endOld, insert: text.slice(start, endNew) };
}
