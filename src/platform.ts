import { invoke } from "@tauri-apps/api/core";
import { readText as readClipboardText, writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";

export interface TextFile {
  text: string;
  bom: boolean;
  mtime: number | null;
}

export interface OpenRequest {
  path: string | null;
  content: string | null;
  /** A folder to show in the sidebar instead of a document. */
  folder?: string | null;
}

export interface FolderEntry {
  path: string;
  /** Relative to the folder, with `/` separators. */
  rel: string;
}

export interface FolderListing {
  files: FolderEntry[];
  /** Empty folders, relative with `/`. */
  dirs: string[];
  truncated: boolean;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const isWindows = /Win/.test(navigator.platform);

export const readText = (path: string) => invoke<TextFile>("read_text", { path });

export const writeText = (path: string, text: string, bom: boolean) =>
  invoke<number | null>("write_text", { path, text, bom });

export const fileMtime = (path: string) => invoke<number | null>("file_mtime", { path });

export const frontendReady = () => invoke<OpenRequest[]>("frontend_ready");

export const listFolder = (root: string) => invoke<FolderListing>("list_folder", { root });
export interface SearchResults {
  files: { path: string; rel: string; matches: { line: number; col: number; len: number; text: string }[] }[];
  total: number;
  truncated: boolean;
}

export const searchFolder = (root: string, query: string, caseSensitive: boolean, regex: boolean) =>
  invoke<SearchResults>("search_folder", { root, query, caseSensitive, regex });

export const createFile = (path: string) => invoke<void>("create_file", { path });
export const createDir = (path: string) => invoke<void>("create_dir", { path });
export const renamePath = (from: string, to: string) => invoke<void>("rename_path", { from, to });
export const trashPath = (path: string) => invoke<void>("trash_path", { path });

export const newWindow = (docs: OpenRequest[] = []) => invoke<void>("new_window", { docs });

// ---- path helpers (paths come from the OS, so handle both separators) ----

export function basename(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i <= 0 ? p.slice(0, i + 1) : p.slice(0, i);
}

export function isAbsolute(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p);
}

/** Resolves `rel` against directory `base`, collapsing `.` and `..`. */
export function resolvePath(base: string, rel: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const full = isAbsolute(rel) ? rel : `${base}${sep}${rel}`;
  const m = full.match(/^([a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/]?|\/)/);
  const root = m ? m[0] : "";
  const out: string[] = [];
  for (const part of full.slice(root.length).split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  const normRoot = sep === "\\" ? root.replace(/\//g, "\\") : root;
  return normRoot + out.join(sep);
}

/**
 * Wraps a path in left-to-right marks. Path labels use `direction: rtl` so a
 * long path is cut from the left; without the marks, punctuation at the ends
 * (like the colon in "C:") would be flipped to the wrong side.
 */
export const ltr = (text: string) => `\u200e${text}\u200e`;

/** Joins a folder and a `/`-separated relative path using the folder's separator. */
export function joinPath(dir: string, rel: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  if (!rel) return dir;
  return dir.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
}

/** Key used to detect that two paths point to the same file. */
export function pathKey(p: string): string {
  const k = p.replace(/\\/g, "/");
  return isWindows || isMac ? k.toLowerCase() : k;
}

export const MARKDOWN_EXTS = ["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt"];

export function isMarkdownPath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXTS.includes(ext);
}

/** The menu-bar preference lives in the backend, which needs it before creating a window. */
export const menuVisible = () => invoke<boolean>("menu_visible");

/** Turns the native menu bar on or off for every window (no-op on macOS). */
export const setMenuVisible = (visible: boolean) => invoke<void>("set_menu_visible", { visible });

// ---- clipboard (the native plugin works where the web Clipboard API is blocked)

export const writeClipboard = (text: string): Promise<void> =>
  writeClipboardText(text).catch(() => navigator.clipboard.writeText(text));

export const readClipboard = (): Promise<string> =>
  readClipboardText()
    .catch(() => navigator.clipboard.readText())
    .catch(() => "");

/** Saves image bytes into `<dir>/images/`; returns the relative path to link to. */
export async function saveImage(dir: string, fileName: string, data: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return invoke<string>("save_image", { dir, fileName, data: btoa(binary) });
}

/** Unsaved changes kept on disk so they survive a crash. */
export interface Recovery {
  id: string;
  path: string | null;
  content: string;
  time: number;
}
export const recoverySave = (r: Recovery) => invoke<void>("recovery_save", { id: r.id, data: JSON.stringify(r) });
export const recoveryRemove = (id: string) => invoke<void>("recovery_remove", { id });
/** Recovery files left by an earlier run. */
export async function recoveryList(): Promise<Recovery[]> {
  const out: Recovery[] = [];
  for (const text of await invoke<string[]>("recovery_list")) {
    try {
      const r = JSON.parse(text) as Recovery;
      if (typeof r.id === "string" && typeof r.content === "string") out.push(r);
    } catch {
      /* unreadable: ignore */
    }
  }
  return out;
}

/** Copies an image file into `<dir>/images/`; returns the path relative to `dir`. */
export const copyImage = (dir: string, source: string) => invoke<string>("copy_image", { dir, source });

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];
export const isImagePath = (path: string) => IMAGE_EXTS.includes(path.split(".").pop()?.toLowerCase() ?? "");

/** Opens the system print dialog (the web API is unavailable in macOS's web view). */
export const printWindow = () => (isMac ? invoke<void>("print_window") : Promise.resolve(window.print()));
