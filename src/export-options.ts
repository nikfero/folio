// The "Export as HTML" options dialog. Choices are remembered between exports.

import * as settings from "./settings";
import { icons } from "./icons";

export interface ExportOptions {
  toc: "none" | "top" | "sidebar";
  theme: "system" | "light" | "dark";
  font: "sans" | "serif";
  width: "narrow" | "medium" | "wide" | "full";
  frontmatter: boolean;
  embedFonts: boolean;
  css: string;
}

export const defaultExportOptions: ExportOptions = {
  toc: "none",
  theme: "system",
  font: "sans",
  width: "medium",
  frontmatter: true,
  embedFonts: true,
  css: "",
};

type Choice = [value: string, label: string];

const selects: { key: "toc" | "theme" | "font" | "width"; label: string; choices: Choice[] }[] = [
  {
    key: "toc",
    label: "Table of contents",
    choices: [
      ["none", "None"],
      ["top", "At the top"],
      ["sidebar", "Sidebar (on wide screens)"],
    ],
  },
  {
    key: "theme",
    label: "Theme",
    choices: [
      ["system", "Follow the reader's system"],
      ["light", "Light"],
      ["dark", "Dark"],
    ],
  },
  {
    key: "font",
    label: "Font",
    choices: [
      ["sans", "Sans-serif"],
      ["serif", "Serif"],
    ],
  },
  {
    key: "width",
    label: "Text width",
    choices: [
      ["narrow", "Narrow"],
      ["medium", "Medium"],
      ["wide", "Wide"],
      ["full", "Full window"],
    ],
  },
];

/** Asks for export options; resolves with them, or null if cancelled. */
export function askExportOptions(doc: { hasMath: boolean; hasFrontmatter: boolean; hasHeadings: boolean }): Promise<ExportOptions | null> {
  const saved = { ...defaultExportOptions, ...settings.get("exportOptions") };
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const form = document.createElement("form");
    form.className = "modal settings export-options";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-label", "Export as HTML");

    const rows = selects
      .map(({ key, label, choices }) => {
        const disabled = key === "toc" && !doc.hasHeadings;
        const opts = choices
          .map(([v, l]) => `<option value="${v}"${saved[key] === v ? " selected" : ""}>${l}</option>`)
          .join("");
        return `<label class="settings-row"><span class="settings-label"><span>${label}</span>${
          disabled ? "<small>This document has no headings</small>" : ""
        }</span><select name="${key}"${disabled ? " disabled" : ""}>${opts}</select></label>`;
      })
      .join("");
    const check = (name: string, label: string, hint: string, on: boolean, show: boolean) =>
      show
        ? `<label class="settings-row"><span class="settings-label"><span>${label}</span><small>${hint}</small></span><input type="checkbox" class="switch" name="${name}"${on ? " checked" : ""}></label>`
        : "";

    form.innerHTML = `
      <div class="settings-head"><h2>Export as HTML</h2><button type="button" class="icon-btn" data-cancel aria-label="Close">${icons.close}</button></div>
      <section>${rows}
        ${check("frontmatter", "Include metadata", "The frontmatter table at the top", saved.frontmatter, doc.hasFrontmatter)}
        ${check("embedFonts", "Embed math fonts", "Works offline; adds about 400 KB", saved.embedFonts, doc.hasMath)}
      </section>
      <section>
        <label class="export-css"><span class="settings-label"><span>Extra CSS</span><small>Added after Folio's styles, e.g. <code>.markdown-body { font-size: 18px }</code></small></span>
        <textarea name="css" rows="4" spellcheck="false" placeholder="/* optional */"></textarea></label>
      </section>
      <div class="modal-buttons"><button type="button" class="btn" data-reset>Reset</button><span class="topbar-spacer"></span><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Export…</button></div>`;
    form.querySelector<HTMLTextAreaElement>("textarea")!.value = saved.css;

    const done = (v: ExportOptions | null) => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    };
    const read = (): ExportOptions => {
      const f = new FormData(form);
      const flag = (name: "frontmatter" | "embedFonts") =>
        form.querySelector(`[name=${name}]`) ? f.get(name) === "on" : saved[name];
      return {
        toc: (form.querySelector<HTMLSelectElement>("[name=toc]")!.value as ExportOptions["toc"]) ?? "none",
        theme: f.get("theme") as ExportOptions["theme"],
        font: f.get("font") as ExportOptions["font"],
        width: f.get("width") as ExportOptions["width"],
        frontmatter: flag("frontmatter"),
        embedFonts: flag("embedFonts"),
        css: String(f.get("css") ?? ""),
      };
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const opts = read();
      settings.set("exportOptions", opts);
      done({ ...opts, toc: doc.hasHeadings ? opts.toc : "none" });
    });
    form.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => done(null)));
    form.querySelector("[data-reset]")!.addEventListener("click", () => {
      const d = defaultExportOptions;
      for (const { key } of selects) form.querySelector<HTMLSelectElement>(`[name=${key}]`)!.value = d[key];
      for (const name of ["frontmatter", "embedFonts"] as const) {
        const box = form.querySelector<HTMLInputElement>(`[name=${name}]`);
        if (box) box.checked = d[name];
      }
      form.querySelector<HTMLTextAreaElement>("textarea")!.value = d.css;
    });
    document.addEventListener("keydown", onKey, true);
    backdrop.appendChild(form);
    document.body.appendChild(backdrop);
    form.querySelector<HTMLElement>("select:not(:disabled), input")?.focus();
  });
}
