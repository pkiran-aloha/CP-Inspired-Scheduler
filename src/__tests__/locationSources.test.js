import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { locationSuggestions, mapsUrlFor, HOME_PREFIX } from '../lib/locationSources'
import { posFor } from '../lib/claims'
import { resolveApptLocation } from '../lib/travel'
import { addDays, isoDate, parseISO, todayISO } from '../lib/date'

const shift = (iso, n) => isoDate(addDays(parseISO(iso), n))
const DATE = shift(todayISO(), 10)
const BASE = blankState()
const C = { ...BASE.clients[0], home: 'Main Center', street: '12 Test Ln', city: 'San Jose', state: 'CA', zip: '95110' }
const S = BASE.staff[0]
const mk = (id, x) => ({ id, date: DATE, start: 540, end: 600, type: 'service', status: 'active', staffIds: [S.id], clientIds: [], location: 'Lincoln Elementary', ...x })
const stateWith = (appts) => ({ ...BASE, clients: [C, ...BASE.clients.slice(1)], appts: Object.fromEntries(appts.map((a) => [a.id, a])) })
const draft = (x = {}) => ({ id: '__draft__', date: DATE, start: 660, clientIds: [C.id], staffIds: [S.id], ...x })
const first = S.name.split(' ')[0]

describe('locationSuggestions', () => {
  it('offers the client site and home address, the staff previous stop, then offices, each tagged', () => {
    const list = locationSuggestions(stateWith([mk('a1', {})]), draft())
    const by = Object.fromEntries(list.map((s) => [s.source, s]))
    expect(list[0]).toMatchObject({ value: 'Main Center', group: 'Client', source: 'client-site' })
    expect(by['client-home']).toMatchObject({ value: `${HOME_PREFIX}12 Test Ln, San Jose, CA 95110`, sub: 'Client home address' })
    expect(by['staff-prev']).toMatchObject({ value: 'Lincoln Elementary', group: 'Staff', sub: `After ${first}'s 9 AM` })
    expect(by.telehealth.value).toBe('Telehealth (video)')
    // offered once even though it is also an office
    expect(list.filter((s) => s.value === 'Main Center')).toHaveLength(1)
    expect(list.filter((s) => s.value === 'Lincoln Elementary')).toHaveLength(1)
    expect(list.some((s) => s.value === 'Clinic Room 2')).toBe(false) // not a schedulable location
  })

  it('takes the latest same-day stop that ends by the start, skipping cancelled and drive blocks', () => {
    const s = stateWith([
      mk('early', { start: 420, end: 480, location: 'Northside Center' }),
      mk('late', { start: 540, end: 600, location: 'Library community session' }),
      mk('cx', { start: 600, end: 650, location: 'North Clinic', status: 'cancelled' }),
      mk('drv', { start: 600, end: 655, type: 'drive', location: 'A → B' }),
      mk('after', { start: 700, end: 760, location: 'Jefferson Elementary' }),
    ])
    const prev = locationSuggestions(s, draft()).find((x) => x.source === 'staff-prev')
    expect(prev.value).toBe('Library community session')
  })

  it('falls back to the most recent earlier day, and offers nothing without history', () => {
    const s = stateWith([mk('old', { date: shift(DATE, -3), location: 'Northside Center' }), mk('older', { date: shift(DATE, -9), location: 'North Clinic' })])
    const prev = locationSuggestions(s, draft()).find((x) => x.source === 'staff-prev')
    expect(prev.value).toBe('Northside Center')
    expect(prev.sub).toContain(`${first}'s last stop, ${shift(DATE, -3)}`)
    expect(locationSuggestions(stateWith([]), draft()).some((x) => x.source === 'staff-prev')).toBe(false)
  })
})

describe('free-text and suggested values downstream', () => {
  it('a client home address bills as POS 12 and travels from the client geo', () => {
    const appt = { location: `${HOME_PREFIX}12 Test Ln, San Jose, CA 95110`, clientIds: [C.id] }
    expect(posFor(appt)).toBe('12')
    expect(resolveApptLocation(stateWith([]), appt)).toMatchObject({ source: 'client' })
  })

  it('mapsUrlFor builds a search link only from text the app already has', () => {
    const s = stateWith([])
    expect(mapsUrlFor(s, '45 Any Rd, Campbell')).toBe('https://www.google.com/maps/search/?api=1&query=45%20Any%20Rd%2C%20Campbell')
    expect(mapsUrlFor(s, `${HOME_PREFIX}12 Test Ln`)).toContain('query=12%20Test%20Ln')
    expect(mapsUrlFor(s, 'Main Center')).toContain(encodeURIComponent('1140 Sunset Crest Way'))
    expect(mapsUrlFor(s, 'Telehealth (video)')).toBe('')
    expect(mapsUrlFor(s, 'Community park session')).toBe('') // office with no street address
    expect(mapsUrlFor(s, '')).toBe('')
    const site = { ...C, home: "Test family's home" }
    expect(mapsUrlFor({ ...s, clients: [site] }, "Test family's home", [C.id])).toContain('query=12%20Test%20Ln')
  })
})
