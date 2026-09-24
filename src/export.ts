// Export of the rendered document as a standalone HTML file.

import appCss from "./styles/app.css?raw";
import markdownCss from "./styles/markdown.css?raw";
import katexCss from "katex/dist/katex.min.css?raw";
import katexPkg from "katex/package.json";
import { escapeHtml } from "./markdown";
import type { ExportOptions } from "./export-options";
import { themeCss as previewThemeCss } from "./themes";

// KaTeX's fonts as data: URIs, loaded only when a document with math is exported.
const katexFonts = import.meta.glob("/node_modules/katex/dist/fonts/*.woff2", {
  query: "?inline",
  import: "default",
}) as Record<string, () => Promise<string>>;

const FONTS = {
  sans: "var(--font-ui)",
  serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
};
const WIDTHS = { narrow: "680px", medium: "820px", wide: "1040px", full: "none" };

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

/** The app's theme variables for the chosen theme ("system" follows the reader's OS). */
function themeCss(theme: ExportOptions["theme"]): string {
  const light = /:root \{[\s\S]*?\n\}/.exec(appCss)?.[0] ?? "";
  const dark = /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(appCss)?.[1] ?? "";
  if (theme === "light") return light;
  if (theme === "dark") return `${light}\n:root {${dark}\n}`;
  return `${light}\n@media (prefers-color-scheme: dark) {\n  :root {${dark}\n  }\n}`;
}

/** KaTeX's stylesheet with its fonts inlined, so math renders offline. */
async function embeddedKatexCss(): Promise<string> {
  const byName = new Map<string, string>();
  await Promise.all(
    Object.entries(katexFonts).map(async ([path, load]) => byName.set(path.split("/").pop()!.replace(".woff2", ""), await load())),
  );
  // Keep only the woff2 source of each @font-face, pointing at the inlined data.
  return katexCss.replace(
    /src:url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\)(?:,url\([^)]*\) format\("[^"]*"\))*/g,
    (whole, name: string) => (byName.has(name) ? `src:url(${byName.get(name)}) format("woff2")` : whole),
  );
}

/** Waits (briefly) for diagrams and math that are still rendering. */
async function settled(root: HTMLElement): Promise<void> {
  for (let i = 0; i < 30 && root.querySelector(".mermaid:not([data-rendered]), .math:not([data-rendered])"); i++)
    await new Promise((r) => setTimeout(r, 100));
}

/** Re-renders diagrams for the export's theme; "system" embeds both and lets CSS pick. */
async function themeDiagrams(root: HTMLElement, theme: ExportOptions["theme"]): Promise<void> {
  const diagrams = [...root.querySelectorAll<HTMLElement>(".mermaid[data-source]")];
  if (!diagrams.length) return;
  const { mermaidSvg } = await import("./lazy/mermaid");
  for (const el of diagrams) {
    const source = el.dataset.source!;
    try {
      if (theme === "system") {
        const [light, dark] = [await mermaidSvg(source, "light"), await mermaidSvg(source, "dark")];
        el.innerHTML = `<div class="only-light">${light}</div><div class="only-dark">${dark}</div>`;
      } else {
        el.innerHTML = await mermaidSvg(source, theme);
      }
    } catch {
      /* keep what the preview rendered */
    }
  }
}

/** A nested list of links to the document's headings. */
function tableOfContents(root: HTMLElement): string {
  const headings = [...root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]")];
  if (!headings.length) return "";
  const min = Math.min(...headings.map((h) => Number(h.tagName[1])));
  const out: string[] = [];
  const liOpen: boolean[] = [];
  let depth = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]) - min + 1;
    while (depth < level) {
      out.push("<ul>"); // nested inside the parent's still-open <li>
      liOpen[++depth] = false;
    }
    while (depth > level) {
      if (liOpen[depth]) out.push("</li>");
      out.push("</ul>");
      depth--;
    }
    if (liOpen[depth]) out.push("</li>");
    out.push(`<li><a href="#${escapeHtml(h.id)}">${escapeHtml(h.textContent?.trim() ?? "")}</a>`);
    liOpen[depth] = true;
  }
  while (depth > 0) {
    if (liOpen[depth]) out.push("</li>");
    out.push("</ul>");
    depth--;
  }
  const html = out.join("");
  return `<nav class="toc" aria-label="Contents"><div class="toc-title">Contents</div>${html}</nav>`;
}

const PAGE_CSS = `
body { margin: 0; background: var(--bg); color: var(--fg); }
html { scroll-behavior: smooth; }
.markdown-body :is(h1, h2, h3, h4, h5, h6) { scroll-margin-top: 16px; }
.only-dark { display: none; }
@media (prefers-color-scheme: dark) { .only-dark { display: block; } .only-light { display: none; } }
.toc { max-width: var(--content-width); margin: 0 auto; padding: 36px 48px 0; font: 14px/1.5 var(--font-ui); }
.toc-title { margin-bottom: 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-faint); }
.toc ul { margin: 0; padding-left: 14px; list-style: none; }
.toc > ul { padding-left: 0; }
.toc a { display: block; padding: 2px 0; color: var(--fg-muted); text-decoration: none; }
.toc a:hover { color: var(--accent); }
body.toc-top .toc, body.toc-sidebar .toc { padding-bottom: 16px; border-bottom: 1px solid var(--border); }
@media (min-width: 1100px) {
  body.toc-sidebar .page { display: grid; grid-template-columns: 260px minmax(0, 1fr); }
  body.toc-sidebar .toc { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow: auto; margin: 0; padding: 36px 16px 36px 28px; border-bottom: 0; border-right: 1px solid var(--border); }
}
@media print { .toc { display: none; } }
`;

/** Builds a self-contained HTML page from the rendered preview. */
export async function buildHtml(body: HTMLElement, fallbackTitle: string, opts: ExportOptions): Promise<string> {
  await settled(body);
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".code-copy, .heading-fold").forEach((el) => el.remove());
  clone.querySelectorAll(".fold-hidden, .folded").forEach((el) => el.classList.remove("fold-hidden", "folded"));
  if (!opts.frontmatter) clone.querySelectorAll(".frontmatter").forEach((el) => el.remove());
  await themeDiagrams(clone, opts.theme);
  clone.querySelectorAll("[data-line], [data-rendered], [data-task-line], [data-source]").forEach((el) => {
    for (const a of ["data-line", "data-rendered", "data-task-line", "data-source"]) el.removeAttribute(a);
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
  const hasMath = !!clone.querySelector(".katex");
  const math = !hasMath
    ? ""
    : opts.embedFonts
      ? `<style>\n${await embeddedKatexCss()}\n</style>\n`
      : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katexPkg.version}/dist/katex.min.css">\n`;
  const toc = opts.toc !== "none" ? tableOfContents(clone) : "";
  const layout = `:root { --zoom: 1; --content-width: ${WIDTHS[opts.width]}; --font-text: ${FONTS[opts.font]}; }`;
  const theme = opts.style === "preview" ? await previewThemeCss().catch(() => "") : "";
  // Themes style dark mode with [data-theme="dark"], as in the app; "system" follows the reader's OS.
  const dataTheme =
    opts.theme === "system"
      ? `<script>(()=>{const m=matchMedia("(prefers-color-scheme: dark)"),s=()=>document.documentElement.dataset.theme=m.matches?"dark":"light";s();m.addEventListener("change",s)})()</script>\n`
      : "";

  return `<!doctype html>
<html lang="en"${opts.theme === "system" ? "" : ` data-theme="${opts.theme}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Folio">
${opts.theme === "system" ? "" : `<meta name="color-scheme" content="${opts.theme}">\n`}${dataTheme}<title>${escapeHtml(title)}</title>
${math}<style>
${themeCss(opts.theme)}
${layout}
${PAGE_CSS}
${markdownCss}
</style>
${theme.trim() ? `<style>\n${theme}\n</style>\n` : ""}${opts.css.trim() ? `<style>\n${opts.css}\n</style>\n` : ""}</head>
<body class="folio-preview toc-${toc ? opts.toc : "none"}">
<div class="page">
${toc}
<article class="markdown-body">
${clone.innerHTML}
</article>
</div>
</body>
</html>
`;
}
