import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import hljs from "highlight.js/lib/common";
import type { StateBlock, StateCore, StateInline, Token } from "markdown-it";

type InlineRule = (state: StateInline, silent: boolean) => boolean;
type BlockRule = (state: StateBlock, startLine: number, endLine: number, silent: boolean) => boolean;
type CoreRule = (state: StateCore) => void;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** GitHub-style heading slugs, keeping non-Latin letters. */
export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const lineAttr = (t: Token) => (t.map ? ` data-line="${t.map[0]}"` : "");

/** Tags block-level tokens with their 0-based source line for scroll sync and jump-to-source. */
const sourceLines: CoreRule = (state) => {
  for (const t of state.tokens) {
    if (t.map && t.block && t.nesting === 1) t.attrSet("data-line", String(t.map[0]));
    if (t.map && t.type === "hr") t.attrSet("data-line", String(t.map[0]));
  }
};

/** Turns `- [ ] item` into a checkbox that knows which source line it came from. */
const taskLists: CoreRule = (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    const li = tokens[i - 2];
    if (inline.type !== "inline" || tokens[i - 1].type !== "paragraph_open" || li.type !== "list_item_open") continue;
    const first = inline.children?.[0];
    const m = first?.type === "text" ? /^\[([ xX])\][ \t]/.exec(first.content) : null;
    if (!first || !m || !li.map) continue;
    first.content = first.content.slice(m[0].length);
    const box = new state.Token("html_inline", "", 0);
    const checked = m[1] !== " ";
    box.content = `<input type="checkbox" class="task-box" data-task-line="${li.map[0]}"${checked ? " checked" : ""}>`;
    inline.children!.unshift(box);
    li.attrJoin("class", "task-item");
  }
};

const mathInline: InlineRule = (state, silent) => {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;

  if (src.charCodeAt(start + 1) === 0x24) {
    const end = src.indexOf("$$", start + 2);
    if (end < 0 || end === start + 2) return false;
    if (!silent) {
      const t = state.push("math_inline", "math", 0);
      t.content = src.slice(start + 2, end);
      t.markup = "$$";
    }
    state.pos = end + 2;
    return true;
  }

  const next = src.charCodeAt(start + 1);
  if (Number.isNaN(next) || next === 0x20 || next === 0x09 || next === 0x0a) return false;
  let end = start + 1;
  while ((end = src.indexOf("$", end)) !== -1 && src.charCodeAt(end - 1) === 0x5c /* \ */) end++;
  if (end === -1) return false;
  const prev = src.charCodeAt(end - 1);
  const after = src.charCodeAt(end + 1);
  if (prev === 0x20 || prev === 0x09 || prev === 0x0a) return false;
  if (after >= 0x30 && after <= 0x39) return false; // "costs $5 and $6"
  if (!silent) {
    const t = state.push("math_inline", "math", 0);
    t.content = src.slice(start + 1, end);
    t.markup = "$";
  }
  state.pos = end + 1;
  return true;
};

const mathBlock: BlockRule = (state, startLine, endLine, silent) => {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;

  const firstLine = state.src.slice(pos + 2, max).trim();
  let content: string;
  let last = startLine;
  if (firstLine.endsWith("$$") && firstLine.length >= 2) {
    content = firstLine.slice(0, -2);
  } else {
    let found = false;
    while (++last < endLine) {
      const p = state.bMarks[last] + state.tShift[last];
      const line = state.src.slice(p, state.eMarks[last]).trim();
      if (line.endsWith("$$")) {
        found = true;
        break;
      }
    }
    if (!found) return false;
    const lastText = state.src.slice(state.bMarks[last] + state.tShift[last], state.eMarks[last]).trim();
    content = [firstLine, state.getLines(startLine + 1, last, state.tShift[startLine], false), lastText.slice(0, -2)]
      .filter((s) => s.trim())
      .join("\n");
  }
  if (silent) return true;

  const t = state.push("math_block", "math", 0);
  t.block = true;
  t.content = content;
  t.map = [startLine, last + 1];
  t.markup = "$$";
  state.line = last + 1;
  return true;
};

function highlight(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* fall through */
    }
  }
  return escapeHtml(code);
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
md.use(footnote);
md.use(anchor, { slugify, tabIndex: false });
md.inline.ruler.after("escape", "math_inline", mathInline);
md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
md.core.ruler.after("inline", "task_lists", taskLists);
md.core.ruler.push("source_lines", sourceLines);

md.renderer.rules.math_inline = (tokens, idx) => {
  const t = tokens[idx];
  return `<span class="math${t.markup === "$$" ? " display" : ""}">${escapeHtml(t.content)}</span>`;
};
md.renderer.rules.math_block = (tokens, idx) =>
  `<div class="math display"${lineAttr(tokens[idx])}>${escapeHtml(tokens[idx].content)}</div>\n`;

md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx];
  const lang = t.info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (lang === "mermaid") return `<div class="mermaid"${lineAttr(t)}>${escapeHtml(t.content)}</div>\n`;
  if (lang === "math" || lang === "katex" || lang === "latex")
    return `<div class="math display"${lineAttr(t)}>${escapeHtml(t.content)}</div>\n`;
  const cls = lang ? ` language-${escapeHtml(lang)}` : "";
  return `<pre${lineAttr(t)}><code class="hljs${cls}">${highlight(t.content, lang)}</code></pre>\n`;
};
md.renderer.rules.code_block = (tokens, idx) =>
  `<pre${lineAttr(tokens[idx])}><code class="hljs">${escapeHtml(tokens[idx].content)}</code></pre>\n`;

export interface Frontmatter {
  raw: string;
  /** Parsed `key: value` pairs, or null if the block isn't simple enough to tabulate. */
  pairs: [string, string][] | null;
}

/**
 * Extracts a leading YAML frontmatter block, replacing it with blank lines so
 * rendered line numbers still match the source.
 */
function splitFrontmatter(text: string): { body: string; frontmatter: Frontmatter | null } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { body: text, frontmatter: null };
  const raw = m[1];
  const blank = "\n".repeat(m[0].split("\n").length - 1);
  let pairs: [string, string][] | null = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = /^([\w.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      pairs = null;
      break;
    }
    pairs.push([kv[1], kv[2].replace(/^(["'])(.*)\1$/, "$2")]);
  }
  return { body: blank + text.slice(m[0].length), frontmatter: { raw, pairs } };
}

export interface RenderResult {
  html: string;
  frontmatter: Frontmatter | null;
  hasMath: boolean;
  hasMermaid: boolean;
}

export function renderMarkdown(text: string): RenderResult {
  const { body, frontmatter } = splitFrontmatter(text);
  const html = md.render(body, {});
  return {
    html,
    frontmatter,
    hasMath: html.includes('class="math'),
    hasMermaid: html.includes('class="mermaid"'),
  };
}

/** Flips the `[ ]` / `[x]` marker on a task-list source line; returns null if the line isn't a task. */
export function toggleTaskLine(line: string): string | null {
  const m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line);
  if (!m) return null;
  const mark = m[2] === " " ? "x" : " ";
  return m[1] + `[${mark}]` + line.slice(m[0].length);
}
