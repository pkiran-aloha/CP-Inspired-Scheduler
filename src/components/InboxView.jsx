import React, { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { todayISO } from '../lib/date'
import { currentAccount } from '../lib/security'
import { TASK_PRIORITIES, linkLabel, notificationsFor, openTasksFor, taskState } from '../lib/tasks'

const TONE = { stop: 'tone-stop', warn: 'tone-warn', flag: 'tone-flag' }
const DUE = { overdue: 'Overdue', today: 'Due today', upcoming: 'Due', none: 'No due date', done: 'Done' }

/** Inbox: in-app notifications read from the workspace, and tasks assigned to staff. Nothing leaves this device. */
export default function InboxView({ onClose }) {
  const state = useStore()
  const { actions, staff = [], clients = [] } = state
  const toast = useToast()
  const today = todayISO()
  const me = currentAccount(state)?.staffId || null
  const [tab, setTab] = useState('notifications')
  const [scope, setScope] = useState(me ? 'mine' : 'all')
  const blank = { title: '', assigneeId: me || staff[0]?.id || '', dueOn: today, priority: 'normal', clientId: '', notes: '' }
  const [form, setForm] = useState(null)
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const can = (area) => state.canAccess(area, 'view')
  const canClients = can('clients') // client names show only to roles that can open Clients
  const feed = notificationsFor(state, me, today, can)
  const tasks = openTasksFor(state, scope === 'mine' ? me : null, today)
  const say = (res) => toast({ message: res.msg, kind: res.ok ? 'ok' : 'warn' })
  const save = () => {
    const res = actions.saveTask({ ...form, link: form.clientId ? { kind: 'client', id: form.clientId } : null })
    say(res)
    if (res.ok) setForm(null)
  }
  const go = (n) => {
    if (n.go.tab) { setTab(n.go.tab); return }
    actions.setUI({ section: n.go.section, inboxPanel: false })
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="modal" role="dialog" aria-label="Inbox" data-testid="inbox-panel" style={{ position: 'fixed', right: 12, top: 12, bottom: 12, width: 'min(460px, calc(100vw - 24px))', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <b style={{ fontSize: 15 }}>Inbox</b>
          <span className="muted" style={{ fontSize: 11 }}>In this workspace only; nothing is emailed or texted.</span>
          <button className="modal-x" aria-label="Close" data-testid="inbox-close" onClick={onClose} style={{ marginLeft: 'auto' }}>{Icon.x({ size: 14 })}</button>
        </div>
        <div className="viewseg" role="tablist" style={{ margin: '10px 16px 0' }}>
          {[['notifications', `Notifications (${feed.length})`], ['tasks', `Tasks (${openTasksFor(state, me, today).length} mine)`]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} data-testid={`inbox-tab-${k}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
          {tab === 'notifications' && (
            !feed.length ? <div className="muted" data-testid="inbox-clear" style={{ fontSize: 12 }}>Nothing needs you right now.</div> : feed.map((n) => (
              <div key={n.id} data-testid={`inbox-n-${n.id}`} className={`tag ${TONE[n.tone]}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 8, borderRadius: 10, width: '100%' }}>
                <span style={{ flex: 1 }}>{n.text}</span>
                <button className="btn btn-xs" data-testid={`inbox-go-${n.id}`} onClick={() => go(n)}>Open</button>
              </div>
            ))
          )}
          {tab === 'tasks' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <div className="viewseg" role="group" aria-label="Whose tasks">
                  {me && <button className={scope === 'mine' ? 'on' : ''} data-testid="inbox-scope-mine" onClick={() => setScope('mine')}>Mine</button>}
                  <button className={scope === 'all' ? 'on' : ''} data-testid="inbox-scope-all" onClick={() => setScope('all')}>Everyone</button>
                </div>
                <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} data-testid="task-new" onClick={() => setForm(blank)}>{Icon.plus({ size: 12 })} New task</button>
              </div>
              {form && (
                <div className="panel" data-testid="task-form" style={{ padding: 12, borderRadius: 10, border: '1px solid var(--line)', marginBottom: 10, display: 'grid', gap: 8 }}>
                  <label className="iq-fld"><span>Task</span><input className="input" data-testid="task-f-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Call the family about the renewal" /></label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label className="iq-fld"><span>Assign to</span><select className="input" data-testid="task-f-assignee" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                    <label className="iq-fld"><span>Due</span><input className="input" type="date" data-testid="task-f-due" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} /></label>
                    <label className="iq-fld"><span>Priority</span><select className="input" data-testid="task-f-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{TASK_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                    {canClients && <label className="iq-fld"><span>About client (optional)</span><select className="input" data-testid="task-f-client" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">None</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
                  </div>
                  <label className="iq-fld"><span>Notes</span><input className="input" data-testid="task-f-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm" data-testid="task-f-cancel" onClick={() => setForm(null)}>Cancel</button>
                    <button className="btn btn-sm btn-primary" data-testid="task-f-save" onClick={save}>Add task</button>
                  </div>
                </div>
              )}
              {!tasks.length ? <div className="muted" data-testid="task-empty" style={{ fontSize: 12 }}>No open tasks.</div> : tasks.map((t) => {
                const st = taskState(t, today)
                const who = staff.find((s) => s.id === t.assigneeId)?.name || t.assigneeId
                const about = linkLabel(state, t.link, can)
                return (
                  <div key={t.id} data-testid={`task-row-${t.id}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--line)', fontSize: 12 }}>
                    <input type="checkbox" aria-label={`Mark "${t.title}" done`} data-testid={`task-done-${t.id}`} checked={false} onChange={() => say(actions.setTaskDone(t.id, true))} />
                    <div style={{ flex: 1 }}>
                      <b>{t.title}</b>{t.priority === 'high' && <span className="tag tone-warn" style={{ marginLeft: 6 }}>High</span>}
                      <div className="muted">{who}{about ? ` · ${about}` : ''}{t.notes ? ` · ${t.notes}` : ''}</div>
                    </div>
                    <span className={`tag ${st === 'overdue' ? 'tone-stop' : st === 'today' ? 'tone-warn' : ''}`} data-testid={`task-state-${t.id}`}>{DUE[st]}{t.dueOn && st !== 'none' ? ` ${t.dueOn}` : ''}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
