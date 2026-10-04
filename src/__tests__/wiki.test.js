import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { REPO_BLOB, buildWiki, renderMarkdown, resolveHref, searchTerms, searchWiki } from '../lib/wiki'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WIKI_DIR = `${ROOT}docs/wiki/`
const wikiFiles = () => Object.fromEntries(fs.readdirSync(WIKI_DIR).filter((f) => f.endsWith('.md'))
  .map((f) => [`../../docs/wiki/${f}`, fs.readFileSync(WIKI_DIR + f, 'utf8')]))

describe('renderMarkdown', () => {
  it('escapes raw HTML and refuses script links', () => {
    const html = renderMarkdown('Hi <script>alert(1)</script> <img src=x onerror=y> [x](javascript:alert(1)) `<b>`')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<code>&lt;b&gt;</code>')
  })

  it('routes wiki links inside Help and repo paths to GitHub', () => {
    const html = renderMarkdown('[a](era-and-payments.md#void) [b](../../src/lib/era.js) [c](#top) [d](../HANDOFF.md) [e](https://example.org)', 'faq')
    expect(html).toContain('data-wiki-page="era-and-payments" data-wiki-anchor="void"')
    expect(html).toContain(`href="${REPO_BLOB}src/lib/era.js"`)
    expect(html).toContain('data-wiki-page="faq" data-wiki-anchor="top"')
    expect(html).toContain(`href="${REPO_BLOB}docs/HANDOFF.md"`)
    expect(html).toContain('href="https://example.org" target="_blank" rel="noopener noreferrer"')
    expect(resolveHref('mailto:x@example.org')).toBeNull()
  })

  it('renders tables, nested lists, emphasis and unique heading anchors', () => {
    const md = [
      '## Same', '## Same', '',
      '| A | B |', '|---|---|', '| **1** | `x\\|y` |', '',
      '- one', '  - two', '- three', '',
      '1. first', '2. second',
    ].join('\n')
    const html = renderMarkdown(md)
    expect(html).toContain('<h2 id="wiki-same">Same</h2>')
    expect(html).toContain('<h2 id="wiki-same-1">Same</h2>')
    expect(html).toContain('<th>A</th><th>B</th>')
    expect(html).toContain('<td><strong>1</strong></td><td><code>x|y</code></td>')
    expect(html).toContain('<ul><li>one<ul><li>two</li></ul></li><li>three</li></ul>')
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>')
  })
})

describe('searchWiki', () => {
  const wiki = buildWiki({
    '../../docs/wiki/README.md': '# Home\n\n[FAQ](faq.md) · [Billing](billing.md)\n',
    '../../docs/wiki/billing.md': '# Billing\n\n## Recoupments\n\nRecord a payer taking money back.\n\n## Claims\n\nA recoupment reopens the balance.\n',
    '../../docs/wiki/faq.md': "# FAQ\n\n## Scheduling\n\n### Why can't I save this booking?\n\nA stop finding in the Checks rail blocks Save.\n",
  })

  it('orders pages by the wiki home navigation', () => {
    expect(wiki.pages.map((p) => p.slug)).toEqual(['readme', 'faq', 'billing'])
  })

  it('ranks heading hits above body hits', () => {
    const { items } = searchWiki(wiki.pages, 'recoupment')
    expect(items.map((r) => r.heading)).toEqual(['Recoupments', 'Claims'])
    expect(items[0]).toMatchObject({ page: 'billing', anchor: 'recoupments' })
  })

  it('answers questions typed in plain language', () => {
    expect(searchTerms("Why can't I save this booking?")).toEqual(['save', 'book'])
    const { items, partial } = searchWiki(wiki.pages, "why can't I save this booking")
    expect(partial).toBe(false)
    expect(items[0]).toMatchObject({ page: 'faq', anchor: 'why-cant-i-save-this-booking' })
  })

  it('falls back to closest matches, and finds nothing for nonsense', () => {
    const res = searchWiki(wiki.pages, 'recoupment zzzq')
    expect(res.partial).toBe(true)
    expect(res.items[0].heading).toBe('Recoupments')
    expect(searchWiki(wiki.pages, 'zzzq qqqz').total).toBe(0)
    expect(searchWiki(wiki.pages, '   ').items).toEqual([])
  })
})

// The wiki stays current because each page names the files it documents. These checks
// fail CI when a page points at a file that no longer exists or a link goes nowhere.
describe('docs/wiki contract', () => {
  const wiki = buildWiki(wikiFiles())

  it('every page except the home lists existing source files', () => {
    for (const p of wiki.pages.filter((x) => x.slug !== 'readme')) {
      const line = p.md.split(/\r?\n/).find((l) => l.startsWith('_Sources:'))
      expect(line, `${p.slug}.md has no _Sources: line`).toBeTruthy()
      const paths = line.replace(/^_Sources:\s*/, '').replace(/_\s*$/, '').split(',').map((s) => s.trim().split(/\s/)[0]).filter(Boolean)
      for (const path of paths) {
        const target = path.includes('*') ? path.slice(0, path.lastIndexOf('/')) : path
        expect(fs.existsSync(ROOT + target), `${p.slug}.md lists missing source ${path}`).toBe(true)
      }
    }
  })

  it('the home links every page, and every wiki link lands on a page and heading', () => {
    const home = wiki.bySlug.readme.md
    for (const p of wiki.pages.filter((x) => x.slug !== 'readme')) expect(home, `README does not link ${p.slug}.md`).toContain(`(${p.slug}.md)`)
    for (const p of wiki.pages) {
      for (const m of renderMarkdown(p.md, p.slug).matchAll(/data-wiki-page="([^"]+)"(?: data-wiki-anchor="([^"]+)")?/g)) {
        const target = wiki.bySlug[m[1]]
        expect(target, `${p.slug}.md links missing page ${m[1]}.md`).toBeTruthy()
        if (m[2]) expect(renderMarkdown(target.md, target.slug), `${p.slug}.md links missing heading ${m[1]}#${m[2]}`).toContain(`id="wiki-${m[2]}"`)
      }
    }
  })
})
