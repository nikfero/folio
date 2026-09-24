// Loaded on demand, only for documents that contain Mermaid diagrams.
import mermaid from "mermaid";

const cache = new Map<string, string>();
let initializedFor = "";
let counter = 0;

export async function renderMermaid(root: HTMLElement, theme: "light" | "dark"): Promise<void> {
  if (initializedFor !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme === "dark" ? "dark" : "default" });
    initializedFor = theme;
  }
  for (const el of root.querySelectorAll<HTMLElement>(".mermaid:not([data-rendered])")) {
    const source = el.textContent ?? "";
    const key = `${theme}\n${source}`;
    el.dataset.rendered = "";
    let svg = cache.get(key);
    if (!svg) {
      const id = `folio-mermaid-${++counter}`;
      try {
        svg = (await mermaid.render(id, source)).svg;
        if (cache.size > 200) cache.clear();
        cache.set(key, svg);
      } catch (e) {
        // Mermaid can leave its scratch element behind when a diagram fails.
        document.getElementById(`d${id}`)?.remove();
        el.classList.add("mermaid-error");
        el.textContent = `Mermaid error: ${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
    }
    if (el.isConnected) el.innerHTML = svg;
  }
}
