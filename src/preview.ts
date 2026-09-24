import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";
import { escapeHtml, renderMarkdown, type Frontmatter } from "./markdown";
import { dirname, resolvePath } from "./platform";
import { icons } from "./icons";

export interface PreviewHandlers {
  onToggleTask(line: number): void;
  onLink(href: string): void;
  /** Ctrl/Cmd+click or double-click on a block; `line` is 0-based. */
  onJumpToSource(line: number, how: "modclick" | "dblclick"): void;
}

type MathModule = typeof import("./lazy/math");
type MermaidModule = typeof import("./lazy/mermaid");

let mathModule: MathModule | null = null;
let mermaidModule: MermaidModule | null = null;

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  // Only checkboxes may be interactive; any other form control stays inert.
  if (node.nodeName === "INPUT" && data.attrName === "type" && data.attrValue !== "checkbox") data.keepAttr = false;
});

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["input"],
    ADD_ATTR: ["data-line", "data-task-line"],
    FORBID_TAGS: ["style", "form", "button", "textarea", "select"],
  });
}

function frontmatterHtml(fm: Frontmatter): string {
  if (fm.pairs && fm.pairs.length) {
    const rows = fm.pairs.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("");
    return `<table class="frontmatter" data-line="0"><tbody>${rows}</tbody></table>`;
  }
  return `<pre class="frontmatter" data-line="0"><code>${escapeHtml(fm.raw)}</code></pre>`;
}

const EXTERNAL = /^(https?:|data:|blob:|asset:|mailto:)/i;

const HEADING = /^H([1-6])$/;
const level = (el: Element) => Number(HEADING.exec(el.tagName)?.[1] ?? 0);

export class Preview {
  readonly body: HTMLElement;
  private generation = 0;
  /** Folded headings (by id) per document, kept across re-renders. */
  private folds = new Map<string, Set<string>>();
  private docKey = "";

  constructor(
    readonly scroller: HTMLElement,
    private handlers: PreviewHandlers,
  ) {
    this.body = scroller.querySelector(".markdown-body")!;
    this.body.addEventListener("click", (e) => this.onClick(e));
    this.body.addEventListener("dblclick", (e) => {
      if ((e.target as Element).closest("a, input, .code-copy, .heading-fold")) return;
      const line = this.lineAt(e.target as Element);
      if (line != null) this.handlers.onJumpToSource(line, "dblclick");
    });
  }

  render(text: string, docPath: string | null, theme: "light" | "dark"): void {
    const gen = ++this.generation;
    this.docKey = docPath ?? "";
    const result = renderMarkdown(text);
    let html = sanitize(result.html);
    if (result.frontmatter) html = frontmatterHtml(result.frontmatter) + html;
    this.body.innerHTML = html;

    if (docPath) this.rewriteImages(dirname(docPath));
    this.addCopyButtons();
    this.addFoldToggles();
    this.applyFolds();

    if (result.hasMath) {
      if (mathModule) mathModule.renderMath(this.body);
      else
        import("./lazy/math").then((m) => {
          mathModule = m;
          if (gen === this.generation) m.renderMath(this.body);
        });
    }
    if (result.hasMermaid) {
      if (mermaidModule) void mermaidModule.renderMermaid(this.body, theme);
      else
        import("./lazy/mermaid").then((m) => {
          mermaidModule = m;
          if (gen === this.generation) void m.renderMermaid(this.body, theme);
        });
    }
  }

  clear(): void {
    this.generation++;
    this.body.innerHTML = "";
  }

  /** The 0-based source line of the block containing `el`. */
  lineAt(el: Element): number | null {
    const block = el.closest<HTMLElement>("[data-line]");
    return block ? Number(block.dataset.line) : null;
  }

  scrollToId(id: string): void {
    const target = this.body.querySelector(`#${CSS.escape(id)}`) ?? this.body.querySelector(`[name="${CSS.escape(id)}"]`);
    if (target) {
      this.reveal(target);
      target.scrollIntoView({ block: "start" });
    }
  }

  // ------------------------------------------------------------ folding

  private folded(): Set<string> {
    let set = this.folds.get(this.docKey);
    if (!set) this.folds.set(this.docKey, (set = new Set()));
    return set;
  }

  /** A fold arrow on each top-level heading that has something under it. */
  private addFoldToggles(): void {
    for (const h of this.body.children) {
      if (!level(h) || !h.id) continue;
      const next = h.nextElementSibling;
      if (!next || (level(next) && level(next) <= level(h))) continue;
      const btn = document.createElement("span");
      btn.className = "heading-fold";
      btn.setAttribute("role", "button");
      btn.title = "Fold section";
      h.prepend(btn);
    }
  }

  /** Hides everything under a folded heading, up to the next heading of the same or a higher level. */
  private applyFolds(): void {
    const folded = this.folded();
    let hideBelow = 0; // level of the folded heading being hidden under; 0 = none
    for (const el of this.body.children) {
      const l = level(el);
      if (l && hideBelow && l <= hideBelow) hideBelow = 0;
      el.classList.toggle("fold-hidden", hideBelow > 0);
      if (!l) continue;
      const isFolded = folded.has(el.id) && !!el.querySelector(":scope > .heading-fold");
      el.classList.toggle("folded", isFolded);
      const btn = el.querySelector<HTMLElement>(":scope > .heading-fold");
      if (btn) btn.title = isFolded ? "Unfold section" : "Fold section";
      if (isFolded && !hideBelow) hideBelow = l;
    }
  }

  toggleFold(heading: Element): void {
    const folded = this.folded();
    if (folded.has(heading.id)) folded.delete(heading.id);
    else folded.add(heading.id);
    this.applyFolds();
  }

  /** Folds (or unfolds) every section of the document. */
  foldAll(fold: boolean): void {
    const folded = this.folded();
    folded.clear();
    if (fold) for (const b of this.body.querySelectorAll(":scope > * > .heading-fold")) folded.add(b.parentElement!.id);
    this.applyFolds();
  }

  /** Unfolds whatever hides `el`, so it can be scrolled to. */
  reveal(el: Element): void {
    let top: Element | null = el;
    while (top && top.parentElement !== this.body) top = top.parentElement;
    for (let guard = 0; top?.classList.contains("fold-hidden") && guard < 20; guard++) {
      let prev = top.previousElementSibling;
      while (prev && !prev.classList.contains("folded")) prev = prev.previousElementSibling;
      if (!prev) break;
      this.folded().delete(prev.id);
      this.applyFolds();
    }
  }

  /** Words of prose, ignoring code, math and diagrams. */
  wordCount(): number {
    const walker = document.createTreeWalker(this.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest("pre, .math, .mermaid, .frontmatter, .code-copy")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    let count = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      count += n.nodeValue!.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
    return count;
  }

  headings(): HTMLElement[] {
    return [...this.body.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
  }

  private rewriteImages(baseDir: string): void {
    for (const img of this.body.querySelectorAll<HTMLImageElement>("img[src]")) {
      const src = img.getAttribute("src")!;
      if (EXTERNAL.test(src)) continue;
      let path: string;
      try {
        path = src.startsWith("file://") ? decodeURI(new URL(src).pathname).replace(/^\/([a-zA-Z]:)/, "$1") : decodeURI(src);
      } catch {
        path = src;
      }
      img.src = convertFileSrc(resolvePath(baseDir, path.split(/[?#]/)[0]));
    }
  }

  private addCopyButtons(): void {
    for (const pre of this.body.querySelectorAll("pre")) {
      if (!pre.querySelector("code") || pre.classList.contains("frontmatter")) continue;
      const btn = document.createElement("span");
      btn.className = "code-copy";
      btn.title = "Copy code";
      btn.setAttribute("role", "button");
      btn.innerHTML = icons.copy;
      pre.appendChild(btn);
    }
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as Element;

    const fold = target.closest(".heading-fold");
    if (fold) {
      e.preventDefault();
      this.toggleFold(fold.parentElement!);
      return;
    }

    const copy = target.closest(".code-copy");
    if (copy) {
      const code = copy.parentElement?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard.writeText(code).then(() => {
        copy.classList.add("done");
        copy.innerHTML = icons.check;
        setTimeout(() => {
          copy.classList.remove("done");
          copy.innerHTML = icons.copy;
        }, 1200);
      });
      return;
    }

    const box = target.closest<HTMLInputElement>("input.task-box");
    if (box) {
      this.handlers.onToggleTask(Number(box.dataset.taskLine));
      return;
    }

    const link = target.closest("a[href]");
    if (link) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const line = this.lineAt(link);
        if (line != null) return this.handlers.onJumpToSource(line, "modclick");
      }
      const href = link.getAttribute("href")!;
      if (href.startsWith("#")) this.scrollToId(decodeURIComponent(href.slice(1)));
      else this.handlers.onLink(href);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      const line = this.lineAt(target);
      if (line != null) this.handlers.onJumpToSource(line, "modclick");
    }
  }
}
