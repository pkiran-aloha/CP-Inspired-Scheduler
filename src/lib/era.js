// Local-only 835 reader. This is a deliberately strict CLAIM-level subset of X12:
// ISA/GS/ST/BPR/TRN/CLP/CAS/AMT/NM1/PLB. No network clearinghouse or service-line
// SVC matching. Structural/numeric errors are reported, never silently coerced to 0.
const cents = (value) => Math.round(value * 100) / 100

function fingerprintOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return `${text.length}-${(h >>> 0).toString(16)}`
}

function x12Date(raw) {
  if (!/^\d{8}$/.test(raw || '')) return null
  const y = Number(raw.slice(0, 4)), m = Number(raw.slice(4, 6)), d = Number(raw.slice(6, 8))
  const parsed = new Date(y, m - 1, d)
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null
}

export function parse835(text) {
  const errors = [], lines = []
  const meta = { traceNo: '', paymentDate: null, bprAmount: null, payerName: '', hasPLB: false, hasSVC: false }
  const result = (fingerprint = null) => ({ lines, matched: [], unmatched: [...lines], errors, meta, fingerprint })
  if (typeof text !== 'string' || !text.trim()) { errors.push('Empty 835 file'); return result() }
  const raw = text.trim()
  if (!raw.includes('~')) { errors.push('Not an 835 file: segment terminators (~) are missing'); return result() }
  const segments = raw.split('~').map((s) => s.trim()).filter(Boolean)
  const fingerprint = fingerprintOf(segments.join('~'))
  const amount = (value, label) => {
    const s = String(value ?? '').trim()
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) { errors.push(`${label}: missing or invalid amount`); return 0 }
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0) { errors.push(`${label}: negative/reversal amounts are not supported`); return 0 }
    if (!Number.isSafeInteger(Math.round(n * 100))) { errors.push(`${label}: amount exceeds the supported cent range`); return 0 }
    return cents(n)
  }
  let current = null
  let clpCount = 0
  let hasISA = false, hasGS = false, hasST = false, hasSE = false, hasGE = false, hasIEA = false, hasBPR = false
  let isaControl = null, gsControl = null, stControl = null, inService = false

  for (const seg of segments) {
    const parts = seg.split('*')
    const id = (parts[0] || '').toUpperCase()
    if (id === 'ISA') { hasISA = true; isaControl = parts[13] }
    if (id === 'GS') { hasGS = true; gsControl = parts[6] }
    if (id === 'GE') {
      hasGE = true
      if (parts[2] !== gsControl) errors.push('GS/GE functional-group control numbers do not match')
    }
    if (id === 'IEA') {
      hasIEA = true
      if (parts[2] !== isaControl) errors.push('ISA/IEA interchange control numbers do not match')
    }
    if (id === 'ST') {
      if (hasST) errors.push('Multiple 835 transactions are not supported in one file')
      if (parts[1] !== '835') errors.push('ST transaction is not an 835')
      hasST = true
      stControl = parts[2]
    }
    if (id === 'SE') {
      hasSE = true
      if (parts[2] !== stControl) errors.push('ST/SE transaction control numbers do not match')
      current = null
    }

    if (id === 'CLP') {
      if (!hasST || hasSE) errors.push('CLP claim line outside the 835 transaction')
      inService = false
      clpCount++
      const claimNo = (parts[1] || '').trim()
      const statusCode = (parts[2] || '').trim()
      if (!claimNo) errors.push(`CLP ${clpCount}: missing claim number`)
      if (!statusCode) errors.push(`CLP ${clpCount}: missing claim status`)
      const charges = amount(parts[3], `CLP ${clpCount} charges`)
      const paid = amount(parts[4], `CLP ${clpCount} paid`)
      const patientResp = amount(parts[5], `CLP ${clpCount} patient responsibility`)
      if (!charges) errors.push(`CLP ${clpCount}: charges must be positive`)
      current = {
        id: `era-line-${clpCount}`, claimNo, payerClaimCtrl: (parts[7] || '').trim(), statusCode,
        status: statusCode === '4' ? 'denied' : statusCode === '2' ? 'processed secondary'
          : statusCode === '3' ? 'processed tertiary'
            : ['1', '19', '20'].includes(statusCode) ? 'processed' : 'other',
        charges, paid, patientResp, allowed: null, adjustments: [], casRaw: [], amt: null, nm1: [],
        dosFrom: null, dosTo: null, hasSVC: false, plb: null, raw: seg,
      }
      lines.push(current)
    } else if (id === 'SVC') {
      meta.hasSVC = true
      if (current) current.hasSVC = true
      else errors.push('Service line without a claim')
      inService = true
    } else if (id === 'CAS' && current && !inService) {
      const group = (parts[1] || '').trim().toUpperCase()
      if (!group) errors.push(`CAS after CLP ${clpCount}: missing adjustment group`)
      for (let i = 2; i < parts.length; i += 3) {
        const reason = (parts[i] || '').trim()
        if (!reason && parts[i + 1]) errors.push(`CAS after CLP ${clpCount}: missing adjustment reason`)
        if (reason) current.adjustments.push({ group, reason, amount: amount(parts[i + 1], `CAS ${group}-${reason}`), qty: parts[i + 2] || '' })
      }
      current.casRaw.push(seg)
    } else if (id === 'CAS' && !current) {
      errors.push('CAS adjustment without a claim')
    } else if (id === 'AMT' && current && !inService) {
      const qual = (parts[1] || '').trim()
      const value = amount(parts[2], `AMT ${qual || 'unknown'}`)
      current.amt = { qual, amount: value, raw: seg }
      // AMT*B6 is the *allowed amount*, not CLP05 patient responsibility.
      if (qual === 'B6') current.allowed = value
    } else if (id === 'NM1' && current) {
      current.nm1.push({ raw: seg, parts })
    } else if (id === 'DTM' && current && ['232', '233'].includes(parts[1])) {
      const date = x12Date(parts[2])
      if (!date) errors.push(`CLP ${clpCount}: invalid date of service`)
      else if (parts[1] === '232') current.dosFrom = date
      else current.dosTo = date
    } else if (id === 'PLB') {
      // PLB is provider-level, NOT a claim adjustment; preserve for review only.
      meta.hasPLB = true
      current = null
      inService = false
    } else if (id === 'BPR') {
      hasBPR = true
      meta.bprAmount = amount(parts[2], 'BPR total')
      meta.paymentDate = x12Date(parts[16]) || meta.paymentDate
    } else if (id === 'TRN') {
      meta.traceNo = (parts[2] || '').trim()
    } else if (id === 'N1' && parts[1] === 'PR') {
      meta.payerName = (parts[2] || '').trim()
    } else if (id === 'DTM' && parts[1] === '405' && !meta.paymentDate) {
      meta.paymentDate = x12Date(parts[2])
    }
  }

  if (!hasISA) errors.push('Missing ISA header')
  if (!hasGS) errors.push('Missing GS header')
  if (!hasST) errors.push('Missing ST header')
  if (!hasSE) errors.push('Missing SE trailer')
  if (!hasGE) errors.push('Missing GE trailer')
  if (!hasIEA) errors.push('Missing IEA trailer')
  if (!hasBPR) errors.push('Missing BPR payment information')
  if (!meta.traceNo) errors.push('Missing TRN payment trace')
  if (clpCount === 0) errors.push('No CLP claim segments found')
  return result(fingerprint)
}

// Exact claim identifiers only. A guessed match must NEVER post money automatically.
export function matchEraLines(eraLines, claims) {
  const allClaims = Object.values(claims || {})
  const matched = [], unmatched = []
  for (const line of eraLines) {
    // CLP07 is a payer-assigned control number, not our claim number. Never use it
    // as a fallback; only a unique exact CLP01 -> claim number/id is trustworthy.
    const matches = allClaims.filter((c) => c.no === line.claimNo || c.id === line.claimNo)
    if (matches.length === 1) matched.push({ era: line, claim: matches[0], method: 'exact-claim-no' })
    else unmatched.push(line)
  }
  return { matched, unmatched }
}

export function denialByCARC(eraLines) {
  const map = {}
  for (const line of eraLines) {
    for (const adj of line.adjustments || []) {
      if (!map[adj.reason]) map[adj.reason] = { reason: adj.reason, group: adj.group, count: 0, amount: 0 }
      map[adj.reason].count++
      map[adj.reason].amount += adj.amount
    }
  }
  return Object.values(map).sort((a, b) => b.amount - a.amount)
}
