import pathlib

# ============ A) exportKit: FULL-TEXT wrapped PDF (no clips, no ellipsis) ============
p = pathlib.Path('src/lib/exportKit.js'); s = p.read_text()
start = s.index('// ---------- PDF (jsPDF, letter landscape, repeating table head) ----------')
end = s.index('// ---------- download (works for text and Blob payloads) ----------')
newpdf = '''// ---------- PDF (jsPDF, letter landscape, wrapping FULL-TEXT cells) ----------
// Nothing is clipped or ellipsised: columns are sized from the FULL content of the
// report, every cell word-wraps inside its column, rows grow to fit and the table
// paginates by measured row heights with a repeating header. What the screen shows
// in full, the PDF contains in full — printable and signable as-is.
export function specToPdf(spec) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape', compress: true })
  const PW = 792
  const M = 30
  const CW = PW - M * 2
  const LINE = 8.9 // one 7.4pt line
  const BOTTOM = 596 // table floor (leaves room for the footer rule at 612)
  const cellText = (r, c) => fmtVal(r[c.k], c.t)
  // jsPDF standard fonts are WinAnsi: map fancy glyphs to ASCII, then drop the rest
  const safe = (v) => String(v ?? '')
    .replace(/\\u2192|\\u279c/g, '->').replace(/[\\u2212\\u2013\\u2014]/g, '-').replace(/[\\u201c\\u201d]/g, '"').replace(/[\\u2018\\u2019]/g, "'").replace(/\\u00a0/g, ' ')
    .replace(/[^\\u0000-\\u00ff]/g, '')
  const T = (v) => { const t = safe(typeof v === 'string' ? v.replace(/\\s+/g, ' ').trim() : v); return t === '' ? '\\u002d' : t }
  const wrap = (t, w, size) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size)
    const out = doc.splitTextToSize(t, Math.max(12, w))
    return Array.isArray(out) ? out : [t]
  }
  const tw = (t, size) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); return doc.getTextWidth(t) }
  // column widths from the FULL report content (one giant cell capped so it can't starve the rest)
  const sample = spec.rows.length > 400 ? spec.rows.filter((_, i) => i % Math.ceil(spec.rows.length / 400) === 0) : spec.rows
  const weights = spec.cols.map((c) => {
    let max = tw(String(c.label), 7.2) + 12
    for (const r of sample) max = Math.max(max, Math.min(tw(T(cellText(r, c)), 7.4) + 10, 240))
    return Math.max(max, 38)
  })
  const wSum = weights.reduce((a, b) => a + b, 0)
  let W = weights.map((w) => (w / wSum) * CW)
  // floor every column at 38pt of width, skimming the shortfall from the widest columns
  const MINW = 38
  for (let guard = 0; guard < 24; guard++) {
    const deficit = W.reduce((a, w) => a + Math.max(0, MINW - w), 0)
    if (deficit < 0.5) break
    const flex = W.reduce((a, w) => a + Math.max(0, w - MINW), 0)
    if (!flex) break
    W = W.map((w) => (w < MINW ? MINW : w - ((w - MINW) / flex) * deficit))
  }
  const xAt = (() => { let x = M; return W.map((w) => { const at = x; x += w; return at }) })()

  // measure every row once (wrapped lines per cell), then paginate by real height
  const rowsL = spec.rows.map((r, ri) => {
    const lines = spec.cols.map((c, ci) => wrap(T(cellText(r, c)), W[ci] - 9, 7.4))
    return { ri, r, lines, h: Math.max(1, ...lines.map((l) => l.length)) * LINE + 6.5 }
  })
  const headLines = spec.cols.map((c, ci) => wrap(String(c.label), W[ci] - 9, 7.2))
  const headH = Math.max(1, ...headLines.map((l) => l.length)) * 8.4 + 7
  const noteLines = spec.note ? wrap(T(`Note: ${spec.note}`), CW - 200, 6.8) : []
  const y0 = 96 + noteLines.length * 8
  const reserveTotals = Object.keys(spec.totals).length ? 30 : 0
  const avail = BOTTOM - (y0 + headH - 6) - 14 - reserveTotals // vertical room for data rows per page
  const pages = []
  let cur = { rows: [], h: 0 }
  for (const L of rowsL) {
    if (cur.rows.length && cur.h + L.h > avail) { pages.push(cur); cur = { rows: [], h: 0 } }
    cur.rows.push(L)
    cur.h += L.h
  }
  pages.push(cur)

  const furniture = (pi) => {
    doc.setFillColor(...ACCENT); doc.rect(0, 0, PW, 64, 'F')
    doc.setFillColor(255, 255, 255); doc.rect(0, 64, PW, 1.6, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    const pg = pages[pi]
    const cont = pages.length > 1 ? `  (continued \\u2014 rows ${pg.rows.length ? pg.rows[0].ri + 1 : 1}\\u2013${pg.rows.length ? pg.rows[pg.rows.length - 1].ri + 1 : 0})` : ''
    doc.text(wrap(T(`${spec.title}${cont}`), CW - 200, 13), M, 26)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6)
    doc.text(wrap(T(`${spec.range}  \\u00b7  Scope: ${spec.scope}  \\u00b7  ${spec.rows.length} rows`), CW - 200, 7.6), M, 40)
    doc.text(T(`Generated ${spec.generated} \\u00b7 derived from the live PMS ledger`), M, 51)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text(T(spec.org), PW - M, 26, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8)
    doc.text('Aloha ABA \\u00b7 Practice Management Suite', PW - M, 38, { align: 'right' })
    if (pi === 0 && noteLines.length) {
      doc.setTextColor(...MUTED); doc.setFont('helvetica', 'italic'); doc.setFontSize(6.8)
      doc.text(noteLines, M, 78)
      doc.setFont('helvetica', 'normal')
    }
    doc.setFillColor(...HEAD_BG); doc.rect(M, y0 - 13, CW, headH, 'F')
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2)
    headLines.forEach((ln, ci) => {
      const c = spec.cols[ci]
      doc.text(ln, c.align === 'r' ? xAt[ci] + W[ci] - 4.5 : xAt[ci] + 4.5, y0 - 13 + 9.5, c.align === 'r' ? { align: 'right' } : undefined)
    })
    doc.setDrawColor(199, 204, 221); doc.setLineWidth(0.5); doc.line(M, y0 - 13 + headH + 1, M + CW, y0 - 13 + headH + 1)
  }
  const footer = (pi) => {
    doc.setDrawColor(224, 228, 240); doc.line(M, 612, M + CW, 612)
    doc.setFontSize(6.6); doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal')
    doc.text(T(`${spec.org} \\u00b7 ${spec.title} \\u00b7 ${spec.range}`), M, 624)
    doc.text(T(`Page ${pi + 1} of ${pages.length}`), M + CW, 624, { align: 'right' })
  }
  pages.forEach((pg, pi) => {
    if (pi > 0) doc.addPage()
    furniture(pi)
    let y = y0 + headH - 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4)
    pg.rows.forEach(({ r, lines, h, ri }) => {
      if (ri % 2 === 1) { doc.setFillColor(...ROW_ALT); doc.rect(M, y - 2, CW, h, 'F') }
      doc.setTextColor(...INK)
      spec.cols.forEach((c, ci) => {
        doc.text(lines[ci], c.align === 'r' ? xAt[ci] + W[ci] - 4.5 : xAt[ci] + 4.5, y + 5.5, c.align === 'r' ? { align: 'right' } : undefined)
      })
      doc.setDrawColor(234, 237, 246); doc.setLineWidth(0.3); doc.line(M, y + h - 2.5, M + CW, y + h - 2.5)
      y += h
    })
    // totals band on the final page — full text, wrapped
    if (pi === pages.length - 1 && Object.keys(spec.totals).length) {
      y += 3
      let th = 0
      const parts = []
      spec.cols.forEach((c, ci) => {
        const raw = ci === 0 ? 'TOTAL' : spec.totals[c.k] != null ? T(fmtVal(Math.round(spec.totals[c.k] * 100) / 100, c.t)) : null
        if (!raw) return
        const ln = wrap(raw, W[ci] - 9, 7.6)
        th = Math.max(th, ln.length * 9 + 6)
        parts.push({ ci, ln, c })
      })
      doc.setFillColor(...TOT_BG); doc.rect(M, y, CW, th + 4, 'F')
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.9); doc.line(M, y, M + CW, y)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); doc.setTextColor(...INK)
      parts.forEach(({ ci, ln, c }) => doc.text(ln, c.align === 'r' ? xAt[ci] + W[ci] - 4.5 : xAt[ci] + 4.5, y + 11, c.align === 'r' ? { align: 'right' } : undefined))
    }
    footer(pi)
  })
  return doc
}

'''
s = s[:start] + newpdf + s[end:]
p.write_text(s)
print('A) exportKit rewritten OK')

# ============ B) reports.js: exports carry ALL rows (no UI truncation leaking in) ============
p = pathlib.Path('src/lib/reports.js'); s = p.read_text()
old = """      rows.sort((a, b) => b.freeH - a.freeH)
      const top = rows.slice(0, 120)
      return {"""
new = """      rows.sort((a, b) => b.freeH - a.freeH)
      return {"""
assert old in s; s = s.replace(old, new, 1)
old = "        rows: top,"
assert old in s; s = s.replace(old, "        rows,", 1)
old = "        note: top.length < rows.length ? `Showing the 120 largest gaps of ${rows.length}.` : undefined,"
assert old in s; s = s.replace(old, "", 1)
p.write_text(s)
print('B) gap report: full rows exported OK')
