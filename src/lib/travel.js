// ---- Travel feasibility and routing (B3) ----
// Pure, no React. All distances are estimated from straight-line (haversine)
// × road factor at a configurable average speed. No map service, no guessing.
// Honest copy everywhere: "estimated from straight-line distance; not a map route".
//
// Data sources (per product choice client+office):
//   - client.geo: [lat,lng] for home, school, community sessions
//   - office geo: optional lat/lng on Settings > Organization offices, seeded for demo
//                 offices, used for center/clinic sessions
//   - unknown places are skipped, never guessed
//
// Defaults (configurable via settings.system.travel in future, but shipped fixed):
//   - road factor 1.3, avg speed 25 mph, buffer 5 min
//   - tight threshold 10 min (gap < travel+10 => tight, gap < travel => impossible)

const ROAD_FACTOR = 1.3
const AVG_SPEED_MPH = 25
const BUFFER_MIN = 5
const TIGHT_EXTRA_MIN = 10

// haversine distance in miles between two [lat,lng] pairs
export function haversineMi(a, b) {
  if (!a || !b) return null
  const [lat1, lon1] = Array.isArray(a) ? a : [a.lat, a.lng]
  const [lat2, lon2] = Array.isArray(b) ? b : [b.lat, b.lng]
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return null
  const toRad = (d) => (d * Math.PI) / 180
  const R = 3958.8 // earth radius miles
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLon / 2)
  const aa = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa))
  return R * c
}

export function estimateTravelMinutes(distanceMi, { roadFactor = ROAD_FACTOR, avgMph = AVG_SPEED_MPH, bufferMin = BUFFER_MIN } = {}) {
  if (!Number.isFinite(distanceMi) || distanceMi < 0) return null
  const roadMi = distanceMi * roadFactor
  const hours = roadMi / avgMph
  const mins = hours * 60 + bufferMin
  return Math.max(0, Math.round(mins))
}

export function travelLeg(fromCoord, toCoord, opts) {
  if (!fromCoord || !toCoord) return null
  const straightMi = haversineMi(fromCoord, toCoord)
  if (straightMi == null) return null
  const travelMin = estimateTravelMinutes(straightMi, opts)
  if (travelMin == null) return null
  return { straightMi, roadMi: straightMi * (opts?.roadFactor ?? ROAD_FACTOR), travelMin }
}

// Resolve an appointment's location to coords
// state: full workspace (for clients, settings.offices)
// appt: { location, clientIds, type, origin, destination }
// Returns { lat, lng, label, source: 'office'|'client'|'drive' } or null if unknown/skipped
export function resolveApptLocation(state, appt) {
  if (!appt) return null
  // telehealth has no travel
  const loc = String(appt.location || '').trim()
  if (!loc) {
    // no location string — try client geo for home/school/community if we have a client
    const cid = (appt.clientIds || [])[0]
    if (cid) {
      const cl = (state.clients || []).find((c) => c.id === cid)
      if (cl?.geo && Array.isArray(cl.geo) && cl.geo.length >= 2) {
        return { lat: cl.geo[0], lng: cl.geo[1], label: cl.name || cl.home || 'client home', source: 'client' }
      }
    }
    return null
  }
  const lower = loc.toLowerCase()
  if (lower.includes('telehealth') || lower.includes('video') || lower.includes('remote')) return null

  // 1) office match
  const offices = state.settings?.offices || []
  const office = offices.find((o) => o.name === loc || o.name.toLowerCase() === lower)
  if (office) {
    // if office has explicit lat/lng, use it
    const lat = office.lat ?? office.geo?.[0] ?? office.latitude
    const lng = office.lng ?? office.geo?.[1] ?? office.longitude
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return { lat: Number(lat), lng: Number(lng), label: office.name, source: 'office' }
    }
    // office exists but no coords — unknown, skip (never guess)
    return null
  }

  // 2) drive appointments have origin/destination strings; try to resolve each as office first, else client
  if (appt.type === 'drive') {
    // for drive, the location itself might be \"A → B\"; we already handled office match above.
    // Fallback: try origin/destination as office or client
    for (const key of ['origin', 'destination']) {
      const name = String(appt[key] || '').trim()
      if (!name) continue
      const off = offices.find((o) => o.name === name)
      if (off) {
        const lat = off.lat ?? off.geo?.[0]
        const lng = off.lng ?? off.geo?.[1]
        if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
          return { lat: Number(lat), lng: Number(lng), label: off.name, source: 'office' }
        }
      }
    }
  }

  // 3) client geo for home/school/community sessions
  const cid = (appt.clientIds || [])[0]
  if (cid) {
    const cl = (state.clients || []).find((c) => c.id === cid)
    if (cl?.geo && Array.isArray(cl.geo) && cl.geo.length >= 2) {
      // only use client geo when location is not a center? But per product choice we use client geo for
      // home, school, community. Center sessions should have used office geo above; if office geo missing,
      // we skip rather than using client geo for center (to avoid guessing). So check if location looks like a center.
      const centerish = ['center', 'clinic', 'assessment lab', 'room'].some((k) => lower.includes(k))
      if (centerish) return null // center without office coords -> unknown, skip
      return { lat: cl.geo[0], lng: cl.geo[1], label: cl.name || cl.home || loc, source: 'client' }
    }
  }

  return null
}

// For a staff member's day, compute travel checks against a draft appointment
// draft: { id, date, start, end, location, clientIds, type }
// existing: array of appts on same date for that staff, excluding draft id, sorted by start
// Returns array of { kind: 'prev'|'next', staffId, staffName, fromAppt, toAppt, fromLoc, toLoc, gapMin, travelMin, distanceMi, severity: 'impossible'|'tight'|'ok', message }
export function travelChecksForStaffDay(state, staffId, draft, existingSorted, opts) {
  const out = []
  if (!draft?.date || !(draft.end > draft.start)) return out
  const staff = (state.staff || []).find((s) => s.id === staffId)
  const staffName = staff?.name || staffId

  // find previous and next
  let prev = null
  let next = null
  for (const a of existingSorted) {
    if (a.end <= draft.start) {
      if (!prev || a.end > prev.end) prev = a
    }
    if (a.start >= draft.end) {
      if (!next || a.start < next.start) next = a
    }
  }

  const draftLoc = resolveApptLocation(state, draft)

  if (prev) {
    const prevLoc = resolveApptLocation(state, prev)
    if (prevLoc && draftLoc) {
      const leg = travelLeg([prevLoc.lat, prevLoc.lng], [draftLoc.lat, draftLoc.lng], opts)
      if (leg) {
        const gapMin = draft.start - prev.end
        const needed = leg.travelMin
        let severity = 'ok'
        if (gapMin < needed) severity = 'impossible'
        else if (gapMin < needed + TIGHT_EXTRA_MIN) severity = 'tight'
        if (severity !== 'ok') {
          out.push({
            kind: 'prev',
            staffId,
            staffName,
            fromAppt: prev,
            toAppt: draft,
            fromLoc: prevLoc,
            toLoc: draftLoc,
            gapMin,
            travelMin: needed,
            distanceMi: leg.straightMi,
            roadMi: leg.roadMi,
            severity,
            message:
              severity === 'impossible'
                ? `${staffName} needs about ${needed} min from ${prevLoc.label} to ${draftLoc.label}; the gap is ${gapMin} min`
                : `${staffName} has a tight turnaround: about ${needed} min from ${prevLoc.label} to ${draftLoc.label}, gap ${gapMin} min`,
          })
        }
      }
    }
  }

  if (next) {
    const nextLoc = resolveApptLocation(state, next)
    if (nextLoc && draftLoc) {
      const leg = travelLeg([draftLoc.lat, draftLoc.lng], [nextLoc.lat, nextLoc.lng], opts)
      if (leg) {
        const gapMin = next.start - draft.end
        const needed = leg.travelMin
        let severity = 'ok'
        if (gapMin < needed) severity = 'impossible'
        else if (gapMin < needed + TIGHT_EXTRA_MIN) severity = 'tight'
        if (severity !== 'ok') {
          out.push({
            kind: 'next',
            staffId,
            staffName,
            fromAppt: draft,
            toAppt: next,
            fromLoc: draftLoc,
            toLoc: nextLoc,
            gapMin,
            travelMin: needed,
            distanceMi: leg.straightMi,
            roadMi: leg.roadMi,
            severity,
            message:
              severity === 'impossible'
                ? `${staffName} needs about ${needed} min from ${draftLoc.label} to ${nextLoc.label}; the gap is ${gapMin} min`
                : `${staffName} has a tight turnaround to next: about ${needed} min from ${draftLoc.label} to ${nextLoc.label}, gap ${gapMin} min`,
          })
        }
      }
    }
  }

  return out
}

// For a full day's route for one staff member, return legs
// apptsSorted: sorted by start, same date, same staff, non-cancelled
// Returns { legs: [{ fromAppt, toAppt, fromLoc, toLoc, gapMin, travelMin, distanceMi, severity }], totals: { distanceMi, travelMin, impossible, tight } }
export function routeForDay(state, apptsSorted, opts) {
  const legs = []
  let totalDist = 0
  let totalTravel = 0
  let impossible = 0
  let tight = 0

  for (let i = 0; i < apptsSorted.length - 1; i++) {
    const from = apptsSorted[i]
    const to = apptsSorted[i + 1]
    const fromLoc = resolveApptLocation(state, from)
    const toLoc = resolveApptLocation(state, to)
    if (!fromLoc || !toLoc) continue
    const leg = travelLeg([fromLoc.lat, fromLoc.lng], [toLoc.lat, toLoc.lng], opts)
    if (!leg) continue
    const gapMin = to.start - from.end
    const needed = leg.travelMin
    let severity = 'ok'
    if (gapMin < needed) {
      severity = 'impossible'
      impossible++
    } else if (gapMin < needed + TIGHT_EXTRA_MIN) {
      severity = 'tight'
      tight++
    }
    totalDist += leg.straightMi
    totalTravel += needed
    legs.push({
      fromAppt: from,
      toAppt: to,
      fromLoc,
      toLoc,
      gapMin,
      travelMin: needed,
      distanceMi: leg.straightMi,
      roadMi: leg.roadMi,
      severity,
    })
  }

  return { legs, totals: { distanceMi: totalDist, travelMin: totalTravel, impossible, tight } }
}

// Suggest a re-ordering that minimizes total travel distance (brute force for small n, heuristic for larger)
// For a day with up to 8 appts, try all permutations that respect fixed-time appointments? For v1, we keep
// it simple: sort by nearest neighbor greedy starting from first appointment's location, but show as
// read-only suggestion with miles saved. Honest: not a map route.
export function suggestRouteOrder(state, apptsSorted, opts) {
  if (apptsSorted.length <= 2) return null
  // Only consider appts that have resolvable locations
  const withLoc = apptsSorted
    .map((a) => ({ appt: a, loc: resolveApptLocation(state, a) }))
    .filter((x) => x.loc)
  if (withLoc.length <= 2) return null

  // Current total straight distance
  let currentDist = 0
  for (let i = 0; i < withLoc.length - 1; i++) {
    const d = haversineMi([withLoc[i].loc.lat, withLoc[i].loc.lng], [withLoc[i + 1].loc.lat, withLoc[i + 1].loc.lng])
    if (d != null) currentDist += d
  }

  // Greedy nearest neighbor starting from first appt (keep first fixed for continuity, but also try all starts)
  // For simplicity, keep first appointment fixed (often the earliest is least movable), then greedy.
  const remaining = withLoc.slice(1)
  const ordered = [withLoc[0]]
  let pool = [...remaining]
  while (pool.length) {
    const last = ordered[ordered.length - 1]
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < pool.length; i++) {
      const d = haversineMi([last.loc.lat, last.loc.lng], [pool[i].loc.lat, pool[i].loc.lng])
      if (d != null && d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    ordered.push(pool[bestIdx])
    pool.splice(bestIdx, 1)
  }

  let suggestedDist = 0
  for (let i = 0; i < ordered.length - 1; i++) {
    const d = haversineMi([ordered[i].loc.lat, ordered[i].loc.lng], [ordered[i + 1].loc.lat, ordered[i + 1].loc.lng])
    if (d != null) suggestedDist += d
  }

  const savedMi = currentDist - suggestedDist
  if (savedMi <= 0.1) return null // no meaningful saving

  return {
    currentOrder: withLoc.map((x) => x.appt),
    suggestedOrder: ordered.map((x) => x.appt),
    currentDist,
    suggestedDist,
    savedMi,
    savedMin: estimateTravelMinutes(savedMi, opts) - BUFFER_MIN, // rough
  }
}

export const TRAVEL_DEFAULTS = { roadFactor: ROAD_FACTOR, avgMph: AVG_SPEED_MPH, bufferMin: BUFFER_MIN, tightExtraMin: TIGHT_EXTRA_MIN }
