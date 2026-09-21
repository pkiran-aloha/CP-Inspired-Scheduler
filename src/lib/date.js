// ---- Date / time helpers (all local wall-clock, minutes-of-day based) ----

export const pad = (n) => String(n).padStart(2, '0')

export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export const addMonths = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const day = Math.min(d.getDate(), daysInMonth(x.getFullYear(), x.getMonth()))
  x.setDate(day)
  return x
}

export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()

export const startOfWeek = (d, weekStartsOn = 0) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const diff = (x.getDay() - weekStartsOn + 7) % 7
  return addDays(x, -diff)
}

export const todayISO = () => isoDate(new Date())

export const minToHM = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

export const hmToMin = (hm) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

export function fmtTime(m, h24 = false) {
  let h = Math.floor(m / 60) % 24
  const mm = m % 60
  if (h24) return `${pad(h)}:${pad(mm)}`
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return mm === 0 ? `${h} ${ap}` : `${h}:${pad(mm)} ${ap}`
}

// "9:00 AM – 10:30 AM" style range, AM/PM only when it changes
export function fmtRange(s, e, h24 = false) {
  if (h24) return `${minToHM(s)}–${minToHM(e)}`
  const apOf = (m) => (Math.floor(m / 60) >= 12 ? 'PM' : 'AM')
  const same = apOf(s) === apOf(e)
  const t = (m) => (same ? fmtTime(m).replace(/ (AM|PM)$/, '') : fmtTime(m))
  return `${t(s)}–${t(e)} ${apOf(e)}`
}

export function fmtDur(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m}m`
  if (!m) return `${h}h`
  return `${h}h ${m}m`
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_MINI = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDayLabel(iso, style = 'short') {
  const d = parseISO(iso)
  if (style === 'full') return `${DAY_NAMES[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
  if (style === 'agenda') return `${DAY_SHORT[d.getDay()]} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
  return `${DAY_SHORT[d.getDay()]} ${pad(d.getMonth() + 1)}/${d.getDate()}`
}

export function monthLabel(y, m) {
  return `${MONTHS[m]} ${y}`
}

export function rangeLabel(view, days, weekStartsOn) {
  const first = parseISO(days[0])
  const last = parseISO(days[days.length - 1])
  const f = (d) => `${MONTHS[d.getMonth()].slice(0, 3)} ${pad(d.getDate())}`
  if (view === 'day') return `${DAY_NAMES[first.getDay()]} · ${MONTHS[first.getMonth()].slice(0, 3)} ${first.getDate()}, ${first.getFullYear()}`
  if (view === 'week' || view === 'timeline') {
    if (first.getMonth() === last.getMonth()) return `${MONTHS[first.getMonth()].slice(0, 3)} ${pad(first.getDate())} – ${pad(last.getDate())} ${first.getFullYear()}`
    return `${f(first)} – ${f(last)} ${last.getFullYear()}`
  }
  if (view === 'agenda') return `Agenda · ${f(first)} – ${f(last)}`
  return monthLabel(first.getFullYear(), first.getMonth())
}

export function weekNum(iso) {
  const d = parseISO(iso)
  const target = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - target) / 86400000 + target.getDay() + 1) / 7)
}

export const snap = (m, s) => Math.max(0, Math.min(1440, Math.round(m / s) * s))
