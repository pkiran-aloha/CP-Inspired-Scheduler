import React, { useState } from 'react'
import { Icon } from '../ui/Icons'

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

function CheckItem({ g, i }) {
  const [more, setMore] = useState(false)
  const lines = g.lines || []
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
      {lines.length > 0 && (
        <ul className="bk-lines">
          {lines.map((l, k) => (
            <li key={k} hidden={!more && k >= 2}>
              {l.tone && <ToneGlyph tone={l.tone} size={11} />}
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      {lines.length > 2 && (
        <button type="button" className="bk-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? 'Show less' : `Show ${lines.length - 2} more`}
        </button>
      )}
      {g.extra}
      {(g.notes || []).map((n, k) => <p key={k} className="bk-note">{n}</p>)}
      {g.foot && <p className="bk-foot">{g.foot}</p>}
    </li>
  )
}

/**
 * The booking dialog's single home for everything that could stop or colour a booking.
 * `groups`: [{ key, tone: stop|warn|flag|todo, icon, title, sub?, lines?: [{text, tone?}],
 *              notes?: string[], extra?: node, foot?: string, testid? }]
 * `hint`: what to do next when nothing is wrong yet (e.g. pick people).
 */
export function BookingChecks({ groups, hint }) {
  const sorted = [...groups].sort((a, b) => RANK[b.tone] - RANK[a.tone])
  const count = (t) => groups.filter((g) => g.tone === t).length
  const top = sorted[0]?.tone || 'ok'
  const headline = { stop: 'Fix before booking', warn: 'Review before booking', flag: 'Good to book, with notes', todo: 'Almost there', ok: 'Ready to book' }[top]
  return (
    <section className={`panel bk-panel top-${top}`} aria-labelledby="bk-title" data-testid="booking-checks">
      <header className="bk-top">
        <h3 id="bk-title">Checks</h3>
        <span className={`bk-status tone-${top}`} data-testid="booking-checks-status">
          {Icon[TONE_ICON[top]]({ size: 13, strokeWidth: 2.1 })}
          {headline}
        </span>
      </header>
      {groups.length > 0 && (
        <div className="bk-tally" aria-label="Summary of checks">
          {['stop', 'warn', 'flag', 'todo'].filter((t) => count(t)).map((t) => (
            <span key={t} className={`bk-count tone-${t}`}>
              {Icon[TONE_ICON[t]]({ size: 11, strokeWidth: 2.2 })}
              {count(t)} {TONE_WORD[t].toLowerCase()}
            </span>
          ))}
        </div>
      )}
      {sorted.length ? (
        <ul className="bk-list">{sorted.map((g, i) => <CheckItem key={g.key} g={g} i={i} />)}</ul>
      ) : (
        <p className="bk-clear">{hint || 'No clashes, authorization or practice-rule issues for this slot.'}</p>
      )}
    </section>
  )
}
