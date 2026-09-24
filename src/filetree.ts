// The folder view in the sidebar: a collapsible tree of the folder's Markdown files.

import { icons } from "./icons";
import { basename, dirname, isMac, ltr, pathKey, type FolderEntry } from "./platform";

interface DirNode {
  name: string;
  rel: string;
  dirs: Map<string, DirNode>;
  files: FolderEntry[];
}

function buildTree(files: FolderEntry[], emptyDirs: string[]): DirNode {
  const root: DirNode = { name: "", rel: "", dirs: new Map(), files: [] };
  const dirFor = (parts: string[]) => {
    let node = root;
    for (const part of parts) {
      let child = node.dirs.get(part);
      if (!child) {
        child = { name: part, rel: node.rel ? `${node.rel}/${part}` : part, dirs: new Map(), files: [] };
        node.dirs.set(part, child);
      }
      node = child;
    }
    return node;
  };
  for (const d of emptyDirs) dirFor(d.split("/"));
  for (const f of files) dirFor(f.rel.split("/").slice(0, -1)).files.push(f);
  sortTree(root);
  return root;
}

function sortTree(node: DirNode): void {
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  node.dirs = new Map([...node.dirs.entries()].sort(([a], [b]) => byName(a, b)));
  node.files.sort((a, b) => byName(basename(a.rel), basename(b.rel)));
  for (const d of node.dirs.values()) sortTree(d);
}

export class FileTree {
  private root: string | null = null;
  private files: FolderEntry[] = [];
  private emptyDirs: string[] = [];
  private expanded = new Set<string>();
  private activeKey = "";

  constructor(
    private el: HTMLElement,
    private handlers: {
      open(path: string): void;
      openFolder(path?: string): void;
      closeFolder(): void;
      recentFolders(): string[];
      newFile(dirRel: string): void;
    },
  ) {
    el.addEventListener("click", (e) => {
      const target = e.target as Element;
      const recent = target.closest<HTMLElement>("[data-recent-folder]");
      if (recent) return this.handlers.openFolder(recent.dataset.recentFolder);
      if (target.closest("[data-open-folder]")) return this.handlers.openFolder();
      if (target.closest("[data-close-folder]")) return this.handlers.closeFolder();
      if (target.closest("[data-new-file]")) return this.handlers.newFile("");
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
  setFolder(root: string | null, files: FolderEntry[], truncated = false, emptyDirs: string[] = []): void {
    const same = root !== null && this.root !== null && pathKey(root) === pathKey(this.root);
    this.root = root;
    this.files = files;
    this.emptyDirs = emptyDirs;
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

  /** Expands a folder (by relative path) and its parents, e.g. after creating something in it. */
  reveal(rel: string): void {
    if (!rel) return;
    this.expandParents(`${rel}/x`);
    this.render();
  }

  contains(path: string): boolean {
    const key = pathKey(path);
    return this.files.some((f) => pathKey(f.path) === key);
  }

  private emptyState(): string {
    const shortcut = isMac ? "⌘⇧F" : "Ctrl+Shift+F";
    const recent = this.handlers
      .recentFolders()
      .slice(0, 5)
      .map(
        (p) =>
          `<button class="tree-recent" data-recent-folder="${escapeAttr(p)}" title="${escapeAttr(p)}">${icons.folder}<span class="tree-recent-name">${escapeText(basename(p))}</span><span class="tree-recent-dir">${escapeText(ltr(dirname(p)))}</span></button>`,
      )
      .join("");
    return `<div class="tree-empty">
        <div class="tree-empty-icon">${icons.folder}</div>
        <p class="tree-empty-title">No folder open</p>
        <p class="tree-empty-text">Open a folder to browse all of its Markdown files here.</p>
        <button class="tree-open-btn" data-open-folder>${icons.folder}<span>Open Folder…</span></button>
        <p class="tree-empty-key"><kbd>${shortcut}</kbd><br>or drop a folder onto the window</p>
      </div>${recent ? `<div class="tree-recents"><div class="tree-recents-title">Recent folders</div>${recent}</div>` : ""}`;
  }

  private expandParents(rel: string): void {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) this.expanded.add(parts.slice(0, i).join("/"));
  }

  private render(): void {
    if (!this.root) {
      this.el.innerHTML = this.emptyState();
      return;
    }
    const head = `<div class="tree-folder" title="${escapeAttr(this.root)}">${icons.folder}<span>${escapeText(basename(this.root))}</span><button class="icon-btn tree-action" data-new-file title="New File" aria-label="New File">${icons.plus}</button><button class="icon-btn tree-action" data-close-folder title="Close Folder" aria-label="Close Folder">${icons.close}</button></div>`;
    if (!this.files.length && !this.emptyDirs.length) {
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
    walk(buildTree(this.files, this.emptyDirs), 0);
    const note = this.el.dataset.truncated === "true" ? `<p class="tree-note">Showing the first 10,000 files.</p>` : "";
    this.el.innerHTML = head + rows.join("") + note;
  }
}

const escapeText = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
