# Themes and custom CSS

Folio can restyle the rendered document in two places:

- **Preview themes** change how documents look in Read view and in the preview side of Split view. Choose one in **Settings → Preview → Theme**. HTML exports use the same theme unless you pick another style when exporting.
- **Extra CSS for an export** adds a few rules to one HTML export only, in the **Export as HTML** dialog.

Both are plain CSS. Themes don't change the editor or Live mode, which keep Folio's own look.

## Built-in themes

| Theme | Look |
|---|---|
| **Folio** | The default |
| **GitHub** | Close to how GitHub shows README files |
| **Academic** | A paper: serif, justified text, numbered sections, tables with horizontal rules only |
| **Sepia** | Warm paper tones and a book face |

Every theme has a light and a dark version, which follow Folio's light/dark setting.

Their source is in [`themes/`](../themes): each theme is one CSS file. They're a good starting point for your own.

## Using your own theme

1. Copy [`themes/template.css`](../themes/template.css), or one of the built-in themes, anywhere on your computer and rename it.
2. Open **Settings → Preview → Theme → Custom CSS file…** and choose the file.
3. Edit the file in any editor. Each time you save it, Folio reloads it and shows "Theme reloaded" in the status bar. Keep the preview open next to the file while you work.

If the file can't be read (moved, deleted), Folio shows an error and falls back to its own look. Choose the file again with **Choose…**.

## How a theme works

Folio renders a document into this structure, both in the app and in an HTML export:

```html
<html data-theme="light">                <!-- or "dark" -->
  …
  <section class="folio-preview">        <!-- the page around the document; <body> in an export -->
    <article class="markdown-body">      <!-- the document -->
      <h1>…</h1>
      <p>…</p>
      …
    </article>
  </section>
```

Two rules keep a theme from breaking anything:

- **Start every selector with `.folio-preview`**, e.g. `.folio-preview .markdown-body h1 { … }`. The theme then applies only to the document, never to Folio's toolbar, sidebar or menus. It also wins over Folio's own rules for the same elements.
- **Set colours and fonts through the variables below**, inside `.folio-preview { … }`. Everything that uses them, such as code blocks, tables and callouts, follows the change.

### Variables

| Variable | Used for |
|---|---|
| `--bg` | Page background |
| `--bg-alt` | Table headers, striped rows, `<details>` |
| `--bg-code` | Code blocks and `inline code` |
| `--fg` | Text |
| `--fg-muted` | Quotes, footnotes, `######` headings |
| `--fg-faint` | The faintest text |
| `--border` | Rules, table borders, heading underlines |
| `--accent` | Links, checkboxes |
| `--font-text` | The document's font |
| `--font-mono` | Code |
| `--content-width` | Width of the text column (`none` for full width) |
| `--callout-note`, `--callout-tip`, `--callout-important`, `--callout-warning`, `--callout-caution` | Callout colours |
| `--syn-keyword`, `--syn-string`, `--syn-number`, `--syn-comment`, `--syn-function`, `--syn-type`, `--syn-property`, `--syn-tag`, `--syn-meta` | Code highlighting |

A theme that sets `--font-text` or `--content-width` overrides the **Font** and **Text width** settings. The built-in themes set a font but leave the width to you.

### Dark mode

Folio sets `data-theme="dark"` on `<html>` in dark mode. Give your theme dark colours with:

```css
:root[data-theme="dark"] .folio-preview {
  --bg: #1d1c1a;
  --fg: #e8e4dc;
  /* … */
}
```

An exported page does the same. With **Theme: Follow the reader's system**, a small script in the page sets `data-theme` from the reader's system and follows it when it changes.

### Elements you can style

| Selector | What |
|---|---|
| `h1` … `h6`, `p`, `a`, `strong`, `em`, `hr`, `img` | The usual |
| `blockquote` | Quotes |
| `pre`, `:not(pre) > code` | Code blocks, inline code |
| `table`, `th`, `td` | Tables |
| `ul`, `ol`, `li.task-item`, `.task-box` | Lists, task lists and their checkboxes |
| `.callout`, `.callout-title`, `.callout-note` … `.callout-caution` | Callouts (`> [!NOTE]` …) |
| `details.callout` | Foldable callouts (`> [!NOTE]-`) |
| `table.frontmatter` | The metadata table from a document's frontmatter |
| `.footnotes` | Footnotes |
| `.math`, `.math.display` | Formulas |
| `.mermaid` | Diagrams |
| `@media print { … }` | Printing and Save as PDF |

Put `.folio-preview .markdown-body` in front of each, e.g. `.folio-preview .markdown-body blockquote`.

### Font size and zoom

Folio's zoom (Ctrl/⌘ + / −) multiplies the document's font size by `var(--zoom)`. If you set a font size, keep the zoom working:

```css
.folio-preview .markdown-body {
  font-size: calc(17px * var(--zoom));
}
```

### Fonts and images

- Use fonts installed on the computer, and list fallbacks: `font-family: "Iowan Old Style", Palatino, Georgia, serif`.
- For security, the app doesn't load fonts or stylesheets from the internet (`@import url(https://…)`, Google Fonts). An `@font-face` with a `data:` URL works everywhere. Web fonts do work in an exported page opened in a browser.
- Images in a theme (`background: url(…)`) must be `https://` or `data:` URLs. A relative path isn't resolved against the theme file.

## Styling an HTML export

**Export as HTML** asks for:

- **Style:** the preview's theme, or Folio's own look. This choice only appears when a theme is chosen.
- **Theme:** light, dark, or follow the reader's system.
- **Font, text width, table of contents, metadata, math fonts.**
- **Extra CSS:** rules added after all other styles, for this export. Type them, or use **Load from file…** to fill the box from a `.css` file. The box is remembered for the next export.

Ready-made snippets for the Extra CSS box are in [`themes/snippets/`](../themes/snippets):

| Snippet | Does |
|---|---|
| [`numbered-headings.css`](../themes/snippets/numbered-headings.css) | Numbers sections 1, 1.1, 1.1.1 |
| [`print.css`](../themes/snippets/print.css) | Better printing: each `##` section on a new page, no tables or code split across pages, link addresses shown |
| [`wide-page.css`](../themes/snippets/wide-page.css) | A wider page and larger text, tables full width |

Snippets are ordinary CSS, so you can also paste them into a theme file.

## Adding a built-in theme

Every `.css` file directly in `themes/` (except `template.css`) is built into Folio as a theme. Its name comes from the first comment:

```css
/* Folio theme: Solarized — a short description */
```

Add a file, rebuild, and it appears in **Settings → Preview → Theme**.
