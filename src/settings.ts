// Per-user preferences, kept in localStorage (shared by all Folio windows).

export interface Settings {
  theme: "system" | "light" | "dark";
  defaultMode: "read" | "split" | "edit";
  toc: boolean;
  split: number;
  zoom: number;
}

const defaults: Settings = { theme: "system", defaultMode: "read", toc: true, split: 0.5, zoom: 1 };
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

export function resolvedTheme(): "light" | "dark" {
  const pref = get("theme");
  if (pref !== "system") return pref;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const RECENT_KEY = PREFIX + "recent";

export function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 15)));
  } catch {
    /* storage unavailable */
  }
}

export function addRecent(path: string): void {
  saveRecent([path, ...recent().filter((p) => p !== path)]);
}

export function removeRecent(path: string): void {
  saveRecent(recent().filter((p) => p !== path));
}
