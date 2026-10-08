// Billing document builders (pure). Each returns {fileName, content} (or a list of them)
// and is the one source of truth for the file its screen downloads.

import { dueOf, isPrimaryReceivable, patientResponsibilityOf } from './claims.js'
import { isoDate, todayISO } from './date.js'

// ---------- Draft patient-share statement (Generate Invoice screen) ----------
const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

/** One row per selected client: its primary receivable claims, their charges and the reported patient share. */
export function patientShareRows(state, clientIds = [], { balanceOnly = false } = {}) {
  const clients = state.clients || []
  return clientIds.map((cid) => {
    const claims = Object.values(state.claims || {}).filter((c) => c.clientId === cid && isPrimaryReceivable(c) &&
      (balanceOnly ? patientResponsibilityOf(state, c) > 0 : true))
    return { client: clients.find((c) => c.id === cid), claims,
      total: claims.reduce((s, c) => s + c.charges, 0), due: claims.reduce((s, c) => s + patientResponsibilityOf(state, c), 0) }
  })
}

/** The text file "Download draft statement" saves. Claims are picked by client, not by the range (the range is a label). */
export function buildPatientShareDraft(state, { clientIds = [], balanceOnly = false, from = '', to = '', today = todayISO() } = {}) {
  const rows = patientShareRows(state, clientIds, { balanceOnly })
  const total = rows.reduce((s, r) => s + r.total, 0)
  const due = rows.reduce((s, r) => s + r.due, 0)
  const lines = [
    `Draft patient share — ${state.settings?.org?.name || 'Practice'} — ${today}`,
    `Range ${from} → ${to} — ${balanceOnly ? 'Reported patient balances only' : 'All primary claims'}`,
    'DRAFT: Only explicit payer-reported patient responsibility and self-pay are shown as patient share. Verify COB and coverage before billing. Unassigned payer balances are excluded.',
    '',
    ...rows.flatMap((r) => [
      `Client: ${r.client?.name || r.client?.id} — ${r.claims.length} primary claims — Charges ${money(r.total)} — Reported patient share ${money(r.due)}`,
      ...r.claims.map((c) => `  ${c.no} | ${c.dosFrom} | ${c.payer} | ${money(c.charges)} | Patient receipts ${money(c.patientPaid || 0)} | Practice A/R ${money(Math.max(0, dueOf(c)))} | Remaining reported patient share ${money(patientResponsibilityOf(state, c))} | ${c.status}`),
      '',
    ]),
    `Total charges ${money(total)} — Reported patient share ${money(due)} (verify before sending)`,
  ]
  return { fileName: `Patient-share-draft-${today}.txt`, content: lines.join('\n'), rows, total, due }
}

// ---------- QBO CSV ----------
export function buildQboCsv(state, opts = {}) {
  const {
    officeIds = [],
    payerIds = [],
    clientIds = [],
    from = '2026-01-01',
    to = '2026-12-31',
    invoiceDate = isoDate(new Date()),
    dueDate = isoDate(new Date(Date.now() + 30 * 86400000)),
    invoiceNumberStart = 4127,
  } = opts

  const clients = state.clients || []
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]))

  let claims = Object.values(state.claims || {}).filter((c) => {
    // QBO rows are original service charges, not an allocated COB balance.
    // Do not export a linked filing as a second invoice or misstate its payer.
    if (!isPrimaryReceivable(c) || (c.secondary && state.claims?.[c.secondary]?.status !== 'void') ||
        c.dosFrom < from || c.dosFrom > to) return false
    if (clientIds.length && !clientIds.includes(c.clientId)) return false
    if (payerIds.length) {
      // payerIds can be names or ids
      const payerNames = payerIds.map((id) => {
        const p = (state.payers || []).find((x) => x.id === id)
        return p ? p.name : id
      })
      if (!payerNames.includes(c.payer)) return false
    }
    const due = dueOf(c)
    if (due <= 0.5) return false
    return true
  })

  // office filter — for now, if officeIds specified, filter by client home? Simplified: if officeIds, keep all (office = practice)
  // Build rows: one per service line
  const rows = []
  let invNum = Number(invoiceNumberStart) || 4127
  let rowCount = 0
  const files = []
  let currentFileRows = []
  let invoicesInFile = 0
  let lastClientId = null

  const header = 'Invoice Number,Customer,Invoice Date,Due Date,Product/Service,Qty,Unit Price,Amount,Memo,Tax Code'

  const flushFile = () => {
    if (!currentFileRows.length) return
    const fileName = `QBO-${from}-to-${to}-${files.length + 1}.csv`
    files.push({ fileName, content: [header, ...currentFileRows].join('\n'), rows: currentFileRows.length, invoices: invoicesInFile })
    currentFileRows = []
    invoicesInFile = 0
  }

  // group claims by client for invoice numbering
  const byClient = {}
  for (const c of claims) {
    if (!byClient[c.clientId]) byClient[c.clientId] = []
    byClient[c.clientId].push(c)
  }

  for (const [cid, group] of Object.entries(byClient)) {
    const cl = clientById[cid] || { name: cid }
    const customer = `"${(cl.name || '').replace(/\"/g, '""')}"` // Last, First already
    const thisInvNum = invNum++

    for (const c of group) {
      for (const l of c.lines) {
        // QBO: no negatives, no adj lines — skip if charge <=0
        if (l.charge <= 0) continue
        const memo = `DOS ${l.dos} · ${l.code} × ${l.units} · claim ${c.no}`
        const row = `${thisInvNum},${customer},${fmtQboDate(invoiceDate)},${fmtQboDate(dueDate)},${l.code || 'ABA Service'},${l.units},${l.rate},${l.charge},"${memo.replace(/\"/g, '""')}",`
        currentFileRows.push(row)
        rowCount++
        if (currentFileRows.length >= 1000) {
          flushFile()
        }
      }
    }
    invoicesInFile++
    if (invoicesInFile >= 100) {
      flushFile()
    }
    if (rowCount >= 1000) {
      // already flushed by row guard, but ensure
    }
  }

  flushFile()

  if (!files.length) {
    files.push({ fileName: `QBO-${from}-to-${to}-1.csv`, content: header, rows: 0, invoices: 0 })
  }

  return files
}

function fmtQboDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

// ---------- Verification Forms ----------
/** The text file a Verification Forms record downloads. */
export function buildVerificationForm(form) {
  return {
    fileName: `Verification-${form.clientName}.txt`,
    content: `Verification Form\nClient ${form.clientName}\nPayer ${form.payer}\nStatus ${form.status}\nDate ${form.date}\nNotes ${form.notes || ''}`,
  }
}

// ---------- Appeal letter (Appeals screen) ----------
export function buildAppealLetter(state, opts = {}) {
  const { claimId, narrative = '', enclosures = [] } = opts
  const claim = (state.claims || {})[claimId]
  if (!claim) return { fileName: 'Appeal-NotFound.txt', content: 'Claim not found' }
  const org = state.settings?.org || {}
  const client = (state.clients || []).find((c) => c.id === claim.clientId) || {}
  const content = [
    `${org.name || 'Practice'}`,
    org.address || '',
    '',
    `Date: ${isoDate(new Date())}`,
    `Payer: ${claim.payer}`,
    `Re: Appeal — Claim ${claim.no} · Client ${client.name || ''} · DOS ${claim.dosFrom} → ${claim.dosTo}`,
    // denial.code is the practice's own reason id (Settings → Billing), not a CARC, so print only the reason.
    `Denial reason: ${claim.denial?.reason || 'not recorded'}`,
    '',
    'Dear Claims Review,',
    '',
    narrative || 'Please reconsider the denial — medical necessity documented, auth on file.',
    '',
    `Enclosures: ${enclosures.join(', ') || 'None'}`,
    '',
    'Sincerely,',
    `${org.name || ''}`,
    '',
    '# Confidential — contains health information',
  ].join('\n')
  return { fileName: `Appeal-${claim.no}.txt`, content }
}

export function build835ErrorReport(state, opts = {}) {
  const { eraId } = opts
  const era = (state.eraImports || {})[eraId]
  if (!era) return { fileName: '835-Error-NotFound.csv', content: 'ERA not found' }
  // New imports persist the review decision, not just the match: even an exact
  // match may be parked for overpayment, a duplicate or inconsistent totals.
  const parked = (era.detail || []).filter((d) => d.decision ? d.decision === 'parked' :
    !Object.values(state.claims || {}).some((c) => c.no === d.claimNo))
  const csv = (value) => {
    const text = String(value ?? '')
    // Protect spreadsheet viewers from formula injection in payer-supplied text.
    const safe = /^\s*[=+@-]/.test(text) ? `'${text}` : text
    return `"${safe.replace(/"/g, '""')}"`
  }
  const rows = [
    'claim_no,dos_from,dos_to,status,charges,allowed,paid,patient_resp,adjustments,reason,suggested_match',
    ...parked.map((l) => [l.claimNo, l.dosFrom, l.dosTo, l.status, l.charges, l.allowed, l.paid, l.patientResp,
      (l.adjustments || []).map((a) => `${a.group}-${a.reason} $${a.amount}`).join('; '),
      l.reason || 'No exact claim number match', 'Verify claim number, DOS, amount and payer manually'].map(csv).join(',')),
  ]
  return { fileName: `835-Error-${String(era.fileName || era.id).replace(/[^A-Za-z0-9.-]/g, '_')}.csv`, content: rows.join('\n') }
}
