import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { PersonAvatar } from '../ui/avatars'

export default function ProviderIdView() {
  const state = useStore()
  const { providers, actions } = state
  const toast = useToast()
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState('all')
  const [open, setOpen] = useState(null)
  const [form, setForm] = useState({ name: '', npi: '', taxonomy: '', license: '', role: 'BCBA', creds: '' })

  const list = useMemo(() => {
    let out = providers || []
    if (roleF !== 'all') out = out.filter((p) => (p.role || '').toLowerCase() === roleF)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      out = out.filter((p) => `${p.name} ${p.npi} ${p.role} ${p.license}`.toLowerCase().includes(t))
    }
    return out
  }, [providers, roleF, q])

  const kpis = {
    total: (providers || []).length,
    bcba: (providers || []).filter((p) => p.role === 'BCBA').length,
    bt: (providers || []).filter((p) => (p.role || '').includes('BT') || p.role === 'RBT').length,
    missing: (providers || []).filter((p) => !p.npi).length,
  }

  const save = () => {
    if (!form.name || !form.npi) { toast({ message: 'Name and NPI required', kind: 'warn' }); return }
    if (open === 'new') actions.addProvider({ id: `prv_${Date.now()}`, ...form })
    else actions.updateProvider(open, form)
    toast({ message: open === 'new' ? 'Provider added' : 'Provider updated', kind: 'ok' })
    setOpen(null); setForm({ name: '', npi: '', taxonomy: '', license: '', role: 'BCBA', creds: '' })
  }

  return (
    <div className="sectionpage" data-testid="pi-sec" style={{ background: 'var(--bg)' }}>
      <SectionBar icon="shield" title="Provider IDs" sub={`${kpis.total} providers · ${kpis.bcba} BCBA · ${kpis.bt} BT/RBT · ${kpis.missing} missing NPI`}>
        <div className="sb-search" style={{ minWidth: 240, borderRadius: 10 }}>
          <span className="sic">{Icon.search({ size: 12 })}</span>
          <input placeholder="Search name, NPI, license" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pi-search" style={{ fontSize: 13 }} />
        </div>
        <button className="btn btn-sm btn-primary" data-testid="pi-add" onClick={() => { setForm({ name: '', npi: '', taxonomy: '', license: '', role: 'BCBA', creds: '' }); setOpen('new') }} style={{ borderRadius: 10 }}>+ Provider</button>
      </SectionBar>

      <div className="batch-strip" data-testid="pi-kpis" style={{ margin: '16px', padding: '16px', gap: 12, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {[
          ['Total', kpis.total, 'All', '#6366f1', 'pi-kpi-total'],
          ['BCBA', kpis.bcba, 'Board Certified', '#0ea5e9', 'pi-kpi-bcba'],
          ['BT / RBT', kpis.bt, 'Technicians', '#10b981', 'pi-kpi-bt'],
          ['Missing NPI', kpis.missing, 'Needs attention', '#ef4444', 'pi-kpi-missing'],
        ].map(([label, val, sub, color, testId]) => (
          <div key={label} className="rp-sumchip on" data-testid={testId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', minWidth: 140, borderRadius: 12, padding: '12px 16px' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: `${color}14`, color, display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 14 })}</span>
            <div><b style={{ fontSize: 18, fontWeight: 800 }}>{val}</b><span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span></div>
          </div>
        ))}
      </div>

      <div className="batch-strip" style={{ margin: '0 16px 16px', padding: '12px 16px', gap: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="viewseg" style={{ borderRadius: 10, padding: 3 }} data-testid="pi-role-tabs">
          {[
            ['all', 'All roles'],
            ['bcba', 'BCBA'],
            ['rbt', 'RBT'],
            ['bcaba', 'BCaBA'],
          ].map(([id, label]) => (
            <button key={id} className={roleF === id ? 'on' : ''} data-testid={`pi-role-${id}`} onClick={() => setRoleF(id)} style={{ borderRadius: 8, fontSize: 13 }}>{label}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{list.length} providers</span>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="panel" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)' }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f114', color: '#6366f1', display: 'grid', placeItems: 'center' }}>{Icon.shield({ size: 16 })}</span>
            <div><b style={{ fontSize: 14 }}>Provider Roster</b><div className="muted" style={{ fontSize: 12 }}>NPI · Taxonomy · License · Role</div></div>
          </div>
          <div className="py-tbl" data-testid="pi-table" style={{ overflowX: 'auto' }}>
            <div className="py-thead" style={{ gridTemplateColumns: '1.6fr 140px 160px 120px 100px 120px', background: 'var(--panel-2)', fontSize: 11, padding: '12px 16px' }}>
              <span>Provider</span><span>NPI</span><span>Taxonomy</span><span>License</span><span>Role</span><span>Actions</span>
            </div>
            {list.map((p) => (
              <div key={p.id} className="py-trow" data-testid={`pi-row-${p.id}`} style={{ gridTemplateColumns: '1.6fr 140px 160px 120px 100px 120px', minHeight: 56, padding: '12px 16px' }}>
                <div className="py-cell"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><PersonAvatar p={{ name: p.name }} size={28} /><div><b style={{ fontSize: 13 }}>{p.name}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.creds || ''}</div></div></div></div>
                <div className="py-cell"><span className="ln-code" style={{ fontSize: 12 }}>{p.npi || '—'}</span>{!p.npi && <span style={{ marginLeft: 6, fontSize: 10, background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: 10 }}>Missing</span>}</div>
                <div className="py-cell" style={{ fontSize: 12, color: 'var(--muted)' }}>{p.taxonomy || '—'}</div>
                <div className="py-cell" style={{ fontSize: 12 }}>{p.license || '—'}</div>
                <div className="py-cell"><span className="pill" style={{ fontSize: 11, borderRadius: 20, padding: '3px 10px', background: p.role === 'BCBA' ? '#eff6ff' : 'var(--panel-2)' }}>{p.role}</span></div>
                <div className="py-cell" style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-xs" data-testid={`pi-edit-${p.id}`} onClick={() => { setForm({ name: p.name, npi: p.npi || '', taxonomy: p.taxonomy || '', license: p.license || '', role: p.role || 'BCBA', creds: p.creds || '' }); setOpen(p.id) }} style={{ borderRadius: 8 }}>Edit</button>
                  <button className="btn btn-xs" data-testid={`pi-del-${p.id}`} onClick={() => { actions.deleteProvider(p.id); toast({ message: `${p.name} removed`, kind: 'ok' }) }} style={{ borderRadius: 8 }}>Delete</button>
                </div>
              </div>
            ))}
            {!list.length && <div className="py-empty" style={{ padding: 48, textAlign: 'center' }} data-testid="pi-empty"><b>No providers</b><div className="muted" style={{ fontSize: 12 }}>Add your BCBAs and RBTs with NPI.</div></div>}
            <div className="footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'var(--panel-2)', borderTop: '1px solid var(--line)', fontSize: 12 }}><span>{list.length} providers</span><span>{kpis.missing} missing NPI</span></div>
          </div>
        </div>
      </div>

      {open && (
        <div className="modal-backdrop" data-testid="pi-modal">
          <div className="modal" style={{ width: 520, borderRadius: 14, border: '1px solid var(--line)' }}>
            <div className="modal-hd" style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}><b style={{ fontSize: 15 }}>{open === 'new' ? 'Add Provider' : 'Edit Provider'}</b><button className="iconbtn" onClick={() => setOpen(null)} style={{ marginLeft: 'auto' }}>{Icon.x({ size: 12 })}</button></div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="pi-f-name" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
                <label className="field"><span>NPI (10-digit)</span><input value={form.npi} onChange={(e) => setForm({ ...form, npi: e.target.value })} placeholder="1234567890" data-testid="pi-f-npi" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
                <label className="field"><span>Role</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="pi-f-role" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }}><option>BCBA</option><option>RBT</option><option>BCaBA</option><option>BT</option></select></label>
                <label className="field"><span>Credentials</span><input value={form.creds} onChange={(e) => setForm({ ...form, creds: e.target.value })} placeholder="BCBA, LBA" data-testid="pi-f-creds" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
                <label className="field"><span>Taxonomy</span><input value={form.taxonomy} onChange={(e) => setForm({ ...form, taxonomy: e.target.value })} placeholder="103K00000X" data-testid="pi-f-tax" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
                <label className="field"><span>License #</span><input value={form.license} onChange={(e) => setForm({ ...form, license: e.target.value })} data-testid="pi-f-lic" style={{ fontSize: 13, borderRadius: 10, padding: '10px 12px' }} /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btn btn-sm" onClick={() => setOpen(null)} style={{ borderRadius: 10 }}>Cancel</button><button className="btn btn-sm btn-primary" data-testid="pi-save" onClick={save} style={{ borderRadius: 10 }}>Save</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
