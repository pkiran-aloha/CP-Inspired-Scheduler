import { parseISO, minToHM } from './date'

const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

export function buildICS(appts, staffById, clientsById) {
  const dt = (iso, min) => {
    const d = parseISO(iso)
    d.setHours(Math.floor(min / 60), min % 60, 0, 0)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AlohaABA//Scheduler//EN', 'CALSCALE:GREGORIAN']
  for (const a of appts) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@pulseaba`,
      `DTSTAMP:${dt(a.date, 0)}Z`,
      `DTSTART:${dt(a.date, a.start)}`,
      `DTEND:${dt(a.date, a.end)}`,
      `SUMMARY:${esc(a.title)}`,
      a.location ? `LOCATION:${esc(a.location)}` : '',
      `DESCRIPTION:${esc([(a.staffIds || []).map((s) => staffById[s]?.name).filter(Boolean).join(', '), (a.clientIds || []).map((c) => clientsById[c]?.name).filter(Boolean).join(', '), a.notes].filter(Boolean).join(' | '))}`,
      a.status === 'cancelled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return lines.filter(Boolean).join('\r\n')
}

export function download(filename, text, mime = 'text/calendar;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
