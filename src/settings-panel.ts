import * as settings from "./settings";
import type { Settings } from "./settings";
import { icons } from "./icons";

type Option<T> = [value: T, label: string];

interface Row<K extends keyof Settings = keyof Settings> {
  key: K;
  label: string;
  hint?: string;
  /** A select with these options; omitted for on/off switches. */
  options?: Option<Settings[K]>[];
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

  for (const section of sections(opts)) {
    const box = document.createElement("section");
    box.innerHTML = `<h3></h3>`;
    box.querySelector("h3")!.textContent = section.title;
    for (const row of section.rows) box.appendChild(renderRow(row, onChange));
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

function renderRow(row: Row, onChange: (key: keyof Settings) => void): HTMLElement {
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
    select.addEventListener("change", () => {
      settings.set(row.key, row.options![Number(select.value)][0]);
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
