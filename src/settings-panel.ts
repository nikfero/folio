import * as settings from "./settings";
import type { Settings } from "./settings";
import { icons } from "./icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { builtinThemes } from "./themes";
import { basename } from "./platform";

type Option<T> = [value: T, label: string];

interface Row<K extends keyof Settings = keyof Settings> {
  key: K;
  label: string;
  hint?: string;
  /** A select with these options; omitted for on/off switches. */
  options?: Option<Settings[K]>[];
  /** A file picker (the setting holds the path) accepting these extensions. */
  file?: string[];
  /** Shown only while this returns true (re-checked after every change). */
  visible?: () => boolean;
}

interface Section {
  title: string;
  rows: Row[];
}

function sections(opts: { menuBar: boolean }): Section[] {
  return [
    {
      title: "General",
      rows: [
        {
          key: "theme",
          label: "Theme",
          options: [
            ["system", "Match system"],
            ["light", "Light"],
            ["dark", "Dark"],
          ],
        },
        {
          key: "defaultMode",
          label: "Open files in",
          options: [
            ["read", "Read view"],
            ["live", "Live preview"],
            ["split", "Split view"],
            ["edit", "Edit view"],
          ],
        },
        { key: "restoreSession", label: "Reopen tabs on startup" },
        { key: "autoSave", label: "Auto-save", hint: "Save a second after you stop typing" },
        {
          key: "autoReload",
          label: "Reload changed files automatically",
          hint: "Otherwise Folio asks first when another program changes a file",
        },
        ...(opts.menuBar ? [{ key: "menuBar", label: "Show menu bar" } as Row] : []),
      ],
    },
    {
      title: "Editor",
      rows: [
        {
          key: "editorFontSize",
          label: "Font size",
          options: [12, 13, 14, 15, 16, 18, 20].map((n) => [n, `${n} px`] as Option<number>),
        },
        { key: "lineNumbers", label: "Line numbers" },
        { key: "wrapLines", label: "Wrap long lines" },
      ],
    },
    {
      title: "Focus mode",
      rows: [
        {
          key: "focusHighlight",
          label: "Keep bright",
          hint: "The rest of the text fades while you write",
          options: [
            ["sentence", "Current sentence"],
            ["paragraph", "Current paragraph"],
            ["off", "Everything"],
          ],
        },
        { key: "focusTypewriter", label: "Typewriter scrolling", hint: "Keep the line you're writing in the middle of the screen" },
      ],
    },
    {
      title: "Preview",
      rows: [
        {
          key: "previewTheme",
          label: "Theme",
          hint: "Also used for HTML exports; themes may set their own font",
          options: [
            ["", "Folio"],
            ...builtinThemes.map((t): Option<string> => [t.id, t.name]),
            ["custom", "Custom CSS file…"],
          ],
        },
        {
          key: "previewThemeFile",
          label: "Custom CSS file",
          hint: "Reloaded when you change it. How to write one: docs/THEMES.md",
          file: ["css"],
          visible: () => settings.get("previewTheme") === "custom",
        },
        {
          key: "previewFont",
          label: "Font",
          options: [
            ["sans", "Sans-serif"],
            ["serif", "Serif"],
          ],
        },
        {
          key: "previewWidth",
          label: "Text width",
          options: [
            ["narrow", "Narrow"],
            ["medium", "Medium"],
            ["wide", "Wide"],
            ["full", "Full window"],
          ],
        },
      ],
    },
  ] as Section[];
}

let open: HTMLElement | null = null;

/** Opens the settings dialog; `onChange` runs after every change. */
export function openSettings(onChange: (key: keyof Settings) => void, opts: { menuBar: boolean; version: string }): void {
  if (open) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const panel = document.createElement("div");
  panel.className = "modal settings";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Settings");
  panel.innerHTML = `<div class="settings-head"><h2>Settings</h2><button class="icon-btn" data-close aria-label="Close">${icons.close}</button></div>`;

  const rendered: [Row, HTMLElement][] = [];
  const changed = (key: keyof Settings) => {
    for (const [row, el] of rendered) el.hidden = row.visible ? !row.visible() : false;
    onChange(key);
  };
  for (const section of sections(opts)) {
    const box = document.createElement("section");
    box.innerHTML = `<h3></h3>`;
    box.querySelector("h3")!.textContent = section.title;
    for (const row of section.rows) {
      const el = renderRow(row, changed, panel);
      el.hidden = row.visible ? !row.visible() : false;
      rendered.push([row, el]);
      box.appendChild(el);
    }
    panel.appendChild(box);
  }
  const foot = document.createElement("p");
  foot.className = "settings-foot";
  foot.textContent = `Folio ${opts.version} · Settings apply to all windows.`;
  panel.appendChild(foot);

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    open = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  panel.querySelector("[data-close]")!.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  open = backdrop;
  panel.querySelector<HTMLElement>("select, input")?.focus();
}

/** Asks for a file for a `file` row; resolves with whether one was chosen. */
async function pickFile(row: Row): Promise<boolean> {
  const current = String(settings.get(row.key) ?? "");
  const picked = await openDialog({
    filters: [{ name: row.label, extensions: row.file! }],
    defaultPath: current || undefined,
  });
  if (typeof picked !== "string") return false;
  settings.set(row.key, picked as never);
  return true;
}

function renderRow(row: Row, onChange: (key: keyof Settings) => void, panel: HTMLElement): HTMLElement {
  if (row.file) {
    const el = document.createElement("div");
    el.className = "settings-row";
    el.dataset.key = row.key;
    el.innerHTML = `<span class="settings-label"><span></span><small></small></span><span class="settings-file"><span class="settings-file-name"></span><button type="button" class="btn small">Choose…</button></span>`;
    el.querySelector(".settings-label > span")!.textContent = row.label;
    el.querySelector("small")!.textContent = row.hint ?? "";
    const name = el.querySelector<HTMLElement>(".settings-file-name")!;
    const show = () => {
      const path = String(settings.get(row.key) ?? "");
      name.textContent = path ? basename(path) : "None";
      name.title = path;
    };
    show();
    el.querySelector("button")!.addEventListener("click", async () => {
      if (await pickFile(row)) {
        show();
        onChange(row.key);
      }
    });
    return el;
  }
  const el = document.createElement("label");
  el.className = "settings-row";
  el.innerHTML = `<span class="settings-label"><span></span><small></small></span>`;
  el.querySelector(".settings-label > span")!.textContent = row.label;
  el.querySelector("small")!.textContent = row.hint ?? "";
  const current = settings.get(row.key);

  if (row.options) {
    const select = document.createElement("select");
    row.options.forEach(([value, label], i) => {
      const opt = new Option(label, String(i), false, value === current);
      select.appendChild(opt);
    });
    select.addEventListener("change", async () => {
      const previous = settings.get(row.key);
      settings.set(row.key, row.options![Number(select.value)][0]);
      // A custom theme needs a file: ask for one, and go back if none is chosen.
      if (row.key === "previewTheme" && settings.get("previewTheme") === "custom" && !settings.get("previewThemeFile")) {
        if (!(await pickFile({ key: "previewThemeFile", label: "CSS", file: ["css"] }))) {
          settings.set(row.key, previous as never);
          select.value = String(row.options!.findIndex(([v]) => v === previous));
          return;
        }
        const name = panel.querySelector('[data-key="previewThemeFile"] .settings-file-name');
        if (name) name.textContent = basename(settings.get("previewThemeFile"));
      }
      onChange(row.key);
    });
    el.appendChild(select);
  } else {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "switch";
    toggle.checked = Boolean(current);
    toggle.addEventListener("change", () => {
      settings.set(row.key, toggle.checked as never);
      onChange(row.key);
    });
    el.appendChild(toggle);
  }
  return el;
}
