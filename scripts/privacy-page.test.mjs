import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  PRIVACY_PAGE_TITLE,
  PrivacyPageError,
  escapeHtml,
  headingSlug,
  inlineHtml,
  markdownToHtml,
  privacyPageHtml,
} from './privacy-page.mjs'

const POLICY = readFileSync(path.join(import.meta.dirname, '..', 'docs', 'privacy.md'), 'utf8')

describe('headings', () => {
  it('become h1 to h6 with the id GitHub gives them', () => {
    expect(markdownToHtml('# Privacy policy')).toBe('<h1 id="privacy-policy">Privacy policy</h1>')
    expect(markdownToHtml('## Where it is stored and who processes it')).toBe(
      '<h2 id="where-it-is-stored-and-who-processes-it">Where it is stored and who processes it</h2>',
    )
    expect(markdownToHtml('### What we store')).toBe('<h3 id="what-we-store">What we store</h3>')
    expect(markdownToHtml('###### Six')).toBe('<h6 id="six">Six</h6>')
  })

  it('get ids without punctuation, and unique ones when repeated', () => {
    expect(headingSlug("Cookies & the app's **local** storage")).toBe(
      'cookies--the-apps-local-storage',
    )
    expect(headingSlug('[Logs](#logs) — 2026')).toBe('logs--2026')
    expect(markdownToHtml('## Logs\n\n## Logs')).toBe(
      '<h2 id="logs">Logs</h2>\n<h2 id="logs-1">Logs</h2>',
    )
  })

  it('end a paragraph or a list without a blank line', () => {
    expect(markdownToHtml('Text\n## Next\n- item\n## Last')).toBe(
      '<p>Text</p>\n<h2 id="next">Next</h2>\n<ul>\n<li>item</li>\n</ul>\n<h2 id="last">Last</h2>',
    )
  })
})

describe('paragraphs', () => {
  it('run over lines up to a blank line', () => {
    expect(markdownToHtml('One line\nand the next.\n\n  Another.\n')).toBe(
      '<p>One line\nand the next.</p>\n<p>Another.</p>',
    )
  })

  it('escape HTML', () => {
    expect(markdownToHtml('a < b & "c" > d')).toBe('<p>a &lt; b &amp; &quot;c&quot; &gt; d</p>')
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('read CRLF line ends like LF', () => {
    expect(markdownToHtml('# Title\r\n\r\nText\r\nmore')).toBe(
      '<h1 id="title">Title</h1>\n<p>Text\nmore</p>',
    )
  })
})

describe('lists', () => {
  it('become ul with an li per "- " item, continued on indented lines', () => {
    expect(markdownToHtml('- One,\n  continued;\n- two.\n\nAfter.')).toBe(
      '<ul>\n<li>One,\ncontinued;</li>\n<li>two.</li>\n</ul>\n<p>After.</p>',
    )
  })

  it('start after a paragraph without a blank line', () => {
    expect(markdownToHtml('**Your account**\n- Your email address.')).toBe(
      '<p><strong>Your account</strong></p>\n<ul>\n<li>Your email address.</li>\n</ul>',
    )
  })

  it('refuse nested lists', () => {
    expect(() => markdownToHtml('- one\n  - nested')).toThrow(PrivacyPageError)
  })
})

describe('inline Markdown', () => {
  it('turns **bold** into strong', () => {
    expect(inlineHtml('**Settings › Account › Delete account** deletes')).toBe(
      '<strong>Settings › Account › Delete account</strong> deletes',
    )
  })

  it('turns links into a, to a heading, a path, https or mailto', () => {
    expect(inlineHtml('(see [Logs](#logs))')).toBe('(see <a href="#logs">Logs</a>)')
    expect(inlineHtml('[the app](/)')).toBe('<a href="/">the app</a>')
    expect(inlineHtml('[Cloudflare](https://www.cloudflare.com/privacypolicy/?a=1&b=2)')).toBe(
      '<a href="https://www.cloudflare.com/privacypolicy/?a=1&amp;b=2">Cloudflare</a>',
    )
    expect(inlineHtml('Han Lin, [hotdogee@gmail.com](mailto:hotdogee@gmail.com)')).toBe(
      'Han Lin, <a href="mailto:hotdogee@gmail.com">hotdogee@gmail.com</a>',
    )
    expect(inlineHtml('[**bold** link](#x)')).toBe('<a href="#x"><strong>bold</strong> link</a>')
  })

  it('leaves the address alone: only the label and the text around a link can be bold', () => {
    expect(inlineHtml('[x](https://a.example/**b**)')).toBe(
      '<a href="https://a.example/**b**">x</a>',
    )
    expect(inlineHtml('**see [Logs](#logs)** first')).toBe(
      '<strong>see <a href="#logs">Logs</a></strong> first',
    )
  })

  it('refuses links the site cannot serve or that are not web pages', () => {
    for (const href of [
      'deploy.md',
      '../README.md',
      'http://example.com/',
      '//example.com/',
      // A browser reads a backslash as a slash: /\evil.example opens https://evil.example/.
      '/\\evil.example',
      '/a\\b',
      '#`code`',
      'javascript:alert(1)',
      'mailto:nobody',
    ]) {
      expect(() => inlineHtml(`[x](${href})`), href).toThrow(PrivacyPageError)
    }
  })

  it('keeps code spans literal', () => {
    expect(inlineHtml('the `[…]` and `**` <b>')).toBe(
      'the <code>[…]</code> and <code>**</code> &lt;b&gt;',
    )
  })

  it('refuses placeholders and syntax it does not know', () => {
    for (const text of [
      '[Operator name], [postal address]',
      '[contact email]',
      '*emphasis*',
      '**unclosed bold',
      '![an image](/icon.svg)',
      '[a reference link][ref]',
      'a stray ` backtick',
    ]) {
      expect(() => inlineHtml(text), text).toThrow(PrivacyPageError)
    }
  })
})

describe('the converter', () => {
  it('refuses block syntax it does not know', () => {
    for (const markdown of [
      '> A quote',
      '1. First',
      '* Item',
      '+ Item',
      '| a | b |',
      '```\ncode\n```',
      '    indented code',
      '<div>raw</div>',
      '---',
      'Setext\n===',
    ]) {
      expect(() => markdownToHtml(markdown), markdown).toThrow(PrivacyPageError)
    }
  })

  it('refuses a # link to no heading', () => {
    expect(() => markdownToHtml('## Logs\n\n[Logs](#logs) and [gone](#gone)')).toThrow(
      'a link to #gone, no heading',
    )
    expect(markdownToHtml('## Logs\n\n[Logs](#logs)')).toContain('<a href="#logs">Logs</a>')
  })
})

describe('the privacy policy page', () => {
  const html = privacyPageHtml(POLICY)
  const main = /<main>([\s\S]*)<\/main>/.exec(html)?.[1] ?? ''

  it('renders docs/privacy.md: every construct it uses', () => {
    expect(main).toContain('<h1 id="privacy-policy">Privacy policy</h1>')
    expect(main).toContain('<h2 id="logs">Logs</h2>')
    expect(main).toContain('<h3 id="what-we-store">What we store</h3>')
    expect(main).toMatch(/<p>Timer App is a timer and stopwatch\./)
    expect(main).toContain('<ul>\n<li>')
    expect(main).toContain('<h4 id="your-account">Your account</h4>')
    expect(main).toContain('<strong>Cloudflare</strong>')
    expect(main).toContain('<a href="#logs">Logs</a>')
    // The date changes with every edit of the policy.
    expect(main).toMatch(/<p>Last updated \d{4}-\d{2}-\d{2}\./)
  })

  it("names the operator and the contact address, and has no placeholder and no 'Draft'", () => {
    expect(main).toContain('<p>Han Lin, <a href="mailto:hotdogee@gmail.com">hotdogee@gmail.com</a>')
    expect(html).not.toMatch(/\[[^\]]*\]/)
    expect(html).not.toMatch(/draft|not yet in force|placeholder/i)
    expect(POLICY).not.toMatch(/\[(operator|postal|contact)[^\]]*\]|Draft/i)
  })

  it('is a standalone page: English, titled, with the favicon and a link back to the app', () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/)
    expect(html).toContain(`<title>${PRIVACY_PAGE_TITLE}</title>`)
    expect(PRIVACY_PAGE_TITLE).toBe('Privacy policy – Timer App')
    expect(html).toContain('<meta charset="utf-8" />')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />')
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="48x48" />')
    expect(html).toContain('<a href="/"><span aria-hidden="true">← </span>Back to Timer App</a>')
  })

  it('has no scripts and loads nothing from elsewhere', () => {
    expect(html).not.toMatch(/<script|\bon[a-z]+=|javascript:/i)
    expect(html).not.toMatch(/@import|url\(/)
    expect(html).toContain(
      `content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"`,
    )
    // Every resource the page loads is on its own site; only the policy's links leave it.
    const resources = [...html.matchAll(/<(?:link|img|iframe|source)\b[^>]*>/g)].map(([tag]) => tag)
    expect(resources.length).toBeGreaterThan(0)
    for (const tag of resources) expect(tag).not.toMatch(/(?:href|src)="(?!\/[^/])/)
  })

  it('reads in a column of about 40rem with 16px gutters, light and dark', () => {
    expect(html).toContain('max-width: 40rem;')
    expect(html).toContain('padding: 1.5rem 16px 4rem;')
    expect(html).toContain('font-family:\n          system-ui,')
    expect(html).toContain('@media (prefers-color-scheme: dark)')
    expect(html).toContain('<meta name="color-scheme" content="light dark" />')
  })
})
