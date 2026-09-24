// Small in-app UI primitives: dropdown menus, modal dialogs and toasts.

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  action?: () => void;
  /** Entries of a submenu, opened on hover, click or the right arrow key. */
  submenu?: MenuEntry[];
}
export type MenuEntry = MenuItem | "separator";

/** Open menus, the root first and then any submenus. */
let openMenus: HTMLElement[] = [];

export function closeMenu(): void {
  for (const m of openMenus) m.remove();
  openMenus = [];
}

/** Closes the submenus deeper than `level` (0 = the root menu). */
function closeSubmenus(level: number): void {
  for (const m of openMenus.splice(level + 1)) m.remove();
}

function buildMenu(entries: MenuEntry[], level: number): HTMLElement {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  for (const entry of entries) {
    if (entry === "separator") {
      menu.appendChild(Object.assign(document.createElement("div"), { className: "menu-sep" }));
      continue;
    }
    const item = document.createElement("button");
    item.className = entry.submenu ? "menu-item has-submenu" : "menu-item";
    item.setAttribute("role", "menuitem");
    item.disabled = !!entry.disabled;
    item.innerHTML = `<span></span><kbd></kbd>`;
    item.children[0].textContent = entry.label;
    item.children[1].textContent = entry.submenu ? "›" : (entry.shortcut ?? "");
    if (entry.submenu) {
      item.setAttribute("aria-haspopup", "menu");
      const open = () => {
        if (openMenus[level + 1]?.dataset.parent === entry.label) return;
        closeSubmenus(level);
        const sub = buildMenu(entry.submenu!, level + 1);
        sub.dataset.parent = entry.label;
        place(sub, item.getBoundingClientRect());
      };
      item.addEventListener("mouseenter", open);
      item.addEventListener("click", open);
    } else {
      item.addEventListener("mouseenter", () => closeSubmenus(level));
      item.addEventListener("click", () => {
        closeMenu();
        entry.action?.();
      });
    }
    menu.appendChild(item);
  }
  return menu;
}

/** Adds a submenu beside its item, flipping to the left when there's no room on the right. */
function place(menu: HTMLElement, beside: DOMRect): void {
  document.body.appendChild(menu);
  openMenus.push(menu);
  const r = menu.getBoundingClientRect();
  const x = beside.right + r.width + 4 <= innerWidth ? beside.right + 2 : beside.left - r.width - 2;
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, Math.min(beside.top - 5, innerHeight - r.height - 4))}px`;
}

/** Shows a menu at viewport point (x, y), kept inside the window. */
export function showMenu(x: number, y: number, entries: MenuEntry[]): void {
  closeMenu();
  const menu = buildMenu(entries, 0);
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  openMenus = [menu];
  (menu.querySelector("button:not(:disabled)") as HTMLElement | null)?.focus();
}

document.addEventListener(
  "pointerdown",
  (e) => {
    if (openMenus.length && !openMenus.some((m) => m.contains(e.target as Node))) closeMenu();
  },
  true,
);
document.addEventListener("keydown", (e) => {
  if (!openMenus.length) return;
  const current = openMenus.find((m) => m.contains(document.activeElement)) ?? openMenus[openMenus.length - 1];
  const level = openMenus.indexOf(current);
  const items = [...current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const focused = document.activeElement as HTMLButtonElement;
  const i = items.indexOf(focused);
  const backToParent = () => {
    const parent = openMenus[level].dataset.parent;
    closeSubmenus(level - 1);
    [...openMenus[level - 1].querySelectorAll<HTMLElement>(".has-submenu")].find((b) => b.firstElementChild?.textContent === parent)?.focus();
  };
  if (e.key === "Escape") {
    if (level > 0) backToParent();
    else closeMenu();
  } else if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
  else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
  else if (e.key === "ArrowRight" && focused?.classList.contains("has-submenu")) {
    focused.click();
    openMenus[level + 1]?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  } else if (e.key === "ArrowLeft" && level > 0) backToParent();
  else return;
  e.preventDefault();
  e.stopPropagation();
});
window.addEventListener("blur", closeMenu);

export interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

/** A modal dialog; resolves with the chosen button's value, or `cancelValue` on Escape. */
export function dialog<T>(title: string, message: string, buttons: DialogButton<T>[], cancelValue: T): Promise<T> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = `<h2></h2><p></p><div class="modal-buttons"></div>`;
    box.querySelector("h2")!.textContent = title;
    box.querySelector("p")!.textContent = message;
    const row = box.querySelector(".modal-buttons")!;
    const done = (v: T) => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(v);
    };
    for (const b of buttons) {
      const el = document.createElement("button");
      el.className = `btn${b.primary ? " primary" : ""}${b.danger ? " danger" : ""}`;
      el.textContent = b.label;
      el.addEventListener("click", () => done(b.value));
      row.appendChild(el);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(cancelValue);
      }
    };
    document.addEventListener("keydown", onKey, true);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    (row.querySelector(".primary") as HTMLElement | null)?.focus();
  });
}

/**
 * Asks for a line of text (e.g. a file name). Resolves with the trimmed text,
 * or null if cancelled. `select` picks the part to pre-select, e.g. the name
 * without its extension.
 */
export function promptDialog(
  title: string,
  opts: { value?: string; okLabel?: string; select?: [number, number]; validate?: (v: string) => string | null } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const box = document.createElement("form");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = `<h2></h2><input class="modal-input" type="text" spellcheck="false"><p class="modal-error"></p><div class="modal-buttons"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary"></button></div>`;
    box.querySelector("h2")!.textContent = title;
    box.querySelector<HTMLButtonElement>("[type=submit]")!.textContent = opts.okLabel ?? "OK";
    const input = box.querySelector("input")!;
    const error = box.querySelector<HTMLElement>(".modal-error")!;
    input.value = opts.value ?? "";
    const done = (v: string | null) => {
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
    box.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      const problem = !v ? "Please enter a name." : (opts.validate?.(v) ?? null);
      if (problem) {
        error.textContent = problem;
        input.focus();
        return;
      }
      done(v);
    });
    input.addEventListener("input", () => (error.textContent = ""));
    box.querySelector("[data-cancel]")!.addEventListener("click", () => done(null));
    document.addEventListener("keydown", onKey, true);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    input.focus();
    const [a, b] = opts.select ?? [0, input.value.length];
    input.setSelectionRange(a, b);
  });
}

export type UnsavedChoice = "save" | "discard" | "cancel";

export function confirmUnsaved(name: string): Promise<UnsavedChoice> {
  return dialog<UnsavedChoice>(
    `Save changes to “${name}”?`,
    "Your changes will be lost if you don't save them.",
    [
      { label: "Don't Save", value: "discard", danger: true },
      { label: "Cancel", value: "cancel" },
      { label: "Save", value: "save", primary: true },
    ],
    "cancel",
  );
}

export function toast(message: string, kind: "info" | "error" = "info"): void {
  let host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add("leaving"), kind === "error" ? 5000 : 2500);
  setTimeout(() => el.remove(), kind === "error" ? 5400 : 2900);
}
