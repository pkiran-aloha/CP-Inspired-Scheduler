import React from 'react'
import { Icon } from '../ui/Icons'

/**
 * Security is no longer its own rail section — user accounts and roles are the
 * Security module inside Settings. Old links that still carry
 * `section: 'security'` land here for one paint while App opens that module on
 * top of it, so bookmarks and palette history never dead-end.
 */
export default function SecurityRedirect() {
  return (
    <div className="sectionpage" data-testid="security-redirect">
      <div className="empty" style={{ padding: 40 }}>
        <span className="empty-ic">{Icon.shield({ size: 18 })}</span>
        <b>Security moved into Settings</b>
        <span className="muted">User Accounts and User Roles now live under Settings → Security. Opening it…</span>
      </div>
    </div>
  )
}
