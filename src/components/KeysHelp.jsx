import React from 'react'
import { Icon } from '../ui/Icons'

const GROUPS = [
  ['Anything', [['⌘ / Ctrl + K', 'command palette — search people, reports, actions'], ['?', 'this sheet'], ['Esc', 'close any sheet or dialog']]],
  ['Calendar', [['N or A', 'new appointment / block time at the anchor'], ['T', 'jump to today'], ['D · W · M · H · G', 'day / week / month / timeline / agenda'], ['← →', 'slide the visible window back / forward'], ['drag on grid', 'block time · click a slot to quick-book'], ['⇤ / ⤢ on a slot card', 'expand overlapping sessions side-by-side']]],
  ['Workspace', [['1 – 6', 'calendar · clients · staff · billing · analytics · reports'], ['U', 'undo the last change'], ['☾ (top bar)', 'toggle dark / light'], ['⌘K → client name', 'jump to their row on the roster']]],
  ['Reports & billing', [['click a report row', 'jump to the underlying record'], ['click a trend bar', 'focus the table to that day / week'], ['✓ / ⚡ on an issue row', 'verify & sign or auto-fix, with undo'], ['print', 'every report keeps a dedicated print stylesheet']]],
]

export default function KeysHelp({ onClose }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="kb-help">
      <div className="modal kh" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="modal-head">
          <h2>{Icon.zap({ size: 15 })} Keyboard & gestures</h2>
          <span className="spacer" />
          <button className="modal-x" onClick={onClose} aria-label="Close">{Icon.x({ size: 14 })}</button>
        </div>
        <div className="modal-body kh-body">
          {GROUPS.map(([title, rows]) => (
            <section key={title}>
              <h3>{title}</h3>
              {rows.map(([k, v]) => (
                <div className="kh-row" key={k}>
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11 }}>Shortcuts pause while you're typing in a field.</span>
          <button className="btn btn-sm btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  )
}
