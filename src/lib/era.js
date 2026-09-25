// U6 — 835 parser (pure, fixture-driven)
// Parses a minimal subset of X12 835: ISA/GS/ST/BPR/TRN/CLP/NM1/CAS/AMT/PLB/SE/GE/IEA
// Returns { lines, matched, unmatched, errors } — never throws

export function parse835(text) {
  const errors = []
  const lines = []
  if (!text || typeof text !== 'string' || !text.trim()) {
    errors.push('Empty 835 file')
    return { lines, matched: [], unmatched: [], errors }
  }
  const raw = String(text).trim()
  if (!raw.includes('~') && !raw.includes('CLP')) {
    errors.push('Not an 835 — missing segment terminators (~) and CLP segments')
    return { lines, matched: [], unmatched: [], errors }
  }

  const segments = raw.split('~').map((s) => s.trim()).filter(Boolean)
  let current = null
  let lxCount = 0
  let hasISA = false, hasGS = false, hasST = false

  for (const seg of segments) {
    if (!seg) continue
    const parts = seg.split('*')
    const id = (parts[0] || '').toUpperCase()

    if (id === 'ISA') hasISA = true
    if (id === 'GS') hasGS = true
    if (id === 'ST') hasST = true

    if (id === 'CLP') {
      lxCount++
      const claimNo = (parts[1] || '').trim()
      const statusCode = (parts[2] || '').trim() // 1=processed as primary, 2=denied, 3=... etc
      const charges = parseFloat(parts[3]) || 0
      const paid = parseFloat(parts[4]) || 0
      const patientResp = parseFloat(parts[5]) || 0
      const claimId = (parts[7] || claimNo || `CLP-${lxCount}`).trim()
      const payerClaimCtrl = (parts[7] || '').trim()

      if (!claimNo) errors.push(`CLP ${lxCount}: missing claim number`)

      current = {
        id: `era-line-${lxCount}`,
        claimNo,
        payerClaimCtrl,
        statusCode,
        status: statusCode === '4' ? 'denied' : statusCode === '2' || statusCode === '3' ? 'partial' : statusCode === '1' || statusCode === '19' || statusCode === '20' ? 'paid' : paid===0 && charges>0 ? 'denied' : paid>0 && paid<charges ? 'partial' : paid>0 ? 'paid' : 'other',
        charges,
        paid,
        patientResp,
        adjustments: [],
        casRaw: [],
        amt: null,
        nm1: [],
        plb: null,
        raw: seg,
      }
      lines.push(current)
    } else if (id === 'CAS' && current) {
      const group = parts[1] || ''
      const casEntries = []
      for (let i = 2; i < parts.length; i += 3) {
        const reason = (parts[i] || '').trim()
        const amount = parseFloat(parts[i + 1]) || 0
        const qty = parts[i + 2] || ''
        if (reason) {
          casEntries.push({ group, reason, amount, qty })
        }
      }
      current.adjustments.push(...casEntries)
      current.casRaw.push(seg)
    } else if (id === 'AMT' && current) {
      const qual = parts[1] || ''
      const amount = parseFloat(parts[2]) || 0
      current.amt = { qual, amount, raw: seg }
      // B6 = patient responsibility
      if (qual === 'B6') current.patientResp = amount
    } else if (id === 'NM1' && current) {
      current.nm1.push({ raw: seg, parts })
    } else if (id === 'PLB') {
      // provider level adjustment — attach to last line or as separate
      const plb = { raw: seg, parts, adjustments: [] }
      for (let i = 3; i < parts.length; i += 2) {
        const reason = parts[i]
        const amount = parseFloat(parts[i + 1]) || 0
        if (reason) plb.adjustments.push({ reason, amount })
      }
      if (current) current.plb = plb
      else lines.push({ id: `era-plb-${lxCount}`, claimNo: '', status: 'plb', charges: 0, paid: 0, patientResp: 0, adjustments: plb.adjustments, raw: seg })
    } else if (id === 'BPR') {
      const rawAmt = parts[2] || ''
      const amount = parseFloat(rawAmt)
      if (rawAmt && isNaN(amount)) errors.push(`BPR: invalid total amount ${rawAmt}`)
    }
  }

  if (!hasISA) errors.push('Missing ISA header')
  if (!hasGS) errors.push('Missing GS header')
  if (!hasST) errors.push('Missing ST header')
  if (lxCount === 0) errors.push('No CLP claim segments found')

  // For pure parser, matched/unmatched are same as lines — UI will do exact-claim-no match
  const matched = []
  const unmatched = [...lines]

  return { lines, matched, unmatched, errors }
}

// Helper for UI: try to match ERA lines to existing claims
export function matchEraLines(eraLines, claims) {
  const claimsByNo = {}
  const claimsById = {}
  for (const c of Object.values(claims || {})) {
    if (c.no) claimsByNo[c.no] = c
    claimsById[c.id] = c
  }
  const matched = []
  const unmatched = []
  for (const line of eraLines) {
    const exact = claimsByNo[line.claimNo] || claimsById[line.claimNo] || claimsByNo[line.payerClaimCtrl]
    if (exact) {
      matched.push({ era: line, claim: exact, method: 'exact-claim-no' })
    } else {
      // fallback: try to find by charges+paid proximity? For now park as unmatched
      unmatched.push(line)
    }
  }
  return { matched, unmatched }
}

// For reports: denial by CARC
export function denialByCARC(eraLines) {
  const map = {}
  for (const line of eraLines) {
    for (const adj of line.adjustments || []) {
      if (!map[adj.reason]) map[adj.reason] = { reason: adj.reason, group: adj.group, count: 0, amount: 0 }
      map[adj.reason].count++
      map[adj.reason].amount += adj.amount
    }
  }
  return Object.values(map).sort((a,b)=>b.amount-a.amount)
}
