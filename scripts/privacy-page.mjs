/**
 * The public privacy policy page: `docs/privacy.md`, the source of truth, rendered to a standalone
 * HTML page. `pnpm build` writes it to `dist/privacy.html` (the `privacyPage` plugin in
 * vite.config.ts), which the Worker's static assets serve at `/privacy`; `pnpm dev` serves it
 * there too, rendered on every request.
 *
 * The converter knows only the Markdown the policy uses: ATX headings (`#` to `######`, each
 * with a GitHub-style id, so `[Logs](#logs)` works), paragraphs, `- ` lists whose items continue
 * on indented lines, `**bold**`, `` `code` ``, and links to a heading on the page (`#…`), to a
 * path of the site (`/…`), to `https://` or to `mailto:`. Anything else fails the build rather
 * than reaching the page as raw Markdown: other block syntax (quotes, ordered or nested lists,
 * tables, code blocks, raw HTML), other inline syntax (a `*`, `[`, `]` or backtick left over,
 * which includes a placeholder such as `[Operator name]`), a link to another kind of address
 * (a relative `deploy.md` would not exist on the site) and a `#` link to no heading.
 *
 * The page has no scripts and loads nothing from elsewhere: the styles are inline, and it
 * follows the system's light or dark scheme.
 */

/** A Markdown construct the converter does not support, or a broken link. */
export class PrivacyPageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'PrivacyPageError'
  }
}

/** The page's title (the browser tab). */
export const PRIVACY_PAGE_TITLE = 'Privacy policy – Timer App'

/** Block syntax the converter refuses, with what it is. */
const UNSUPPORTED_BLOCKS = /** @type {const} */ ([
  [/^>/, 'a block quote'],
  [/^\d+[.)]\s/, 'an ordered list'],
  [/^[*+]\s/, 'a list with * or +'],
  [/^\|/, 'a table'],
  [/^(```|~~~)/, 'a fenced code block'],
  [/^ {4}/, 'an indented code block'],
  [/^</, 'raw HTML'],
  [/^([-*_])\s*\1\s*\1[-*_\s]*$/, 'a thematic break'],
  [/^(=+|-+)\s*$/, 'a setext heading'],
])

/**
 * `text` with `&`, `<`, `>` and `"` escaped, for HTML text and attribute values.
 * @param {string} text
 */
export function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * The id GitHub gives a heading with `text` (its Markdown stripped): lower case, without
 * punctuation, spaces turned into hyphens.
 * @param {string} text
 */
export function headingSlug(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
}

/** Marks where a code span goes back in (U+E000, private use), around its index. */
const CODE_MARK = '\uE000'
/** Marks where a link's address goes back in (U+E001), around its index. */
const HREF_MARK = '\uE001'

/**
 * Whether a link may point at `href` (see the module comment). A path of the site has no
 * backslash: a browser reads `/\host` as `//host`, another site.
 * @param {string} href
 */
function allowedHref(href) {
  return (
    !href.includes(CODE_MARK) &&
    /^(#[^\s#]+|\/(?![/\\])[^\s\\]*|https:\/\/\S+|mailto:\S+@\S+)$/.test(href)
  )
}

/**
 * One line's inline Markdown as HTML: code spans, links and bold, the rest escaped. Throws a
 * {@link PrivacyPageError} for inline syntax left over.
 * @param {string} text
 */
export function inlineHtml(text) {
  /** @type {string[]} */
  const codes = []
  /** @type {string[]} */
  const hrefs = []
  // Code spans first: their content is literal, so it waits outside the passes below.
  let html = text.replace(/`([^`]+)`/g, (_match, /** @type {string} */ code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`)
    return `${CODE_MARK}${String(codes.length - 1)}${CODE_MARK}`
  })
  html = escapeHtml(html)
  // Not an image (`![…](…)`), whose `[` is then left over. The address waits outside the bold
  // pass and the leftover check too (a `**` in a URL is part of it); the label does not.
  html = html.replace(
    /(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, /** @type {string} */ label, /** @type {string} */ href) => {
      // `href` is escaped already, which keeps `&amp;` right in the attribute.
      const raw = href.replaceAll('&amp;', '&')
      if (!allowedHref(raw)) {
        throw new PrivacyPageError(
          `a link to ${raw}: links go to #a-heading, /a-path, https:// or mailto: only`,
        )
      }
      hrefs.push(href)
      return `<a href="${HREF_MARK}${String(hrefs.length - 1)}${HREF_MARK}">${label}</a>`
    },
  )
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const leftover = /[*`[\]]/.exec(html)
  if (leftover !== null) {
    throw new PrivacyPageError(
      `unsupported Markdown (the ${leftover[0]}, a placeholder or other syntax) in: ${text}`,
    )
  }
  return html
    .replace(/\uE001(\d+)\uE001/g, (_match, /** @type {string} */ index) => {
      return hrefs[Number(index)] ?? ''
    })
    .replace(/\uE000(\d+)\uE000/g, (_match, /** @type {string} */ index) => {
      return codes[Number(index)] ?? ''
    })
}

/**
 * `markdown` (the subset in the module comment) as an HTML fragment: one element per line, in
 * source order. Throws a {@link PrivacyPageError} for anything unsupported, and for a `#` link to
 * no heading.
 * @param {string} markdown
 */
export function markdownToHtml(markdown) {
  /** @type {string[]} */
  const out = []
  /** @type {Set<string>} */
  const ids = new Set()
  /** @type {string[] | null} The paragraph being read: its lines. */
  let paragraph = null
  /** @type {string[][] | null} The list being read: its items, each as its lines. */
  let list = null

  const closeParagraph = () => {
    if (paragraph !== null) out.push(`<p>${paragraph.map(inlineHtml).join('\n')}</p>`)
    paragraph = null
  }
  const closeList = () => {
    if (list !== null) {
      out.push('<ul>')
      for (const item of list) out.push(`<li>${item.map(inlineHtml).join('\n')}</li>`)
      out.push('</ul>')
    }
    list = null
  }

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  for (const [index, line] of lines.entries()) {
    const where = `line ${String(index + 1)}`
    if (line.trim() === '') {
      closeParagraph()
      closeList()
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading !== null) {
      closeParagraph()
      closeList()
      const level = String(heading[1]?.length)
      const text = heading[2] ?? ''
      const base = headingSlug(text)
      let id = base
      for (let n = 1; ids.has(id); n++) id = `${base}-${String(n)}`
      ids.add(id)
      out.push(`<h${level} id="${escapeHtml(id)}">${inlineHtml(text)}</h${level}>`)
      continue
    }
    const item = /^- (.*)$/.exec(line)
    if (item !== null) {
      closeParagraph()
      list ??= []
      list.push([item[1] ?? ''])
      continue
    }
    // An item continues on an indented line (or, as in CommonMark, an unindented one right after).
    const lastItem = list?.at(-1)
    if (lastItem !== undefined) {
      const text = line.trim()
      if (/^[-*+]\s|^\d+[.)]\s/.test(text)) throw new PrivacyPageError(`${where}: a nested list`)
      lastItem.push(text)
      continue
    }
    for (const [pattern, what] of UNSUPPORTED_BLOCKS) {
      // An indented line inside a paragraph continues it; only one that starts a block is code.
      if (paragraph !== null && what === 'an indented code block') continue
      if (pattern.test(line)) throw new PrivacyPageError(`${where}: ${what} is not supported`)
    }
    paragraph ??= []
    paragraph.push(line.trim())
  }
  closeParagraph()
  closeList()

  const html = out.join('\n')
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) {
    if (id !== undefined && !ids.has(id)) throw new PrivacyPageError(`a link to #${id}, no heading`)
  }
  return html
}

/** The page's styles: a readable column, the system font, light and dark. */
const STYLE = `
      :root {
        color-scheme: light dark;
        --background: #f9f9ff;
        --text: #1a1b20;
        --muted: #44474f;
        --link: #0b57d0;
        --rule: #c4c6d0;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --background: #121318;
          --text: #e3e2e9;
          --muted: #c4c6d0;
          --link: #a8c7fa;
          --rule: #44474f;
        }
      }
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      html {
        -webkit-text-size-adjust: 100%;
        text-size-adjust: 100%;
      }
      body {
        margin: 0;
        background: var(--background);
        color: var(--text);
        font-family:
          system-ui,
          -apple-system,
          'Segoe UI',
          Roboto,
          'Helvetica Neue',
          Arial,
          sans-serif;
        font-size: 1rem;
        line-height: 1.6;
      }
      .page {
        max-width: 40rem;
        margin: 0 auto;
        padding: 1.5rem 16px 4rem;
        overflow-wrap: break-word;
      }
      nav {
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--rule);
      }
      a {
        color: var(--link);
        text-underline-offset: 0.15em;
      }
      a:focus-visible {
        outline: 2px solid var(--link);
        outline-offset: 2px;
        border-radius: 2px;
      }
      h1,
      h2,
      h3,
      h4 {
        line-height: 1.25;
        scroll-margin-top: 1rem;
      }
      h1 {
        font-size: 2rem;
        margin: 2rem 0 0.75rem;
      }
      h2 {
        font-size: 1.375rem;
        margin: 2.5rem 0 0.75rem;
      }
      h3 {
        font-size: 1.125rem;
        margin: 2rem 0 0.5rem;
      }
      h4 {
        font-size: 1rem;
        margin: 1.5rem 0 0.5rem;
      }
      h1 + p {
        color: var(--muted);
      }
      p,
      ul {
        margin: 0 0 1rem;
      }
      ul {
        padding-inline-start: 1.25rem;
      }
      li + li {
        margin-top: 0.375rem;
      }
      code {
        font-family: ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace;
        font-size: 0.9em;
      }`

/**
 * The privacy policy page for `markdown` (docs/privacy.md's text): a standalone HTML document
 * with the policy, a link back to the app at `/` and the app's favicon.
 * @param {string} markdown
 */
export function privacyPageHtml(markdown) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"
    />
    <meta name="color-scheme" content="light dark" />
    <meta name="description" content="How Timer App handles your data." />
    <title>${escapeHtml(PRIVACY_PAGE_TITLE)}</title>
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/favicon.svg" sizes="any" type="image/svg+xml" />
    <style>${STYLE}
    </style>
  </head>
  <body>
    <div class="page">
      <nav><a href="/"><span aria-hidden="true">← </span>Back to Timer App</a></nav>
      <main>
${markdownToHtml(markdown)}
      </main>
    </div>
  </body>
</html>
`
}
