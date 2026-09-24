// Export of the rendered document as a standalone HTML file.

import appCss from "./styles/app.css?raw";
import markdownCss from "./styles/markdown.css?raw";
import katexPkg from "katex/package.json";
import { escapeHtml } from "./markdown";

/** Reads a local image (asset URL) and returns it as a data: URI, or null if it can't be read. */
async function toDataUri(src: string): Promise<string | null> {
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** The theme variables from the app stylesheet: light by default, dark when the reader prefers it. */
function themeCss(): string {
  const light = /:root \{[\s\S]*?\n\}/.exec(appCss)?.[0] ?? "";
  const dark = /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(appCss)?.[1] ?? "";
  return `${light}\n@media (prefers-color-scheme: dark) {\n  :root {${dark}\n  }\n}`;
}

/** Waits (briefly) for diagrams and math that are still rendering. */
async function settled(root: HTMLElement): Promise<void> {
  for (let i = 0; i < 30 && root.querySelector(".mermaid:not([data-rendered]), .math:not([data-rendered])"); i++)
    await new Promise((r) => setTimeout(r, 100));
}

/** Builds a self-contained HTML page from the rendered preview. */
export async function buildHtml(body: HTMLElement, fallbackTitle: string): Promise<string> {
  await settled(body);
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".code-copy").forEach((el) => el.remove());
  clone.querySelectorAll("[data-line], [data-rendered], [data-task-line]").forEach((el) => {
    el.removeAttribute("data-line");
    el.removeAttribute("data-rendered");
    el.removeAttribute("data-task-line");
  });
  clone.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((el) => el.setAttribute("disabled", ""));
  // Embed local images so the file works anywhere; remote ones stay links.
  await Promise.all(
    [...clone.querySelectorAll<HTMLImageElement>("img[src]")].map(async (img) => {
      const src = img.getAttribute("src")!;
      if (/^(asset:|https?:\/\/asset\.localhost)/i.test(src)) {
        const data = await toDataUri(src);
        if (data) img.setAttribute("src", data);
      }
    }),
  );
  const title = clone.querySelector("h1")?.textContent?.trim() || fallbackTitle;
  const katex = clone.querySelector(".katex")
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katexPkg.version}/dist/katex.min.css">\n`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Folio">
<title>${escapeHtml(title)}</title>
${katex}<style>
${themeCss()}
body { margin: 0; background: var(--bg); color: var(--fg); }
${markdownCss}
</style>
</head>
<body>
<article class="markdown-body">
${clone.innerHTML}
</article>
</body>
</html>
`;
}
