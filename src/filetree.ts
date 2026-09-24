// The folder view in the sidebar: a collapsible tree of the folder's Markdown files.

import { icons } from "./icons";
import { basename, pathKey, type FolderEntry } from "./platform";

interface DirNode {
  name: string;
  rel: string;
  dirs: Map<string, DirNode>;
  files: FolderEntry[];
}

function buildTree(files: FolderEntry[]): DirNode {
  const root: DirNode = { name: "", rel: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.rel.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let child = node.dirs.get(part);
      if (!child) {
        child = { name: part, rel: node.rel ? `${node.rel}/${part}` : part, dirs: new Map(), files: [] };
        node.dirs.set(part, child);
      }
      node = child;
    }
    node.files.push(f);
  }
  return root;
}

export class FileTree {
  private root: string | null = null;
  private files: FolderEntry[] = [];
  private expanded = new Set<string>();
  private activeKey = "";

  constructor(
    private el: HTMLElement,
    private handlers: { open(path: string): void; openFolder(): void },
  ) {
    el.addEventListener("click", (e) => {
      const target = e.target as Element;
      if (target.closest("[data-open-folder]")) return this.handlers.openFolder();
      const row = target.closest<HTMLElement>(".tree-row");
      if (!row) return;
      if (row.dataset.dir !== undefined) {
        const rel = row.dataset.dir;
        if (this.expanded.has(rel)) this.expanded.delete(rel);
        else this.expanded.add(rel);
        this.render();
      } else if (row.dataset.path) {
        this.handlers.open(row.dataset.path);
      }
    });
  }

  get folder(): string | null {
    return this.root;
  }

  get entries(): FolderEntry[] {
    return this.files;
  }

  /** Shows a folder's files; keeps the expanded state when the same folder is refreshed. */
  setFolder(root: string | null, files: FolderEntry[], truncated = false): void {
    const same = root !== null && this.root !== null && pathKey(root) === pathKey(this.root);
    this.root = root;
    this.files = files;
    if (!same) {
      this.expanded.clear();
      // Small folders open fully; bigger ones start with only the top level visible.
      if (files.length <= 40) for (const f of files) this.expandParents(f.rel);
    }
    this.el.dataset.truncated = String(truncated);
    this.render();
  }

  /** Highlights the active document and reveals it in the tree. */
  setActive(path: string | null): void {
    const key = path ? pathKey(path) : "";
    if (key === this.activeKey) return;
    this.activeKey = key;
    const entry = this.files.find((f) => pathKey(f.path) === key);
    if (entry) this.expandParents(entry.rel);
    this.render();
    this.el.querySelector(".tree-row.active")?.scrollIntoView({ block: "nearest" });
  }

  contains(path: string): boolean {
    const key = pathKey(path);
    return this.files.some((f) => pathKey(f.path) === key);
  }

  private expandParents(rel: string): void {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) this.expanded.add(parts.slice(0, i).join("/"));
  }

  private render(): void {
    if (!this.root) {
      this.el.innerHTML = `<div class="tree-empty"><p>No folder open.</p><button class="btn small" data-open-folder>Open Folder…</button></div>`;
      return;
    }
    const head = `<div class="tree-folder" title="${escapeAttr(this.root)}">${icons.folder}<span>${escapeText(basename(this.root))}</span></div>`;
    if (!this.files.length) {
      this.el.innerHTML = `${head}<p class="tree-note">No Markdown files in this folder.</p>`;
      return;
    }
    const rows: string[] = [];
    const walk = (node: DirNode, depth: number) => {
      for (const dir of node.dirs.values()) {
        const open = this.expanded.has(dir.rel);
        rows.push(
          `<div class="tree-row dir${open ? " open" : ""}" data-dir="${escapeAttr(dir.rel)}" style="--depth:${depth}"><span class="tree-caret">${icons.down}</span><span class="tree-name">${escapeText(dir.name)}</span></div>`,
        );
        if (open) walk(dir, depth + 1);
      }
      for (const f of node.files) {
        const active = pathKey(f.path) === this.activeKey;
        rows.push(
          `<div class="tree-row file${active ? " active" : ""}" data-path="${escapeAttr(f.path)}" title="${escapeAttr(f.rel)}" style="--depth:${depth}"><span class="tree-name">${escapeText(basename(f.rel))}</span></div>`,
        );
      }
    };
    walk(buildTree(this.files), 0);
    const note = this.el.dataset.truncated === "true" ? `<p class="tree-note">Showing the first 10,000 files.</p>` : "";
    this.el.innerHTML = head + rows.join("") + note;
  }
}

const escapeText = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
