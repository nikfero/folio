// Preview themes: CSS that restyles the rendered document (preview and HTML
// export). Built-in themes live in /themes; a custom one is any CSS file,
// reloaded when it changes. See docs/THEMES.md.

import * as settings from "./settings";
import { basename, fileMtime, readText } from "./platform";

/** The built-in themes, from /themes/*.css (template.css is only a starting point for your own). */
const files = import.meta.glob("/themes/*.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Theme {
  id: string;
  name: string;
  css: string;
}

export const builtinThemes: Theme[] = Object.entries(files)
  .map(([path, css]) => {
    const id = path.split("/").pop()!.replace(/\.css$/, "");
    // The first comment names the theme: /* Folio theme: GitHub ... */
    const name = /Folio theme:\s*([^\n*]+?)\s*(?:[—-].*)?(?:\*\/|\n)/.exec(css)?.[1] ?? id;
    return { id, name, css };
  })
  .filter((t) => t.id !== "template")
  .sort((a, b) => a.name.localeCompare(b.name));

let custom: { path: string; mtime: number | null; css: string } | null = null;

/** Display name of the theme in use ("Folio" when none). */
export function themeName(): string {
  const id = settings.get("previewTheme");
  if (id === "custom") return settings.get("previewThemeFile") ? basename(settings.get("previewThemeFile")) : "Folio";
  return builtinThemes.find((t) => t.id === id)?.name ?? "Folio";
}

/** The CSS of the theme in use ("" for Folio's own look). */
export async function themeCss(): Promise<string> {
  const id = settings.get("previewTheme");
  if (id !== "custom") return builtinThemes.find((t) => t.id === id)?.css ?? "";
  const path = settings.get("previewThemeFile");
  if (!path) return "";
  if (custom?.path !== path) {
    const file = await readText(path);
    custom = { path, mtime: file.mtime, css: file.text };
  }
  return custom.css;
}

function styleElement(): HTMLStyleElement {
  let el = document.getElementById("preview-theme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "preview-theme";
    document.head.appendChild(el);
  }
  return el;
}

/** Applies the chosen theme to the preview; resolves with an error message if a custom file can't be read. */
export async function applyPreviewTheme(): Promise<string | null> {
  try {
    styleElement().textContent = await themeCss();
    return null;
  } catch (e) {
    styleElement().textContent = "";
    custom = null;
    return `Couldn't read the theme ${basename(settings.get("previewThemeFile"))}: ${e}`;
  }
}

/** Re-reads a custom theme file that changed on disk; true if the preview was updated. */
export async function refreshCustomTheme(): Promise<boolean> {
  if (settings.get("previewTheme") !== "custom" || !custom) return false;
  const mtime = await fileMtime(custom.path).catch(() => null);
  if (mtime === null || mtime === custom.mtime) return false;
  custom = null;
  await applyPreviewTheme();
  return true;
}
