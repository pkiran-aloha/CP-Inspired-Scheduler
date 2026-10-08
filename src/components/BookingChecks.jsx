import React, { useId, useState } from 'react'
import { Icon } from '../ui/Icons'
import { railDecision } from '../lib/railGlance'

// One drawn glyph per severity, so a tone reads the same in the rail, the pickers and
// the pills: stop sign (refused / must fix), caution (review), flag (noted), clipboard
// (still to fill in), check (clear).
export const TONE_ICON = { stop: 'stop', warn: 'caution', flag: 'flag', todo: 'edit', ok: 'checkCircle' }
export const TONE_WORD = { stop: 'Must fix', warn: 'Review', flag: 'Noted', todo: 'To complete', ok: 'Clear' }

export function ToneGlyph({ tone = 'ok', size = 14, label }) {
  return (
    <span className={`bk-glyph tone-${tone}`} role="img" aria-label={label || TONE_WORD[tone]} title={label || TONE_WORD[tone]}>
      {Icon[TONE_ICON[tone]]({ size, strokeWidth: 2 })}
    </span>
  )
}

/** A candidate's verdict inside a people picker: glyph + two-word reason, full sentence on hover. */
export function VerdictChip({ v }) {
  if (!v) return null
  return (
    <span className={`pv tone-${v.tone}`} title={v.detail} data-testid="pick-verdict">
      {Icon[TONE_ICON[v.tone]]({ size: 11, strokeWidth: 2.2 })}
      <span>{v.label}</span>
      {v.count > 1 && <em>+{v.count - 1}</em>}
    </span>
  )
}

const RANK = { ok: 0, todo: 1, flag: 2, warn: 3, stop: 4 }

function Lines({ lines }) {
  return (
    <ul className="bk-lines">
      {lines.map((l, k) => (
        <li key={k}>
          {l.tone && <ToneGlyph tone={l.tone} size={11} />}
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * One check: headline, the first line of why / what to do, then everything else
 * (more lines, notes, how it is worked out) behind a Details disclosure. `extra`
 * (slot chips, the acknowledgement tick) always stays in view.
 */
function CheckItem({ g, i }) {
  const [more, setMore] = useState(false)
  const id = useId()
  const lines = g.lines || []
  const shown = g.show ?? 1
  const rest = lines.slice(shown)
  const hasMore = rest.length > 0 || (g.notes || []).length > 0 || Boolean(g.foot) || Boolean(g.detail)
  return (
    <li className={`bk-item tone-${g.tone}`} style={{ '--i': i }} data-testid={g.testid}>
      <div className="bk-head">
        <span className="bk-ic" aria-hidden="true">{Icon[g.icon]({ size: 15, strokeWidth: 1.9 })}</span>
        <span className="bk-titles">
          <b>{g.title}</b>
          {g.sub && <span>{g.sub}</span>}
        </span>
        <ToneGlyph tone={g.tone} />
      </div>
      {shown > 0 && lines.length > 0 && <Lines lines={lines.slice(0, shown)} />}
      {g.extra}
      {hasMore && (
        <>
          <button type="button" className={`bk-more ${more ? 'on' : ''}`} onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls={id}>
            {Icon.chevDown({ size: 11, strokeWidth: 2.4 })}
            {more ? 'Hide details' : rest.length ? `Details · ${rest.length} more` : 'Details'}
          </button>
          <div id={id} className="bk-detail" hidden={!more}>
            {rest.length > 0 && <Lines lines={rest} />}
            {g.detail}
            {(g.notes || []).map((n, k) => <p key={k} className="bk-note">{n}</p>)}
            {g.foot && <p className="bk-foot">{g.foot}</p>}
          </div>
        </>
      )}
    </li>
  )
}

/** A horizontal meter: role="meter", with the numbers as its accessible value text. */
function Bar({ tone, label, max, now, text, parts, capPct }) {
  return (
    <span className={`bk-bar tone-${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={now} aria-valuetext={text}>
      {parts.map((p) => <i key={p.cls} className={p.cls} style={{ width: `${Math.max(0, Math.min(100, p.pct))}%` }} />)}
      {capPct != null && <b className="bk-bar-cap" style={{ left: `${capPct}%` }} />}
    </span>
  )
}

/** Authorized hours, each picked clinician's week, and risk / drive / continuity chips. */
function Glance({ glance }) {
  const auth = glance?.auth?.meter ? glance.auth : null
  const staff = (glance?.staff || []).filter((s) => s.meter)
  const chips = glance?.chips || []
  if (!auth && !staff.length && !chips.length) return null
  const m = auth?.meter
  return (
    <div className="bk-glance" data-testid="bk-glance">
      {auth && (
        <div className="bk-gl-row" data-testid="bk-glance-auth">
          <div className="bk-gl-lab"><span>Authorized hours</span><b>{auth.name}</b></div>
          <Bar
            tone={m.tone} label={`Authorized hours for ${auth.name}`} max={m.cap}
            now={Math.min(m.cap, m.used + m.booked)} text={m.text}
            parts={[{ cls: 'bk-bar-used', pct: m.usedPct }, { cls: 'bk-bar-booked', pct: m.bookedPct }]}
            capPct={m.over > 0 ? m.capPct : null}
          />
          <span className="bk-gl-key">
            <span><i className="bk-sw bk-sw-used" />{m.used} h used</span>
            <span><i className="bk-sw bk-sw-booked" />{m.booked} h booked</span>
            {m.over > 0
              ? <span className="tone-warn bk-gl-over"><ToneGlyph tone="warn" size={10} />{m.over} h over {m.cap} h</span>
              : <span><i className="bk-sw" />{m.left} h left of {m.cap} h</span>}
          </span>
          {m.week && (
            <>
              <Bar
                tone={m.week.pct >= 100 ? 'flag' : 'ok'} label={`Authorized week for ${auth.name}`} max={m.week.cap}
                now={Math.min(m.week.cap, m.week.hours)} text={m.week.text}
                parts={[{ cls: 'bk-bar-used', pct: m.week.pct }]}
              />
              <span className="bk-gl-key"><span>{m.week.text}</span></span>
            </>
          )}
        </div>
      )}
      {staff.map((s) => (
        <div key={s.id} className="bk-gl-row" data-testid="bk-glance-load">
          <div className="bk-gl-lab"><span>Week load</span><b>{s.name}</b></div>
          <Bar tone={s.meter.tone} label={`Week load for ${s.name}`} max={s.meter.target} now={Math.min(s.meter.target, s.meter.hours)} text={s.meter.text} parts={[{ cls: 'bk-bar-used', pct: s.meter.pct }]} />
          <span className="bk-gl-key"><span>{s.meter.over && <ToneGlyph tone="flag" size={10} />}{s.meter.text}</span></span>
        </div>
      ))}
      {chips.length > 0 && (
        <div className="bk-gl-chips">
          {chips.map((c) => (
            <span key={c.key} className={`bk-chip tone-${c.tone || 'ok'}`} data-testid={`bk-chip-${c.key}`}>
              {Icon[c.icon]({ size: 12, strokeWidth: 2 })}
              <span>{c.text}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The booking dialog's single home for everything that could stop or colour a booking.
 * `groups`: [{ key, tone: stop|warn|flag|todo, icon, title, sub?, lines?: [{text, tone?}], show?,
 *              notes?: string[], extra?: node, detail?: node, foot?: string, testid? }]
 *   `show` lines stay in view (default 1); the rest, `detail`, notes and foot sit behind Details.
 * `glance`: { auth?: {name, meter}, staff?: [{id, name, meter}], chips?: [{key, icon, tone, text}] } (railGlance.js)
 * `hint`: what to do next when nothing is wrong yet (e.g. pick people).
 */
export function BookingChecks({ groups, hint, glance }) {
  const sorted = [...groups].sort((a, b) => RANK[b.tone] - RANK[a.tone])
  const d = railDecision(groups)
  return (
    <section className={`panel bk-panel top-${d.tone}`} aria-labelledby="bk-title" data-testid="booking-checks">
      <h3 id="bk-title" className="bk-top">Checks</h3>
      <div className={`bk-decision tone-${d.tone}`}>
        <span className="bk-decision-ic" aria-hidden="true">{Icon[TONE_ICON[d.tone]]({ size: 17, strokeWidth: 2.1 })}</span>
        <div className="bk-decision-txt">
          <b className="bk-status" data-testid="booking-checks-status">{d.headline}</b>
          {d.counts.length > 0 && (
            <div className="bk-tally" aria-label="Summary of checks">
              {d.counts.map((c) => (
                <span key={c.tone} className={`bk-count tone-${c.tone}`}>
                  {Icon[TONE_ICON[c.tone]]({ size: 11, strokeWidth: 2.2 })}
                  {c.text}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <Glance glance={glance} />
      {sorted.length ? (
        <ul className="bk-list">{sorted.map((g, i) => <CheckItem key={g.key} g={g} i={i} />)}</ul>
      ) : (
        <p className="bk-clear">{hint || 'No clashes, authorization or practice-rule issues for this slot.'}</p>
      )}
      <p className="bk-basis">Worked out on this device from this workspace's calendar, authorizations, session history and Settings rules. Nothing is sent or booked until you save.</p>
    </section>
  )
}
