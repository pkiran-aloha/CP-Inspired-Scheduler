import { describe, it, expect } from 'vitest'
import { buildSpec, specToPdf } from '../lib/exportKit'

const long = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'
const spec = buildSpec({
  org: { name: 'Aloha ABA Therapy Partners' },
  def: { name: 'Service delivery ledger with a genuinely long report title for wrapping' },
  columns: [{ k: 'note', label: 'Session note / remarks' }, { k: 'amt', label: 'Charge $', t: 'money', align: 'r' }],
  rows: Array.from({ length: 160 }, (_, i) => ({ note: `${long} row-${i}`, amt: i })),
  totals: { amt: 12720 },
  days: ['2026-09-01', '2026-09-02'],
  scopeLabel: 'All records',
  note: 'Note sentence that goes on and on and must appear in full. '.repeat(6) + 'THE-END-SENTINEL',
})

describe('chunk-36 PDF export', () => {
  const doc = specToPdf(spec)
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1')
  it('does not truncate — first, middle and last row tails all present', () => {
    for (const tail of ['row-0', 'row-79', 'row-159']) expect(raw.includes(tail)).toBe(true)
  })
  it('wraps instead of ellipsising — no trailing … anywhere', () => {
    expect(raw.includes('\u2026')).toBe(false)
  })
  it('keeps the full note text, sentinel and all', () => {
    expect(raw.includes('THE-END-SENTINEL')).toBe(true)
  })
  it('paginates by measured height and numbers the pages', () => {
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
    expect(raw.includes('Page 1 of')).toBe(true)
  })
  it('totals survive on the final page', () => {
    expect(raw.includes('$12,720.00')).toBe(true)
  })
})
