// Loaded on demand, only for documents that contain math.
import katex from "katex";
import "katex/dist/katex.min.css";

/** Renders TeX into `el`; errors are shown inline by KaTeX instead of throwing. */
export function renderTex(el: HTMLElement, tex: string, display: boolean): void {
  try {
    katex.render(tex, el, { displayMode: display, throwOnError: false });
  } catch {
    el.textContent = tex;
    el.classList.add("math-error");
  }
}

export function renderMath(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>(".math:not([data-rendered])")) {
    renderTex(el, el.textContent ?? "", el.classList.contains("display"));
    el.dataset.rendered = "";
  }
}
