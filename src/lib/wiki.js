// Help & Wiki engine. docs/wiki/*.md is bundled into the app as raw text, so the
// in-app Help always matches the wiki that shipped with the build. This module turns
// that text into ordered pages, searchable sections and escaped HTML. Pure: no React.

export const REPO_BLOB = 'https://github.com/pkiran-aloha/CP-Inspired-Scheduler/blob/main/'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** GitHub-style heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function slugify(text) {
  return String(text).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
}

const pageSlug = (file) => file.split('/').pop().replace(/\.md$/i, '').toLowerCase()

/**
 * Where a markdown link points. Wiki pages open inside Help; repo files open on GitHub;
 * anything else (mailto:, javascript:, data:) is not linked at all.
 */
export function resolveHref(href, page) {
  if (/^https?:\/\//i.test(href)) return { url: href }
  if (href.startsWith('#')) return { page, anchor: href.slice(1) }
  const wiki = /^([\w-]+)\.md(?:#([\w-]+))?$/i.exec(href)
  if (wiki) return { page: wiki[1].toLowerCase(), anchor: wiki[2] || null }
  if (/^[\w./-]+(#[\w-]+)?$/.test(href)) {
    const parts = ['docs', 'wiki']
    for (const seg of href.split('#')[0].split('/')) {
      if (seg === '..') parts.pop()
      else if (seg && seg !== '.') parts.push(seg)
    }
    return { url: REPO_BLOB + parts.join('/') }
  }
  return null
}

function emphasis(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
}

const spans = (raw) => raw.split(/(`[^`]+`)/).map((t) =>
  t.length > 1 && t.startsWith('`') && t.endsWith('`') ? `<code>${esc(t.slice(1, -1))}</code>` : emphasis(esc(t))).join('')

function inline(raw, page) {
  let out = ''
  let last = 0
  for (const m of raw.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    out += spans(raw.slice(last, m.index))
    const label = spans(m[1])
    const to = resolveHref(m[2], page)
    if (!to) out += label
    else if (to.page) out += `<a href="#" data-wiki-page="${esc(to.page)}"${to.anchor ? ` data-wiki-anchor="${esc(to.anchor)}"` : ''}>${label}</a>`
    else out += `<a href="${esc(to.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    last = m.index + m[0].length
  }
  return out + spans(raw.slice(last))
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, '\u0000').split('|').map((c) => c.replace(/\u0000/g, '|').trim())
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/

function renderList(items, page) {
  let html = ''
  const stack = []
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`
    const top = stack[stack.length - 1]
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? 'ol' : 'ul'
      stack.push({ indent: it.indent, tag })
      html += `<${tag}><li>`
    } else html += '</li><li>'
    html += inline(it.text, page)
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`
  return html
}

/** Markdown (the subset the wiki uses) to HTML. Every piece of text is escaped. */
export function renderMarkdown(md, page = '') {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n')
  const used = {}
  const out = []
  let para = []
  const flush = () => {
    if (!para.length) return
    const text = para.join(' ')
    const meta = /^_(Sources|Last synced)/.test(text)
    out.push(`<p${meta ? ' class="wiki-meta"' : ''}>${inline(text, page)}</p>`)
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) { flush(); continue }
    if (/^```/.test(line)) {
      flush()
      const code = []
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i])
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      const base = slugify(h[2].replace(/[`*_]/g, ''))
      const id = used[base] ? `${base}-${used[base]}` : base
      used[base] = (used[base] || 0) + 1
      out.push(`<h${h[1].length} id="wiki-${id}">${inline(h[2], page)}</h${h[1].length}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); continue }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      flush()
      const head = cells(line)
      const rows = []
      i += 1
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) rows.push(cells(lines[++i]))
      out.push(`<div class="wiki-table"><table><thead><tr>${head.map((c) => `<th>${inline(c, page)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, page)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if (LIST.test(line)) {
      flush()
      const items = []
      while (i < lines.length) {
        const m = LIST.exec(lines[i])
        if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] })
        else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1].text += ' ' + lines[i].trim()
        else break
        i++
      }
      i--
      out.push(renderList(items, page))
      continue
    }
    if (/^>\s?/.test(line)) {
      flush()
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
      i--
      out.push(`<blockquote>${inline(quote.join(' '), page)}</blockquote>`)
      continue
    }
    para.push(line.trim())
  }
  flush()
  return out.join('\n')
}

const plain = (md) => md
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/`|\*\*/g, '')
  .replace(/^\s*[>#]+\s*/gm, '')
  .replace(/\|/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

/** One searchable section per heading (level 2 and deeper); the intro sits under the page title. */
export function parsePage(slug, md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n')
  const title = (lines.find((l) => /^#\s+/.test(l)) || slug).replace(/^#\s+/, '').trim()
  const used = {}
  const sections = []
  let cur = { anchor: null, heading: title, level: 1, body: [] }
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const base = slugify(h[2].replace(/[`*_]/g, ''))
      const anchor = used[base] ? `${base}-${used[base]}` : base
      used[base] = (used[base] || 0) + 1
      if (h[1].length === 1) continue
      sections.push(cur)
      cur = { anchor, heading: plain(h[2]), level: h[1].length, body: [] }
    } else if (!/^_(Sources|Last synced)/.test(line.trim())) cur.body.push(line)
  }
  sections.push(cur)
  return {
    slug,
    title,
    md,
    sections: sections.map(({ body, ...s }) => ({ ...s, text: plain(body.join('\n')) })).filter((s) => s.text || s.anchor),
  }
}

/**
 * Pages from an import.meta.glob map ({path: raw}). Order follows the links in the
 * wiki home (README) so Help's page list matches the wiki's own navigation table.
 */
export function buildWiki(files) {
  const pages = Object.entries(files || {}).map(([file, raw]) => parsePage(pageSlug(file), raw))
  const bySlug = Object.fromEntries(pages.map((p) => [p.slug, p]))
  const order = ['readme']
  if (bySlug.readme) for (const m of bySlug.readme.md.matchAll(/\]\(([\w-]+)\.md[)#]/gi)) order.push(m[1].toLowerCase())
  const rank = (slug) => { const i = order.indexOf(slug); return i < 0 ? order.length : i }
  pages.sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title))
  return { pages, bySlug }
}

const STOP = new Set('a an the i im my me we our to of in on at for is are was do does did how what why when where which who can cant could should would it its this that these and or with from be will by as if'.split(' '))
const fold = (s) => s.toLowerCase().replace(/['’]/g, '')
// ponytail: suffix-stripping stem (posted -> post, claims -> claim), swap for a real stemmer if recall suffers
const stem = (t) => t.length > 5 && t.endsWith('ing') ? t.slice(0, -3)
  : t.length > 4 && t.endsWith('ed') ? t.slice(0, -2)
    : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t

/** Query to search terms: case and apostrophes folded, question words dropped, light stemming. */
export function searchTerms(query) {
  const words = fold(String(query || '')).split(/[^\w-]+/).filter(Boolean)
  const kept = words.filter((w) => !STOP.has(w))
  return [...new Set((kept.length ? kept : words).map(stem))]
}

/**
 * Ranked section matches. Every term must appear in the section heading, its text or
 * its page title; heading hits outrank body hits and FAQ questions get a lift. When no
 * section has every term, the sections matching the most terms come back as `partial`.
 */
export function searchWiki(pages, query, limit = 30) {
  const terms = searchTerms(query)
  if (!terms.length) return { total: 0, items: [], partial: false }
  const hits = []
  for (const p of pages) {
    const title = fold(p.title)
    for (const s of p.sections) {
      const head = fold(s.heading)
      const text = fold(s.text)
      let score = 0
      let matched = 0
      for (const t of terms) {
        const inHead = head.includes(t)
        const n = text.split(t).length - 1
        if (inHead || n || title.includes(t)) matched++
        score += (inHead ? 10 : 0) + Math.min(n, 5) + (title.includes(t) ? 2 : 0)
      }
      if (!matched) continue
      if (p.slug === 'faq' && s.level === 3) score += 5
      const first = Math.min(...terms.map((t) => { const k = text.indexOf(t); return k < 0 ? Infinity : k }))
      const at = isFinite(first) ? Math.max(0, first - 60) : 0
      const snippet = `${at > 0 ? '…' : ''}${s.text.slice(at, at + 180).trim()}${at + 180 < s.text.length ? '…' : ''}`
      hits.push({ page: p.slug, title: p.slug === 'readme' ? 'Wiki home' : p.title, anchor: s.anchor, heading: s.heading, snippet, score, matched })
    }
  }
  const full = hits.filter((h) => h.matched === terms.length)
  const best = Math.max(0, ...hits.map((h) => h.matched))
  const pool = full.length ? full : hits.filter((h) => h.matched === best)
  pool.sort((a, b) => b.score - a.score)
  return { total: pool.length, items: pool.slice(0, limit), partial: !full.length && pool.length > 0 }
}
