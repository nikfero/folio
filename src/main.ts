import "./styles/app.css";
import "./styles/markdown.css";

async function boot() {
  // Outside Tauri (plain `npm run dev` in a browser) fake the backend so the UI can be worked on.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    await import("./dev-mock").then((m) => m.installMock());
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  try {
    const { App } = await import("./app");
    await new App().start();
  } finally {
    // Windows start hidden so they never flash blank or at the wrong size.
    await getCurrentWindow()
      .show()
      .catch(() => {});
    void getCurrentWindow()
      .setFocus()
      .catch(() => {});
  }
}

void boot();
