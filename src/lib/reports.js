// ---- Report engine: pure builders over the PMS ledger (appointments, rosters, billing) ----
// Every report returns { columns, rows, summary, note } so the UI, CSV export and tests share one shape.

import { TYPES, STATUSES, BILL_CODES, computeBilling, overlapsType } from './model'
import { rangeMetrics } from './analytics'
import { agingOf, dueOf } from './claims'
import { scanNeedsCover, needsCoverFor } from './smart'
import { addDays, isoDate, parseISO, todayISO } from './date'

export const REPORT_CATS = [
  { id: 'operations', label: 'Operations & Capacity' },
  { id: 'clinical', label: 'Clinical & Compliance' },
  { id: 'billing', label: 'Billing & Claims' },
  { id: 'people', label: 'People & Payroll' },
  { id: 'quality', label: 'Data Quality' },
]

const rawList = (state, days) => {
  const set = new Set(days)
  return Object.values(state.appts).filter((a) => set.has(a.date))
}
const byIdMap = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]))
const r2 = (n) => Math.round(n * 100) / 100
const r1 = (n) => Math.round(n * 10) / 10
const h10 = (min) => r1(min / 60)
const namesOf = (a, map) => (a || []).map((id) => map[id]?.name || id).join(', ')
const firstClient = (a, clients) => clients[a.clientIds?.[0]]?.name || '—'
const weeksOf = (days) => days.length / 7
const fmtD = (d) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : '—')
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000)

// scope: one optional staff / client / team id applied to every report
export function inScope(a, scope, state) {
  if (!scope) return true
  if (scope.staff && !(a.staffIds || []).includes(scope.staff)) return false
  if (scope.client && !(a.clientIds || []).includes(scope.client)) return false
  if (scope.team) {
    const t = state.teams.find((x) => x.id === scope.team)
    if (!t) return false
    const ts = new Set(t.staffIds || [])
    const tc = new Set(t.clientIds || [])
    if (!(a.staffIds || []).some((s) => ts.has(s)) && !(a.clientIds || []).some((c) => tc.has(c))) return false
  }
  return true
}
const scoped = (state, days, scope) => rawList(state, days).filter((a) => inScope(a, scope, state))

const moneyCell = { align: 'r' }

// ====================================================================
//  Reports
// ====================================================================

const REPORTS_RAW = [
  // ---------- Operations ----------
  {
    id: 'attendance', cat: 'operations', name: 'Attendance & Session Ledger', icon: 'clipboard',
    blurb: 'Every clinical appointment in range with outcome, staff, units and charge — the master ledger.',
    build(state, ctx) {
      const clients = byIdMap(state.clients)
      const staff = byIdMap(state.staff)
      const list = scoped(state, ctx.days, ctx.scope).filter((a) => a.type === 'service' || a.type === 'evaluation')
      const rows = list.map((a) => ({
        date: a.date, time: `${String(Math.floor(a.start / 60)).padStart(2, '0')}:${String(a.start % 60).padStart(2, '0')}`,
        client: firstClient(a, clients), staff: namesOf(a.staffIds, staff), type: TYPES[a.type].label,
        status: STATUSES[a.status].label, minutes: a.end - a.start, units: a.billing?.units || 0, charge: r2(computeBilling(a)),
        _link: { kind: 'appt', id: a.id, date: a.date },
      }))
      const m = rangeMetrics(state, ctx.days)
      const delivered = m.completed + m.active + m.confirmed
      return {
        columns: [
          { k: 'date', label: 'Date' }, { k: 'time', label: 'Start' }, { k: 'client', label: 'Client' }, { k: 'staff', label: 'Staff' },
          { k: 'type', label: 'Type' }, { k: 'status', label: 'Status' }, { k: 'minutes', label: 'Min', t: 'num', ...moneyCell },
          { k: 'units', label: 'Units', t: 'num', ...moneyCell }, { k: 'charge', label: 'Charge $', t: 'money', ...moneyCell },
        ],
        rows,
        summary: [
          { label: 'Ledger lines', value: rows.length },
          { label: 'Completed', value: m.completed },
          { label: 'No-shows', value: m.noShow },
          { label: 'Cancellations', value: m.cancelled },
          { label: 'Attendance rate', value: `${list.length ? Math.round(((delivered + 0.0001) / Math.max(1, delivered + m.noShow + m.cancelled)) * 100) : 100}%` },
        ],
      }
    },
  },
  {
    id: 'utilization', cat: 'operations', name: 'Staff Utilization vs Target', icon: 'spark',
    blurb: 'Booked hours against each person’s target week — the core productivity report.',
    build(state, ctx) {
      const list = scoped(state, ctx.days, ctx.scope)
      const weeks = weeksOf(ctx.days)
      const agg = {}
      for (const a of list) {
        if (a.status === 'cancelled' || !overlapsType(a)) continue
        for (const s of a.staffIds || []) {
          const g = (agg[s] = agg[s] || { sessionMin: 0, supMin: 0, driveMin: 0, sessions: 0, revenue: 0 })
          if (a.type === 'service' || a.type === 'evaluation') {
            g.sessionMin += a.end - a.start
            g.sessions++
            g.revenue += r2(computeBilling(a) / Math.max(1, (a.staffIds || []).length))
          } else if (a.type === 'supervision') g.supMin += a.end - a.start
          else if (a.type === 'drive') g.driveMin += a.end - a.start
        }
      }
      const rows = state.staff
        .filter((s) => !ctx.scope?.staff || ctx.scope.staff === s.id)
        .map((s) => {
          const g = agg[s.id] || { sessionMin: 0, supMin: 0, driveMin: 0, sessions: 0, revenue: 0 }
          const targetH = Math.round((s.targetWeekH || 30) * weeks)
          const bookedH = h10(g.sessionMin + g.supMin + g.driveMin)
          return {
            staff: s.name, role: s.role, fte: s.fte ?? 1, sessions: g.sessions,
            sessionH: h10(g.sessionMin), supH: h10(g.supMin), driveH: h10(g.driveMin),
            bookedH, targetH, utilPct: targetH ? Math.round((bookedH / targetH) * 100) : 0, revenue: Math.round(g.revenue),
            _link: { kind: 'staff', id: s.id },
          }
        })
        .sort((a, b) => b.utilPct - a.utilPct)
      const avgUtil = rows.length ? Math.round(rows.reduce((t, r) => t + r.utilPct, 0) / rows.length) : 0
      return {
        columns: [
          { k: 'staff', label: 'Staff' }, { k: 'role', label: 'Role' }, { k: 'fte', label: 'FTE', t: 'num', ...moneyCell },
          { k: 'sessions', label: 'Sessions', t: 'num', ...moneyCell }, { k: 'sessionH', label: 'Sess h', t: 'hrs', ...moneyCell },
          { k: 'supH', label: 'Sup h', t: 'hrs', ...moneyCell }, { k: 'driveH', label: 'Drive h', t: 'hrs', ...moneyCell },
          { k: 'bookedH', label: 'Booked h', t: 'hrs', ...moneyCell }, { k: 'targetH', label: 'Target h', t: 'hrs', ...moneyCell },
          { k: 'utilPct', label: 'Util %', t: 'pct', ...moneyCell }, { k: 'revenue', label: 'Revenue $', t: 'money', ...moneyCell },
        ],
        rows,
        summary: [
          { label: 'Avg utilization', value: `${avgUtil}%` },
          { label: 'Over target (>100%)', value: rows.filter((r) => r.utilPct > 100).length },
          { label: 'Under 60%', value: rows.filter((r) => r.utilPct < 60).length },
        ],
        note: 'Target = personal target-week hours × weeks in range. Meetings & PTO are booked time but not billable, so they count toward utilization, not revenue.',
      }
    },
  },
  {
    id: 'cover', cat: 'operations', name: 'Cancellations & Backfill Log', icon: 'alert',
    blurb: 'What got cancelled, whether smart backfill recovered the slot, and dollars still at risk.',
    build(state, ctx) {
      const clients = byIdMap(state.clients)
      const staff = byIdMap(state.staff)
      const openIds = new Set(scanNeedsCover(state, ctx.days).map((c) => c.appt.id))
      const list = scoped(state, ctx.days, ctx.scope).filter((a) => a.status === 'cancelled' || a.backfilled)
      const rows = list.map((a) => {
        const outcome = a.backfilled ? `Backfilled → ${staff[a.staffIds?.find((s) => s !== a.backfilledFrom)]?.name || 'covered'}` : openIds.has(a.id) ? 'Still open' : 'Left unstaffed / ignored'
        const est = (Number(a.billing?.units) || 4) * (Number(a.billing?.rate) || state.settings.defaultRate)
        return {
          date: a.date, client: firstClient(a, clients), was: namesOf(a.backfilledFrom ? [a.backfilledFrom] : a.staffIds, staff) || '—',
          hours: `${String(Math.floor(a.start / 60)).padStart(2, '0')}:${String(a.start % 60).padStart(2, '0')}`,
          outcome, atRisk: openIds.has(a.id) ? r2(est) : 0, _link: { kind: 'appt', id: a.id, date: a.date },
        }
      })
      const open = rows.filter((r) => r.atRisk > 0).length
      return {
        columns: [
          { k: 'date', label: 'Date' }, { k: 'hours', label: 'Start' }, { k: 'client', label: 'Client' }, { k: 'was', label: 'Original staff' },
          { k: 'outcome', label: 'Outcome' }, { k: 'atRisk', label: '$ at risk', t: 'money', ...moneyCell },
        ],
        rows,
        summary: [
          { label: 'Cancellations', value: rows.length },
          { label: 'Recovered', value: rows.filter((r) => r.outcome.startsWith('Backfilled')).length },
          { label: 'Still open', value: open },
          { label: '$ at risk', value: `$${Math.round(rows.reduce((t, r) => t + r.atRisk, 0)).toLocaleString()}` },
        ],
      }
    },
  },
  {
    id: 'gaps', cat: 'operations', name: 'Open Staff Capacity (Gaps)', icon: 'clock',
    blurb: 'Booked vs available minutes per staff-day — sellable hours hiding inside the schedule.',
    build(state, ctx) {
      const wd = state.settings.workday || [8, 18]
      const capMin = (wd[1] - wd[0]) * 60
      const booked = {}
      for (const a of scoped(state, ctx.days, ctx.scope)) {
        if (a.status === 'cancelled' || !overlapsType(a)) continue
        for (const s of a.staffIds || []) {
          const k = `${s}|${a.date}`
          booked[k] = (booked[k] || 0) + (a.end - a.start)
        }
      }
      const rows = []
      for (const d of ctx.days) {
        const dt = parseISO(d)
        if (dt.getDay() === 0 || dt.getDay() === 6) continue
        for (const s of state.staff) {
          if (ctx.scope?.staff && ctx.scope.staff !== s.id) continue
          const b = booked[`${s.id}|${d}`] || 0
          const free = capMin - b
          if (free >= 45) rows.push({ staff: s.name, date: d, bookedH: h10(b), capH: Math.round(capMin / 60), freeH: h10(free), sellable: `$${Math.round((free / 30) * state.settings.defaultRate)}`, _link: { kind: 'staff', id: s.id, date: d } })
        }
      }
      rows.sort((a, b) => b.freeH - a.freeH)
      const top = rows.slice(0, 120)
      return {
        columns: [
          { k: 'staff', label: 'Staff' }, { k: 'date', label: 'Date' }, { k: 'bookedH', label: 'Booked h', t: 'hrs', ...moneyCell },
          { k: 'capH', label: 'Day h', t: 'num', ...moneyCell }, { k: 'freeH', label: 'Free h', t: 'hrs', ...moneyCell }, { k: 'sellable', label: 'Sellable @ default rate', align: 'r' },
        ],
        rows: top,
        summary: [
          { label: 'Gap windows', value: rows.length },
          { label: 'Total open hours', value: `${Math.round(rows.reduce((t, r) => t + r.freeH, 0))}h` },
          { label: 'Est. recoverable', value: `$${Math.round(rows.reduce((t, r) => t + (r.freeH / 30) * state.settings.defaultRate, 0)).toLocaleString()}` },
        ],
        note: top.length < rows.length ? `Showing the 120 largest gaps of ${rows.length}.` : undefined,
      }
    },
  },

  // ---------- Clinical & compliance ----------
  {
    id: 'auth', cat: 'clinical', name: 'Authorization Burn-down', icon: 'shield',
    blurb: 'Delivered weekly hours vs each client’s authorized hours — pace, overruns and expiry risk.',
    build(state, ctx) {
      const today = todayISO()
      const weeks = weeksOf(ctx.days)
      const rows = state.clients
        .filter((c) => !ctx.scope?.client || ctx.scope.client === c.id)
        .map((c) => {
          const appts = rawList(state, ctx.days).filter((a) => (a.clientIds || []).includes(c.id) && (a.type === 'service' || a.type === 'evaluation') && a.status !== 'cancelled')
          const deliveredH = h10(appts.reduce((t, a) => t + (a.end - a.start), 0))
          const allowed = (c.authWeekly || 10) * weeks
          const burn = allowed ? Math.round((deliveredH / allowed) * 100) : 0
          const daysLeft = c.authEnd ? daysBetween(today, c.authEnd) : null
          const pace = burn > 105 ? 'Over authorized' : burn >= 88 ? 'On pace' : appts.length ? 'Under-scheduled' : 'No sessions in range'
          return {
            client: c.name, program: c.program, insurer: c.insurer || '—', authWeekly: c.authWeekly, deliveredH, allowedH: Math.round(allowed),
            burnPct: burn, pace, authEnd: c.authEnd || '—', daysLeft: daysLeft ?? '', _link: { kind: 'client', id: c.id },
          }
        })
        .sort((a, b) => b.burnPct - a.burnPct)
      return {
        columns: [
          { k: 'client', label: 'Client' }, { k: 'program', label: 'Program' }, { k: 'insurer', label: 'Payer' },
          { k: 'authWeekly', label: 'Auth h/wk', t: 'num', ...moneyCell }, { k: 'deliveredH', label: 'Delivered h', t: 'hrs', ...moneyCell },
          { k: 'allowedH', label: 'Allowed h', t: 'num', ...moneyCell }, { k: 'burnPct', label: 'Burn %', t: 'pct', ...moneyCell },
          { k: 'pace', label: 'Pace' }, { k: 'authEnd', label: 'Auth end' }, { k: 'daysLeft', label: 'Days left', t: 'num', ...moneyCell },
        ],
        rows,
        summary: [
          { label: 'Over authorized', value: rows.filter((r) => r.burnPct > 105).length },
          { label: 'Under-scheduled', value: rows.filter((r) => r.pace === 'Under-scheduled' || r.pace === 'No sessions in range').length },
          { label: 'Auths expiring ≤30d', value: rows.filter((r) => r.daysLeft !== '' && r.daysLeft <= 30).length },
        ],
      }
    },
  },
  {
    id: 'reassess', cat: 'clinical', name: 'Re-assessment Due Dates', icon: 'repeat',
    blurb: 'VB-MAPP / ABLLS-R cadence — last assessment, next due date, who owns it.',
    build(state, ctx) {
      const today = todayISO()
      const evals = rawList(state, Object.keys(state.appts).length ? allDays(state) : []).filter((a) => a.type === 'evaluation' && a.status !== 'cancelled')
      const staff = byIdMap(state.staff)
      const rows = state.clients.map((c) => {
        const mine = evals.filter((a) => (a.clientIds || []).includes(c.id)).sort((a, b) => (a.date < b.date ? 1 : -1))
        const last = mine[0]
        const nextDue = last ? isoDate(addDays(parseISO(last.date), 180)) : null
        const daysLeft = nextDue ? daysBetween(today, nextDue) : null
        const status = !last ? 'No baseline on file' : daysLeft < 0 ? 'OVERDUE' : daysLeft <= 21 ? 'Due soon' : 'Scheduled ok'
        return { client: c.name, program: c.program, lastEval: last?.date || '—', instrument: last?.title || '—', owner: last ? namesOf(last.staffIds, staff) : '—', nextDue: nextDue || '—', daysLeft: daysLeft ?? '', status, _link: last ? { kind: 'appt', id: last.id, date: last.date } : { kind: 'client', id: c.id } }
      }).sort((a, b) => (a.daysLeft === '' ? 9999 : b.daysLeft === '' ? -9999 : a.daysLeft - b.daysLeft))
      return {
        columns: [
          { k: 'client', label: 'Client' }, { k: 'program', label: 'Program' }, { k: 'lastEval', label: 'Last assessment' },
          { k: 'instrument', label: 'Instrument' }, { k: 'owner', label: 'Owner' }, { k: 'nextDue', label: 'Next due' },
          { k: 'daysLeft', label: 'Days left', t: 'num', ...moneyCell }, { k: 'status', label: 'Status' },
        ],
        rows,
        summary: [
          { label: 'Overdue', value: rows.filter((r) => r.status === 'OVERDUE').length },
          { label: 'Due ≤3 weeks', value: rows.filter((r) => r.status === 'Due soon').length },
          { label: 'Missing baseline', value: rows.filter((r) => r.status === 'No baseline on file').length },
        ],
        note: 'Default cycle: 180 days between standardized re-assessments (payer-mandated in most CA auths).',
      }
    },
  },
  {
    id: 'supervision', cat: 'clinical', name: 'BCBA Supervision Coverage', icon: 'eye',
    blurb: 'Monthly supervision cadence for every RBT / trainee — BACB compliance at a glance.',
    build(state, ctx) {
      const list = scoped(state, ctx.days, ctx.scope)
      const isSup = (s) => /BCBA|BCaBA/.test(s.role || '')
      const sups = state.staff.filter(isSup).map((x) => x.id)
      const rows = state.staff
        .filter((s) => /RBT|Student/i.test(s.role || '') && (!ctx.scope?.staff || ctx.scope.staff === s.id))
        .map((s) => {
          const sv = list.filter((a) => a.type === 'supervision' && (a.staffIds || []).includes(s.id) && (a.staffIds || []).some((x) => sups.includes(x) && x !== s.id) && a.status !== 'cancelled')
          const mine = list.filter((a) => (a.staffIds || []).includes(s.id) && (a.type === 'service' || a.type === 'evaluation') && a.status !== 'cancelled')
          const svcH = mine.reduce((t, a) => t + (a.end - a.start), 0) / 60
          const required = Math.max(1, Math.round(weeksOf(ctx.days) / 4.3))
          const minPct = sv.length && svcH ? Math.round(((sv.length * 60) / svcH) * 100) : 0
          const last = sv.sort((a, b) => (a.date < b.date ? 1 : -1))[0]
          const status = !mine.length ? 'No caseload' : sv.length < required ? 'Below cadence' : minPct < 5 ? 'Under 5% of hours' : 'Compliant'
          return { rbt: s.name, role: s.role, caseloadH: r1(svcH), supCount: sv.length, required, supMinPct: minPct, lastSup: last?.date || '—', status, _link: { kind: 'staff', id: s.id } }
        })
        .sort((a, b) => (b.status === 'Compliant') - (a.status === 'Compliant') || a.supCount - b.supCount)
      return {
        columns: [
          { k: 'rbt', label: 'Technician' }, { k: 'role', label: 'Role' }, { k: 'caseloadH', label: 'Direct h', t: 'hrs', ...moneyCell },
          { k: 'supCount', label: 'Sup sessions', t: 'num', ...moneyCell }, { k: 'required', label: 'Required', t: 'num', ...moneyCell },
          { k: 'supMinPct', label: 'Sup % of hours', t: 'pct', ...moneyCell }, { k: 'lastSup', label: 'Last supervision' }, { k: 'status', label: 'Status' },
        ],
        rows,
        summary: [
          { label: 'Compliant', value: rows.filter((r) => r.status === 'Compliant').length },
          { label: 'Below cadence', value: rows.filter((r) => r.status === 'Below cadence').length },
          { label: 'Under BACB 5%', value: rows.filter((r) => r.supMinPct < 5 && r.caseloadH > 0).length },
        ],
      }
    },
  },
  {
    id: 'documentation', cat: 'clinical', name: 'Documentation & Verification', icon: 'file',
    blurb: 'Session notes, attachments and sign-off completeness per staff member.',
    build(state, ctx) {
      const list = scoped(state, ctx.days, ctx.scope).filter((a) => a.status === 'completed' && (a.type === 'service' || a.type === 'evaluation'))
      const agg = {}
      for (const a of list) {
        for (const s of a.staffIds || []) {
          const g = (agg[s] = agg[s] || { done: 0, noted: 0, docs: 0, verified: 0, overdue: 0 })
          g.done++
          if (a.notes) g.noted++
          if (a.documents?.length) g.docs++
          if (a.verification?.verifyStatus === 'verified') g.verified++
          else if (a.verification?.verifyStatus === 'flagged' || !a.verification) g.overdue++
        }
      }
      const rows = state.staff
        .filter((s) => agg[s.id])
        .map((s) => {
          const g = agg[s.id]
          return { staff: s.name, role: s.role, done: g.done, notePct: Math.round((g.noted / g.done) * 100), docsPct: Math.round((g.docs / g.done) * 100), verifiedPct: Math.round((g.verified / Math.max(1, g.done)) * 100), open: g.overdue, _link: { kind: 'staff', id: s.id } }
        })
        .sort((a, b) => a.verifiedPct - b.verifiedPct)
      const t = list.length
      return {
        columns: [
          { k: 'staff', label: 'Staff' }, { k: 'role', label: 'Role' }, { k: 'done', label: 'Completed', t: 'num', ...moneyCell },
          { k: 'notePct', label: 'Notes %', t: 'pct', ...moneyCell }, { k: 'docsPct', label: 'Attachments %', t: 'pct', ...moneyCell },
          { k: 'verifiedPct', label: 'Verified %', t: 'pct', ...moneyCell }, { k: 'open', label: 'Open / flagged', t: 'num', ...moneyCell },
        ],
        rows,
        summary: [
          { label: 'Completed sessions', value: t },
          { label: 'With note', value: `${t ? Math.round((list.filter((a) => a.notes).length / t) * 100) : 0}%` },
          { label: 'Verified', value: `${t ? Math.round((list.filter((a) => a.verification?.verifyStatus === 'verified').length / t) * 100) : 0}%` },
        ],
      }
    },
  },

  // ---------- Billing & claims ----------
  {
    id: 'claimready', cat: 'billing', name: 'Claim-Ready Lines', icon: 'dollar',
    blurb: 'Completed, verified, unit-correct lines ready to submit right now.',
    build(state, ctx) {
      const clients = byIdMap(state.clients)
      const staff = byIdMap(state.staff)
      const needVer = state.settings.billing?.requireVerification !== false
      const rows = scoped(state, ctx.days, ctx.scope)
        .filter((a) => TYPES[a.type]?.billable && a.status === 'completed' && !a.billing?.status)
        .filter((a) => (a.billing?.units || 0) > 0 && (a.billing?.rate || 0) > 0)
        .filter((a) => !needVer || !TYPES[a.type].hasVerification || a.verification?.verifyStatus === 'verified')
        .map((a) => ({
          date: a.date, client: firstClient(a, clients), payer: clients[a.clientIds?.[0]]?.insurer || 'Self-pay',
          code: a.billing?.code || '—', units: a.billing?.units || 0, rate: a.billing?.rate || 0, charge: r2(computeBilling(a)),
          staff: namesOf(a.staffIds, staff), _link: { kind: 'appt', id: a.id, date: a.date },
        }))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
      const total = Math.round(rows.reduce((t, r) => t + r.charge, 0))
      return {
        columns: [
          { k: 'date', label: 'DOS' }, { k: 'client', label: 'Client' }, { k: 'payer', label: 'Payer' }, { k: 'code', label: 'Code' },
          { k: 'units', label: 'Units', t: 'num', ...moneyCell }, { k: 'rate', label: 'Rate $', t: 'money', ...moneyCell },
          { k: 'charge', label: 'Charge $', t: 'money', ...moneyCell }, { k: 'staff', label: 'Rendered by' },
        ],
        rows,
        summary: [
          { label: 'Lines ready', value: rows.length },
          { label: 'Total charges', value: `$${total.toLocaleString()}` },
          { label: 'Distinct clients', value: new Set(rows.map((r) => r.client)).size },
        ],
        note: 'Blocked lines are intentionally excluded — see the Blocked Claims report for what needs fixing first.',
      }
    },
  },
  {
    id: 'blocked', cat: 'billing', name: 'Blocked Claims & Fixes', icon: 'ban',
    blurb: 'Completed billable sessions that cannot be billed yet, with the exact fix.',
    build(state, ctx) {
      const clients = byIdMap(state.clients)
      const staff = byIdMap(state.staff)
      const needVer = state.settings.billing?.requireVerification !== false
      const rows = []
      for (const a of scoped(state, ctx.days, ctx.scope)) {
        if (!TYPES[a.type]?.billable || a.status !== 'completed') continue
        if (a.billing?.status === 'billed') continue
        const issues = []
        if (!(a.billing?.units > 0)) issues.push('Missing billable units')
        if (a.billing && !(a.billing.rate > 0) && !a.billing.mileage) issues.push('Unit rate is $0')
        if (!a.billing) issues.push('No billing line attached')
        if (needVer && TYPES[a.type].hasVerification && a.verification?.verifyStatus !== 'verified') issues.push(a.verification ? `Verification ${a.verification.verifyStatus}` : 'Session not verified')
        if (!issues.length) continue
        const code = BILL_CODES.find((c) => c.id === a.billing?.code) || BILL_CODES[0]
        const estCharge = r2(((a.end - a.start) / code.unitMins) * (a.billing?.rate || code.rate))
        rows.push({
          date: a.date, client: firstClient(a, clients), staff: namesOf(a.staffIds, staff), type: TYPES[a.type].label,
          issues: issues.join(' · '), fix: issues.includes('Missing billable units') ? `Auto-fill ${r2((a.end - a.start) / code.unitMins)} units @ ${code.id}` : issues.some((i) => i.startsWith('Verification') || i === 'Session not verified') ? 'Open session → verify & sign' : 'Set rate in billing tab',
          estCharge, _link: { kind: 'appt', id: a.id, date: a.date },
        })
      }
      rows.sort((a, b) => b.estCharge - a.estCharge)
      return {
        columns: [
          { k: 'date', label: 'DOS' }, { k: 'client', label: 'Client' }, { k: 'staff', label: 'Staff' }, { k: 'type', label: 'Type' },
          { k: 'issues', label: 'Why blocked' }, { k: 'fix', label: 'Suggested fix' }, { k: 'estCharge', label: 'Value $', t: 'money', ...moneyCell },
        ],
        rows,
        summary: [
          { label: 'Blocked lines', value: rows.length },
          { label: 'Value held back', value: `$${Math.round(rows.reduce((t, r) => t + r.estCharge, 0)).toLocaleString()}` },
        ],
      }
    },
  },
  {
    id: 'revenueCode', cat: 'billing', name: 'Revenue by Code × Bucket', icon: 'dollar',
    blurb: 'CPT-level revenue rolled up per day/week/month — mix shifts and rate sanity.',
    build(state, ctx) {
      const buckets = ctx.buckets
      const rows = []
      for (const b of buckets) {
        const acc = {}
        for (const a of scoped(state, b.days, ctx.scope)) {
          if (!TYPES[a.type]?.billable || !a.billing || a.status === 'cancelled') continue
          const k = a.billing.code || 'other'
          const g = (acc[k] = acc[k] || { charge: 0, units: 0, lines: 0 })
          g.charge += computeBilling(a)
          g.units += Number(a.billing.units) || 0
          g.lines++
        }
        const tot = Object.values(acc).reduce((t, g) => t + g.charge, 0)
        for (const [code, g] of Object.entries(acc).sort((x, y) => y[1].charge - x[1].charge)) {
          rows.push({ bucket: b.label, code, desc: BILL_CODES.find((c) => c.id === code)?.label.split(' · ')[1] || 'Mileage / misc', lines: g.lines, units: r2(g.units), charge: Math.round(g.charge), share: tot ? Math.round((g.charge / tot) * 100) : 0 })
        }
      }
      const total = Math.round(rows.reduce((t, r) => t + r.charge, 0))
      return {
        columns: [
          { k: 'bucket', label: 'Period' }, { k: 'code', label: 'Code' }, { k: 'desc', label: 'Description' },
          { k: 'lines', label: 'Lines', t: 'num', ...moneyCell }, { k: 'units', label: 'Units', t: 'num', ...moneyCell },
          { k: 'charge', label: 'Charge $', t: 'money', ...moneyCell }, { k: 'share', label: 'Share %', t: 'pct', ...moneyCell },
        ],
        rows,
        summary: [{ label: 'Periods', value: buckets.length }, { label: 'Total revenue', value: `$${total.toLocaleString()}` }],
      }
    },
  },
  {
    id: 'claims', cat: 'billing', name: 'Claims Register', icon: 'file',
    blurb: 'Every claim form with lifecycle status, aging, adjustments and remittance outcome.',
    build(state, ctx) {
      const clients = byIdMap(state.clients)
      const all = Object.values(state.claims || {})
      const inWin = all.filter((c) => c.lines.some((l) => ctx.days.includes(l.dos)))
      const rows = inWin
        .map((c) => {
          const age = agingOf(c)
          const due = dueOf(c)
          return {
            no: c.no, client: clients[c.clientId]?.name || '—', payer: c.payer,
            period: c.dosFrom === c.dosTo ? c.dosFrom : `${c.dosFrom.slice(5)}–${c.dosTo.slice(5)}`,
            lines: c.lines.length, units: c.units, charges: r2(c.charges), adj: r2(c.adj || 0), paid: r2(c.paid || 0),
            due: r2(due), status: c.status, age: age ? age.days : null, check: c.remittance?.checkNo || (c.denial ? `denied: ${c.denial.code}` : ''),
            _link: null,
          }
        })
        .sort((a, b) => (a.age == null ? -1 : b.age == null ? 1 : b.age - a.age) || b.due - a.due)
      const money = (f) => Math.round(inWin.filter((c) => c.status === f).reduce((t, c) => t + c.charges, 0))
      const outstanding = Math.round(inWin.reduce((t, c) => t + Math.max(0, dueOf(c)), 0))
      return {
        columns: [
          { k: 'no', label: 'Claim' }, { k: 'client', label: 'Client' }, { k: 'payer', label: 'Payer' }, { k: 'period', label: 'DOS' },
          { k: 'lines', label: 'Lines', t: 'num', ...moneyCell }, { k: 'units', label: 'Units', t: 'num', ...moneyCell },
          { k: 'charges', label: 'Charges $', t: 'money', ...moneyCell }, { k: 'adj', label: 'Adj $', t: 'money', ...moneyCell },
          { k: 'paid', label: 'Paid $', t: 'money', ...moneyCell }, { k: 'due', label: 'Due $', t: 'money', ...moneyCell },
          { k: 'status', label: 'Status' }, { k: 'age', label: 'Days out', t: 'num', ...moneyCell }, { k: 'check', label: 'Check / denial' },
        ],
        rows,
        summary: [
          { label: 'Claims', value: rows.length },
          { label: 'Outstanding', value: `$${outstanding.toLocaleString()}` },
          { label: 'Awaiting payer', value: `$${money('submitted').toLocaleString()}` },
          { label: 'Denied', value: `$${money('denied').toLocaleString()}` },
        ],
        note: 'Open the Billing desk to post payments or rebill; numbers here derive from the same claim store.',
      }
    },
  },
  {
    id: 'payer', cat: 'billing', name: 'Payer Mix & Billing Status', icon: 'building',
    blurb: 'Revenue split by insurer / self-pay, plus what is still unsubmitted per payer.',
    build(state, ctx) {
      const clients = byIdMap(state.clients)
      const acc = {}
      let total = 0
      for (const a of scoped(state, ctx.days, ctx.scope)) {
        if (!TYPES[a.type]?.billable || !a.billing || a.status === 'cancelled') continue
        const payer = a.clientIds?.map((c) => clients[c]?.insurer || 'Self-pay')[0] || 'Direct / other'
        const charge = computeBilling(a) / Math.max(1, (a.clientIds || []).length || 1)
        const g = (acc[payer] = acc[payer] || { clients: new Set(), sessions: 0, hours: 0, charge: 0, unbilled: 0 })
        g.charge += charge
        a.clientIds?.forEach((c) => g.clients.add(c))
        if (a.type === 'service' || a.type === 'evaluation') {
          g.sessions++
          g.hours += (a.end - a.start) / 60
        }
        if (a.status === 'completed' && !a.billing.status) g.unbilled += charge
      }
      total = Object.values(acc).reduce((t, g) => t + g.charge, 0)
      const rows = Object.entries(acc)
        .map(([payer, g]) => ({ payer, clients: g.clients.size, sessions: g.sessions, hours: r1(g.hours), charge: Math.round(g.charge), share: total ? Math.round((g.charge / total) * 100) : 0, unbilled: Math.round(g.unbilled) }))
        .sort((a, b) => b.charge - a.charge)
      return {
        columns: [
          { k: 'payer', label: 'Payer' }, { k: 'clients', label: 'Clients', t: 'num', ...moneyCell }, { k: 'sessions', label: 'Sessions', t: 'num', ...moneyCell },
          { k: 'hours', label: 'Hours', t: 'hrs', ...moneyCell }, { k: 'charge', label: 'Charges $', t: 'money', ...moneyCell },
          { k: 'share', label: 'Mix %', t: 'pct', ...moneyCell }, { k: 'unbilled', label: 'Unbilled $', t: 'money', ...moneyCell },
        ],
        rows,
        summary: [
          { label: 'Payers active', value: rows.length },
          { label: 'Self-pay exposure', value: `$${(rows.find((r) => /Self/i.test(r.payer))?.charge || 0).toLocaleString()}` },
          { label: 'Unbilled total', value: `$${Math.round(rows.reduce((t, r) => t + r.unbilled, 0)).toLocaleString()}` },
        ],
      }
    },
  },

  // ---------- People & payroll ----------
  {
    id: 'payroll', cat: 'people', name: 'Payroll & Session Hours', icon: 'team',
    blurb: 'Hours by category, mileage and estimated labor cost vs revenue per staff.',
    build(state, ctx) {
      const list = scoped(state, ctx.days, ctx.scope)
      const agg = {}
      for (const a of list) {
        if (a.status === 'cancelled') continue
        for (const s of a.staffIds || []) {
          const g = (agg[s] = agg[s] || { sess: 0, sup: 0, drive: 0, miles: 0, rev: 0, blocks: 0 })
          if (a.type === 'service' || a.type === 'evaluation') g.sess += a.end - a.start
          else if (a.type === 'supervision') g.sup += a.end - a.start
          else if (a.type === 'drive') {
            g.drive += a.end - a.start
            if (a.billing?.mileage) g.miles += Number(a.billing.distance) || 0
          }
          if (TYPES[a.type]?.billable && a.billing) g.rev += computeBilling(a) / Math.max(1, (a.staffIds || []).length)
          g.blocks++
        }
      }
      const rows = state.staff
        .filter((s) => !ctx.scope?.staff || ctx.scope.staff === s.id)
        .map((s) => {
          const g = agg[s.id] || { sess: 0, sup: 0, drive: 0, miles: 0, rev: 0, blocks: 0 }
          const hours = r1((g.sess + g.sup + g.drive) / 60)
          const cost = Math.round(hours * (s.payrollRate || 25))
          const rev = Math.round(g.rev)
          return { staff: s.name, role: s.role, blocks: g.blocks, sessH: h10(g.sess), supH: h10(g.sup), driveH: h10(g.drive), miles: Math.round(g.miles), hours, rate: s.payrollRate || 25, cost, revenue: rev, margin: rev - cost, marginPct: rev ? Math.round(((rev - cost) / rev) * 100) : 0, _link: { kind: 'staff', id: s.id } }
        })
        .sort((a, b) => b.hours - a.hours)
      const tot = rows.reduce((t, r) => ({ cost: t.cost + r.cost, rev: t.rev + r.revenue }), { cost: 0, rev: 0 })
      return {
        columns: [
          { k: 'staff', label: 'Staff' }, { k: 'role', label: 'Role' }, { k: 'blocks', label: 'Appts', t: 'num', ...moneyCell },
          { k: 'sessH', label: 'Session h', t: 'hrs', ...moneyCell }, { k: 'supH', label: 'Sup h', t: 'hrs', ...moneyCell },
          { k: 'driveH', label: 'Drive h', t: 'hrs', ...moneyCell }, { k: 'miles', label: 'Miles', t: 'num', ...moneyCell },
          { k: 'hours', label: 'Total h', t: 'hrs', ...moneyCell }, { k: 'rate', label: 'Rate $/h', t: 'money', ...moneyCell },
          { k: 'cost', label: 'Cost $', t: 'money', ...moneyCell }, { k: 'revenue', label: 'Revenue $', t: 'money', ...moneyCell },
          { k: 'margin', label: 'Margin $', t: 'money', ...moneyCell }, { k: 'marginPct', label: 'Margin %', t: 'pct', ...moneyCell },
        ],
        rows,
        summary: [
          { label: 'Total labor cost', value: `$${tot.cost.toLocaleString()}` },
          { label: 'Attributed revenue', value: `$${tot.rev.toLocaleString()}` },
          { label: 'Net margin', value: tot.rev ? `${Math.round(((tot.rev - tot.cost) / tot.rev) * 100)}%` : '—' },
        ],
      }
    },
  },

  // ---------- Data quality ----------
  {
    id: 'quality', cat: 'quality', name: 'Data Quality & Validations', icon: 'checkCircle',
    blurb: 'Live cross-module validations: billing completeness, auth overruns, supervision gaps, double-books.',
    build(state, ctx) {
      const issues = validationIssues(state, ctx.days, ctx.scope)
      const rows = issues.map((i) => ({ sev: i.sev, cat: i.cat, message: i.msg, who: i.who, date: i.date || '—', fix: i.fix, _link: i.link }))
      return {
        columns: [
          { k: 'sev', label: 'Severity' }, { k: 'cat', label: 'Area' }, { k: 'message', label: 'Issue' },
          { k: 'who', label: 'Entity' }, { k: 'date', label: 'When' }, { k: 'fix', label: 'Suggested action' },
        ],
        rows,
        summary: [
          { label: 'Errors', value: rows.filter((r) => r.sev === 'error').length },
          { label: 'Warnings', value: rows.filter((r) => r.sev === 'warn').length },
          { label: 'Notices', value: rows.filter((r) => r.sev === 'notice').length },
          { label: 'Fixable in one click', value: rows.filter((r) => r.fix.startsWith('Auto')).length },
        ],
        note: rows.length ? 'Click any row to jump straight to the record — the same validations run live in the appointment wizard.' : undefined,
      }
    },
  },
]

// all dates present in the ledger (used by full-history reports like re-assessment cadence)
function allDays(state) {
  return [...new Set(Object.values(state.appts).map((a) => a.date))].sort()
}

// ====================================================================
//  Validations — shared by the Reports quality page, Billing section & KPI badges
// ====================================================================
export function validationIssues(state, days, scope) {
  const issues = []
  const push = (sev, cat, msg, who, fix, link, date) => issues.push({ id: `v${issues.length}`, sev, cat, msg, who, fix, link, date })
  const clients = byIdMap(state.clients)
  const staff = byIdMap(state.staff)
  const today = todayISO()
  const list = days ? rawList(state, days) : allApptsList(state)
  const scopedList = list.filter((a) => inScope(a, scope, state))

  for (const a of scopedList) {
    const who = a.clientIds?.map((c) => clients[c]?.name).join(', ') || '—'
    if (a.status === 'completed' && TYPES[a.type]?.billable) {
      if (!a.billing) push('error', 'Billing', `Completed ${TYPES[a.type].label.toLowerCase()} has no billing line`, who, 'Open the session → Billing tab → add units', { kind: 'appt', id: a.id, date: a.date }, a.date)
      else {
        if (!(a.billing.units > 0)) push('error', 'Billing', `${TYPES[a.type].label} completed with 0 billable units`, who, `Auto-fill ${r2((a.end - a.start) / (a.billing.unitMins || 30))} units`, { kind: 'appt', id: a.id, date: a.date }, a.date)
        if (!(a.billing.rate > 0) && !a.billing.mileage) push('error', 'Billing', `Unit rate is $0 — claim would pay nothing`, who, 'Set rate from code table', { kind: 'appt', id: a.id, date: a.date }, a.date)
      }
      if (TYPES[a.type].hasVerification && a.verification?.verifyStatus !== 'verified') {
        push(a.verification?.verifyStatus === 'flagged' ? 'error' : 'warn', 'Verification', a.verification ? 'Session verification flagged — cannot bill' : 'Session completed but not verified/signed', who, 'Open session → Verify & sign', { kind: 'appt', id: a.id, date: a.date }, a.date)
      }
    }
    if (overlapsType(a) && a.status !== 'cancelled' && !(a.staffIds || []).length) push('error', 'Scheduling', 'Appointment occupies time but has no staff assigned', who, 'Assign staff (suggestions available)', { kind: 'appt', id: a.id, date: a.date }, a.date)
    if ((a.type === 'service' || a.type === 'evaluation') && !(a.clientIds || []).length) push('error', 'Scheduling', 'Clinical session has no client attached', namesOf(a.staffIds, staff) || '—', 'Add the client', { kind: 'appt', id: a.id, date: a.date }, a.date)
    if (a.type === 'drive' && a.billing?.mileage && !(a.billing.distance > 0)) push('warn', 'Billing', 'Mileage claim without distance', who, 'Enter miles driven', { kind: 'appt', id: a.id, date: a.date }, a.date)
    if (a.type === 'service' && a.status === 'completed' && !a.notes) push('notice', 'Documentation', 'No session note captured', who, 'Add a note before payer audit', { kind: 'appt', id: a.id, date: a.date }, a.date)
  }

  // double-book detection (same day only, cheap pass).
  // • real clashes (two client-facing rows on one person) → error, grouped per staff-day
  // • seeded PTO/training blocks overlapping existing sessions → one aggregated notice per staff-day
  const byDate = {}
  for (const a of scopedList) if (a.status !== 'cancelled' && overlapsType(a)) (byDate[a.date] = byDate[a.date] || []).push(a)
  const clashAgg = new Map()
  const ptoAgg = new Map()
  for (const d of Object.keys(byDate)) {
    const arr = byDate[d]
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]
        const b = arr[j]
        if (!(a.start < b.end && b.start < a.end)) continue
        const sharedC = (a.clientIds || []).filter((c) => (b.clientIds || []).includes(c))
        if (sharedC.length) push('error', 'Scheduling', `Client in two places at once on ${fmtD(d)}`, clients[sharedC[0]]?.name || '—', 'Move one session', { kind: 'appt', id: a.id, date: d }, d)
        const shared = (a.staffIds || []).filter((s) => (b.staffIds || []).includes(s))
        if (!shared.length) continue
        const busyPair = (x) => x.type !== 'unavailable'
        if (busyPair(a) && busyPair(b)) {
          const k = `${shared[0]}|${d}`
          const g = clashAgg.get(k) || { n: 0, date: d, staff: shared[0], appt: a }
          g.n++
          clashAgg.set(k, g)
        } else {
          const busy = a.type === 'unavailable' ? b : a
          const block = a.type === 'unavailable' ? a : b
          const who = (busy.staffIds || [])[0]
          if (!who) continue
          const k = `${who}|${d}`
          const g = ptoAgg.get(k) || { n: 0, date: d, staff: who, appt: busy.id, title: block.title }
          g.n++
          ptoAgg.set(k, g)
        }
      }
    }
  }
  for (const g of clashAgg.values()) push('error', 'Scheduling', `Double-booked staff: ${g.n > 1 ? `${g.n} overlapping appointments` : 'two overlapping appointments'} on ${fmtD(g.date)}`, staff[g.staff]?.name || '—', 'Resolve on the calendar — suggestions will re-offer the slot', { kind: 'staff', id: g.staff, date: g.date }, g.date)
  for (const g of ptoAgg.values()) push('warn', 'Scheduling', `${g.n} session(s) overlap “${g.title}” on ${fmtD(g.date)} — historical clash, import-time`, staff[g.staff]?.name || '—', 'Reassign to a float or cancel', { kind: 'appt', id: g.appt, date: g.date }, g.date)

  // client-side: auth pace + expiry (uses last 7 days)
  const last7 = Array.from({ length: 7 }, (_, i) => isoDate(addDays(parseISO(today), i - 6)))
  for (const c of state.clients) {
    if (scope?.client && scope.client !== c.id) continue
    const hrs = rawList(state, last7).filter((a) => (a.clientIds || []).includes(c.id) && (a.type === 'service' || a.type === 'evaluation') && a.status !== 'cancelled').reduce((t, a) => t + (a.end - a.start), 0) / 60
    if (c.authWeekly && hrs > c.authWeekly * 1.05) push('warn', 'Authorization', `Over authorized weekly hours (${r1(hrs)}h of ${c.authWeekly}h)`, c.name, 'Throttle scheduling or request auth increase', { kind: 'client', id: c.id }, last7[6])
    if (c.authEnd) {
      const left = daysBetween(today, c.authEnd)
      if (left < 0) push('error', 'Authorization', `Authorization lapsed on ${fmtD(c.authEnd)}`, c.name, 'Renew auth before booking', { kind: 'client', id: c.id }, c.authEnd)
      else if (left <= 30) push('warn', 'Authorization', `Authorization expires in ${left}d (${fmtD(c.authEnd)})`, c.name, 'Request re-authorization now', { kind: 'client', id: c.id }, c.authEnd)
    }
  }

  // staff-side: students must ride with a supervisor; RBTs need monthly supervision
  const sups = state.staff.filter((s) => /BCBA|BCaBA/.test(s.role || '')).map((x) => x.id)
  const range30 = Array.from({ length: 30 }, (_, i) => isoDate(addDays(parseISO(today), i - 29)))
  const l30 = rawList(state, range30)
  for (const s of state.staff) {
    if (scope?.staff && scope.staff !== s.id) continue
    if (/Student|trainee/i.test(s.cert || '') || /Student/i.test(s.role || '')) {
      const alone = l30.filter((a) => (a.staffIds || []).includes(s.id) && a.type === 'service' && a.status !== 'cancelled' && !(a.staffIds || []).some((x) => sups.includes(x) && x !== s.id))
      if (alone.length) push('warn', 'Supervision', `${alone.length} student-therapist session(s) without an on-site supervisor`, s.name, 'Add supervising BCBA to the appointment', { kind: 'appt', id: alone[alone.length - 1].id, date: alone[alone.length - 1].date }, alone[alone.length - 1].date)
    }
    if (/RBT/i.test(s.role || '')) {
      const supCount = l30.filter((a) => a.type === 'supervision' && (a.staffIds || []).includes(s.id) && a.status !== 'cancelled').length
      if (supCount === 0 && l30.some((a) => (a.staffIds || []).includes(s.id) && a.type === 'service')) push('warn', 'Supervision', 'No supervision recorded in the last 30 days', s.name, 'Schedule BCBA supervision', { kind: 'staff', id: s.id }, today)
    }
  }

  const order = { error: 0, warn: 1, notice: 2 }
  return issues.sort((a, b) => order[a.sev] - order[b.sev] || (a.date > b.date ? -1 : 1)).slice(0, 400)
}
const allApptsList = (state) => Object.values(state.appts)

// ====================================================================
export const REPORTS = REPORTS_RAW
export const REPORT_BY_ID = Object.fromEntries(REPORTS.map((r) => [r.id, r]))

export function runReport(state, id, ctx) {
  const def = REPORT_BY_ID[id]
  if (!def) return { columns: [], rows: [], summary: [], note: 'Unknown report' }
  const t0 = Date.now()
  const out = def.build(state, ctx)
  return { ...out, def, ms: Date.now() - t0 }
}

const esc = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCSV(result, meta) {
  const head = [
    `# ${meta.org?.name || 'Aloha ABA'} — ${meta.def.name}`,
    `# Range: ${meta.days[0]} → ${meta.days[meta.days.length - 1]} (${meta.days.length} days, bucket: ${meta.gran})`,
    `# Scope: ${meta.scopeLabel || 'All records'}`,
    `# Generated: ${new Date().toISOString()}`,
  ]
  const cols = result.columns.map((c) => esc(c.label)).join(',')
  const rows = result.rows.map((r) => result.columns.map((c) => esc(typeof r[c.k] === 'number' ? r2(r[c.k]) : r[c.k])).join(','))
  return [...head, cols, ...rows].join('\n')
}
