import { parseISO, minToHM, addDays, isoDate } from './date'
import { isCancelStatus, telehealthRoomFor } from './settingsMasters'

const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

// roomFor(appt) → the practice's video room link for telehealth sessions ('' otherwise)
export function buildICS(appts, staffById, clientsById, isCancel = (s) => s === 'cancelled' || s === 'no-show', roomFor = () => '') {
  const dt = (iso, min) => {
    const d = parseISO(iso)
    d.setHours(Math.floor(min / 60), min % 60, 0, 0)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AlohaABA//Scheduler//EN', 'CALSCALE:GREGORIAN']
  for (const a of appts) {
    const room = roomFor(a)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@pulseaba`,
      `DTSTAMP:${dt(a.date, 0)}Z`,
      `DTSTART:${dt(a.date, a.start)}`,
      `DTEND:${dt(a.date, a.end)}`,
      `SUMMARY:${esc(a.title)}`,
      a.location ? `LOCATION:${esc(a.location)}` : '',
      `DESCRIPTION:${esc([(a.staffIds || []).map((s) => staffById[s]?.name).filter(Boolean).join(', '), (a.clientIds || []).map((c) => clientsById[c]?.name).filter(Boolean).join(', '), a.notes, room && `Video room: ${room}`].filter(Boolean).join(' | '))}`,
      room ? `URL:${room}` : '',
      isCancel(a.status) ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return lines.filter(Boolean).join('\r\n')
}

// One staff member's next `days` of bookings as a one-off .ics file for Apple or Google Calendar.
// It is a file, not a feed: nothing syncs, so the user downloads it again after changes.
// withClients=false leaves client names out (roles that cannot open Clients).
export function staffCalendar(state, staffId, today, { days = 90, withClients = true } = {}) {
  const person = (state.staff || []).find((s) => s.id === staffId)
  if (!person) return { ok: false, msg: 'That staff member no longer exists.' }
  const end = isoDate(addDays(parseISO(today), days))
  const appts = Object.values(state.appts || {})
    .filter((a) => (a.staffIds || []).includes(staffId) && a.date >= today && a.date < end)
    .sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1))
  if (!appts.length) return { ok: false, msg: `${person.name} has nothing booked in the next ${days} days.` }
  const staffById = Object.fromEntries((state.staff || []).map((s) => [s.id, s]))
  const clientsById = withClients ? Object.fromEntries((state.clients || []).map((c) => [c.id, c])) : {}
  const text = buildICS(appts, staffById, clientsById, (k) => isCancelStatus(state.settings, k), (a) => telehealthRoomFor(state.settings, a))
  const slug = person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    ok: true,
    count: appts.length,
    text,
    filename: `calendar-${slug}-${today}.ics`,
    msg: `Saved ${appts.length} bookings for ${person.name} as an .ics file. Import it into Apple or Google Calendar; it does not update itself, so download it again after changes.`,
  }
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
