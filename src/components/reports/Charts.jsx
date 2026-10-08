import React from 'react'
import { ToneGlyph, TONE_WORD } from '../BookingChecks'
import { niceScale, heatStep, sparkPoints } from '../../lib/reportViz'

/**
 * Hand-drawn report visuals (no chart library). Every mark is keyboard-focusable and
 * carries its value in aria-label + a CSS tooltip (data-tip); the figure has a title and
 * an `alt` sentence, and the table below stays the full text alternative.
 * Colours come from the --viz-* tokens (light + dark) and severity tones (.tone-*),
 * which always ship with a glyph and a word, never colour alone.
 */
export const fmtViz = (v, t) => {
  if (typeof v !== 'number') return String(v ?? '—')
  if (t === 'money') return `$${Math.round(v).toLocaleString('en-US')}`
  if (t === 'pct') return `${v}%`
  if (t === 'hrs') return `${v}h`
  return v.toLocaleString('en-US')
}
const pct = (v, max) => `${Math.max(0, Math.min(100, (v / (max || 1)) * 100))}%`

export function ReportChart({ spec }) {
  if (!spec) return null
  const body = spec.kind === 'bars' ? <Bars spec={spec} /> : spec.kind === 'stack' ? <Stack spec={spec} /> : spec.kind === 'columns' ? <Columns spec={spec} /> : spec.kind === 'heat' ? <Heat spec={spec} /> : null
  return (
    <figure className={`rpc rpc-k-${spec.kind}`} data-testid="rp-chart" data-kind={spec.kind} role="group" aria-label={`${spec.title}. ${spec.alt}`}>
      <figcaption className="rpc-cap">
        <b>{spec.title}</b>
        {spec.kind === 'bars' && spec.total > spec.items.length && <span>Top {spec.items.length} of {spec.total} · full list in the table</span>}
      </figcaption>
      {body}
    </figure>
  )
}

function Legend({ items }) {
  return (
    <ul className="rpc-legend" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label}>
          {it.tone ? <ToneGlyph tone={it.tone} size={12} /> : <i className={`rpc-sw ${it.cls}`} aria-hidden="true" />}
          <span>{it.label}</span>
          {it.value != null && <b>{it.value}</b>}
        </li>
      ))}
    </ul>
  )
}

function Bars({ spec }) {
  const { t, items, keys } = spec
  const max = Math.max(...items.map((i) => Math.max(i.value, i.target || 0)), t === 'pct' ? 100 : 0)
  return (
    <>
      {keys && <Legend items={keys.map((k, i) => ({ label: k, cls: `s${i + 1}` }))} />}
      <ol className="rpc-bars">
        {items.map((it, ix) => {
          const tip = `${it.label}: ${fmtViz(it.value, t)}${it.target != null ? ` · ${spec.targetLabel || 'target'} ${fmtViz(it.target, t)}` : ''}${it.segs ? ` (${keys.map((k, i) => `${k} ${fmtViz(it.segs[i], t)}`).join(', ')})` : ''}${it.tone ? ` · ${TONE_WORD[it.tone]}` : ''}`
          return (
            <li key={ix} className="rpc-bar" tabIndex={0} aria-label={tip} data-tip={tip}>
              <span className="rpc-bar-l">
                {it.tone && it.tone !== 'ok' && <ToneGlyph tone={it.tone} size={11} />}
                <span>{it.label}</span>
              </span>
              <span className="rpc-track">
                {it.segs ? (
                  <span className="rpc-fill rpc-segs" style={{ width: pct(it.value, max) }}>
                    {it.segs.map((v, i) => v > 0 && <i key={i} className={`s${i + 1}`} style={{ flexGrow: v }} />)}
                  </span>
                ) : (
                  <span className="rpc-fill s1" style={{ width: pct(it.value, max) }} />
                )}
                {it.target != null && <i className="rpc-target" style={{ left: pct(it.target, max) }} aria-hidden="true" />}
              </span>
              <b className="rpc-bar-v">{fmtViz(it.value, t)}</b>
            </li>
          )
        })}
      </ol>
      {items.some((i) => i.target != null) && (
        <p className="rpc-key"><i className="rpc-target-key" aria-hidden="true" /> {spec.targetLabel || 'Target'}</p>
      )}
    </>
  )
}

function Stack({ spec }) {
  const { parts, t, ordinal } = spec
  const total = parts.reduce((s, p) => s + p.value, 0)
  const share = (v) => (total ? Math.round((v / total) * 100) : 0)
  const cls = (p, i) => (p.tone ? `tone-${p.tone}` : p.other ? 'so' : ordinal ? `q${p.seq}` : `s${i + 1}`)
  return (
    <>
      <div className="rpc-stack">
        {parts.map((p, i) => {
          const tip = `${p.label}: ${fmtViz(p.value, t)} · ${share(p.value)}%${p.count != null ? ` · ${p.count} claims` : ''}`
          return <span key={p.label} className={`rpc-seg ${cls(p, i)}`} style={{ flexGrow: p.value }} tabIndex={0} aria-label={tip} data-tip={tip} />
        })}
      </div>
      <Legend items={parts.map((p, i) => ({ label: p.label, tone: p.tone, cls: cls(p, i), value: `${fmtViz(p.value, t)} · ${share(p.value)}%` }))} />
    </>
  )
}

function Columns({ spec }) {
  const { buckets, keys, t } = spec
  const { max, ticks } = niceScale(Math.max(...buckets.map((b) => b.total)))
  const every = Math.ceil(buckets.length / 12)
  return (
    <>
      {keys && <Legend items={keys.map((k, i) => ({ label: k, cls: /^Other/.test(k) ? 'so' : `s${i + 1}` }))} />}
      <div className="rpc-cols">
        <div className="rpc-axis" aria-hidden="true">
          {[...ticks].reverse().map((v) => <span key={v}>{fmtViz(v, t)}</span>)}
        </div>
        <div className="rpc-plot">
          {ticks.map((v) => <i key={v} className="rpc-grid" style={{ bottom: pct(v, max) }} aria-hidden="true" />)}
          {buckets.map((b, bi) => {
            const tip = `${b.label}: ${fmtViz(b.total, t)}${keys ? ` (${b.segs.filter((s) => s.value).map((s) => `${s.key} ${fmtViz(s.value, t)}`).join(', ')})` : ''}`
            return (
              <div key={bi} className="rpc-col" tabIndex={0} aria-label={tip} data-tip={tip}>
                <span className="rpc-colbar" style={{ height: pct(b.total, max) }}>
                  {b.segs.map((s, i) => s.value > 0 && <i key={s.key} className={keys && /^Other/.test(s.key) ? 'so' : `s${i + 1}`} style={{ flexGrow: s.value }} />)}
                </span>
                <small className={bi % every ? 'rpc-hide' : undefined}>{b.label}</small>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

function Heat({ spec }) {
  const { rows, hours, max, unit } = spec
  const hh = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`
  return (
    <>
      <div className="rpc-heat" style={{ gridTemplateColumns: `40px repeat(${hours.length}, minmax(18px, 1fr))` }}>
        <span aria-hidden="true" />
        {hours.map((h) => <small key={h} className="rpc-heat-h" aria-hidden="true">{hh(h)}</small>)}
        {rows.map((r) => (
          <React.Fragment key={r.label}>
            <small className="rpc-heat-d" aria-hidden="true">{r.label}</small>
            {r.cells.map((v, i) => {
              const tip = `${r.label} ${hh(hours[i])}: ${v} ${unit}`
              return <span key={i} className={`rpc-cell h${heatStep(v, max)}`} tabIndex={0} aria-label={tip} data-tip={tip} />
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="rpc-key rpc-heat-key">
        <span>Fewer</span>
        {[0, 1, 2, 3, 4].map((s) => <i key={s} className={`rpc-cell h${s}`} aria-hidden="true" />)}
        <span>More · busiest cell {max} {unit}</span>
      </p>
    </>
  )
}

/** Tiny trend line for a KPI tile; renders nothing when the series is flat or partial. */
export function Sparkline({ values, label }) {
  const pts = sparkPoints(values, 64, 20)
  if (!pts) return null
  const last = pts.split(' ').pop().split(',')
  return (
    <svg className="rp-spark" width="64" height="20" viewBox="0 0 64 20" role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={pts} fill="none" />
      <circle cx={last[0]} cy={last[1]} r="2.2" />
    </svg>
  )
}
