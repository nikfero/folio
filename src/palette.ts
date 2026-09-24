// A "type to find" popup used for quick open (files) and the command palette.

import { escapeHtml } from "./markdown";

export interface PaletteItem {
  label: string;
  /** Secondary text, e.g. a file's folder. */
  detail?: string;
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  hint?: string;
  run: () => void;
}

export interface PaletteSource {
  placeholder: string;
  /** Returns the items for a query; `""` means the default (e.g. recent) list. */
  items(query: string): PaletteItem[];
  /** Typing this prefix switches to another source (e.g. ">" for commands). */
  prefixes?: Record<string, PaletteSource>;
  empty?: string;
}

interface Match {
  score: number;
  indices: number[];
}

/** Subsequence match with bonuses for consecutive characters and word starts. */
export function fuzzyMatch(query: string, text: string): Match | null {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const boundary = found === 0 || /[\s/\\._-]/.test(t[found - 1]) || (text[found] !== t[found] && text[found - 1] === t[found - 1]);
    score += 1 + (found === prev + 1 ? 5 : 0) + (boundary ? 8 : 0);
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  return { score: score - text.length * 0.02, indices };
}

/** Highlights matched characters. */
export function highlight(text: string, indices: number[]): string {
  if (!indices.length) return escapeHtml(text);
  const set = new Set(indices);
  let out = "";
  for (let i = 0; i < text.length; i++) out += set.has(i) ? `<b>${escapeHtml(text[i])}</b>` : escapeHtml(text[i]);
  return out;
}

let current: Palette | null = null;

export function openPalette(source: PaletteSource, initial = ""): void {
  current?.close();
  current = new Palette(source, initial);
}

export function isPaletteOpen(): boolean {
  return current !== null;
}

const MAX_ROWS = 200;

class Palette {
  private backdrop: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private items: PaletteItem[] = [];
  private index = 0;
  private source: PaletteSource;

  constructor(
    private root: PaletteSource,
    initial: string,
  ) {
    this.source = root;
    this.backdrop = document.createElement("div");
    this.backdrop.className = "palette-backdrop";
    this.backdrop.innerHTML = `<div class="palette" role="dialog" aria-modal="true"><input type="text" spellcheck="false" autocomplete="off"><div class="palette-list" role="listbox"></div></div>`;
    this.input = this.backdrop.querySelector("input")!;
    this.list = this.backdrop.querySelector(".palette-list")!;
    this.input.value = initial;

    this.input.addEventListener("input", () => this.update());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === this.backdrop) this.close();
    });
    this.list.addEventListener("click", (e) => {
      const row = (e.target as Element).closest<HTMLElement>(".palette-item");
      if (row) this.pick(Number(row.dataset.i));
    });
    this.list.addEventListener("mousemove", (e) => {
      const row = (e.target as Element).closest<HTMLElement>(".palette-item");
      if (row && Number(row.dataset.i) !== this.index) this.select(Number(row.dataset.i), false);
    });

    document.body.appendChild(this.backdrop);
    this.input.focus();
    this.update();
  }

  close(): void {
    this.backdrop.remove();
    if (current === this) current = null;
  }

  private update(): void {
    let query = this.input.value;
    this.source = this.root;
    for (const [prefix, src] of Object.entries(this.root.prefixes ?? {})) {
      if (query.startsWith(prefix)) {
        this.source = src;
        query = query.slice(prefix.length).trimStart();
        break;
      }
    }
    this.input.placeholder = this.source.placeholder;

    const q = query.trim();
    const scored: { item: PaletteItem; label: Match; detail: Match | null; score: number }[] = [];
    for (const item of this.source.items(q)) {
      if (!q) {
        scored.push({ item, label: { score: 0, indices: [] }, detail: null, score: 0 });
        continue;
      }
      // Prefer matches in the label (e.g. a file name) over the detail (its folder).
      const label = fuzzyMatch(q, item.label);
      const full = item.detail ? fuzzyMatch(q, `${item.detail}/${item.label}`) : null;
      if (!label && !full) continue;
      const score = Math.max(label ? label.score + 10 : -Infinity, full ? full.score : -Infinity);
      scored.push({ item, label: label ?? { score: 0, indices: [] }, detail: null, score });
    }
    if (q) scored.sort((a, b) => b.score - a.score);

    this.items = scored.slice(0, MAX_ROWS).map((s) => s.item);
    this.list.innerHTML = scored.length
      ? scored
          .slice(0, MAX_ROWS)
          .map(
            (s, i) =>
              `<div class="palette-item" role="option" data-i="${i}"><span class="palette-label">${highlight(s.item.label, s.label.indices)}</span>${
                s.item.detail ? `<span class="palette-detail">${escapeHtml(s.item.detail)}</span>` : ""
              }${s.item.hint ? `<kbd>${escapeHtml(s.item.hint)}</kbd>` : ""}</div>`,
          )
          .join("")
      : `<div class="palette-empty">${escapeHtml(this.source.empty ?? "No matches")}</div>`;
    this.select(0, true);
  }

  private select(i: number, scroll: boolean): void {
    if (!this.items.length) return;
    this.index = (i + this.items.length) % this.items.length;
    for (const row of this.list.querySelectorAll(".palette-item.active")) row.classList.remove("active");
    const row = this.list.querySelector<HTMLElement>(`[data-i="${this.index}"]`);
    row?.classList.add("active");
    if (scroll) row?.scrollIntoView({ block: "nearest" });
  }

  private pick(i: number): void {
    const item = this.items[i];
    this.close();
    item?.run();
  }

  private onKey(e: KeyboardEvent): void {
    const keys: Record<string, () => void> = {
      ArrowDown: () => this.select(this.index + 1, true),
      ArrowUp: () => this.select(this.index - 1, true),
      PageDown: () => this.select(Math.min(this.items.length - 1, this.index + 10), true),
      PageUp: () => this.select(Math.max(0, this.index - 10), true),
      Enter: () => this.pick(this.index),
      Escape: () => this.close(),
    };
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  }
}
