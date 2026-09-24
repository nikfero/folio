// The sidebar's Search panel: find text across every Markdown file in the open folder.

import { icons } from "./icons";
import { basename, type SearchResults } from "./platform";

export interface SearchHandlers {
  folder(): string | null;
  search(query: string, caseSensitive: boolean, regex: boolean): Promise<SearchResults>;
  /** Opens a result; `line` is 1-based, `col`/`len` are string offsets in that line. */
  open(path: string, line: number, col: number, len: number, matched: string): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class SearchPanel {
  private input: HTMLInputElement;
  private summary: HTMLElement;
  private list: HTMLElement;
  private caseSensitive = false;
  private regex = false;
  private results: SearchResults | null = null;
  private collapsed = new Set<string>();
  private timer = 0;
  private seq = 0;

  constructor(
    private el: HTMLElement,
    private handlers: SearchHandlers,
  ) {
    el.innerHTML = `
      <div class="search-box">
        <span class="search-icon">${icons.search}</span>
        <input type="text" placeholder="Search in folder" spellcheck="false" aria-label="Search in folder">
        <button class="search-opt" data-opt="case" title="Match case" aria-pressed="false">Aa</button>
        <button class="search-opt" data-opt="regex" title="Use regular expression" aria-pressed="false">.*</button>
      </div>
      <div class="search-summary"></div>
      <div class="search-results"></div>`;
    this.input = el.querySelector("input")!;
    this.summary = el.querySelector(".search-summary")!;
    this.list = el.querySelector(".search-results")!;

    this.input.addEventListener("input", () => this.schedule());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.list.querySelector<HTMLElement>(".search-hit")?.click();
      } else if (e.key === "Escape" && this.input.value) {
        e.preventDefault();
        e.stopPropagation();
        this.input.value = "";
        this.schedule();
      }
    });
    el.querySelectorAll<HTMLButtonElement>(".search-opt").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.opt === "case") this.caseSensitive = !this.caseSensitive;
        else this.regex = !this.regex;
        b.setAttribute("aria-pressed", String(b.dataset.opt === "case" ? this.caseSensitive : this.regex));
        this.schedule(0);
      }),
    );
    this.list.addEventListener("click", (e) => {
      const target = e.target as Element;
      const file = target.closest<HTMLElement>(".search-file");
      if (file) {
        const path = file.dataset.path!;
        if (this.collapsed.has(path)) this.collapsed.delete(path);
        else this.collapsed.add(path);
        this.renderResults();
        return;
      }
      const hit = target.closest<HTMLElement>(".search-hit");
      if (!hit || !this.results) return;
      for (const h of this.list.querySelectorAll(".search-hit.active")) h.classList.remove("active");
      hit.classList.add("active");
      const f = this.results.files[Number(hit.dataset.f)];
      const m = f.matches[Number(hit.dataset.m)];
      this.handlers.open(f.path, m.line, m.col, m.len, m.text.slice(m.col, m.col + m.len));
    });
    this.render();
  }

  /** Focuses the query box, optionally replacing the query (e.g. with the selected text). */
  focus(query?: string): void {
    if (query && !query.includes("\n")) {
      this.input.value = query;
      this.schedule(0);
    }
    this.input.focus();
    this.input.select();
  }

  /** Runs the search again, e.g. after the folder changed or files were saved. */
  refresh(): void {
    this.schedule(0);
  }

  private schedule(delay = 250): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), delay);
  }

  private async run(): Promise<void> {
    const seq = ++this.seq;
    const folder = this.handlers.folder();
    const query = this.input.value;
    if (!folder || !query.trim()) {
      this.results = null;
      this.render();
      return;
    }
    this.summary.textContent = "Searching…";
    try {
      const results = await this.handlers.search(query, this.caseSensitive, this.regex);
      if (seq !== this.seq) return; // a newer search started meanwhile
      this.results = results;
      this.collapsed.clear();
      this.render();
    } catch (e) {
      if (seq !== this.seq) return;
      this.results = null;
      this.list.innerHTML = "";
      this.summary.innerHTML = `<span class="search-error">${esc(String(e).replace(/^Error:\s*/, ""))}</span>`;
    }
  }

  private render(): void {
    const folder = this.handlers.folder();
    this.el.classList.toggle("no-folder", !folder);
    if (!folder) {
      this.summary.textContent = "";
      this.list.innerHTML = `<p class="search-note">Open a folder to search across all of its files.</p>`;
      return;
    }
    const r = this.results;
    if (!r) {
      this.summary.textContent = "";
      this.list.innerHTML = `<p class="search-note">Search every Markdown file in ${esc(basename(folder))}.</p>`;
      return;
    }
    const files = r.files.length;
    this.summary.textContent = r.total
      ? `${r.total.toLocaleString()} result${r.total === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}${r.truncated ? " (showing the first ones)" : ""}`
      : "No results";
    this.renderResults();
  }

  private renderResults(): void {
    const r = this.results;
    if (!r) return;
    const html: string[] = [];
    r.files.forEach((f, fi) => {
      const open = !this.collapsed.has(f.path);
      const dir = f.rel.split("/").slice(0, -1).join("/");
      html.push(
        `<div class="search-file${open ? " open" : ""}" data-path="${esc(f.path)}" title="${esc(f.rel)}"><span class="tree-caret">${icons.down}</span><span class="search-file-name">${esc(basename(f.rel))}</span><span class="search-file-dir">${esc(dir)}</span><span class="search-count">${f.matches.length}</span></div>`,
      );
      if (!open) return;
      f.matches.forEach((m, mi) => {
        // Show some context before the match and cut long lines.
        const start = Math.max(0, m.col - 30);
        const before = (start > 0 ? "…" : "") + m.text.slice(start, m.col).trimStart();
        const hit = m.text.slice(m.col, m.col + m.len);
        const after = m.text.slice(m.col + m.len, m.col + m.len + 120);
        html.push(
          `<div class="search-hit" data-f="${fi}" data-m="${mi}" title="Line ${m.line}"><span class="search-text">${esc(before)}<mark>${esc(hit)}</mark>${esc(after)}</span><span class="search-line">${m.line}</span></div>`,
        );
      });
    });
    this.list.innerHTML = html.join("");
  }
}
