// Loaded on demand, only for documents that contain Mermaid diagrams.
import mermaid from "mermaid";

const cache = new Map<string, string>();
let initializedFor = "";
let counter = 0;

/** Renders one diagram to SVG markup (cached); throws with Mermaid's message on bad input. */
export async function mermaidSvg(source: string, theme: "light" | "dark"): Promise<string> {
  const key = `${theme}\n${source}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (initializedFor !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme === "dark" ? "dark" : "default" });
    initializedFor = theme;
  }
  const id = `folio-mermaid-${++counter}`;
  try {
    const { svg } = await mermaid.render(id, source);
    if (cache.size > 200) cache.clear();
    cache.set(key, svg);
    return svg;
  } catch (e) {
    // Mermaid can leave its scratch element behind when a diagram fails.
    document.getElementById(`d${id}`)?.remove();
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

/** Renders every not-yet-rendered `.mermaid` element under `root`, keeping its source in `data-source`. */
export async function renderMermaid(root: HTMLElement, theme: "light" | "dark"): Promise<void> {
  for (const el of root.querySelectorAll<HTMLElement>(".mermaid:not([data-rendered])")) {
    const source = el.dataset.source ?? el.textContent ?? "";
    el.dataset.source = source;
    el.dataset.rendered = "";
    try {
      const svg = await mermaidSvg(source, theme);
      if (el.isConnected) el.innerHTML = svg;
    } catch (e) {
      el.classList.add("mermaid-error");
      el.textContent = `Mermaid error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}
