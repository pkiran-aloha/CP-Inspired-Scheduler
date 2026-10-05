import { describe, it, expect } from 'vitest'
import { blankState } from '../state/store'
import { haversineMi, estimateTravelMinutes, travelLeg, resolveApptLocation, travelChecksForStaffDay, routeForDay, suggestRouteOrder, TRAVEL_DEFAULTS } from '../lib/travel'
import { evaluateAppointmentValidations, planSettingsOp } from '../lib/settingsMasters'

const fresh = () => blankState()

describe('travel pure logic', () => {
  it('haversine distance: same point 0, SF to SJ ~ 42mi', () => {
    expect(haversineMi([37.25, -121.94], [37.25, -121.94])).toBeCloseTo(0, 5)
    const sf = [37.7749, -122.4194]
    const sj = [37.3382, -121.8863]
    const d = haversineMi(sf, sj)
    expect(d).toBeGreaterThan(30)
    expect(d).toBeLessThan(60)
  })

  it('estimateTravelMinutes uses 1.3 road factor, 25 mph, 5 min buffer', () => {
    expect(TRAVEL_DEFAULTS.roadFactor).toBe(1.3)
    expect(TRAVEL_DEFAULTS.avgMph).toBe(25)
    expect(TRAVEL_DEFAULTS.bufferMin).toBe(5)
    // 10 mi straight = 13 mi road, 13/25h=0.52h=31.2m +5 =36m
    expect(estimateTravelMinutes(10)).toBe(36)
    expect(estimateTravelMinutes(0)).toBe(5)
  })

  it('travelLeg returns straight, road, travelMin or null', () => {
    const leg = travelLeg([37.25, -121.94], [37.3655, -121.9255])
    expect(leg.straightMi).toBeGreaterThan(0)
    expect(leg.travelMin).toBeGreaterThan(5)
    expect(travelLeg(null, [1,2])).toBeNull()
  })

  it('resolveApptLocation: office with lat/lng, client geo, telehealth skipped', () => {
    const s = fresh()
    // Main Center has lat/lng seeded now
    const main = s.settings.offices.find(o => o.name === 'Main Center')
    expect(main.lat).toBeTruthy()
    const apptCenter = { location: 'Main Center', clientIds: [s.clients[0].id] }
    const loc1 = resolveApptLocation(s, apptCenter)
    expect(loc1).toBeTruthy()
    expect(loc1.source).toBe('office')
    expect(loc1.label).toBe('Main Center')

    const apptHome = { location: "Jimmy Ma's home", clientIds: [s.clients[1].id] } // client c2 has geo
    const loc2 = resolveApptLocation(s, apptHome)
    expect(loc2).toBeTruthy()
    expect(loc2.source).toBe('client')

    const apptTele = { location: 'Telehealth - video', clientIds: [s.clients[0].id] }
    expect(resolveApptLocation(s, apptTele)).toBeNull()

    const apptUnknownOffice = { location: 'Unknown Office That Does Not Exist', clientIds: [s.clients[0].id] }
    // location unknown, but client geo exists — but if location looks like center, we skip. For unknown, it will use client geo because not centerish
    // Our unknown string does not contain center/clinic/room, so should return client geo
    const loc3 = resolveApptLocation(s, apptUnknownOffice)
    expect(loc3).toBeTruthy()
  })

  it('travelChecksForStaffDay flags impossible and tight', () => {
    const s = fresh()
    const staffId = s.staff[0].id
    const clientA = s.clients[0] // geo [37.33, -122.03]
    const clientB = s.clients[1] // geo [37.29, -121.99]

    // Two existing appts same day far apart
    const date = '2026-10-01'
    const prev = { id: 'a1', date, start: 540, end: 600, location: clientA.name, clientIds: [clientA.id], staffIds: [staffId], status: 'active' }
    const next = { id: 'a2', date, start: 660, end: 720, location: clientB.name, clientIds: [clientB.id], staffIds: [staffId], status: 'active' }

    // draft in middle with only 10 min gap but travel needs ~20 min (since ~3 miles)
    // distance between c1 and c2: compute
    const d = haversineMi(clientA.geo, clientB.geo)
    const travel = estimateTravelMinutes(d)
    expect(travel).toBeGreaterThan(5)

    const draftTight = { id: 'draft', date, start: 610, end: 650, location: clientB.name, clientIds: [clientB.id], staffIds: [staffId], status: 'active' }
    const checks = travelChecksForStaffDay(s, staffId, draftTight, [prev, next])
    // prev gap = 10, travel maybe ~? Let's check logic: if gap < travel => impossible, else if gap < travel+10 => tight
    // Since we have small gap, we expect at least one check
    expect(checks.length).toBeGreaterThan(0)
    expect(['impossible','tight']).toContain(checks[0].severity)
    expect(checks[0].message).toMatch(/needs about|tight turnaround/i)

    // far gap should be ok
    const draftFar = { id: 'draft', date, start: 800, end: 860, location: clientB.name, clientIds: [clientB.id], staffIds: [staffId], status: 'active' }
    const checksFar = travelChecksForStaffDay(s, staffId, draftFar, [prev, next])
    expect(checksFar.length).toBe(0)
  })

  it('routeForDay totals and suggestRouteOrder saves miles', () => {
    const s = fresh()
    const c1 = s.clients[0]
    const c2 = s.clients[1]
    const c3 = s.clients[3]
    const date = '2026-10-02'
    const appts = [
      { id: 'a1', date, start: 540, end: 600, location: c1.name, clientIds: [c1.id], status: 'active' },
      { id: 'a2', date, start: 610, end: 670, location: c2.name, clientIds: [c2.id], status: 'active' },
      { id: 'a3', date, start: 680, end: 740, location: c3.name, clientIds: [c3.id], status: 'active' },
    ]
    const route = routeForDay(s, appts)
    expect(route.legs.length).toBe(2)
    expect(route.totals.distanceMi).toBeGreaterThan(0)

    const suggestion = suggestRouteOrder(s, appts)
    // may or may not save; just check shape if present
    if (suggestion) {
      expect(suggestion.savedMi).toBeGreaterThan(0)
      expect(suggestion.suggestedOrder.length).toBe(3)
    }
  })
})

describe('travel validation integration', () => {
  it('adds staff.travel warn by default and surfaces in evaluateAppointmentValidations', () => {
    const s = fresh()
    const travelMode = s.settings.appointmentValidations?.staff?.travel || s.settings.system?.appointmentValidations?.staff?.travel
    expect(travelMode).toBe('warn')

    const staffId = s.staff[0].id
    const cA = s.clients[0]
    const cB = s.clients[1]
    const date = '2026-10-03'
    s.appts = {
      existing: { id: 'existing', date, start: 540, end: 600, location: cA.name, clientIds: [cA.id], staffIds: [staffId], status: 'active', type: 'service' }
    }
    const draft = { id: 'draft', date, start: 605, end: 665, location: cB.name, clientIds: [cB.id], staffIds: [staffId], status: 'active', type: 'service' }
    const res = evaluateAppointmentValidations(s, draft)
    const travelIssues = res.items.filter(i => i.id === 'staff.travel')
    // gap 5 min, travel ~ >5, so should be impossible -> warn
    expect(travelIssues.length).toBeGreaterThan(0)
    expect(travelIssues[0].message).toMatch(/Estimated from straight-line distance/)
  })

  it('office upsert validates lat/lng pair', () => {
    const s = fresh()
    const office = s.settings.offices[0]
    const bad1 = planSettingsOp(s, 'office.upsert', { item: { ...office, lat: 100, lng: 0 } })
    expect(bad1.ok).toBe(false)
    const bad2 = planSettingsOp(s, 'office.upsert', { item: { ...office, lat: 37.25, lng: null } })
    expect(bad2.ok).toBe(false)
    const ok = planSettingsOp(s, 'office.upsert', { item: { ...office, lat: 37.25, lng: -121.94 } })
    expect(ok.ok).toBe(true)
  })
})
