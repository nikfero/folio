// Small in-app UI primitives: dropdown menus, modal dialogs and toasts.

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  action: () => void;
}
export type MenuEntry = MenuItem | "separator";

let openMenu: HTMLElement | null = null;

export function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

/** Shows a menu at viewport point (x, y), kept inside the window. */
export function showMenu(x: number, y: number, entries: MenuEntry[]): void {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  for (const entry of entries) {
    if (entry === "separator") {
      menu.appendChild(Object.assign(document.createElement("div"), { className: "menu-sep" }));
      continue;
    }
    const item = document.createElement("button");
    item.className = "menu-item";
    item.setAttribute("role", "menuitem");
    item.disabled = !!entry.disabled;
    item.innerHTML = `<span></span><kbd></kbd>`;
    item.children[0].textContent = entry.label;
    item.children[1].textContent = entry.shortcut ?? "";
    item.addEventListener("click", () => {
      closeMenu();
      entry.action();
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  openMenu = menu;
  (menu.querySelector("button:not(:disabled)") as HTMLElement | null)?.focus();
}

document.addEventListener(
  "pointerdown",
  (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) closeMenu();
  },
  true,
);
document.addEventListener("keydown", (e) => {
  if (!openMenu) return;
  const items = [...openMenu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "Escape") closeMenu();
  else if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
  else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
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
