import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { useToast } from '../../ui/Toast'
import { Icon } from '../../ui/Icons'
import { Section, Row, Select, Seg, Banner, Empty, DataTable, IconButton, Toggle } from './kit'
import { IMPORT_TYPES, IMPORT_LIMIT, importType, parseCSV, guessMapping, validateImport, previewRows, templateCSV } from '../../lib/dataImport'
import { downloadDoc } from '../../lib/exportKit'
import { todayISO } from '../../lib/date'

const fmtWhen = (ts) => (ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export function DataImportPanel({ state, actions, toast, readOnly }) {
  const [type, setType] = useState('clients')
  const [matrix, setMatrix] = useState([])
  const [header, setHeader] = useState([])
  const [mapping, setMapping] = useState({})
  const [mode, setMode] = useState('skip')
  const [fileName, setFileName] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const fileRef = useRef(null)
  const def = importType(type)
  const log = (state.settings.importLog || []).slice().reverse()

  const check = useMemo(() => (matrix.length ? validateImport(state, type, matrix, mapping) : null), [state, type, matrix, mapping])
  const preview = useMemo(() => (check ? previewRows(type, matrix, mapping, check, 6) : []), [type, matrix, mapping, check])
  const mappedCount = Object.values(mapping).filter(Boolean).length

  const reset = () => { setMatrix([]); setHeader([]); setMapping({}); setFileName(''); setPaste(''); setPasteOpen(false) }
  const chooseType = (id) => { setType(id); reset() }
  const load = (text, name) => {
    const parsed = parseCSV(text)
    if (!parsed.rows.length) { toast({ message: 'That file has no data rows — check it is a CSV with a header line', kind: 'warn' }); return }
    if (parsed.rows.length > IMPORT_LIMIT) { toast({ message: `This demo imports up to ${IMPORT_LIMIT} rows at a time (file has ${parsed.rows.length}).`, kind: 'warn' }); return }
    setHeader(parsed.header)
    setMatrix(parsed.rows)
    setMapping(guessMapping(type, parsed.header))
    setFileName(name || 'pasted.csv')
  }
  const onFile = (file) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast({ message: 'Import files are limited to 2 MB in this demo', kind: 'warn' }); return }
    const fr = new FileReader()
    fr.onload = () => load(String(fr.result), file.name)
    fr.onerror = () => toast({ message: 'Could not read that file', kind: 'warn' })
    fr.readAsText(file)
  }
  const commit = () => {
    if (!check || check.issues.length) return
    const res = actions.importRows(type, matrix, mapping, { mode, fileName })
    if (!res.ok) { toast({ message: res.msg, kind: 'warn' }); return }
    toast({ message: `Imported ${fileName}: ${res.msg}`, kind: 'ok', action: { label: 'Undo', onClick: () => actions.undo() } })
    reset()
  }

  return (
    <>
      <Section title="What are you importing?" sub="CSV only — a header row plus one record per line" testId="set-import-type">
        <div className="set-import-types">
          {IMPORT_TYPES.map((t) => (
            <button key={t.id} type="button" className={`set-import-card ${type === t.id ? 'on' : ''}`} data-testid={`set-import-type-${t.id}`} onClick={() => chooseType(t.id)}>
              <span className="set-import-ic">{Icon[t.icon]({ size: 16 })}</span>
              <b>{t.label}</b>
              <i>{t.blurb}</i>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title={`${def.label} file`}
        sub={matrix.length ? `${matrix.length} data rows · ${mappedCount} of ${def.fields.length} fields mapped` : `Up to ${IMPORT_LIMIT} rows per file`}
        testId="set-import-file"
        actions={<>
          <button className="btn btn-sm" data-testid="set-import-template" onClick={() => downloadDoc(`aloha-aba-${type}-template.csv`, templateCSV(type), 'text/csv')}>{Icon.download({ size: 12 })} Template</button>
          <button className="btn btn-sm" disabled={readOnly} data-testid="set-import-pick" onClick={() => fileRef.current?.click()}>{Icon.file({ size: 12 })} Choose CSV…</button>
          <button className="btn btn-sm" disabled={readOnly} data-testid="set-import-paste-toggle" onClick={() => setPasteOpen((v) => !v)}>{Icon.copy({ size: 12 })} Paste</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} data-testid="set-import-file-input" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </>}
      >
        {pasteOpen && (
          <div className="set-paste">
            <textarea className="input set-paste-area" rows={5} placeholder={`Paste CSV rows, e.g.\n${templateCSV(type).split('\n').slice(0, 2).join('\n')}`} value={paste} data-testid="set-import-paste" onChange={(e) => setPaste(e.target.value)} />
            <button className="btn btn-sm btn-primary" data-testid="set-import-paste-load" onClick={() => load(paste, 'pasted.csv')}>Load pasted rows</button>
          </div>
        )}
        {!matrix.length ? (
          <Empty testid="set-import-empty">
            {Icon.download({ size: 18 })}
            <span>Download the template, fill it in, and choose the file. Nothing is written until every row validates.</span>
          </Empty>
        ) : (
          <>
            {check.issues.length > 0 && (
              <Banner tone="warn" testid="set-import-issues">
                <b>{check.issues.length} row{check.issues.length === 1 ? '' : 's'} need fixing — nothing will be imported yet.</b>
                <ul className="set-issue-list">
                  {check.issues.slice(0, 6).map((i) => <li key={i.line}><b>Line {i.line}{i.name ? ` · ${i.name}` : ''}:</b> {i.errors.join('; ')}</li>)}
                  {check.issues.length > 6 && <li>…and {check.issues.length - 6} more</li>}
                </ul>
              </Banner>
            )}
            <div className="set-import-summary" data-testid="set-import-summary">
              <span className="set-pill on">{check.total - check.issues.length} ready</span>
              {check.duplicates > 0 && <span className="set-pill warn">{check.duplicates} already on file</span>}
              {check.issues.length > 0 && <span className="set-pill bad">{check.issues.length} with errors</span>}
            </div>
            <DataTable
              testid="set-import-preview"
              columns={[{ key: 'line', label: 'Line', width: '52px' }, ...def.fields.slice(0, 5).map((f) => ({ key: f.key, label: f.label })), { key: 'verdict', label: 'Verdict', width: '1.1fr' }]}
              rows={preview}
              renderRow={(r) => (
                <div className={`set-trow ${r.error ? 'bad' : ''}`} key={r.line} style={{ gridTemplateColumns: `52px ${def.fields.slice(0, 5).map(() => '1fr').join(' ')} 1.1fr` }}>
                  <span className="muted">{r.line}</span>
                  {r.cells.slice(0, 5).map((c) => <span key={c.key}>{c.value || <i className="muted">—</i>}</span>)}
                  <span>{r.error ? <span className="set-pill bad">{r.error}</span> : r.duplicate ? <span className="set-pill warn">update / skip</span> : <span className="set-pill on">new</span>}</span>
                </div>
              )}
            />
            {matrix.length > 6 && <p className="set-hint">Showing the first 6 of {matrix.length} rows.</p>}

            <div className="set-import-map">
              <b>Column mapping</b>
              <span className="muted">Auto-matched from the header — change anything that guessed wrong.</span>
              <div className="set-map-grid">
                {header.map((col, i) => (
                  <label key={`${col}-${i}`} className="set-map-row">
                    <span title={col}>{col}</span>
                    <Select value={mapping[i] || ''} wide={190} testid={`set-import-map-${i}`}
                      options={[{ value: '', label: '— ignore this column —' }, ...def.fields.map((f) => ({ value: f.key, label: f.label + (f.required ? ' *' : '') }))]}
                      onChange={(v) => setMapping((m) => ({ ...m, [i]: v }))} />
                  </label>
                ))}
              </div>
            </div>

            <div className="set-import-foot">
              <div className="set-inline">
                <span className="muted">Existing records:</span>
                <Seg value={mode} onChange={setMode} testid="set-import-mode" ariaLabel="Duplicate handling"
                  options={[{ value: 'skip', label: 'Skip' }, { value: 'update', label: 'Update in place' }]} />
              </div>
              <div className="set-actions">
                <button className="btn btn-sm" onClick={reset} data-testid="set-import-clear">Clear file</button>
                <button className="btn btn-sm btn-primary" disabled={readOnly || !check.valid} data-testid="set-import-commit" onClick={commit}>
                  {Icon.download({ size: 12 })} Import {check.valid} row{check.valid === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </>
        )}
      </Section>

      <Section title="Import history" sub={`${(state.settings.importLog || []).length} of the last 20 imports`} testId="set-import-log">
        {log.length ? (
          <DataTable
            testid="set-import-log-table"
            columns={[{ key: 'when', label: 'When', width: '1.2fr' }, { key: 'what', label: 'What', width: '1fr' }, { key: 'file', label: 'File', width: '1.4fr' }, { key: 'counts', label: 'Result', width: '1.4fr' }]}
            rows={log}
            renderRow={(e) => (
              <div className="set-trow" key={e.id} data-testid={`set-import-log-${e.id}`} style={{ gridTemplateColumns: '1.2fr 1fr 1.4fr 1.4fr' }}>
                <span className="muted">{fmtWhen(e.at)}</span>
                <span>{importType(e.type).label}</span>
                <span className="muted">{e.file || 'pasted rows'}</span>
                <span>{e.counts.created} created · {e.counts.updated} updated · {e.counts.skipped} skipped</span>
              </div>
            )}
          />
        ) : <Empty testid="set-import-log-empty">No imports recorded in this workspace yet.</Empty>}
        <p className="set-hint">
          Imports are local-only: the file is read in this browser and never uploaded. The log travels in the workspace backup so a
          restored copy still shows what came in. Files with PHI need a cleaning decision before they belong anywhere but a
          sandbox — this demo ships fictional rows only.
        </p>
      </Section>
    </>
  )
}

export default DataImportPanel
