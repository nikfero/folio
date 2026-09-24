// Per-user preferences, kept in localStorage (shared by all Folio windows).

import type { Mode } from "./app";

export interface Settings {
  theme: "system" | "light" | "dark";
  defaultMode: Mode;
  /** Whether the sidebar is visible. */
  toc: boolean;
  sidebarPanel: "files" | "outline";
  split: number;
  zoom: number;
  restoreSession: boolean;
  autoSave: boolean;
  autoReload: boolean;
  menuBar: boolean;
  editorFontSize: number;
  lineNumbers: boolean;
  wrapLines: boolean;
  previewFont: "sans" | "serif";
  previewWidth: "narrow" | "medium" | "wide" | "full";
}

const defaults: Settings = {
  theme: "system",
  defaultMode: "read",
  toc: true,
  sidebarPanel: "outline",
  split: 0.5,
  zoom: 1,
  restoreSession: true,
  autoSave: false,
  autoReload: false,
  menuBar: false,
  editorFontSize: 14,
  lineNumbers: true,
  wrapLines: true,
  previewFont: "sans",
  previewWidth: "medium",
};

const PREFIX = "folio.";

export function get<K extends keyof Settings>(key: K): Settings[K] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw != null) return JSON.parse(raw) as Settings[K];
  } catch {
    /* fall back to default */
  }
  return defaults[key];
}

export function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/** True if a `storage` event key belongs to a setting (another window changed it). */
export function isSettingKey(key: string | null): boolean {
  return !!key && key.startsWith(PREFIX) && key.slice(PREFIX.length) in defaults;
}

export function resolvedTheme(): "light" | "dark" {
  const pref = get("theme");
  if (pref !== "system") return pref;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

// ---- recent files

export function recent(): string[] {
  return readJson<string[]>("recent", []);
}

export function addRecent(path: string): void {
  writeJson("recent", [path, ...recent().filter((p) => p !== path)].slice(0, 15));
}

export function removeRecent(path: string): void {
  writeJson(
    "recent",
    recent().filter((p) => p !== path),
  );
}

// ---- recent folders

export function recentFolders(): string[] {
  return readJson<string[]>("recentFolders", []);
}

export function addRecentFolder(path: string): void {
  writeJson("recentFolders", [path, ...recentFolders().filter((p) => p !== path)].slice(0, 8));
}

export function removeRecentFolder(path: string): void {
  writeJson(
    "recentFolders",
    recentFolders().filter((p) => p !== path),
  );
}

// ---- per-file auto-reload overrides (keyed by normalized path)

function reloadOverrides(): Record<string, boolean> {
  return readJson<Record<string, boolean>>("reloadOverrides", {});
}

export function reloadOverride(key: string): boolean | undefined {
  return reloadOverrides()[key];
}

/** Sets a file's auto-reload override; `undefined` makes it follow the global setting again. */
export function setReloadOverride(key: string, value: boolean | undefined): void {
  const all = reloadOverrides();
  if (value === undefined) delete all[key];
  else all[key] = value;
  writeJson("reloadOverrides", all);
}

// ---- session (the main window's open tabs)

export interface SessionTab {
  path: string;
  mode: Mode;
  /** Fractional 0-based source line at the top of the view. */
  topLine: number;
}

export interface Session {
  tabs: SessionTab[];
  active: number;
  folder?: string | null;
}

export function session(): Session {
  return readJson<Session>("session", { tabs: [], active: 0 });
}

export function saveSession(s: Session): void {
  writeJson("session", s);
}
