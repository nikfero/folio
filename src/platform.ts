import { invoke } from "@tauri-apps/api/core";

export interface TextFile {
  text: string;
  bom: boolean;
  mtime: number | null;
}

export interface OpenRequest {
  path: string | null;
  content: string | null;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const isWindows = /Win/.test(navigator.platform);

export const readText = (path: string) => invoke<TextFile>("read_text", { path });

export const writeText = (path: string, text: string, bom: boolean) =>
  invoke<number | null>("write_text", { path, text, bom });

export const fileMtime = (path: string) => invoke<number | null>("file_mtime", { path });

export const frontendReady = () => invoke<OpenRequest[]>("frontend_ready");

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
