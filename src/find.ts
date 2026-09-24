import { icons } from "./icons";

const hasHighlights = typeof CSS !== "undefined" && "highlights" in CSS;

/** Find-in-page for the rendered preview (the editor uses CodeMirror's own search). */
export class FindBar {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private count: HTMLElement;
  private ranges: Range[] = [];
  private index = -1;

  constructor(
    host: HTMLElement,
    private scroller: HTMLElement,
    private root: HTMLElement,
  ) {
    this.el = document.createElement("div");
    this.el.className = "findbar";
    this.el.hidden = true;
    this.el.innerHTML = `
      <span class="findbar-icon">${icons.search}</span>
      <input type="text" placeholder="Find in document" spellcheck="false" aria-label="Find in document">
      <span class="findbar-count"></span>
      <button class="icon-btn" data-dir="-1" title="Previous (Shift+Enter)">${icons.up}</button>
      <button class="icon-btn" data-dir="1" title="Next (Enter)">${icons.down}</button>
      <button class="icon-btn" data-close title="Close (Esc)">${icons.close}</button>`;
    host.appendChild(this.el);
    this.input = this.el.querySelector("input")!;
    this.count = this.el.querySelector(".findbar-count")!;

    this.input.addEventListener("input", () => this.search(true));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
    this.el.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest("button");
      if (!btn) return;
      if (btn.hasAttribute("data-close")) this.close();
      else this.step(Number(btn.dataset.dir));
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.el.hidden = false;
    const sel = window.getSelection()?.toString().trim();
    if (sel && !sel.includes("\n")) this.input.value = sel;
    this.input.focus();
    this.input.select();
    this.search(true);
  }

  close(): void {
    this.el.hidden = true;
    this.ranges = [];
    this.paint();
  }

  /** Re-runs the search after the preview re-rendered, keeping the position. */
  refresh(): void {
    if (this.isOpen) this.search(false);
  }

  private search(jump: boolean): void {
    const q = this.input.value.toLowerCase();
    this.ranges = [];
    if (q) {
      const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement?.closest(".code-copy, .katex-mathml, script, style")
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue!.toLowerCase();
        for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + q.length);
          this.ranges.push(r);
        }
      }
    }
    if (jump || this.index >= this.ranges.length) {
      // Start from the first match below the current scroll position.
      const top = this.scroller.getBoundingClientRect().top;
      const i = this.ranges.findIndex((r) => r.getBoundingClientRect().top >= top);
      this.index = this.ranges.length ? Math.max(0, i) : -1;
      if (jump) this.reveal();
    }
    this.paint();
  }

  private step(dir: number): void {
    if (!this.ranges.length) return;
    this.index = (this.index + dir + this.ranges.length) % this.ranges.length;
    this.reveal();
    this.paint();
  }

  private reveal(): void {
    const r = this.ranges[this.index];
    if (!r) return;
    const rect = r.getBoundingClientRect();
    const box = this.scroller.getBoundingClientRect();
    if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40)
      this.scroller.scrollTop += rect.top - box.top - this.scroller.clientHeight / 3;
  }

  private paint(): void {
    this.count.textContent = this.input.value ? `${this.ranges.length ? this.index + 1 : 0}/${this.ranges.length}` : "";
    this.el.classList.toggle("no-match", !!this.input.value && !this.ranges.length);
    if (!hasHighlights) return;
    CSS.highlights.set("find", new Highlight(...this.ranges));
    const cur = this.ranges[this.index];
    if (cur) CSS.highlights.set("find-current", new Highlight(cur));
    else CSS.highlights.delete("find-current");
  }
}
