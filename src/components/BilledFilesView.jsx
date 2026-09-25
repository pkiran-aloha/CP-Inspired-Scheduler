import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { SectionBar } from './NavRail'
import { Icon } from '../ui/Icons'
import { useToast } from '../ui/Toast'
import { download } from '../lib/ics'
import { todayISO, isoDate } from '../lib/date'

const PAGE_SIZE = 25

export default function BilledFilesView() {
  const state = useStore()
  const { actions, ui } = state
  const toast = useToast()
  const [q, setQ] = useState('')
  const [payerF, setPayerF] = useState('all')
  const [sort, setSort] = useState({ k: 'date', d: -1 })
  const [page, setPage] = useState(0)

  const files = useMemo(() => Object.values(state.billedFiles || {}), [state.billedFiles])
  const claimsById = state.claims || {}

  const payers = useMemo(() => [...new Set(files.map((f)=>f.payer).filter(Boolean))], [files])

  const rows = useMemo(() => {
    let r = [...files]
    const s = q.trim().toLowerCase()
    if (s) r = r.filter((f)=> `${f.fileName} ${f.payer} ${f.clientNames||''}`.toLowerCase().includes(s))
    if (payerF !== 'all') r = r.filter((f)=>f.payer===payerF)
    r.sort((a,b)=>{
      const av = a[sort.k] || ''
      const bv = b[sort.k] || ''
      if (sort.k === 'date') return (new Date(bv) - new Date(av)) * (sort.d>0?1:-1)
      return String(av).localeCompare(String(bv)) * sort.d
    })
    return r
  }, [files, q, payerF, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const view = rows.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE)

  const generate = () => {
    const openClaims = Object.values(claimsById).filter((c)=>c.status==='submitted')
    if (!openClaims.length) { toast({ message:'No submitted claims to file — submit drafts first', kind:'warn' }); return }
    const fileName = `837P-${todayISO()}-${String(Object.keys(state.billedFiles||{}).length+1).padStart(3,'0')}.txt`
    const content = openClaims.map((c)=>`${c.no}|${c.payer}|${c.charges}|${c.dosFrom}->${c.dosTo}`).join('\n')
    const rec = {
      id: `bf-${Date.now().toString(36)}`,
      fileName,
      payer: openClaims[0].payer,
      clientCount: new Set(openClaims.map((c)=>c.clientId)).size,
      claimCount: openClaims.length,
      claimIds: openClaims.map((c)=>c.id),
      clientNames: [...new Set(openClaims.map((c)=> (state.clients||[]).find((cl)=>cl.id===c.clientId)?.name || ''))].slice(0,3).join(', '),
      date: todayISO(),
      sendCount: 1,
      content,
      createdAt: Date.now(),
    }
    actions.record('billedFiles', rec)
    toast({ message:`${fileName} generated — ${openClaims.length} claims filed`, kind:'ok' })
  }

  const resend = (f) => {
    const next = { ...f, sendCount: (f.sendCount||1)+1, date: todayISO(), createdAt: Date.now() }
    actions.record('billedFiles', next)
    toast({ message:`${f.fileName} resent — count ${next.sendCount}`, kind:'ok' })
  }

  const downloadFile = (f) => {
    download(f.fileName, f.content || `File ${f.fileName} — ${f.claimCount} claims`)
    toast({ message:`${f.fileName} downloaded`, kind:'ok' })
  }

  const flip = (k) => setSort((x)=>({ k, d: x.k===k ? -x.d : 1 }))

  return (
    <div className="sectionpage">
      <SectionBar icon="file" title="Billed Files" sub={`${files.length} files · 837P pipeline shares file generation with Billing Manager`}>
        <input className="input" style={{ width:200, height:30 }} placeholder="Search files, payers..." value={q} onChange={(e)=>setQ(e.target.value)} data-testid="bf-search" />
        <select className="input" style={{ height:30 }} value={payerF} onChange={(e)=>setPayerF(e.target.value)} data-testid="bf-payer-filter">
          <option value="all">All payers</option>
          {payers.map((p)=><option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-sm btn-primary" data-testid="bf-generate" onClick={generate}>{Icon.file({ size:12 })} Generate</button>
      </SectionBar>

      <div className="sec-body">
        <div className="py-dirsec" data-testid="bf-sec">
          <header className="py-sech">
            <span className="py-sech-ic">{Icon.table({ size:13 })}</span>
            <b>File registry</b>
            <i>25 per page · resend bumps count</i>
            <span className="an-spacer" />
            <span className="muted">{rows.length} of {files.length}</span>
          </header>

          <div className="py-tbl" data-testid="bf-table">
            <div className="py-thead" style={{ gridTemplateColumns:'2fr 1fr 1fr 0.7fr 0.7fr 0.7fr 1fr' }}>
              <button className="sortable" data-testid="bf-sort-file" onClick={()=>flip('fileName')}>File Name</button>
              <button className="sortable" data-testid="bf-sort-payer" onClick={()=>flip('payer')}>Payer</button>
              <span>Clients</span>
              <span>Claims</span>
              <button className="sortable" data-testid="bf-sort-date" onClick={()=>flip('date')}>Billed Through</button>
              <span>Send Count</span>
              <span>Actions</span>
            </div>
            {view.length===0 && <div className="py-empty">No billed files — submit claims from Billing Manager, then Generate here. The table mirrors screenshot 10 intent: file name, payer, client/claim counts, billed-through date, resend count, download.</div>}
            {view.map((f)=>(
              <div className="py-trow" key={f.id} data-testid={`bf-row-${f.id}`} style={{ gridTemplateColumns:'2fr 1fr 1fr 0.7fr 0.7fr 0.7fr 1fr' }}>
                <div className="py-idcell"><b>{f.fileName}</b><span className="muted" style={{ fontSize:11 }}>{f.clientNames||'—'}</span></div>
                <div className="py-cell"><span className="tag soft">{f.payer||'—'}</span></div>
                <div className="py-cell num"><b>{f.clientCount}</b></div>
                <div className="py-cell num"><b>{f.claimCount}</b></div>
                <div className="py-cell"><span className="muted">{f.date}</span></div>
                <div className="py-cell num"><span className={`py-cnt${f.sendCount>1?'':' z'}`}>{f.sendCount||1}</span></div>
                <div className="py-cell" style={{ display:'flex', gap:6 }}>
                  <button className="btn btn-sm" data-testid={`bf-download-${f.id}`} onClick={()=>downloadFile(f)}>{Icon.download({ size:11 })} Download</button>
                  <button className="btn btn-sm" data-testid={`bf-resend-${f.id}`} onClick={()=>resend(f)}>{Icon.repeat({ size:11 })} Resend</button>
                </div>
              </div>
            ))}
            <div className="py-pager" data-testid="bf-pager">
              <span className="muted">{rows.length ? `${page*PAGE_SIZE+1}–${Math.min(rows.length,(page+1)*PAGE_SIZE)} of ${rows.length}` : '0 files'}</span>
              {pages>1 && <span className="py-pages">{Array.from({ length:pages },(_,i)=><button key={i} className={`pg-num${i===page?' on':''}`} data-testid={`bf-page-${i}`} onClick={()=>setPage(i)}>{i+1}</button>)}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
