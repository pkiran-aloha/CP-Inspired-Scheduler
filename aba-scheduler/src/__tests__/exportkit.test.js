// ---- export kit: slot grouping math + Excel/PDF document builders ----
import { describe, it, expect } from 'vitest'
import { slotBlocks } from '../state/store'
import { buildSpec, specToXls, specToPdf, fmtVal } from '../lib/exportKit'

const at = (h, m = 0) => h * 60 + m

describe('slotBlocks (30-min grouping rhythm)', () => {
  it('slices a chained cluster on :00/:30 boundaries', () => {
    const anchor = { id: 'a', start: at(8, 10), end: at(12) }
    const b = { id: 'b', start: at(8, 30), end: at(9, 30) }
    const c = { id: 'c', start: at(10), end: at(10, 30) }
    const out = slotBlocks([anchor, b, c])
    expect(out.length).toBe(3) // starts fall in three different half-hour slots
    expect(out[0]).toMatchObject({ start: at(8, 10), end: at(8, 30) }) // first top = first real event
    expect(out[1]).toMatchObject({ start: at(8, 30), end: at(10) }) // snapped window boundaries
    expect(out[2]).toMatchObject({ start: at(10), end: at(12) }) // last runs to cluster end
  })
  it('groups starts inside the same 30-min slot into one block', () => {
    const a = { id: 'a', start: at(9), end: at(9, 20) }
    const b = { id: 'b', start: at(9, 20), end: at(10) }
    const long = { id: 'l', start: at(8), end: at(11) }
    const out = slotBlocks([long, a, b])
    const nine = out.find((x) => x.start === at(9))
    expect(nine.items.map((i) => i.id)).toEqual(['a', 'b']) // same bucket → one card
    expect(out.every((x) => (x.end - x.start) % 30 === 0 || x.end === at(11))).toBe(true)
  })
  it('passes isolated events through untouched', () => {
    const solo = [{ id: 'x', start: at(13, 5), end: at(14) }]
    const out = slotBlocks(solo)
    expect(out).toEqual([{ start: at(13, 5), end: at(14), items: solo }])
  })
})

describe('exportKit document builders', () => {
  const spec = buildSpec({
    org: { name: 'Aloha ABA Center' },
    def: { name: 'Attendance & Session Ledger', blurb: 'master ledger' },
    columns: [
      { k: 'client', label: 'Client', t: 'text' },
      { k: 'charge', label: 'Charge', t: 'money', align: 'r' },
    ],
    rows: [
      { client: 'Justin Hsu', charge: 128 },
      { client: 'Meg Jones', charge: 478.5 },
    ],
    totals: { charge: 606.5 },
    days: ['2026-09-13', '2026-09-19'],
    scopeLabel: '',
    note: 'Demo note',
  })

  it('formats values per column type', () => {
    expect(fmtVal(128, 'money')).toBe('$128.00')
    expect(fmtVal(42.5, 'pct')).toBe('42.5%')
    expect(fmtVal(null, 'num')).toBe('—')
  })

  it('Excel spec carries branding, zebra rows, money formats and a totals row', () => {
    const xls = specToXls(spec)
    expect(xls).toContain('<table')
    expect(xls).toContain('Aloha ABA Center · Attendance &amp; Session Ledger') // HTML-escaped
    expect(xls).toContain('<th class="">Client</th>')
    expect(xls).toContain('mso-number-format') // currency number format on the money cell
    expect(xls).toContain('class="z"') // zebra shading on the second row
    expect(xls).toContain('TOTAL')
    expect(xls).toContain('ss:Width') // explicit column widths
    expect(xls).toContain('FreezePanes')
    expect(xls).toContain('478.5') // raw numbers so Excel can compute
  })

  it('PDF spec is a real multi-page letter landscape document', () => {
    const many = { ...spec, rows: Array.from({ length: 80 }, (_, i) => ({ client: `C${i}`, charge: i + 0.5 })) }
    const out = specToPdf(many).output('arraybuffer')
    const head = new TextDecoder('latin1').decode(new Uint8Array(out).slice(0, 5))
    expect(head).toBe('%PDF-')
    const bytes = new TextDecoder('latin1').decode(new Uint8Array(out))
    const count = Math.max(...[...bytes.matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1])), 1)
    expect(count).toBeGreaterThanOrEqual(2) // 80 rows → continued pages with repeated table head
    expect(out.byteLength).toBeGreaterThan(4000) // real vector content, compressed
  })
})
