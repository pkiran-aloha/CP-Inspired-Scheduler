// ---- Payroll outputs: register, provider export, GL journal, bank file, stubs ----
//
// Everything here is a *file builder*. Nothing transmits: the practice downloads
// an artifact and hands it to its payroll provider or bank. The generated-shaped
// files (CSV/IIF-style summary, NACHA-shaped ACH) are deliberately labelled as
// local drafts so nobody mistakes them for an accepted submission.

import { EARNING_BY_ID, RUN_STATUS_LABEL, PAY_FREQUENCIES, timesheet } from './payroll'

const money2 = (cents) => (cents / 100).toFixed(2)
const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n')
const hours2 = (h) => (Number(h) || 0).toFixed(2)

// ---------------------------------------------------------------------------
// Payroll register — the control document for a pay run
// ---------------------------------------------------------------------------
/** One row per employee per earning code, then the gross→net columns. */
export function registerRows(run, state) {
  const org = state.settings?.org?.name || 'Aloha ABA'
  const head = [
    'Pay run', 'Period start', 'Period end', 'Pay date', 'Status',
    'Employee', 'Payroll ID', 'Office', 'Classification', 'Pay type',
    'Earning code', 'Earning description', 'Hours', 'Rate', 'Amount',
    'Gross', 'Pre-tax', 'Employee taxes', 'Post-tax', 'Net pay', 'Employer cost',
  ]
  const rows = [head]
  for (const line of run.lines || []) {
    const earnings = (line.earnings || []).length ? line.earnings : [{ code: 'REG', label: 'Regular', hours: 0, rate: 0, cents: line.grossCents }]
    earnings.forEach((e, i) => {
      const first = i === 0
      rows.push([
        run.no, run.periodStart, run.periodEnd, run.payDate, RUN_STATUS_LABEL[run.status] || run.status,
        line.name, line.payrollId || '', line.office || '', line.classification || '', line.payType || '',
        e.code, EARNING_BY_ID[e.code]?.label || e.label || '', hours2(e.hours), e.rate ? e.rate.toFixed(2) : (e.perSession ? line.profile?.sessionRate?.toFixed?.(2) || '' : ''),
        money2(e.cents),
        first ? money2(line.grossCents) : '', first ? money2(line.preTaxCents) : '', first ? money2(line.taxCents) : '',
        first ? money2(line.postTaxCents) : '', first ? money2(line.netCents) : '', first ? money2(line.employerCents) : '',
      ])
    })
  }
  const t = run.totals || {}
  rows.push(['TOTAL', '', '', '', '', `${t.staff || 0} employees`, '', '', '', '', '', '', hours2(t.workedHours), '', '',
    money2(t.grossCents || 0), money2(t.preTaxCents || 0), money2(t.taxCents || 0), money2(t.postTaxCents || 0), money2(t.netCents || 0), money2(t.employerCents || 0)])
  rows.push([])
  rows.push([`Generated locally by ${org}. Estimated withholding — verify against your payroll provider before paying.`])
  return rows
}

export const registerCsv = (run, state) => toCsv(registerRows(run, state))

/** exportKit spec so the payroll register can reuse the platform's XLS/PDF kit. */
export function registerSpec(run, state) {
  const cols = [
    { k: 'employee', label: 'Employee', t: 'text' },
    { k: 'payrollId', label: 'Payroll ID', t: 'text' },
    { k: 'office', label: 'Office', t: 'text' },
    { k: 'gross', label: 'Gross', t: 'money', align: 'r' },
    { k: 'preTax', label: 'Pre-tax', t: 'money', align: 'r' },
    { k: 'tax', label: 'Taxes', t: 'money', align: 'r' },
    { k: 'postTax', label: 'Post-tax', t: 'money', align: 'r' },
    { k: 'net', label: 'Net pay', t: 'money', align: 'r' },
    { k: 'employer', label: 'Employer cost', t: 'money', align: 'r' },
    { k: 'hours', label: 'Hours', t: 'num', align: 'r' },
    { k: 'ot', label: 'OT hrs', t: 'num', align: 'r' },
  ]
  const rows = (run.lines || []).map((l) => ({
    employee: l.name, payrollId: l.payrollId || '—', office: l.office || '—',
    gross: l.grossCents / 100, preTax: l.preTaxCents / 100, tax: l.taxCents / 100,
    postTax: l.postTaxCents / 100, net: l.netCents / 100, employer: l.employerCents / 100,
    hours: Math.round(l.workedHours * 100) / 100, ot: Math.round(l.otHours * 100) / 100,
  }))
  const t = run.totals || {}
  return {
    title: `Payroll register ${run.no}`,
    blurb: `Pay period ${run.periodStart} → ${run.periodEnd} · pay date ${run.payDate}`,
    org: state.settings?.org?.name || 'Aloha ABA',
    range: `${run.periodStart} → ${run.periodEnd}`,
    scope: `${t.staff || 0} employees · ${RUN_STATUS_LABEL[run.status] || run.status}`,
    generated: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    cols, rows,
    totals: {
      gross: (t.grossCents || 0) / 100, preTax: (t.preTaxCents || 0) / 100, tax: (t.taxCents || 0) / 100,
      postTax: (t.postTaxCents || 0) / 100, net: (t.netCents || 0) / 100, employer: (t.employerCents || 0) / 100,
      hours: t.workedHours || 0, ot: t.otHours || 0,
    },
    note: 'Withholding figures are local estimates from editable demo tables. Verify before paying.',
  }
}

// ---------------------------------------------------------------------------
// Provider export (QuickBooks Payroll-shaped)
// ---------------------------------------------------------------------------
/**
 * QuickBooks-oriented earnings/deduction import: one row per employee per wage
 * item, keyed by the Payroll ID the practice maintains in Payroll ID Mapping.
 * Accounts come from the payroll GL mapping so the import lands in the right
 * expense lines.
 */
export function qboRows(run, state) {
  const payroll = state.settings?.payroll || {}
  const accounts = payroll.glAccounts || {}
  const rows = [[
    'Payroll ID', 'Employee', 'Pay period start', 'Pay period end', 'Pay date', 'Pay type', 'Item type',
    'Item name', 'Payroll item', 'Hours', 'Rate', 'Amount', 'Account', 'Memo',
  ]]
  for (const l of run.lines || []) {
    for (const e of l.earnings || []) {
      const code = EARNING_BY_ID[e.code]
      rows.push([
        l.payrollId || '', l.name, run.periodStart, run.periodEnd, run.payDate, l.payType || 'hourly',
        e.perSession ? 'Session rate' : 'Earning', code?.short || e.code, code?.label || e.label,
        e.hours ? hours2(e.hours) : '', e.rate ? Number(e.rate).toFixed(2) : '',
        money2(e.cents), accounts.wages || '', e.week ? `OT week ${e.week}` : '',
      ])
    }
    for (const t of l.taxRows || []) {
      rows.push([l.payrollId || '', l.name, run.periodStart, run.periodEnd, run.payDate, l.payType || 'hourly', 'Tax', t.code, t.label, '', '', money2(t.cents), accounts.taxes || '', ''])
    }
  }
  rows.push([])
  rows.push([`Local draft export — no QuickBooks connection. Map these items once in Payroll ID Mapping; ${(run.lines || []).length} employees, ${run.no}.`])
  return rows
}
export const qboCsv = (run, state) => toCsv(qboRows(run, state))

/** Deduction-level export (benefit carriers / garnishment desks). */
export function deductionRows(run) {
  const rows = [['Pay run', 'Pay date', 'Employee', 'Payroll ID', 'Deduction', 'Treatment', 'Amount']]
  for (const l of run.lines || []) {
    for (const d of [...(l.preTax || []), ...(l.postTax || [])]) {
      rows.push([run.no, run.payDate, l.name, l.payrollId || '', d.label, d.kind === 'pretax' ? 'Pre-tax' : 'Post-tax', money2(d.cents)])
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// General-ledger journal (accounting handoff)
// ---------------------------------------------------------------------------
export function glJournalRows(run, state) {
  const accounts = state.settings?.payroll?.glAccounts || {}
  const t = run.totals || {}
  const rows = [['Date', 'Journal no', 'Account', 'Memo', 'Debit', 'Credit']]
  const date = run.payDate
  const jno = `JE-${run.no}`
  // Debit: what the practice spent. Credit: who the money is owed to or held for.
  // It must balance to the cent — an unbalanced payroll journal is how a ledger
  // quietly stops tying out.
  rows.push([date, jno, accounts.wages || '6100 Payroll — clinical wages', `Gross wages ${run.periodStart} → ${run.periodEnd}`, money2(t.grossCents || 0), ''])
  rows.push([date, jno, accounts.taxes || '6150 Payroll taxes', 'Employer payroll taxes (FICA, FUTA, SUTA, WC)', money2(t.employerCents || 0), ''])
  if (t.reimbursementCents) rows.push([date, jno, '6170 Reimbursements', 'Mileage / expense reimbursements paid with payroll', money2(t.reimbursementCents), ''])
  rows.push([date, jno, accounts.net || '2100 Payroll clearing', 'Net pay to be disbursed', '', money2(t.netCents || 0)])
  rows.push([date, jno, '2200 Payroll liabilities', 'Employee taxes withheld (payable)', '', money2(t.taxCents || 0)])
  const deductions = (t.preTaxCents || 0) + (t.postTaxCents || 0)
  if (deductions) rows.push([date, jno, '2210 Deductions payable', 'Benefit & voluntary deductions', '', money2(deductions)])
  if (t.employerCents) rows.push([date, jno, '2220 Employer taxes payable', 'Employer payroll taxes (payable)', '', money2(t.employerCents)])
  return rows
}

// ---------------------------------------------------------------------------
// Direct deposit file (NACHA-shaped local draft)
// ---------------------------------------------------------------------------
/**
 * A NACHA-shaped ACH credit file for direct deposit. This is a *draft*: it has
 * not been through a bank's validation, the routing/account values behind it are
 * demo data, and a real file needs the practice's own originating bank details,
 * company ID and a live balance check. It exists so the workflow is complete and
 * auditable, not so it can be uploaded to a bank as-is.
 */
export function achFile(run, state) {
  const org = state.settings?.org || {}
  const a = state.settings?.payroll?.ach || {}
  const now = new Date()
  const yymmdd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const hhmm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const lines = []
  const companyName = (a.companyName || org.name || 'ALOHA ABA').slice(0, 16).toUpperCase()
  const companyId = (a.companyId || '1999999999').slice(0, 10)
  const origin = (a.originatingBank || '1234567890').slice(0, 10)
  const destName = (a.destinationBank || 'DEMO BANK').slice(0, 23).toUpperCase()
  const total = (run.lines || []).reduce((sum, l) => sum + l.netCents, 0)
  lines.push(`101 ${origin} ${yymmdd}${hhmm} A094101${destName.padEnd(23, ' ')}${companyName.padEnd(16, ' ')}LOCAL DRAFT`.padEnd(94, ' '))
  lines.push(`5200 ${companyName.padEnd(16, ' ')}${companyId.padEnd(10, ' ')}PPD${run.periodStart.replace(/-/g, '').slice(2)} ${run.periodStart.replace(/-/g, '').slice(2)}   1${origin.slice(0, 8)}0000001`.padEnd(94, ' '))
  let seq = 0
  for (const l of run.lines || []) {
    seq += 1
    const acct = String(l.bankAccount || '0000000000').replace(/\D/g, '').padStart(10, '0').slice(0, 17)
    const routing = String(l.bankRouting || '123456789').replace(/\D/g, '').padStart(9, '0').slice(0, 9)
    const name = String(l.name || l.staffId).slice(0, 22).padEnd(22, ' ')
    // 6 = entry detail record, 22 = checking credit, then RDFI / account / amount / name
    lines.push((`622${routing}${acct.padStart(17, ' ')}${String(Math.round(l.netCents)).padStart(10, '0')}${(l.staffId || '').slice(0, 15).padEnd(15, ' ')}${name}  0${String(seq).padStart(6, '0')}`).padEnd(94, ' '))
  }
  const hash = run.lines.reduce((s, l) => s + String(l.bankRouting || '123456789').slice(0, 8), '')
  lines.push((`8${String(seq).padStart(6, '0')}${String(Math.round(total / 100)).padStart(12, '0')}${String(Math.round(total)).padStart(12, '0')}${'0000000000'.padStart(10, '0')}${String(hash).slice(0, 10).padEnd(10, '0')}`).padEnd(94, ' '))
  lines.push((`9${String(seq + 2).padStart(6, '0')}${'0000000000'}${String(seq + 2).padStart(6, '0')}`).padEnd(94, ' '))
  return lines.join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Pay stub (printable)
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtMoney = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function stubHtml(stub) {
  if (!stub) return '<p>No stub available.</p>'
  const { run, line, staff, profile, org, period, net } = stub
  const row = (label, value, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="r">${esc(value)}</td></tr>`
  const earnings = net.rows.map((r) => row(`${EARNING_BY_ID[r.code]?.label || r.label}${r.hours ? ` — ${hours2(r.hours)} h${r.rate ? ` @ ${Number(r.rate).toFixed(2)}` : ''}` : ''}${r.basis ? ` (${r.basis})` : ''}`, fmtMoney(r.cents))).join('')
  const pretax = net.preTax.map((d) => row(d.label, `- ${fmtMoney(d.cents)}`)).join('')
  const taxes = net.taxRows.map((t) => row(t.label, `- ${fmtMoney(t.cents)}`)).join('')
  const posttax = net.postTax.map((d) => row(d.label, `- ${fmtMoney(d.cents)}`)).join('')
  const employer = net.employer.map((e) => row(e.label, fmtMoney(e.cents))).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pay stub ${esc(staff.name)} ${esc(run.periodStart)}</title>
<style>
 body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2436;margin:32px}
 h1{font-size:17px;margin:0 0 2px} h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6e768a;margin:18px 0 6px}
 .head{display:flex;justify-content:space-between;border-bottom:2px solid #4f46e5;padding-bottom:10px}
 .meta{color:#6e768a;font-size:12px}
 table{width:100%;border-collapse:collapse;margin-bottom:4px}
 td{padding:4px 0;border-bottom:1px solid #eceffa} td.r{text-align:right;font-variant-numeric:tabular-nums}
 tr.net td{font-weight:800;border-top:2px solid #4f46e5;border-bottom:none;padding-top:8px}
 tr.tot td{font-weight:700;background:#f6f7fc}
 .grid{display:flex;gap:28px}.grid>div{flex:1}
 .note{margin-top:22px;padding:10px 12px;background:#f6f7fc;border:1px solid #dfe3f5;border-radius:6px;font-size:11.5px;color:#4a5169}
 @media print{body{margin:12mm}}
</style></head><body>
<div class="head">
  <div><h1>${esc(org.name || 'Aloha ABA')}</h1><div class="meta">${esc(org.address || '')}</div><div class="meta">EIN ${esc(org.taxId || '—')}</div></div>
  <div class="meta" style="text-align:right">
    <div><b>Pay stub (draft)</b></div>
    <div>Run ${esc(run.no)} · ${esc(RUN_STATUS_LABEL[run.status] || run.status)}</div>
    <div>Period ${esc(period.start)} → ${esc(period.end)}</div>
    <div>Pay date ${esc(period.payDate)}</div>
  </div>
</div>
<div class="grid" style="margin-top:12px">
  <div><h2>Employee</h2>
    <table><tbody>
      ${row('Name', staff.name || '')}
      ${row('Role', staff.role || '')}
      ${row('Payroll ID', line.payrollId || '—')}
      ${row('Office', line.office || '—')}
      ${row('Classification', profile.classification || '—')}
      ${row('Pay type', profile.payType || '—')}
      ${row('Pay period', `${period.start} → ${period.end}`)}
    </tbody></table>
  </div>
  <div><h2>This period</h2>
    <table><tbody>
      ${row('Hours worked', hours2(net.workedHours))}
      ${row('Overtime hours', hours2(net.otHours))}
      ${row('Delivered clinical hours', hours2(net.deliveredHours))}
      ${row('Gross pay', fmtMoney(net.grossCents), 'tot')}
      ${row('Employee taxes', fmtMoney(net.taxCents))}
      ${row('Deductions', fmtMoney(net.preTaxCents + net.postTaxCents))}
      ${row('Net pay', fmtMoney(net.netCents), 'net')}
    </tbody></table>
  </div>
</div>
<h2>Earnings</h2><table><tbody>${earnings || row('Regular', fmtMoney(net.grossCents))}</tbody></table>
${pretax ? `<h2>Pre-tax deductions</h2><table><tbody>${pretax}</tbody></table>` : ''}
<h2>Taxes withheld (estimated)</h2><table><tbody>${taxes}</tbody></table>
${posttax ? `<h2>Post-tax deductions</h2><table><tbody>${posttax}</tbody></table>` : ''}
${net.reimbursementCents ? `<h2>Reimbursements (non-taxable)</h2><table><tbody>${row('Reimbursements paid with this cheque', fmtMoney(net.reimbursementCents))}</tbody></table>` : ''}
<h2>Year to date</h2><table><tbody>
  ${row('Gross', fmtMoney((net.ytd?.grossCents || 0) + net.grossCents))}
  ${row('Taxes withheld', fmtMoney((net.ytd?.federalTax || 0) + net.taxCents))}
  ${row('Net paid', fmtMoney((net.ytd?.netCents || 0) + net.netCents))}
</tbody></table>
<h2>Employer-paid (not deducted from your pay)</h2><table><tbody>${employer}</tbody></table>
<div class="note">
  Payroll tax and withholding figures in this workspace are <b>estimates</b> produced from editable demo tables.
  They are not a filed tax return, not a W-2, and not legal or tax advice. Verify every figure with your payroll
  provider or accountant before paying staff. Employer-cost lines are shown for budget review only.
</div>
</body></html>`
}

// ---------------------------------------------------------------------------
// Timesheet print sheet
// ---------------------------------------------------------------------------
export function timesheetHtml(state, staffId, period) {
  const t = timesheet(state, staffId, period.id)
  const staff = (state.staff || []).find((s) => s.id === staffId) || {}
  const profile = (state.payProfiles || []).find((p) => p.staffId === staffId) || {}
  const org = state.settings?.org || {}
  const rows = t.lines.map((l) => `<tr>
    <td>${esc(l.date)}</td><td>${esc(EARNING_BY_ID[l.code]?.short || l.code)}</td>
    <td class="r">${hours2(l.hours)}</td><td class="r">${l.rate ? `$${Number(l.rate).toFixed(2)}` : '—'}</td>
    <td class="r">$${((l.amount != null ? l.amount : Math.round(l.hours * l.rate * 100)) / 100).toFixed(2)}</td>
    <td>${esc(l.source === 'adjustment' ? `manual — ${l.note || ''}` : (l.note || l.meta?.evv || ''))}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Timesheet ${esc(staff.name || staffId)} ${esc(period.start)}</title>
<style>body{font:12.5px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2436;margin:30px}
h1{font-size:16px;margin:0 0 2px}.meta{color:#6e768a;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:14px}th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#6e768a;border-bottom:1px solid #d8dcec;padding:6px 4px}
td{padding:5px 4px;border-bottom:1px solid #eceffa}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
tfoot td{font-weight:800;border-top:2px solid #4f46e5;border-bottom:none}
.note{margin-top:18px;font-size:11px;color:#6e768a}
.sig{display:flex;gap:40px;margin-top:34px}.sig div{flex:1;border-top:1px solid #1f2436;padding-top:5px;font-size:11px;color:#6e768a}
@media print{body{margin:12mm}}</style></head><body>
<h1>${esc(org.name || 'Aloha ABA')} — timesheet</h1>
<div class="meta">${esc(staff.name || staffId)}${staff.role ? ` · ${esc(staff.role)}` : ''} · Payroll ID ${esc(profile.payrollId || '—')}${profile.office ? ` · ${esc(profile.office)}` : ''}</div>
<div class="meta">Period ${esc(period.start)} → ${esc(period.end)} · pay date ${esc(period.payDate)} · status ${esc(t.sheet.status)}</div>
<table><thead><tr><th>Date</th><th>Code</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Amount</th><th>Source / note</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">No payable time in this period.</td></tr>'}</tbody>
<tfoot><tr><td colspan="2">Total</td><td class="r">${hours2(t.totals.hours)}</td><td></td><td class="r">$${(t.totals.straightCents / 100).toFixed(2)}</td><td></td></tr></tfoot></table>
<div class="note">Excludes any overtime premium, which is derived at run time from actual hours worked per FLSA workweek.</div>
<div class="sig"><div>Employee signature</div><div>Supervisor approval</div><div>Date</div></div>
</body></html>`
}

export function periodLabel(payroll, period) {
  const freq = PAY_FREQUENCIES[period?.frequency] || PAY_FREQUENCIES[payroll?.frequency] || PAY_FREQUENCIES.biweekly
  return `${freq.label} · ${period?.start} → ${period?.end}`
}

// ---------------------------------------------------------------------------
// Generic CSV download helper (kept local so payroll does not depend on UI code)
// ---------------------------------------------------------------------------
export const payrollCsv = (rows) => toCsv(rows)
