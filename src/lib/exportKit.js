// ---- Report export kit: one table spec → Excel / PDF / CSV documents ----
// Both document formats are generated from the same { title, cols, rows, totals }
// spec the UI renders, so an export always matches what the scheduler sees —
// branded header band, zebra rows, right-aligned money, a totals footer, and an
// honest "generated / range / scope" stamp. Excel ships as an HTML-table .xls
// with mso number formats (opens natively in Excel / Sheets / LibreOffice with
// colors and alignment preserved); PDF is vector jsPDF, letter landscape.
import { jsPDF } from 'jspdf'

const ACCENT = [79, 70, 229] // brand indigo — header band + rules
const INK = [31, 36, 54]
const MUTED = [110, 118, 138]
const ROW_ALT = [246, 247, 252]
const HEAD_BG = [236, 239, 248]
const TOT_BG = [232, 235, 250]

export const fmtVal = (v, t) => {
  if (v == null || v === '') return '—'
  if (typeof v !== 'number') return String(v)
  if (t === 'money') return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (t === 'pct') return `${v}%`
  if (t === 'hrs') return `${v}h`
  return v.toLocaleString('en-US')
}

export function buildSpec({ org, def, columns, rows, totals, days, scopeLabel, note }) {
  return {
    title: def?.name || 'Report',
    blurb: def?.blurb || '',
    org: org?.name || 'Aloha ABA',
    range: days ? `${days[0]} → ${days[days.length - 1]} (${days.length} days)` : '',
    scope: scopeLabel || 'All records',
    generated: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    cols: columns,
    rows,
    totals: totals || {},
    note: note || '',
  }
}

// jsPDF's standard fonts are WinAnsi: Latin-1 plus a few typographic marks. A single
// character outside that set (an arrow, a minus sign, an emoji) makes jsPDF write the
// whole string as UTF-16, which prints as spaced-out gibberish. Map the common ones
// to ASCII and drop the rest.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
export const pdfSafe = (v) => String(v ?? '')
  .replace(/[→➜➡]/g, '->').replace(/←/g, '<-').replace(/↔/g, '<->')
  .replace(/−/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[   ]/g, ' ')
  .replace(/[^\u0000-ÿ]/g, (c) => (WIN_ANSI_EXTRA.includes(c) ? c : ''))
/** Route every string a jsPDF document draws or measures through pdfSafe. */
export function winAnsi(doc) {
  const fix = (s) => (Array.isArray(s) ? s.map(pdfSafe) : typeof s === 'string' ? pdfSafe(s) : s)
  const { text, splitTextToSize, getTextWidth } = doc
  doc.text = function (s, ...rest) { return text.call(this, fix(s), ...rest) }
  doc.splitTextToSize = function (s, ...rest) { return splitTextToSize.call(this, fix(s), ...rest) }
  doc.getTextWidth = function (s) { return getTextWidth.call(this, fix(s)) }
  return doc
}

const escH = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------- Excel (.xls — styled HTML workbook) ----------
export function specToXls(spec) {
  const n = spec.cols.length
  const numFmt = (c) => {
    if (c.t === 'money') return `mso-number-format:"\\$\\#\\,\\#\\#0\\.00";`
    if (c.t === 'pct') return `mso-number-format:"0\\.0\\"%\\"";`
    if (c.t === 'hrs' || c.t === 'num') return `mso-number-format:"\\#\\,\\#\\#0\\.0";`
    return ''
  }
  const head = spec.cols.map((c) => `<th class="${c.align === 'r' ? 'n' : ''}">${escH(c.label)}</th>`).join('')
  const body = spec.rows
    .map(
      (r, ri) =>
        `<tr${ri % 2 ? ' class="z"' : ''}>` +
        spec.cols
          .map((c) => {
            const raw = r[c.k]
            const num = typeof raw === 'number'
            return `<td class="${c.align === 'r' ? 'n' : ''}" style="${num ? numFmt(c) : ''}">${num ? raw : escH(raw == null || raw === '' ? '—' : raw)}</td>`
          })
          .join('') +
        `</tr>`
    )
    .join('')
  const hasTot = Object.keys(spec.totals).length > 0
  const totRow = hasTot
    ? `<tfoot><tr>${spec.cols
        .map((c, ci) => `<td class="tot ${c.align === 'r' ? 'n' : ''}">${ci === 0 ? 'TOTAL' : spec.totals[c.k] != null ? fmtVal(Math.round(spec.totals[c.k] * 100) / 100, c.t) : ''}</td>`)
        .join('')}</tr></tfoot>`
    : ''
  const widths = spec.cols.map((c) => {
    const sample = spec.rows.slice(0, 25).reduce((m, r) => Math.max(m, String(r[c.k] ?? '').length), 0)
    return Math.min(46, Math.max(10, c.label.length, Math.min(sample, 38)))
  })
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${escH(spec.title.slice(0, 28))}</x:Name><x:WorksheetOptions><x:FreezePanes/><x:SplitHorizontal>4</x:SplitHorizontal><x:TopRowBottomPane>4</x:TopRowBottomPane></x:WorksheetOptions><x:Columns>${widths.map((w, i) => `<Column ss:Index="${i + 1}" ss:Width="${(w * 7.2).toFixed(1)}"/>`).join('')}</x:Columns></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  table { border-collapse: collapse; font: 10.5pt Calibri, 'Segoe UI', sans-serif; mso-displayed-decimal-separator: "."; }
  td, th { border: 1px solid #dde1ee; padding: 5px 9px; color: #1f2436; vertical-align: top; }
  th { background: #4f46e5; color: #ffffff; font-weight: 700; text-align: left; border-color: #4338ca; }
  th.n { text-align: right; }
  td.n, .n { text-align: right; font-variant-numeric: tabular-nums; }
  tr.z td { background: #f6f7fc; }
  td.title { border: 0; font: 16pt Calibri; font-weight: 700; color: #1f2436; padding: 2px 0 0; }
  td.sub { border: 0; font: 9.5pt Calibri; color: #5a6378; padding: 1px 0 8px; }
  td.tot { background: #e8ebfa; font-weight: 700; border-top: 2px solid #4f46e5; }
  td.note { border: 0; font: 9pt Calibri; color: #8a93a8; padding-top: 8px; }
</style></head>
<body><table>
  <tr><td class="title" colspan="${n}">${escH(spec.org)} · ${escH(spec.title)}</td></tr>
  <tr><td class="sub" colspan="${n}">${escH(spec.range)} &nbsp;·&nbsp; Scope: ${escH(spec.scope)} &nbsp;·&nbsp; ${spec.rows.length} rows &nbsp;·&nbsp; Generated ${escH(spec.generated)} &nbsp;·&nbsp; Aloha ABA PMS</td></tr>
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>${totRow}
  ${spec.note ? `<tr><td class="note" colspan="${n}">${escH(spec.note)}</td></tr>` : ''}
</table>
</body></html>`
}

// ---------- PDF (jsPDF, letter landscape, wrapping FULL-TEXT cells) ----------
// Nothing is clipped or ellipsised: columns are sized from the FULL content of the
// report, every cell word-wraps inside its column, rows grow to fit and the table
// paginates by measured row heights with a repeating header. What the screen shows
// in full, the PDF contains in full — printable and signable as-is.
export function specToPdf(spec) {
  const doc = winAnsi(new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape', compress: false }))
  const PW = 792
  const M = 30
  const CW = PW - M * 2
  const LINE = 8.9 // one 7.4pt line
  const BOTTOM = 596 // table floor (leaves room for the footer rule at 612)
  const cellText = (r, c) => fmtVal(r[c.k], c.t)
  const T = (v) => { const t = pdfSafe(typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v); return t === '' ? '\u002d' : t }
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
    const span = `rows ${pg.rows.length ? pg.rows[0].ri + 1 : 1}\u2013${pg.rows.length ? pg.rows[pg.rows.length - 1].ri + 1 : 0}`
    const cont = pages.length > 1 ? `  (${pi > 0 ? `continued \u2014 ${span}` : span})` : ''
    doc.text(wrap(T(`${spec.title}${cont}`), CW - 200, 13), M, 26)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6)
    doc.text(wrap(T(`${spec.range}  \u00b7  Scope: ${spec.scope}  \u00b7  ${spec.rows.length} rows`), CW - 200, 7.6), M, 40)
    doc.text(T(`Generated ${spec.generated} \u00b7 derived from the live PMS ledger`), M, 51)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text(T(spec.org), PW - M, 26, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8)
    doc.text('Aloha ABA \u00b7 Practice Management Suite', PW - M, 38, { align: 'right' })
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
    doc.text(T(`${spec.org} \u00b7 ${spec.title} \u00b7 ${spec.range}`), M, 624)
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

// ---------- download (works for text, Blob and jsPDF document payloads) ----------
// A jsPDF document passed as-is used to be stringified into a 15-byte
// "[object Object]" file (the payroll register / summary PDFs); render it here.
export function toBlob(data, mime) {
  if (data instanceof Blob) return data
  if (typeof data?.output === 'function') return data.output('blob')
  return new Blob([data], { type: `${mime};charset=utf-8` })
}
export function downloadDoc(filename, data, mime) {
  const blob = toBlob(data, mime)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
