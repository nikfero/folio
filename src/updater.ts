// Updates: checks the latest GitHub release (at most once a day, and on
// request), and offers to download, install and restart.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as settings from "./settings";
import { toast } from "./ui";

const DAY = 24 * 60 * 60 * 1000;
const RELEASES = "https://github.com/nikfero/folio/releases";

export interface UpdateHooks {
  /** Runs before the update is installed, which may close Folio (keep unsaved work safe here). */
  beforeInstall(): Promise<void>;
}

let checking = false;

/** Looks for a newer version. `manual`: asked for by the user, so report "up to date" and errors too. */
export async function checkForUpdates(manual: boolean, hooks: UpdateHooks): Promise<void> {
  if (checking || document.getElementById("update-card")) return;
  if (!manual && (!settings.get("checkUpdates") || Date.now() - settings.get("lastUpdateCheck") < DAY)) return;
  checking = true;
  let update: Update | null;
  try {
    update = await check();
  } catch (e) {
    if (manual) toast(`Couldn't check for updates: ${e}`, "error");
    return;
  } finally {
    checking = false;
  }
  settings.set("lastUpdateCheck", Date.now());
  if (!update) {
    if (manual) toast("Folio is up to date.");
    return;
  }
  if (!manual && settings.get("skippedVersion") === update.version) return;
  showCard(update, hooks);
}

function showCard(update: Update, hooks: UpdateHooks): void {
  const card = document.createElement("div");
  card.id = "update-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Update available");
  card.innerHTML = `
    <div class="update-title"></div>
    <div class="update-text"></div>
    <div class="update-buttons">
      <button class="link-btn" data-notes>What's new</button>
      <span class="topbar-spacer"></span>
      <button class="btn small" data-skip>Skip</button>
      <button class="btn small" data-later>Later</button>
      <button class="btn small primary" data-install>Update and restart</button>
    </div>`;
  const title = card.querySelector<HTMLElement>(".update-title")!;
  const text = card.querySelector<HTMLElement>(".update-text")!;
  title.textContent = `Folio ${update.version} is available`;
  text.textContent = `You have ${update.currentVersion}. Unsaved changes are kept and reopen after the restart.`;
  const close = () => card.remove();

  card.querySelector("[data-notes]")!.addEventListener("click", () => {
    void openUrl(`${RELEASES}/tag/v${update.version}`).catch(() => {});
  });
  card.querySelector("[data-later]")!.addEventListener("click", close);
  card.querySelector("[data-skip]")!.addEventListener("click", () => {
    settings.set("skippedVersion", update.version);
    close();
  });
  card.querySelector("[data-install]")!.addEventListener("click", async () => {
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await hooks.beforeInstall();
      let total = 0;
      let done = 0;
      text.textContent = "Downloading…";
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          if (total) text.textContent = `Downloading… ${Math.round((done / total) * 100)}%`;
        } else text.textContent = "Installing…";
      });
      text.textContent = "Restarting…";
      await relaunch();
    } catch (e) {
      title.textContent = "The update didn't install";
      text.textContent = `${e}. You can download it from the releases page instead.`;
      const later = card.querySelector<HTMLButtonElement>("[data-later]")!;
      later.disabled = false;
      later.textContent = "Close";
      const notes = card.querySelector<HTMLButtonElement>("[data-notes]")!;
      notes.disabled = false;
      notes.textContent = "Open the releases page";
    }
  });
  document.body.appendChild(card);
}
