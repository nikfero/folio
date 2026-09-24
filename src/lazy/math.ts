// Loaded on demand, only for documents that contain math.
import katex from "katex";
import "katex/dist/katex.min.css";

export function renderMath(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>(".math:not([data-rendered])")) {
    const tex = el.textContent ?? "";
    try {
      katex.render(tex, el, { displayMode: el.classList.contains("display"), throwOnError: false });
    } catch {
      el.classList.add("math-error");
    }
    el.dataset.rendered = "";
  }
}
