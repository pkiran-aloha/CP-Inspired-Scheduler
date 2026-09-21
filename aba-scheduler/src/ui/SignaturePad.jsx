import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './Icons'
import { fmtTime } from '../lib/date'

/**
 * Signature capture for session verification.
 * - Draw (pointer strokes on canvas) or type a name
 * - On sign: embeds staff details + certification/designation, ISO timestamp and geocode
 */
export default function SignaturePad({ value, onChange, staffName, staffId, certification }) {
  const [mode, setMode] = useState('draw')
  const [typed, setTyped] = useState(value?.mode === 'type' ? value.text : '')
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef(null)
  const strokes = useRef([])
  const drawing = useRef(false)
  const [supports, setSupports] = useState(true)

  const ctxOf = () => {
    try {
      return canvasRef.current?.getContext('2d') || null
    } catch {
      return null
    }
  }
  const paint = () => {
    const ctx = ctxOf()
    if (!ctx) {
      setSupports(false)
      return
    }
    const c = canvasRef.current
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text')?.trim() || '#111'
    for (const s of strokes.current) {
      ctx.beginPath()
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
  }
  useEffect(paint, [mode])

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / (r.width || 1)
    const scaleY = canvasRef.current.height / (r.height || 1)
    return [(e.clientX - r.left) * scaleX, (e.clientY - r.top) * scaleY]
  }
  const down = (e) => {
    if (!supports) return
    e.preventDefault()
    drawing.current = true
    strokes.current = [...strokes.current, [pos(e)]]
    try {
      canvasRef.current.setPointerCapture?.(e.pointerId)
    } catch {}
    paint()
  }
  const move = (e) => {
    if (!drawing.current) return
    const s = strokes.current[strokes.current.length - 1]
    s.push(pos(e))
    paint()
  }
  const up = () => (drawing.current = false)
  const clear = () => {
    strokes.current = []
    paint()
    onChange(null)
  }

  const sign = async () => {
    setBusy(true)
    let geo = null
    try {
      if (navigator.geolocation) {
        geo = await new Promise((res) => {
          const to = setTimeout(() => res({ error: 'timeout' }), 2500)
          navigator.geolocation.getCurrentPosition(
            (p) => {
              clearTimeout(to)
              res({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), accuracy: Math.round(p.coords.accuracy) })
            },
            () => {
              clearTimeout(to)
              res({ error: 'denied' })
            },
            { timeout: 2300 }
          )
        })
      } else geo = { error: 'unavailable' }
    } catch {
      geo = { error: 'unavailable' }
    }
    let dataUrl = null
    if (mode === 'draw') {
      try {
        dataUrl = strokes.current.length ? canvasRef.current.toDataURL('image/png') : null
      } catch {
        dataUrl = null
      }
    }
    const sig = {
      mode,
      text: mode === 'type' ? typed.trim() || staffName || 'Signed' : staffName || '',
      dataUrl,
      staffId,
      staffName: staffName || '—',
      certification: certification || '',
      timestamp: new Date().toISOString(),
      geo,
    }
    onChange(sig)
    setBusy(false)
    if (sig.mode === 'type') setTyped(sig.text)
  }

  if (value) {
    const ts = value.timestamp ? new Date(value.timestamp) : null
    return (
      <div className="panel" style={{ borderColor: 'color-mix(in srgb, var(--ok) 45%, var(--line))', background: 'color-mix(in srgb, var(--ok) 5%, var(--panel))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--ok)' }}>{Icon.checkCircle({ size: 15 })}</span>
          <b style={{ fontSize: 12.5 }}>Signed by {value.staffName}</b>
          <span className="f1" />
          <button className="btn btn-ghost btn-sm" onClick={clear}>{Icon.edit({ size: 12 })} Re-sign</button>
        </div>
        <div className="sig-preview" style={{ marginTop: 8 }}>
          {value.dataUrl && value.dataUrl.startsWith('data:') ? <img src={value.dataUrl} alt="signature" /> : <span className="sig-typed">{value.text}</span>}
        </div>
        <div className="sig-meta">
          <span>{Icon.pin({ size: 11 })} {value.certification || 'no certification on file'}</span>
          <span>{Icon.clock({ size: 11 })} {ts ? `${ts.toLocaleDateString()} · ${ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}</span>
          <span>
            {Icon.car({ size: 11 })}{' '}
            {value.geo && !value.geo.error ? <code style={{ fontSize: 11 }}>{value.geo.lat}, {value.geo.lng} ±{value.geo.accuracy}m</code> : <span className="muted">geocode not shared</span>}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <b style={{ fontSize: 12.5 }}>Signature</b>
        <div className="viewseg" style={{ marginLeft: 'auto' }}>
          <button type="button" className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}>✍ Draw</button>
          <button type="button" className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}>⌨ Type</button>
        </div>
      </div>
      {mode === 'draw' ? (
        supports ? (
          <canvas
            ref={canvasRef}
            width={600}
            height={180}
            className="sig-canvas"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
          />
        ) : (
          <div className="muted" style={{ fontSize: 12, padding: '18px 0', textAlign: 'center' }}>Canvas unsupported here — use Type mode.</div>
        )
      ) : (
        <input className="input" placeholder={`${staffName || 'Type your full name'}`} value={typed} onChange={(e) => setTyped(e.target.value)} style={{ fontStyle: 'italic', fontSize: 16 }} data-testid="sig-type" />
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" data-testid="sig-sign" className="btn btn-primary btn-sm" onClick={sign} disabled={busy || (mode === 'draw' && !strokes.current.length)}>
          {busy ? 'Signing…' : `Sign as ${staffName || 'verifier'}`}
        </button>
        {mode === 'draw' && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>}
        <span className="muted" style={{ fontSize: 10.5, marginLeft: 'auto' }}>Captures timestamp{certification ? ` · ${certification}` : ''} + geocode</span>
      </div>
    </div>
  )
}
