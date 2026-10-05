// ---- Demo records for a fresh workspace: Cabinet documents, CEU/PDU log, tasks, messages ----
// Fictional, like the rest of the seed. Every record is built by the same planner the
// screens use, so it passes the same validation. Dates are relative to today, so the
// Cabinet alerts, the Credentials report and the Inbox always have something to show.
import { planCabinetDoc } from './cabinet'
import { planPduEntry } from './credentials'
import { planTask } from './tasks'
import { planMessage } from './messages'
import { addDays, isoDate, parseISO } from './date'

const HOUR = 3600000

export function seedRecords(state, today) {
  const day = (n) => isoDate(addDays(parseISO(today), n))
  const ms = (n, h = 9) => parseISO(day(n)).getTime() + h * HOUR
  const has = (id) => (state.staff || []).some((s) => s.id === id)
  const build = (rows, plan) => {
    const out = {}
    for (const [id, input, at] of rows) {
      const r = plan(state, input, { id, at })
      if (r.ok) out[id] = r.item
    }
    return out
  }

  const client0 = state.clients?.[0]
  const cabinet = build([
    ['demo-cab-1', { title: 'BCBA certification', category: 'Credential / certification', ownerKind: 'staff', ownerId: 's1', issuedOn: day(-330), expiresOn: day(400), reference: 'BCBA #5-12-0034' }, ms(-330)],
    ['demo-cab-2', { title: 'BCBA certification', category: 'Credential / certification', ownerKind: 'staff', ownerId: 's8', issuedOn: day(-709), expiresOn: day(21), reference: 'BCBA #5-14-0788', notes: 'CEUs logged; renewal application not yet filed.' }, ms(-709)],
    ['demo-cab-3', { title: 'RBT certification', category: 'Credential / certification', ownerKind: 'staff', ownerId: 's3', issuedOn: day(-215), expiresOn: day(150), reference: 'RBT #24-08-1177' }, ms(-215)],
    ['demo-cab-4', { title: 'RBT certification', category: 'Credential / certification', ownerKind: 'staff', ownerId: 's4', issuedOn: day(-370), expiresOn: day(-5), reference: 'RBT #23-11-0450', notes: 'Renewal submitted; waiting on the new certificate.' }, ms(-370)],
    ['demo-cab-5', { title: 'CPR and first aid card', category: 'CPR / first aid', ownerKind: 'staff', ownerId: 's10', issuedOn: day(-718), expiresOn: day(12) }, ms(-718)],
    ['demo-cab-6', { title: 'Background check (Live Scan)', category: 'Background check', ownerKind: 'staff', ownerId: 's7', issuedOn: day(-300), expiresOn: day(65) }, ms(-300)],
    ['demo-cab-7', { title: 'Professional liability insurance', category: 'Liability insurance', ownerKind: 'practice', issuedOn: day(-165), expiresOn: day(200), reference: 'Policy PL-000000 (demo)' }, ms(-165)],
    ...(client0 ? [['demo-cab-8', { title: 'Consent for treatment', category: 'Client consent', ownerKind: 'client', ownerId: client0.id, issuedOn: day(-275), expiresOn: day(90) }, ms(-275)]] : []),
  ].filter(([, i]) => i.ownerKind !== 'staff' || has(i.ownerId)), planCabinetDoc)

  const pdus = build([
    ['demo-pdu-1', { staffId: 's1', kind: 'ceu', date: day(-300), hours: 8, title: 'Supervision training (8-hour)', provider: 'Demo CE provider' }, ms(-300)],
    ['demo-pdu-2', { staffId: 's1', kind: 'ceu', date: day(-120), hours: 4, title: 'Ethics in supervision', provider: 'Demo CE provider' }, ms(-120)],
    ['demo-pdu-3', { staffId: 's8', kind: 'ceu', date: day(-60), hours: 6, title: 'Functional analysis workshop', provider: 'Demo CE provider' }, ms(-60)],
    ['demo-pdu-4', { staffId: 's3', kind: 'competency', date: day(-200), title: 'RBT Competency Assessment', provider: 'In-house BCBA' }, ms(-200)],
    ['demo-pdu-5', { staffId: 's3', kind: 'pdu', date: day(-40), hours: 3, title: 'Trauma-informed care', provider: 'In-house training' }, ms(-40)],
    ['demo-pdu-6', { staffId: 's4', kind: 'pdu', date: day(-90), hours: 2, title: 'Data collection refresher', provider: 'In-house training' }, ms(-90)],
    ['demo-pdu-7', { staffId: 's10', kind: 'competency', date: day(-30), title: 'RBT Competency Assessment', provider: 'In-house BCBA' }, ms(-30)],
    ['demo-pdu-8', { staffId: 's10', kind: 'pdu', date: day(-15), hours: 6, title: 'Crisis prevention and de-escalation', provider: 'In-house training' }, ms(-15)],
  ].filter(([, i]) => has(i.staffId)), planPduEntry)

  const denied = Object.values(state.claims || {}).find((c) => c.status === 'denied')
  const openIntake = Object.values(state.intakeRequests || {}).find((r) => !['converted', 'closed'].includes(r.stage))
  const tasks = build([
    ['demo-task-1', { title: 'Call the family about the authorization renewal', assigneeId: 's12', dueOn: day(-1), priority: 'high', link: client0 ? { kind: 'client', id: client0.id } : null }, ms(-4)],
    ['demo-task-2', { title: 'Send the records the payer asked for and resubmit', assigneeId: 's12', dueOn: day(0), link: denied ? { kind: 'claim', id: denied.id } : null }, ms(-2)],
    ['demo-task-3', { title: 'Upload the renewed RBT certificate to the Cabinet', assigneeId: 's4', dueOn: day(-2), priority: 'high' }, ms(-6)],
    ['demo-task-4', { title: 'Review the treatment plan update before the parent meeting', assigneeId: 's1', dueOn: day(3) }, ms(-1)],
    ['demo-task-5', { title: 'Chase the missing diagnostic report', assigneeId: 's9', dueOn: day(1), link: openIntake ? { kind: 'intake', id: openIntake.id } : null }, ms(-3)],
  ].filter(([, i]) => has(i.assigneeId)), planTask)

  // Messages build on each other (a reply needs its thread), so they are planned one by one.
  const messages = {}
  const say = (id, from, input, at) => {
    const r = planMessage({ ...state, messages }, input, { id, at, from })
    if (r.ok) messages[id] = r.item
  }
  say('demo-msg-1', 'account-s12', { toIds: ['account-demo-admin'], subject: 'Denied claim: records request', body: 'The payer wants session notes for the denied claim. I have added a task for today and will resubmit once the notes are attached.' }, ms(-1, 15))
  say('demo-msg-2', 'account-demo-admin', { toIds: ['account-s1'], subject: 'Supervision schedule for next month', body: 'Can you confirm the supervision blocks for your RBTs next month? Two of them are close to the 5% minimum.' }, ms(-2, 11))
  say('demo-msg-3', 'account-s1', { threadId: 'demo-msg-2', body: 'Yes. I will add the blocks to the calendar by Friday.' }, ms(-1, 10))

  return { cabinet, pdus, tasks, messages }
}
