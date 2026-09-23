import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icons'
// chunk-35: long-lived SPA tabs silently keep the PREVIOUS deployment's bundle.
// Poll the freshly written version.json; when it flips, offer a one-click reload.
export default function BuildWatcher() {
  const [stale, setStale] = useState(false)
  const seen = useRef(null)
  useEffect(() => {
    let dead = false
    const check = async () => {
      try {
        const base = (import.meta.env.BASE_URL || './').replace(/[^/]$/, '$&/')
        const r = await fetch(`${base}version.json?cb=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json().catch(() => null)
        if (!j || !j.build) return
        if (seen.current == null) { seen.current = j.build; return }
        if (seen.current !== j.build && !dead) setStale(true)
      } catch { /* dev server / offline — stay quiet */ }
    }
    check()
    const iv = setInterval(check, 120000)
    const onFocus = () => { if (!stale) check() }
    window.addEventListener('focus', onFocus)
    return () => { dead = true; clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [stale])
  if (!stale) return null
  return (
    <button type="button" className="build-update" data-testid="app-update" title="A newer build is deployed — click to reload the app"
      onClick={() => window.location.reload()}>
      {Icon.repeat({ size: 13 })} New version deployed — click to refresh
    </button>
  )
}
