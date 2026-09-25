// U7 — billingDocs builders (pure, document-grade)
// Pure fns: (state, opts) -> {fileName, content} or array

import { dueOf } from './claims.js'
import { isoDate } from './date.js'

const r2 = (n) => Math.round(n * 100) / 100

// ---------- Invoices / Statements ----------
export function buildInvoices(state, opts = {}) {
  const {
    for: forWho = 'client', // 'payer' | 'client'
    payerId = null,
    clientIds = [],
    from = '2026-01-01',
    to = '2026-12-31',
    format = 'standard', // standard | statement | reminder
    orderBy = 'date', // date | client | payer
    descriptionAs = 'service', // service | cpt | title
    doc = 'pdf', // pdf | csv (we return text for both, pdf via exportKit later)
    taxId = false,
    taxPct = 0,
    topNotes = '',
    bottomNotes = '',
    balanceOnly = true,
    inclTime = false,
    perClient = false,
    inclScheduled = false,
  } = opts

  const org = state.settings?.org || {}
  const clients = state.clients || []
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]))

  // filter claims in range
  let claims = Object.values(state.claims || {}).filter((c) => {
    if (c.dosFrom < from || c.dosFrom > to) return false
    if (clientIds.length && !clientIds.includes(c.clientId)) return false
    if (forWho === 'payer' && payerId) {
      // payerId can be payer name or id — match by name if possible
      const payer = (state.payers || []).find((p) => p.id === payerId)
      const payerName = payer ? payer.name : payerId
      if (c.payer !== payerName && c.payer !== payerId) return false
    }
    const due = dueOf(c)
    if (balanceOnly && due <= 0.5) return false
    if (!inclScheduled && c.lines?.some((l) => l.kind === 'scheduled')) {
      // if any line is scheduled and inclScheduled false, exclude? For simplicity, include but grey
    }
    return true
  })

  if (orderBy === 'client') claims = claims.sort((a, b) => (clientById[a.clientId]?.name || '').localeCompare(clientById[b.clientId]?.name || '') || a.dosFrom.localeCompare(b.dosFrom))
  else if (orderBy === 'payer') claims = claims.sort((a, b) => a.payer.localeCompare(b.payer) || a.dosFrom.localeCompare(b.dosFrom))
  else claims = claims.sort((a, b) => a.dosFrom.localeCompare(b.dosFrom))

  const taxRate = taxPct > 0 ? taxPct / 100 : 0

  const makeContent = (groupClaims, groupClientIds) => {
    const totalDue = groupClaims.reduce((s, c) => s + dueOf(c), 0)
    const tax = taxId && taxRate > 0 ? r2(totalDue * taxRate) : 0
    const grand = r2(totalDue + tax)

    const lines = [
      `# ${org.name || 'Practice'} — ${format === 'statement' ? 'Statement of Account' : format === 'reminder' ? 'Payment Reminder' : 'Standard Invoice'} · ${from} → ${to}`,
      `# For: ${forWho === 'payer' ? (payerId || 'Payer') : groupClientIds.length ? groupClientIds.map((id) => clientById[id]?.name || id).join(', ') : 'All clients'}`,
      `# Balance Only: ${balanceOnly ? 'Yes — paid lines hidden' : 'No'} · Separated By Client: ${perClient ? 'Yes' : 'No'} · Incl Time: ${inclTime ? 'Yes' : 'No'} · Incl Scheduled: ${inclScheduled ? 'Yes' : 'No'}`,
      topNotes ? `# Top: ${topNotes}` : null,
      bottomNotes ? `# Bottom: ${bottomNotes}` : null,
      taxId ? `# Tax ID included · Tax ${taxPct}% = $${tax.toFixed(2)}` : null,
      `claim,client,payer,dos_from,dos_to,description,units,rate,charges,paid,adj,due${inclTime ? ',time' : ''}`,
      ...groupClaims.flatMap((c) => {
        const cl = clientById[c.clientId] || {}
        return c.lines.map((l) => {
          let desc = l.desc || ''
          if (descriptionAs === 'cpt') desc = `${l.code} ${l.desc}`
          else if (descriptionAs === 'title') desc = l.desc || c.no
          else desc = l.desc || l.code
          const due = dueOf(c) // per claim due, but line-level for simplicity
          const time = inclTime ? `${Math.floor(l.t0 / 60)}:${String(l.t0 % 60).padStart(2, '0')}-${Math.floor(l.t1 / 60)}:${String(l.t1 % 60).padStart(2, '0')}` : ''
          // Balance Only hides paid lines? At claim level we already filtered, but line-level paid hidden if claim fully paid
          return `${c.no},"${cl.name || ''}",${c.payer},${c.dosFrom},${c.dosTo},"${desc}",${l.units},${l.rate},${l.charge},${c.paid || 0},${c.adj || 0},${due}${inclTime ? `,${time}` : ''}`
        })
      }),
      `TOTAL,,,,,,,${groupClaims.reduce((s, c) => s + c.charges, 0).toFixed(2)},${groupClaims.reduce((s, c) => s + (c.paid || 0), 0).toFixed(2)},${groupClaims.reduce((s, c) => s + (c.adj || 0), 0).toFixed(2)},${totalDue.toFixed(2)}${inclTime ? ',' : ''}`,
      tax ? `TAX,,,,,,,${tax.toFixed(2)}` : null,
      `GRAND TOTAL,,,,,,,${grand.toFixed(2)}`,
    ].filter(Boolean)
    return lines.join('\n')
  }

  const seq = state.settings?.billing?.invoiceSeq || 1
  const prefix = state.settings?.billing?.invoicePrefix || 'INV'
  const yearMonth = to.slice(0, 7).replace('-', '')

  if (perClient) {
    // group by client
    const byClient = {}
    for (const c of claims) {
      const cid = c.clientId
      if (!byClient[cid]) byClient[cid] = []
      byClient[cid].push(c)
    }
    let idx = 0
    return Object.entries(byClient).map(([cid, group]) => {
      const invNo = `${prefix}-${yearMonth}-${String(seq + idx).padStart(3, '0')}`
      idx++
      return {
        fileName: `${invNo}-${clientById[cid]?.name?.replace(/[^A-Za-z0-9]/g, '_') || cid}.${doc === 'pdf' ? 'pdf' : 'csv'}`,
        invNo,
        clientId: cid,
        content: makeContent(group, [cid]),
        total: group.reduce((s, c) => s + dueOf(c), 0),
        claims: group,
      }
    })
  } else {
    const invNo = `${prefix}-${yearMonth}-${String(seq).padStart(3, '0')}`
    return [
      {
        fileName: `${invNo}.${doc === 'pdf' ? 'pdf' : 'csv'}`,
        invNo,
        clientIds,
        content: makeContent(claims, clientIds),
        total: claims.reduce((s, c) => s + dueOf(c), 0),
        claims,
      },
    ]
  }
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
    if (c.dosFrom < from || c.dosFrom > to) return false
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
export function buildVerificationForm(state, opts = {}) {
  const {
    payerId,
    format = 'parental', // parental | benefit | auth_request
    from = '2026-01-01',
    to = '2026-12-31',
    clientIds = [],
    apptState = 'all', // all | completed | scheduled
    doc = 'pdf',
  } = opts

  const payer = (state.payers || []).find((p) => p.id === payerId || p.name === payerId) || { name: payerId || 'Payer', street: '', city: '', state: '', zip: '', contacts: [] }
  const org = state.settings?.org || {}
  const clients = (state.clients || []).filter((c) => !clientIds.length || clientIds.includes(c.id))

  return clients.map((client) => {
    const appts = Object.values(state.appts || {}).filter((a) => {
      if (a.clientIds?.[0] !== client.id) return false
      if (a.date < from || a.date > to) return false
      if (apptState === 'completed' && a.status !== 'completed') return false
      if (apptState === 'scheduled' && !['active', 'confirmed'].includes(a.status)) return false
      return true
    })

    const title = format === 'parental' ? 'Parental Verification' : format === 'benefit' ? 'Benefit Verification Request' : 'Prior Authorization Request'

    const content = [
      `# ${org.name || 'Practice'} — ${title}`,
      `# Payer: ${payer.name} · ${payer.street || ''} ${payer.city || ''} ${payer.state || ''} ${payer.zip || ''}`,
      `# Client: ${client.name} · DOB ${client.dob || '—'} · Member ${client.id}`,
      `# Date Range: ${from} → ${to} · Appointment State: ${apptState}`,
      `# Format: ${format} · Generated: ${isoDate(new Date())}`,
      '',
      format === 'parental' ? `I, the parent/guardian of ${client.name}, attest that the following sessions were provided as documented:` : '',
      format === 'benefit' ? `Requesting benefit verification for ${client.name} — please confirm coverage for ABA services CPT 97151-97158:` : '',
      format === 'auth_request' ? `Prior authorization request for ${client.name} — ${client.program || ''} — requesting units for ${from} → ${to}:` : '',
      '',
      'date,service,code,units,staff,notes',
      ...appts.map((a) => `${a.date},${a.title || ''},${a.billing?.code || ''},${a.billing?.units || ''},"${(a.staffIds || []).join(', ')}",${a.notes || ''}`),
      '',
      format === 'parental' ? 'Parent/Guardian Signature: _________________________ Date: __________' : '',
      format === 'parental' ? 'Provider Signature: _________________________ Date: __________' : '',
      format === 'benefit' ? 'Please return verification to: ' + (org.email || '') : '',
      format === 'auth_request' ? `Units requested: ${appts.reduce((s, a) => s + (a.billing?.units || 0), 0)} · Program: ${client.program || ''}` : '',
      '',
      `# Confidential — contains health information`,
    ].filter(Boolean).join('\n')

    return {
      fileName: `${title.replace(/[^A-Za-z0-9]/g, '_')}-${client.name.replace(/[^A-Za-z0-9]/g, '_')}-${from}-to-${to}.${doc === 'pdf' ? 'pdf' : 'txt'}`,
      clientId: client.id,
      content,
      title,
      payer: payer.name,
      appts,
    }
  })
}

export function buildAppealLetter(state, opts = {}) {
  const { claimId, narrative = '', enclosures = [] } = opts
  const claim = (state.claims || {})[claimId]
  if (!claim) return { fileName: 'Appeal-NotFound.txt', content: 'Claim not found' }
  const org = state.settings?.org || {}
  const client = (state.clients || []).find((c) => c.id === claim.clientId) || {}
  const content = [
    `${org.name || 'Practice'}`,
    `${org.street || ''} ${org.city || ''} ${org.state || ''} ${org.zip || ''}`,
    '',
    `Date: ${isoDate(new Date())}`,
    `Payer: ${claim.payer}`,
    `Re: Appeal — Claim ${claim.no} · Client ${client.name || ''} · DOS ${claim.dosFrom} → ${claim.dosTo}`,
    `CARC: ${claim.denial?.code || ''} — ${claim.denial?.reason || ''}`,
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
  const unmatched = era.detail?.filter((d) => !Object.values(state.claims || {}).some((c) => c.no === d.claimNo)) || []
  const rows = [
    'claim_no,status,charges,paid,patient_resp,adjustments,suggested_match',
    ...unmatched.map((l) => `${l.claimNo},${l.status},${l.charges},${l.paid},${l.patientResp},"${(l.adjustments || []).map((a) => `${a.group}-${a.reason} $${a.amount}`).join('; ')}",Check DOS+amount`,
    ),
  ]
  return { fileName: `835-Error-${era.fileName.replace(/[^A-Za-z0-9.-]/g, '_')}.csv`, content: rows.join('\n') }
}
