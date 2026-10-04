import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { buildWiki, renderMarkdown, searchWiki } from '../lib/wiki'

// The wiki is bundled as text at build time, so Help always matches the docs that
// landed with this build: updating docs/wiki updates this screen on the next deploy.
const WIKI = buildWiki(import.meta.glob('../../docs/wiki/*.md', { query: '?raw', import: 'default', eager: true }))
const label = (p) => (p.slug === 'readme' ? 'Wiki home' : p.title)

/** Help & Wiki: the platform wiki and FAQ, searchable, available to every role. */
export default function HelpView() {
  const [page, setPage] = useState(WIKI.pages[0]?.slug)
  const [anchor, setAnchor] = useState(null)
  const [q, setQ] = useState('')
  const mainRef = useRef(null)
  const current = WIKI.bySlug[page] || WIKI.pages[0]
  const html = useMemo(() => (current ? renderMarkdown(current.md, current.slug) : ''), [current])
  const results = useMemo(() => searchWiki(WIKI.pages, q), [q])
  const searching = q.trim().length > 0

  useEffect(() => {
    if (searching) return
    const el = anchor && document.getElementById(`wiki-${anchor}`)
    if (el) el.scrollIntoView?.({ block: 'start' })
    else mainRef.current?.scrollTo?.(0, 0)
  }, [page, anchor, searching])

  const open = (slug, at = null) => {
    setPage(slug)
    setAnchor(at)
    setQ('')
  }
  const onArticleClick = (e) => {
    const a = e.target.closest?.('a[data-wiki-page]')
    if (!a) return
    e.preventDefault()
    open(a.dataset.wikiPage, a.dataset.wikiAnchor || null)
  }

  return (
    <div className="sectionpage help-view" data-testid="help-view">
      <SectionBar icon="info" title="Help & Wiki" sub="Workflows, FAQs and how each screen works, from the wiki shipped with this build" />
      <div className="help-body">
        <aside className="help-side">
          <label className="help-search">
            <span className="help-search-ic">{Icon.search({ size: 14 })}</span>
            <input
              type="search"
              className="input"
              placeholder="Search workflows, FAQs, terms"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search help"
              data-testid="help-search"
            />
          </label>
          <nav className="help-pages" aria-label="Wiki pages">
            {WIKI.pages.map((p) => (
              <button
                key={p.slug}
                type="button"
                className={`help-page ${!searching && p.slug === current?.slug ? 'on' : ''}`}
                aria-current={!searching && p.slug === current?.slug ? 'page' : undefined}
                onClick={() => open(p.slug)}
                data-testid={`help-page-${p.slug}`}
              >
                {label(p)}
              </button>
            ))}
          </nav>
        </aside>
        <main className="help-main" ref={mainRef}>
          {searching ? (
            <div className="help-results" data-testid="help-results" aria-live="polite">
              <p className="help-count">
                {!results.total ? `No matches for "${q.trim()}".`
                  : results.partial ? `No page has every word. Closest ${results.items.length} of ${results.total}:`
                    : `${results.total} ${results.total === 1 ? 'match' : 'matches'}${results.total > results.items.length ? `, top ${results.items.length} shown` : ''}`}
              </p>
              {results.items.map((r, i) => (
                <button key={`${r.page}-${r.anchor}-${i}`} type="button" className="help-result" onClick={() => open(r.page, r.anchor)} data-testid={`help-result-${i}`}>
                  <span className="help-result-path">{r.title}</span>
                  <span className="help-result-head">{r.heading}</span>
                  {r.snippet && <span className="help-result-snip">{r.snippet}</span>}
                </button>
              ))}
            </div>
          ) : current ? (
            // renderMarkdown escapes every piece of text and only links http(s) and repo paths
            <article className="wiki" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: html }} data-testid="help-article" />
          ) : (
            <p className="help-count">No help pages are bundled in this build.</p>
          )}
        </main>
      </div>
    </div>
  )
}
