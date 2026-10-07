import React from 'react'
import { Dropdown } from './fields'
import { DAY_MINI, DAY_NAMES } from '../lib/date'
import { RECURRENCE_MAX_MONTHS, describeRule, expandRule, nthOf, normalizeRule, presetIdOf, rulePresets, shortDate } from '../lib/recurrence'

const UNITS = [
  { value: 'daily', label: 'day(s)' },
  { value: 'weekly', label: 'week(s)' },
  { value: 'monthly', label: 'month(s)' },
  { value: 'yearly', label: 'year(s)' },
]
const ORD = ['first', 'second', 'third', 'fourth', 'fifth']

/**
 * Google Calendar–style repeat picker: quick picks plus every custom option
 * (interval, weekdays, month day vs nth/last weekday, end never / on / after).
 * `rule` is null for "Doesn't repeat"; `onChange(rule|null)`.
 */
export default function RecurrenceEditor({ date, rule, onChange, weekStart = 0 }) {
  const presets = rulePresets(date)
  const r = normalizeRule(rule, date)
  const presetId = presetIdOf(r, date)
  const set = (patch) => onChange(normalizeRule({ ...r, ...patch }, date))
  const pickPreset = (id) => {
    if (id === 'custom') return onChange(r || normalizeRule({ freq: 'weekly', interval: 1, end: { type: 'never' } }, date))
    const p = presets.find((x) => x.id === id)
    onChange(p?.rule ? normalizeRule({ ...p.rule, end: r?.end || { type: 'never' } }, date) : null)
  }
  const { dates, capped, cap } = r ? expandRule(r, date, { weekStart }) : { dates: [date] }
  const { nth, last, dow, day } = nthOf(date)

  return (
    <div className="rec-ed" data-testid="rec-editor">
      <div className="field">
        <label>Repeats</label>
        <Dropdown
          testid="repeat-select"
          value={presetId}
          onChange={pickPreset}
          options={[...presets.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom…' }]}
        />
      </div>
      {r && (
        <div className="rec-detail">
          <div className="rec-row">
            <span className="rec-k">Every</span>
            <input data-testid="rec-interval" aria-label="Repeat every" type="number" min={1} max={99} className="input rec-num" value={r.interval}
              onChange={(e) => set({ interval: e.target.value })} />
            <Dropdown testid="rec-freq" value={r.freq} options={UNITS} onChange={(v) => set({ freq: v, byDay: undefined, monthBy: undefined })} />
          </div>
          {r.freq === 'weekly' && (
            <div className="rec-row" role="group" aria-label="Repeat on">
              <span className="rec-k">On</span>
              {DAY_MINI.map((d, i) => {
                const on = r.byDay.includes(i)
                return (
                  <button key={i} type="button" className={`rec-day${on ? ' on' : ''}`} data-testid={`rec-day-${i}`} aria-pressed={on} aria-label={DAY_NAMES[i]}
                    onClick={() => set({ byDay: on ? r.byDay.filter((x) => x !== i) : [...r.byDay, i] })}>
                    {d}
                  </button>
                )
              })}
            </div>
          )}
          {r.freq === 'monthly' && (
            <div className="rec-row">
              <span className="rec-k">On</span>
              <Dropdown
                testid="rec-monthby"
                value={r.monthBy}
                onChange={(v) => set({ monthBy: v })}
                options={[
                  { value: 'day', label: `Day ${day} of the month` },
                  ...(nth <= 4 ? [{ value: 'nth', label: `The ${ORD[nth - 1]} ${DAY_NAMES[dow]}` }] : []),
                  ...(last ? [{ value: 'last', label: `The last ${DAY_NAMES[dow]}` }] : []),
                ]}
              />
            </div>
          )}
          <div className="rec-row rec-ends" role="radiogroup" aria-label="Ends">
            <span className="rec-k">Ends</span>
            <label className="rec-opt">
              <input type="radio" name="rec-end" data-testid="rec-end-never" checked={r.end.type === 'never'} onChange={() => set({ end: { type: 'never' } })} /> Never
            </label>
            <label className="rec-opt">
              <input type="radio" name="rec-end" data-testid="rec-end-until" checked={r.end.type === 'until'}
                onChange={() => set({ end: { type: 'until', until: r.end.until || cap } })} /> On
              <input type="date" className="input rec-date" data-testid="rec-until" min={date} aria-label="End date"
                value={r.end.type === 'until' ? r.end.until : ''} onChange={(e) => e.target.value && set({ end: { type: 'until', until: e.target.value } })} />
            </label>
            <label className="rec-opt">
              <input type="radio" name="rec-end" data-testid="rec-end-count" checked={r.end.type === 'count'}
                onChange={() => set({ end: { type: 'count', count: r.end.count || dates.length || 8 } })} /> After
              <input type="number" min={1} max={400} className="input rec-num" data-testid="repeat-count" aria-label="Number of occurrences"
                value={r.end.type === 'count' ? r.end.count : ''} placeholder={String(dates.length)}
                onChange={(e) => e.target.value && set({ end: { type: 'count', count: e.target.value } })} /> times
            </label>
          </div>
          <p className="rec-sum" data-testid="repeat-summary">
            {describeRule(r, date)} · {dates.length} occurrence{dates.length === 1 ? '' : 's'}, last {shortDate(dates[dates.length - 1])}
            {capped && <span className="muted"> · Books up to {RECURRENCE_MAX_MONTHS} months ahead (through {shortDate(cap)}); extend the series later.</span>}
            {r.freq === 'monthly' && r.monthBy === 'day' && day > 28 && <span className="muted"> · Months without a day {day} are skipped.</span>}
            {r.freq === 'yearly' && date.endsWith('-02-29') && <span className="muted"> · Only leap years have Feb 29.</span>}
          </p>
        </div>
      )}
    </div>
  )
}
