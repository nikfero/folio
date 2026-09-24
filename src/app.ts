import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { EditorState, Text } from "@codemirror/state";
import { openSearchPanel } from "@codemirror/search";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

import { createEditor, makeState, minimalReplace, setEditorConfig } from "./editor";
import { Preview } from "./preview";
import { ScrollMap, editorTopLine, revealLine, scrollEditorToLine } from "./scrollsync";
import { FindBar } from "./find";
import { toggleTaskLine } from "./markdown";
import { icons } from "./icons";
import { closeMenu, confirmUnsaved, dialog, showMenu, toast, type MenuEntry } from "./ui";
import * as settings from "./settings";
import { openSettings } from "./settings-panel";
import { FileTree } from "./filetree";
import { openPalette, type PaletteItem, type PaletteSource } from "./palette";
import {
  MARKDOWN_EXTS,
  basename,
  dirname,
  fileMtime,
  frontendReady,
  isMac,
  isMarkdownPath,
  listFolder,
  newWindow,
  pathKey,
  readText,
  menuVisible,
  resolvePath,
  setMenuVisible,
  writeText,
  type OpenRequest,
} from "./platform";

export type Mode = "read" | "split" | "edit";
const MODES: Mode[] = ["read", "split", "edit"];

interface Tab {
  id: number;
  path: string | null;
  untitledNo: number;
  state: EditorState;
  savedDoc: Text;
  bom: boolean;
  eol: "\n" | "\r\n";
  mtime: number | null;
  mode: Mode;
  external: null | "changed" | "deleted";
  saving: boolean;
  /** Fractional 0-based source line at the top of the view, restored on activation. */
  topLine: number;
  autoSaveTimer: number;
}

const mod = isMac ? "⌘" : "Ctrl+";
/** Formats a shortcut like "Shift+P" for the current OS ("⌘⇧P" or "Ctrl+Shift+P"). */
const keys = (combo: string) => (isMac ? `⌘${combo.replace("Shift+", "⇧")}` : `Ctrl+${combo}`);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const SERIF = 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif';
const WIDTHS = { narrow: "680px", medium: "820px", wide: "1040px", full: "none" } as const;
const MD_FILTERS = [
  { name: "Markdown", extensions: MARKDOWN_EXTS },
  { name: "All files", extensions: ["*"] },
];

export class App {
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private nextId = 1;
  private win = getCurrentWebviewWindow();

  private view: EditorView;
  private preview: Preview;
  private scrollMap: ScrollMap;
  private find: FindBar;

  private workspace = $("#workspace");
  private tabsEl = $("#tabs");
  private editorPane = $("#editor-pane");
  private previewPane = $("#preview-pane");
  private tocEl = $("#toc");
  private tocList = $("#toc-list");
  private fileTree = new FileTree($("#files-panel"), {
    open: (path) => void this.openPath(path),
    openFolder: () => void this.openFolderDialog(),
  });
  private banner = $("#banner");
  private welcome = $("#welcome");

  private renderTimer = 0;
  private syncLock: "editor" | "preview" | null = null;
  private syncTimer = 0;
  private tocHeadings: { line: number; el: HTMLElement }[] = [];
  private wordCount = 0;
  private restoring = true;
  private version = "dev";

  /** Every user-facing action, addressed by the same ids as the native menu items. */
  private commands: Record<string, () => unknown> = {
    "new-tab": () => this.newTab(),
    "new-window": () => newWindow(),
    open: () => this.openFileDialog(),
    save: () => this.save(),
    "save-as": () => this.saveAs(),
    reload: () => this.reloadFromDisk(),
    reveal: () => this.active?.path && revealItemInDir(this.active.path),
    "close-tab": () => this.active && this.closeTab(this.active),
    settings: () => this.showSettings(),
    about: () => this.showAbout(),
    "mode-read": () => this.setMode("read"),
    "mode-split": () => this.setMode("split"),
    "mode-edit": () => this.setMode("edit"),
    "cycle-mode": () => this.cycleMode(),
    "toggle-outline": () => this.showPanel("outline", true),
    "show-files": () => this.showPanel("files", false),
    "toggle-sidebar": () => this.setSidebar(this.tocEl.hidden === true),
    "open-folder": () => this.openFolderDialog(),
    "close-folder": () => this.setFolder(null),
    "quick-open": () => this.quickOpen(),
    "command-palette": () => this.commandPalette(),
    find: () => this.openFind(),
    "cycle-theme": () => this.cycleTheme(),
    "zoom-in": () => this.zoom(0.1),
    "zoom-out": () => this.zoom(-0.1),
    "zoom-reset": () => this.zoom(null),
    "next-tab": () => this.cycleTab(1),
    "prev-tab": () => this.cycleTab(-1),
    "move-tab": () => this.active && this.moveToNewWindow(this.active),
    "toggle-auto-reload": () => this.toggleAutoReload(),
  };
  private lastCommand = { id: "", source: "", time: 0 };

  constructor() {
    this.view = createEditor(this.editorPane, (u) => this.onEditorUpdate(u));
    this.preview = new Preview(this.previewPane, {
      onToggleTask: (line) => this.toggleTask(line),
      onLink: (href) => void this.followLink(href),
      onJumpToSource: (line, how) => this.jumpToSource(line, how),
    });
    this.scrollMap = new ScrollMap(this.previewPane);
    this.find = new FindBar(this.workspace, this.previewPane, this.preview.body);
  }

  async start(): Promise<void> {
    this.version = await getVersion().catch(() => null) ?? "dev";
    if (!isMac) settings.set("menuBar", (await menuVisible().catch(() => false)) === true);
    this.applySettings();
    this.bindChrome();
    this.bindKeys();
    this.bindScrollSync();
    await this.bindWindow();
    this.refreshUi();
    try {
      await this.restoreSession();
    } finally {
      this.restoring = false;
    }
    await this.openRequests(await frontendReady());
    setInterval(() => void this.pollDisk(), 1500);
  }

  /** Runs a command. `source` tells shortcuts that arrive twice (webview keydown + native menu accelerator) apart. */
  runCommand(id: string, source: "key" | "menu" | "ui"): void {
    if (source !== "ui" && document.querySelector(".modal-backdrop")) return;
    const now = performance.now();
    const last = this.lastCommand;
    if (source !== "ui" && last.id === id && last.source !== source && last.source !== "ui" && now - last.time < 250) return;
    this.lastCommand = { id, source, time: now };
    closeMenu();
    const result = this.commands[id]?.();
    if (result instanceof Promise) result.catch((e) => toast(String(e), "error"));
  }

  // ------------------------------------------------------------------ tabs

  private isDirty(tab: Tab): boolean {
    return !tab.state.doc.eq(tab.savedDoc);
  }

  /** Whether this tab reloads silently when its file changes: the file's own override, else the global setting. */
  private autoReloadFor(tab: Tab): boolean {
    if (!tab.path) return false;
    return settings.reloadOverride(pathKey(tab.path)) ?? settings.get("autoReload");
  }

  private toggleAutoReload(tab: Tab | null = this.active): void {
    if (!tab?.path) return;
    const next = !this.autoReloadFor(tab);
    // Store an override only when it differs from the global default.
    settings.setReloadOverride(pathKey(tab.path), next === settings.get("autoReload") ? undefined : next);
    this.flash(`Auto-reload ${next ? "on" : "off"} for ${this.tabName(tab)}`);
    if (next && tab.external === "changed" && !this.isDirty(tab)) void this.reloadFromDisk(tab);
    else this.refreshUi();
  }

  private tabName(tab: Tab): string {
    return tab.path ? basename(tab.path) : tab.untitledNo > 1 ? `Untitled-${tab.untitledNo}` : "Untitled";
  }

  private createTab(path: string | null, text: string, opts: Partial<Tab> = {}): Tab {
    const state = makeState(text);
    const untitledNo = path ? 0 : Math.max(0, ...this.tabs.map((t) => t.untitledNo)) + 1;
    const tab: Tab = {
      id: this.nextId++,
      path,
      untitledNo,
      state,
      savedDoc: state.doc,
      bom: false,
      eol: "\n",
      mtime: null,
      mode: path ? settings.get("defaultMode") : "split",
      external: null,
      saving: false,
      topLine: 0,
      autoSaveTimer: 0,
      ...opts,
    };
    // Reuse a blank, untouched "Untitled" tab instead of piling up empty ones.
    const blank = this.active && !this.active.path && this.active.state.doc.length === 0 ? this.active : null;
    const index = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length;
    this.tabs.splice(index, 0, tab);
    if (blank && path) this.removeTab(blank, false);
    this.activate(tab);
    return tab;
  }

  newTab(): void {
    this.createTab(null, "");
    this.view.focus();
  }

  private activate(tab: Tab): void {
    if (this.active === tab) return;
    this.stashScroll();
    this.active = tab;
    this.view.setState(tab.state);
    this.renderNow();
    this.refreshUi();
    requestAnimationFrame(() => {
      if (this.active !== tab) return;
      this.lockSync("editor");
      if (tab.mode !== "read") revealLine(this.view, tab.topLine);
      if (tab.mode !== "edit") this.previewPane.scrollTop = this.scrollMap.topForLine(tab.topLine);
    });
  }

  /** The source line at the top of whichever pane leads in the current mode. */
  private currentTopLine(): number {
    if (!this.active) return 0;
    return this.active.mode === "edit"
      ? editorTopLine(this.view)
      : this.scrollMap.lineForTop(this.previewPane.scrollTop);
  }

  private stashScroll(): void {
    if (this.active) this.active.topLine = this.currentTopLine();
  }

  async closeTab(tab: Tab): Promise<boolean> {
    if (this.isDirty(tab)) {
      this.activate(tab);
      const choice = await confirmUnsaved(this.tabName(tab));
      if (choice === "cancel") return false;
      if (choice === "save" && !(await this.save(tab))) return false;
    }
    this.removeTab(tab, true);
    return true;
  }

  private removeTab(tab: Tab, activateNeighbor: boolean): void {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (activateNeighbor && next) this.activate(next);
      else if (!next) {
        this.view.setState(makeState(""));
        this.preview.clear();
      }
    }
    this.refreshUi();
  }

  private async closeOthers(keep: Tab, onlyRight = false): Promise<void> {
    const start = onlyRight ? this.tabs.indexOf(keep) + 1 : 0;
    for (const t of this.tabs.slice(start)) {
      if (t !== keep && !(await this.closeTab(t))) return;
    }
  }

  private async moveToNewWindow(tab: Tab): Promise<void> {
    const doc: OpenRequest = { path: tab.path, content: this.isDirty(tab) ? tab.state.doc.toString() : null };
    try {
      await newWindow([doc]);
      this.removeTab(tab, true);
    } catch (e) {
      toast(`Couldn't open a new window: ${e}`, "error");
    }
  }

  // ------------------------------------------------------------ open/save

  async openRequests(docs: OpenRequest[]): Promise<void> {
    for (const d of docs) {
      if (d.folder) {
        await this.openFolder(d.folder);
      } else if (d.path) {
        const tab = await this.openPath(d.path);
        if (tab && d.content != null) this.replaceDoc(tab, d.content, false);
      } else if (d.content != null) {
        this.createTab(null, d.content);
      }
    }
  }

  /** Opens a file in a new tab (or focuses its existing tab). `quiet` suppresses the error toast. */
  async openPath(path: string, opts: { quiet?: boolean; tab?: Partial<Tab> } = {}): Promise<Tab | null> {
    const existing = this.tabs.find((t) => t.path && pathKey(t.path) === pathKey(path));
    if (existing) {
      this.activate(existing);
      return existing;
    }
    try {
      const file = await readText(path);
      const tab = this.createTab(path, file.text, {
        bom: file.bom,
        eol: file.text.includes("\r\n") ? "\r\n" : "\n",
        mtime: file.mtime,
        ...opts.tab,
      });
      settings.addRecent(path);
      return tab;
    } catch (e) {
      settings.removeRecent(path);
      if (!opts.quiet) toast(`Couldn't open ${basename(path)}: ${e}`, "error");
      this.refreshUi();
      return null;
    }
  }

  /** Reopens the main window's tabs from the last run. */
  private async restoreSession(): Promise<void> {
    if (this.win.label !== "main" || !settings.get("restoreSession")) return;
    const { tabs, active, folder } = settings.session();
    if (folder) await this.openFolder(folder, true);
    const opened: (Tab | null)[] = [];
    for (const t of tabs)
      opened.push(await this.openPath(t.path, { quiet: true, tab: { mode: t.mode, topLine: t.topLine } }));
    const target = opened[active];
    if (target && target !== this.active) this.activate(target);
  }

  private sessionTimer = 0;

  private scheduleSessionSave(): void {
    if (this.win.label !== "main") return;
    clearTimeout(this.sessionTimer);
    this.sessionTimer = window.setTimeout(() => this.saveSession(), 400);
  }

  private saveSession(): void {
    if (this.win.label !== "main" || this.restoring) return;
    this.stashScroll();
    const saved = this.tabs.filter((t) => t.path);
    settings.saveSession({
      tabs: saved.map((t) => ({ path: t.path!, mode: t.mode, topLine: t.topLine })),
      active: Math.max(0, this.active ? saved.indexOf(this.active) : 0),
      folder: this.fileTree.folder,
    });
  }

  // ---------------------------------------------------------------- folder

  async openFolderDialog(): Promise<void> {
    const picked = await openDialog({
      directory: true,
      defaultPath: this.fileTree.folder ?? (this.active?.path ? dirname(this.active.path) : undefined),
    });
    if (typeof picked === "string") await this.openFolder(picked);
  }

  /** Shows a folder in the sidebar. Returns false if it can't be listed. */
  async openFolder(path: string, quiet = false): Promise<boolean> {
    try {
      const listing = await listFolder(path);
      this.fileTree.setFolder(path, listing.files, listing.truncated);
      this.fileTree.setActive(this.active?.path ?? null);
      this.workspace.classList.add("has-folder");
      if (!quiet) this.showPanel("files", false);
      this.scheduleSessionSave();
      return true;
    } catch (e) {
      if (!quiet) toast(`Couldn't open folder: ${e}`, "error");
      return false;
    }
  }

  private setFolder(path: null): void {
    this.fileTree.setFolder(path, []);
    this.workspace.classList.remove("has-folder");
    if (settings.get("sidebarPanel") === "files") this.showPanel("outline", false);
    this.scheduleSessionSave();
  }

  private refreshingFolder = false;

  /** Re-reads the open folder so new, renamed and deleted files show up. */
  private async refreshFolder(): Promise<void> {
    const folder = this.fileTree.folder;
    if (!folder || this.refreshingFolder || document.visibilityState !== "visible") return;
    this.refreshingFolder = true;
    try {
      const listing = await listFolder(folder);
      if (this.fileTree.folder === folder) this.fileTree.setFolder(folder, listing.files, listing.truncated);
    } catch {
      /* folder gone; keep showing the last listing */
    } finally {
      this.refreshingFolder = false;
    }
  }

  // --------------------------------------------------------------- palette

  private quickOpen(): void {
    const seen = new Set<string>();
    const fileItem = (path: string, detail: string, hint?: string): PaletteItem | null => {
      const key = pathKey(path);
      if (seen.has(key)) return null;
      seen.add(key);
      return { label: basename(path), detail, hint, run: () => void this.openPath(path) };
    };
    const folder = this.fileTree.folder;
    // Files inside the open folder show their folder relative to it; others their full folder.
    const relDirs = new Map(this.fileTree.entries.map((f) => [pathKey(f.path), f.rel.split("/").slice(0, -1).join("/")]));
    const where = (path: string) => relDirs.get(pathKey(path)) ?? dirname(path);
    const source: PaletteSource = {
      placeholder: folder ? `Go to a file in ${basename(folder)} (type > for commands)` : "Go to an open or recent file (type > for commands)",
      empty: folder ? "No matching files" : "No matching files. Open a folder to search all of its files.",
      items: () => {
        seen.clear();
        const items: (PaletteItem | null)[] = [];
        for (const t of this.tabs) if (t.path) items.push(fileItem(t.path, where(t.path), "open"));
        for (const f of this.fileTree.entries) items.push(fileItem(f.path, where(f.path)));
        for (const r of settings.recent()) items.push(fileItem(r, where(r), "recent"));
        return items.filter((i): i is PaletteItem => i !== null);
      },
      prefixes: { ">": this.commandSource() },
    };
    openPalette(source);
  }

  private commandPalette(): void {
    openPalette({ ...this.commandSource(), prefixes: undefined }, "");
  }

  private commandSource(): PaletteSource {
    const list: [id: string, label: string, shortcut?: string][] = [
      ["quick-open", "Go to File…", keys("P")],
      ["open", "Open File…", keys("O")],
      ["open-folder", "Open Folder…", keys("Shift+F")],
      ["close-folder", "Close Folder"],
      ["new-tab", "New Tab", keys("T")],
      ["new-window", "New Window", keys("Shift+N")],
      ["save", "Save", keys("S")],
      ["save-as", "Save As…", keys("Shift+S")],
      ["close-tab", "Close Tab", keys("W")],
      ["reload", "Reload from Disk"],
      ["reveal", "Reveal in Folder"],
      ["move-tab", "Move Tab to New Window"],
      ["toggle-auto-reload", "Toggle Auto-reload for This File"],
      ["mode-read", "View: Read"],
      ["mode-split", "View: Split"],
      ["mode-edit", "View: Edit"],
      ["cycle-mode", "View: Cycle Read / Split / Edit", keys("E")],
      ["toggle-sidebar", "Toggle Sidebar", keys("\\")],
      ["show-files", "Show Files"],
      ["toggle-outline", "Show Outline", keys("Shift+O")],
      ["find", "Find", keys("F")],
      ["next-tab", "Next Tab", "Ctrl+Tab"],
      ["prev-tab", "Previous Tab", "Ctrl+Shift+Tab"],
      ["cycle-theme", "Change Theme"],
      ["zoom-in", "Zoom In", keys("=")],
      ["zoom-out", "Zoom Out", keys("-")],
      ["zoom-reset", "Actual Size", keys("0")],
      ["settings", "Settings…", keys(",")],
      ["about", "About Folio"],
    ];
    return {
      placeholder: "Run a command",
      empty: "No matching commands",
      items: () => list.map(([id, label, hint]) => ({ label, hint, run: () => this.runCommand(id, "ui") })),
    };
  }

  async openFileDialog(): Promise<void> {
    const picked = await openDialog({
      multiple: true,
      filters: MD_FILTERS,
      defaultPath: this.active?.path ? dirname(this.active.path) : undefined,
    });
    if (!picked) return;
    for (const p of Array.isArray(picked) ? picked : [picked]) await this.openPath(p);
  }

  async save(tab: Tab | null = this.active, quiet = false): Promise<boolean> {
    if (!tab) return false;
    if (!tab.path) return this.saveAs(tab);
    clearTimeout(tab.autoSaveTimer);
    const doc = tab.state.doc;
    const text = tab.eol === "\r\n" ? doc.toString().replace(/\n/g, "\r\n") : doc.toString();
    tab.saving = true;
    try {
      tab.mtime = await writeText(tab.path, text, tab.bom);
      tab.savedDoc = doc;
      tab.external = null;
      this.refreshUi();
      if (!quiet) this.flash("Saved");
      return true;
    } catch (e) {
      toast(`Couldn't save ${this.tabName(tab)}: ${e}`, "error");
      return false;
    } finally {
      tab.saving = false;
    }
  }

  async saveAs(tab: Tab | null = this.active): Promise<boolean> {
    if (!tab) return false;
    const path = await saveDialog({
      defaultPath: tab.path ?? `${this.tabName(tab)}.md`,
      filters: MD_FILTERS,
    });
    if (!path) return false;
    tab.path = path;
    tab.untitledNo = 0;
    settings.addRecent(path);
    return this.save(tab);
  }

  /** Replaces a tab's document; `asSaved` marks the result as the on-disk version. */
  private replaceDoc(tab: Tab, text: string, asSaved: boolean): void {
    const change = minimalReplace(tab.state, text.replace(/\r\n?/g, "\n"));
    if (change) {
      if (tab === this.active) this.view.dispatch({ changes: change, userEvent: "external" });
      else tab.state = tab.state.update({ changes: change }).state;
    }
    if (asSaved) tab.savedDoc = tab.state.doc;
    if (tab !== this.active) this.refreshUi();
  }

  async reloadFromDisk(tab: Tab | null = this.active): Promise<void> {
    if (!tab?.path) return;
    try {
      const file = await readText(tab.path);
      tab.bom = file.bom;
      tab.eol = file.text.includes("\r\n") ? "\r\n" : "\n";
      tab.mtime = file.mtime;
      tab.external = null;
      this.replaceDoc(tab, file.text, true);
      this.refreshUi();
    } catch (e) {
      toast(`Couldn't reload ${this.tabName(tab)}: ${e}`, "error");
    }
  }

  private polling = false;

  /** Detects files changed or removed by other programs. */
  private async pollDisk(): Promise<void> {
    this.scheduleSessionSave(); // keeps saved scroll positions current
    if (this.polling) return;
    this.polling = true;
    try {
      for (const tab of [...this.tabs]) {
        if (!tab.path || tab.saving) continue;
        const mtime = await fileMtime(tab.path).catch(() => null);
        if (tab.saving || !this.tabs.includes(tab)) continue;
        if (mtime === null) {
          if (tab.external !== "deleted") {
            tab.external = "deleted";
            this.refreshUi();
          }
        } else if (mtime !== tab.mtime) {
          // By default the user decides when to reload (banner); auto-reload is opt-in
          // and never discards unsaved edits.
          if (!this.isDirty(tab) && this.autoReloadFor(tab)) {
            await this.reloadFromDisk(tab);
            if (tab === this.active) this.flash("Reloaded from disk");
          } else if (tab.external !== "changed") {
            tab.external = "changed";
            this.refreshUi();
          }
        } else if (tab.external === "deleted") {
          tab.external = null;
          this.refreshUi();
        }
      }
    } finally {
      this.polling = false;
    }
  }

  // --------------------------------------------------------------- preview

  private onEditorUpdate(u: ViewUpdate): void {
    const tab = this.active;
    if (!tab) return;
    tab.state = u.state;
    if (u.docChanged) {
      this.scheduleRender();
      this.refreshUi();
      if (settings.get("autoSave") && tab.path && !tab.external) {
        clearTimeout(tab.autoSaveTimer);
        tab.autoSaveTimer = window.setTimeout(() => {
          if (this.tabs.includes(tab) && this.isDirty(tab) && !tab.external) void this.save(tab, true);
        }, 1000);
      }
    } else if (u.selectionSet) {
      this.updateStatus();
    }
  }

  private scheduleRender(): void {
    clearTimeout(this.renderTimer);
    const delay = (this.active?.state.doc.length ?? 0) > 200_000 ? 400 : 120;
    this.renderTimer = window.setTimeout(() => this.renderNow(), delay);
  }

  private renderNow(): void {
    clearTimeout(this.renderTimer);
    const tab = this.active;
    if (!tab) return;
    this.preview.render(tab.state.doc.toString(), tab.path, settings.resolvedTheme());
    this.scrollMap.invalidate();
    this.wordCount = this.preview.wordCount();
    this.buildToc();
    this.find.refresh();
    this.updateStatus();
    if (tab.mode === "split" && this.syncLock !== "preview") this.syncPreviewToEditor();
  }

  private toggleTask(line: number): void {
    const tab = this.active;
    if (!tab) return;
    const doc = this.view.state.doc;
    if (line + 1 > doc.lines) return;
    const l = doc.line(line + 1);
    const next = toggleTaskLine(l.text);
    if (next === null) return this.renderNow();
    const wasClean = !this.isDirty(tab);
    this.view.dispatch({ changes: { from: l.from, to: l.to, insert: next }, userEvent: "input.toggle-task" });
    // In a clean document a checkbox tick is saved right away, like any other viewer action.
    if (wasClean && tab.path) void this.save(tab);
  }

  private jumpToSource(line: number, how: "modclick" | "dblclick"): void {
    const tab = this.active;
    if (!tab) return;
    if (tab.mode === "read") {
      if (how === "dblclick") return; // keep double-click for word selection while reading
      this.setMode("split");
    }
    const doc = this.view.state.doc;
    const pos = doc.line(Math.min(doc.lines, line + 1)).from;
    this.lockSync("preview");
    this.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    this.view.focus();
  }

  private async followLink(href: string): Promise<void> {
    if (/^[a-z][\w+.-]*:/i.test(href) && !/^file:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) {
      await openUrl(href).catch((e) => toast(`Couldn't open link: ${e}`, "error"));
      return;
    }
    const [rawPath, fragment] = href.split("#");
    let rel = rawPath;
    try {
      if (/^file:/i.test(rawPath)) {
        rel = decodeURIComponent(new URL(rawPath).pathname);
        if (/^\/[a-z]:/i.test(rel)) rel = rel.slice(1); // file:///C:/x -> C:/x
      } else {
        rel = decodeURI(rawPath);
      }
    } catch {
      /* keep raw */
    }
    const base = this.active?.path ? dirname(this.active.path) : null;
    if (!base && !/^([a-z]:[\\/]|\/)/i.test(rel)) {
      toast("Save this document first to follow relative links.");
      return;
    }
    const target = resolvePath(base ?? "", rel);
    if (isMarkdownPath(target)) {
      const tab = await this.openPath(target);
      if (tab && fragment) requestAnimationFrame(() => this.preview.scrollToId(decodeURIComponent(fragment)));
    } else {
      await revealItemInDir(target).catch((e) => toast(`Couldn't open ${basename(target)}: ${e}`, "error"));
    }
  }

  // ----------------------------------------------------------- scroll sync

  private lockSync(source: "editor" | "preview"): void {
    this.syncLock = source;
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => (this.syncLock = null), 120);
  }

  private syncPreviewToEditor(): void {
    this.previewPane.scrollTop = this.scrollMap.topForLine(editorTopLine(this.view));
  }

  private syncEditorToPreview(): void {
    scrollEditorToLine(this.view, this.scrollMap.lineForTop(this.previewPane.scrollTop));
  }

  private bindScrollSync(): void {
    this.view.scrollDOM.addEventListener("scroll", () => {
      if (this.active?.mode === "split" && this.syncLock !== "preview") {
        this.lockSync("editor");
        this.syncPreviewToEditor();
      }
      if (this.active?.mode === "edit") this.updateTocActive();
    });
    this.previewPane.addEventListener("scroll", () => {
      if (this.active?.mode === "split" && this.syncLock !== "editor") {
        this.lockSync("preview");
        this.syncEditorToPreview();
      }
      this.updateTocActive();
    });
    // Images, diagrams and window resizes all move blocks around.
    const invalidate = new ResizeObserver(() => this.scrollMap.invalidate());
    invalidate.observe(this.preview.body);
    invalidate.observe(this.previewPane);
  }

  // ------------------------------------------------------------------ mode

  setMode(mode: Mode): void {
    const tab = this.active;
    if (!tab || tab.mode === mode) return;
    // Carry the reading position across the switch.
    const line = this.currentTopLine();
    tab.mode = mode;
    this.applyMode();
    this.updateStatus();
    this.scheduleSessionSave();
    requestAnimationFrame(() => {
      this.scrollMap.invalidate();
      this.lockSync("editor");
      if (mode !== "read") revealLine(this.view, line);
      if (mode !== "edit") this.previewPane.scrollTop = this.scrollMap.topForLine(line);
    });
    if (mode === "edit" && this.find.isOpen) this.find.close();
    if (mode !== "read") this.view.focus();
  }

  private cycleMode(): void {
    if (!this.active) return;
    this.setMode(MODES[(MODES.indexOf(this.active.mode) + 1) % MODES.length]);
  }

  private applyMode(): void {
    const mode = this.active?.mode ?? "read";
    this.workspace.dataset.mode = this.active ? mode : "none";
    for (const b of document.querySelectorAll<HTMLElement>("#modes button"))
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  }

  // ------------------------------------------------------------------- toc

  private buildToc(): void {
    this.tocList.innerHTML = "";
    this.tocHeadings = [];
    const headings = this.preview.headings();
    if (!headings.length) {
      this.tocList.innerHTML = `<p class="toc-empty">No headings</p>`;
      return;
    }
    const minLevel = Math.min(...headings.map((h) => Number(h.tagName[1])));
    for (const h of headings) {
      const item = document.createElement("a");
      item.className = "toc-item";
      item.style.setProperty("--depth", String(Number(h.tagName[1]) - minLevel));
      item.textContent = h.textContent;
      item.title = h.textContent ?? "";
      const line = Number(h.dataset.line ?? 0);
      item.addEventListener("click", () => {
        if (this.active?.mode === "edit") revealLine(this.view, line);
        else h.scrollIntoView({ block: "start" });
      });
      this.tocList.appendChild(item);
      this.tocHeadings.push({ line, el: item });
    }
    this.updateTocActive();
  }

  private updateTocActive(): void {
    if (this.tocEl.hidden || this.tocEl.dataset.panel !== "outline" || !this.tocHeadings.length) return;
    const line =
      this.active?.mode === "edit"
        ? editorTopLine(this.view)
        : this.scrollMap.lineForTop(this.previewPane.scrollTop + 24);
    let current = this.tocHeadings[0];
    for (const h of this.tocHeadings) if (h.line <= line + 0.5) current = h;
    for (const h of this.tocHeadings) h.el.classList.toggle("active", h === current);
  }

  private setSidebar(visible: boolean): void {
    this.tocEl.hidden = !visible;
    settings.set("toc", visible);
    this.scrollMap.invalidate();
    this.updateTocActive();
  }

  /**
   * Shows a sidebar panel. With `toggle`, asking for the panel that is already
   * showing hides the sidebar instead.
   */
  private showPanel(panel: "files" | "outline", toggle: boolean): void {
    const showing = this.tocEl.hidden !== true && settings.get("sidebarPanel") === panel;
    if (toggle && showing) return this.setSidebar(false);
    settings.set("sidebarPanel", panel);
    this.applySidebarPanel();
    this.setSidebar(true);
  }

  private applySidebarPanel(): void {
    const panel = settings.get("sidebarPanel");
    this.tocEl.dataset.panel = panel;
    for (const b of this.tocEl.querySelectorAll<HTMLElement>(".sidebar-tabs button"))
      b.setAttribute("aria-selected", String(b.dataset.panel === panel));
  }

  // -------------------------------------------------------------------- UI

  private refreshUi(): void {
    this.scheduleSessionSave();
    this.renderTabs();
    this.applyMode();
    this.renderBanner();
    this.updateStatus();
    this.fileTree.setActive(this.active?.path ?? null);
    this.welcome.hidden = this.tabs.length > 0;
    if (!this.tabs.length) this.renderWelcome();
    const tab = this.active;
    const title = tab ? `${this.isDirty(tab) ? "● " : ""}${this.tabName(tab)} — Folio` : "Folio";
    if (document.title !== title) {
      document.title = title;
      void this.win.setTitle(title).catch(() => {});
    }
  }

  private renderTabs(): void {
    this.tabsEl.innerHTML = "";
    for (const tab of this.tabs) {
      const el = document.createElement("div");
      el.className = "tab";
      el.dataset.id = String(tab.id);
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(tab === this.active));
      el.title = tab.path ?? this.tabName(tab);
      if (this.isDirty(tab)) el.classList.add("dirty");
      if (tab.external) el.classList.add("stale");
      el.innerHTML = `<span class="tab-icon">${icons.file}</span><span class="tab-name"></span><button class="tab-close" title="Close (${mod}W)" aria-label="Close tab">${icons.close}</button>`;
      el.querySelector(".tab-name")!.textContent = this.tabName(tab);
      this.tabsEl.appendChild(el);
    }
    this.tabsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private renderBanner(): void {
    const tab = this.active;
    if (!tab?.external) {
      this.banner.hidden = true;
      return;
    }
    this.banner.hidden = false;
    this.banner.innerHTML =
      tab.external === "changed"
        ? this.isDirty(tab)
          ? `<span>This file was changed by another program. Reloading will discard your unsaved edits.</span><button class="btn small primary" data-act="reload">Reload</button><button class="btn small" data-act="keep">Keep my version</button>`
          : `<span>This file was changed by another program.</span><button class="btn small primary" data-act="reload">Reload</button><button class="btn small" data-act="always">Always reload this file</button><button class="btn small" data-act="keep">Ignore</button>`
        : `<span>This file was deleted or moved.</span><button class="btn small primary" data-act="save">Save to recreate</button><button class="btn small" data-act="close">Close tab</button>`;
  }

  private renderWelcome(): void {
    const list = $("#recent-list");
    list.innerHTML = "";
    const recent = settings.recent();
    $("#recent").hidden = !recent.length;
    for (const path of recent.slice(0, 8)) {
      const item = document.createElement("button");
      item.className = "recent-item";
      item.innerHTML = `<span class="recent-name"></span><span class="recent-dir"></span>`;
      item.querySelector(".recent-name")!.textContent = basename(path);
      item.querySelector(".recent-dir")!.textContent = dirname(path);
      item.title = path;
      item.addEventListener("click", () => void this.openPath(path));
      list.appendChild(item);
    }
  }

  private updateStatus(): void {
    const tab = this.active;
    $("#statusbar").hidden = !tab;
    if (!tab) return;
    $("#st-path").textContent = tab.path ?? this.tabName(tab);
    $("#st-path").title = tab.path ?? "";
    const state = tab.state;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    $("#st-pos").textContent = tab.mode === "read" ? "" : `Ln ${line.number}, Col ${head - line.from + 1}`;
    const words = this.wordCount;
    $("#st-words").textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"} · ${Math.max(1, Math.round(words / 230))} min read`;
    $("#st-eol").textContent = tab.eol === "\r\n" ? "CRLF" : "LF";

    const reload = $("#st-reload");
    reload.hidden = !tab.path;
    const on = this.autoReloadFor(tab);
    reload.classList.toggle("on", on);
    reload.setAttribute("aria-pressed", String(on));
    reload.innerHTML = `${icons.reload}<span>Auto-reload</span>`;
    reload.title = on
      ? "This file reloads automatically when another program changes it. Click to ask first instead."
      : "Folio asks before reloading this file when another program changes it. Click to reload automatically.";
  }

  private flashTimer = 0;
  private flash(message: string): void {
    const el = $("#st-flash");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => el.classList.remove("show"), 1600);
  }

  private applyTheme(): void {
    const pref = settings.get("theme");
    document.documentElement.dataset.theme = settings.resolvedTheme();
    const btn = $("#btn-theme");
    btn.innerHTML = pref === "light" ? icons.sun : pref === "dark" ? icons.moon : icons.auto;
    btn.title = `Theme: ${pref[0].toUpperCase()}${pref.slice(1)}`;
  }

  private cycleTheme(): void {
    const order = ["system", "light", "dark"] as const;
    settings.set("theme", order[(order.indexOf(settings.get("theme")) + 1) % order.length]);
    this.applyTheme();
    this.renderNow();
  }

  private applyZoom(): void {
    document.documentElement.style.setProperty("--zoom", String(settings.get("zoom")));
    this.view.requestMeasure();
    this.scrollMap.invalidate();
  }

  private zoom(delta: number | null): void {
    const z = delta === null ? 1 : Math.min(2, Math.max(0.6, Math.round((settings.get("zoom") + delta) * 10) / 10));
    settings.set("zoom", z);
    this.applyZoom();
    this.flash(`Zoom ${Math.round(z * 100)}%`);
  }

  /** Applies every setting; also runs when another window changes one. */
  private applySettings(): void {
    this.applyTheme();
    this.applyZoom();
    const root = document.documentElement.style;
    root.setProperty("--editor-font-size", `${settings.get("editorFontSize")}px`);
    root.setProperty("--font-text", settings.get("previewFont") === "serif" ? SERIF : "var(--font-ui)");
    root.setProperty("--content-width", WIDTHS[settings.get("previewWidth")] ?? WIDTHS.medium);
    const effects = setEditorConfig({ lineNumbers: settings.get("lineNumbers"), wrapLines: settings.get("wrapLines") });
    this.view.dispatch({ effects });
    for (const t of this.tabs) if (t !== this.active) t.state = t.state.update({ effects }).state;
    this.tocEl.hidden = !settings.get("toc");
    this.applySidebarPanel();
    this.workspace.style.setProperty("--split", String(settings.get("split")));
    this.scrollMap.invalidate();
    this.updateStatus(); // the auto-reload indicator follows the global default
  }

  private showSettings(): void {
    openSettings(
      (key) => {
        if (key === "menuBar") void setMenuVisible(settings.get("menuBar")).catch((e) => toast(String(e), "error"));
        this.applySettings();
        if (key === "theme" || key === "previewFont" || key === "previewWidth") this.renderNow();
      },
      { menuBar: !isMac, version: this.version },
    );
  }

  private showAbout(): Promise<null> {
    return dialog(
      "Folio",
      `Version ${this.version}. A light, fast Markdown viewer and editor.`,
      [{ label: "OK", value: null, primary: true }],
      null,
    );
  }

  private appMenuEntries(): MenuEntry[] {
    const tab = this.active;
    const item = (label: string, id: string, shortcut?: string, disabled = false): MenuEntry => ({
      label,
      shortcut,
      disabled,
      action: () => this.runCommand(id, "ui"),
    });
    return [
      item("New Tab", "new-tab", keys("T")),
      item("Open File…", "open", keys("O")),
      item("Open Folder…", "open-folder", keys("Shift+F")),
      item("Go to File…", "quick-open", keys("P")),
      item("Save", "save", keys("S"), !tab),
      item("Save As…", "save-as", keys("Shift+S"), !tab),
      "separator",
      item("New Window", "new-window", keys("Shift+N")),
      item("Move Tab to New Window", "move-tab", undefined, !tab),
      "separator",
      item("Command Palette…", "command-palette", keys("Shift+P")),
      item("Find", "find", keys("F"), !tab),
      item("Toggle Sidebar", "toggle-sidebar", keys("\\")),
      item("Reload from Disk", "reload", undefined, !tab?.path),
      item("Reveal in Folder", "reveal", undefined, !tab?.path),
      "separator",
      item("Zoom In", "zoom-in", `${mod}+`),
      item("Zoom Out", "zoom-out", `${mod}−`),
      item("Actual Size", "zoom-reset", `${mod}0`),
      "separator",
      item("Settings…", "settings", `${mod},`),
    ];
  }

  private tabMenuEntries(tab: Tab): MenuEntry[] {
    return [
      { label: "Close", shortcut: `${mod}W`, action: () => void this.closeTab(tab) },
      { label: "Close Others", disabled: this.tabs.length < 2, action: () => void this.closeOthers(tab) },
      {
        label: "Close to the Right",
        disabled: this.tabs.indexOf(tab) === this.tabs.length - 1,
        action: () => void this.closeOthers(tab, true),
      },
      "separator",
      { label: "Move to New Window", action: () => void this.moveToNewWindow(tab) },
      {
        label: `${this.autoReloadFor(tab) ? "✓ " : ""}Auto-reload This File`,
        disabled: !tab.path,
        action: () => this.toggleAutoReload(tab),
      },
      "separator",
      {
        label: "Copy Path",
        disabled: !tab.path,
        action: () => tab.path && void navigator.clipboard.writeText(tab.path),
      },
      {
        label: "Reveal in Folder",
        disabled: !tab.path,
        action: () => tab.path && void revealItemInDir(tab.path).catch((e) => toast(String(e), "error")),
      },
    ];
  }

  private openFind(): void {
    const tab = this.active;
    if (!tab) return;
    if (tab.mode === "edit" || (tab.mode === "split" && this.view.hasFocus)) openSearchPanel(this.view);
    else this.find.open();
  }

  private tabById(el: Element | null): Tab | undefined {
    const id = Number(el?.closest<HTMLElement>(".tab")?.dataset.id);
    return this.tabs.find((t) => t.id === id);
  }

  private bindChrome(): void {
    $("#btn-new-tab").innerHTML = icons.plus;
    $("#btn-toc").innerHTML = icons.outline;
    $("#btn-menu").innerHTML = icons.more;
    $("#btn-new-tab").title = `New tab (${mod}T)`;
    $("#btn-toc").title = `Outline (${mod}⇧O)`;
    $("#btn-new-tab").addEventListener("click", () => this.runCommand("new-tab", "ui"));
    $("#st-reload").addEventListener("click", () => this.runCommand("toggle-auto-reload", "ui"));
    $("#btn-toc").addEventListener("click", () => this.runCommand("toggle-outline", "ui"));
    $("#btn-theme").addEventListener("click", () => this.runCommand("cycle-theme", "ui"));
    $("#btn-menu").addEventListener("click", (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      showMenu(r.right - 220, r.bottom + 4, this.appMenuEntries());
    });
    for (const b of document.querySelectorAll<HTMLElement>("#modes button")) {
      b.title += ` (${mod}E to cycle)`;
      b.addEventListener("click", () => this.setMode(b.dataset.mode as Mode));
    }
    $("#welcome-open").addEventListener("click", () => void this.openFileDialog());
    $("#welcome-new").addEventListener("click", () => this.newTab());
    $("#welcome-folder").addEventListener("click", () => void this.openFolderDialog());
    for (const b of this.tocEl.querySelectorAll<HTMLElement>(".sidebar-tabs button"))
      b.addEventListener("click", () => this.showPanel(b.dataset.panel as "files" | "outline", false));
    window.addEventListener("focus", () => void this.refreshFolder());
    setInterval(() => void this.refreshFolder(), 10_000);
    for (const el of document.querySelectorAll(".kbd-mod")) el.textContent = isMac ? "⌘" : "Ctrl";

    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (settings.get("theme") === "system") {
        this.applyTheme();
        this.renderNow();
      }
    });

    this.banner.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      const tab = this.active;
      if (!act || !tab) return;
      if (act === "reload") void this.reloadFromDisk(tab);
      else if (act === "save") void this.save(tab);
      else if (act === "always") this.toggleAutoReload(tab);
      else if (act === "close") void this.closeTab(tab);
      else if (act === "keep" && tab.path) {
        // Treat the current disk version as seen; the next save overwrites it.
        void fileMtime(tab.path).then((m) => {
          tab.mtime = m;
          tab.external = null;
          this.refreshUi();
        });
      }
    });

    // Tabs: click to activate, middle-click to close, drag to reorder.
    this.tabsEl.addEventListener("pointerdown", (e) => {
      const tab = this.tabById(e.target as Element);
      if (!tab) return;
      if (e.button === 1) {
        e.preventDefault();
        void this.closeTab(tab);
        return;
      }
      if (e.button !== 0 || (e.target as Element).closest(".tab-close")) return;
      this.activate(tab);
      this.dragTab(tab, e);
    });
    this.tabsEl.addEventListener("click", (e) => {
      if (!(e.target as Element).closest(".tab-close")) return;
      const tab = this.tabById(e.target as Element);
      if (tab) void this.closeTab(tab);
    });
    this.tabsEl.addEventListener("dblclick", (e) => {
      if (e.target === this.tabsEl) this.newTab();
    });
    this.tabsEl.addEventListener("contextmenu", (e) => {
      const tab = this.tabById(e.target as Element);
      if (!tab) return;
      e.preventDefault();
      showMenu(e.clientX, e.clientY, this.tabMenuEntries(tab));
    });
    this.tabsEl.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          this.tabsEl.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false },
    );

    // Split divider
    const divider = $("#divider");
    divider.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      divider.setPointerCapture(e.pointerId);
      const box = () => {
        const a = this.editorPane.getBoundingClientRect();
        const b = this.previewPane.getBoundingClientRect();
        return { left: a.left, width: b.right - a.left };
      };
      const move = (ev: PointerEvent) => {
        const { left, width } = box();
        const ratio = Math.min(0.8, Math.max(0.2, (ev.clientX - left) / width));
        this.workspace.style.setProperty("--split", ratio.toFixed(3));
      };
      const up = () => {
        divider.removeEventListener("pointermove", move);
        divider.removeEventListener("pointerup", up);
        settings.set("split", Number(this.workspace.style.getPropertyValue("--split")));
        this.scrollMap.invalidate();
      };
      divider.addEventListener("pointermove", move);
      divider.addEventListener("pointerup", up);
    });
    divider.addEventListener("dblclick", () => {
      this.workspace.style.setProperty("--split", "0.5");
      settings.set("split", 0.5);
    });
  }

  /** Pointer-based reordering (HTML5 drag-and-drop is taken over by the native file drop handler). */
  private dragTab(tab: Tab, down: PointerEvent): void {
    const el = this.tabsEl.querySelector<HTMLElement>(`[data-id="${tab.id}"]`)!;
    let dragging = false;
    const move = (e: PointerEvent) => {
      if (!dragging && Math.abs(e.clientX - down.clientX) < 5) return;
      dragging = true;
      el.classList.add("dragging");
      const siblings = [...this.tabsEl.children].filter((c) => c !== el) as HTMLElement[];
      const before = siblings.find((s) => {
        const r = s.getBoundingClientRect();
        return e.clientX < r.left + r.width / 2;
      });
      if (before) this.tabsEl.insertBefore(el, before);
      else this.tabsEl.appendChild(el);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragging) return;
      const order = [...this.tabsEl.children].map((c) => Number((c as HTMLElement).dataset.id));
      this.tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      this.renderTabs();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private bindKeys(): void {
    const shortcuts: Record<string, string> = {
      o: "open",
      "shift+o": "toggle-outline",
      s: "save",
      "shift+s": "save-as",
      t: "new-tab",
      n: "new-tab",
      "shift+n": "new-window",
      w: "close-tab",
      e: "cycle-mode",
      f: "find",
      ",": "settings",
      p: "quick-open",
      "shift+p": "command-palette",
      "shift+f": "open-folder",
      "\\": "toggle-sidebar",
      pagedown: "next-tab",
      pageup: "prev-tab",
      "=": "zoom-in",
      "+": "zoom-in",
      "shift+=": "zoom-in",
      "shift++": "zoom-in",
      "-": "zoom-out",
      "0": "zoom-reset",
    };
    window.addEventListener(
      "keydown",
      (e) => {
        const primary = isMac ? e.metaKey : e.ctrlKey;
        const key = e.key.toLowerCase();
        const stop = () => {
          e.preventDefault();
          e.stopPropagation();
        };

        if (key === "f5" || (primary && key === "r")) return stop(); // never reload the webview
        if (key === "escape" && this.find.isOpen) {
          stop();
          return this.find.close();
        }

        let id: string | undefined;
        if (e.ctrlKey && key === "tab") id = e.shiftKey ? "prev-tab" : "next-tab";
        else if (primary && !e.altKey) {
          id = shortcuts[(e.shiftKey ? "shift+" : "") + key];
          if (id === "find" && this.view.hasFocus) id = undefined; // CodeMirror's own search panel
          if (!id && /^[1-9]$/.test(key) && !e.shiftKey) {
            const tab = key === "9" ? this.tabs[this.tabs.length - 1] : this.tabs[Number(key) - 1];
            if (tab) {
              stop();
              return this.activate(tab);
            }
          }
        }
        if (id) {
          stop();
          this.runCommand(id, "key");
        }
      },
      true,
    );
  }

  private cycleTab(dir: number): void {
    if (!this.active || this.tabs.length < 2) return;
    const i = this.tabs.indexOf(this.active);
    this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length]);
  }

  private async bindWindow(): Promise<void> {
    await this.win.listen<OpenRequest[]>("open-docs", (e) => void this.openRequests(e.payload));
    await this.win.listen<string>("menu", (e) => this.runCommand(e.payload, "menu"));
    window.addEventListener("storage", (e) => {
      if (!settings.isSettingKey(e.key)) return;
      this.applySettings();
      if (e.key === "folio.theme" || e.key === "folio.previewFont") this.renderNow();
    });

    const overlay = $("#drop-overlay");
    await this.win.onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") overlay.hidden = false;
      else if (p.type === "leave") overlay.hidden = true;
      else if (p.type === "drop") {
        overlay.hidden = true;
        void (async () => {
          for (const path of p.paths) {
            if (isMarkdownPath(path)) await this.openPath(path);
            else if (!(await this.openFolder(path, true)))
              toast(`${basename(path)} isn't a Markdown file or a folder.`);
            else this.showPanel("files", false);
          }
        })();
      }
    });

    await this.win.onCloseRequested(async (e) => {
      this.saveSession();
      const dirty = this.tabs.filter((t) => this.isDirty(t));
      if (!dirty.length) return;
      e.preventDefault();
      for (const tab of dirty) {
        this.activate(tab);
        const choice = await confirmUnsaved(this.tabName(tab));
        if (choice === "cancel") return;
        if (choice === "save" && !(await this.save(tab))) return;
      }
      await this.win.destroy();
    });
  }
}
