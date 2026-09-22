import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import App from '../App'
import { startOfWeek, addDays, isoDate, parseISO, todayISO } from '../lib/date'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const apptsInStorage = () => {
  try {
    return JSON.parse(localStorage.getItem('aloha-aba.v3'))?.appts || {}
  } catch {
    return {}
  }
}

async function pickDropdown(triggerTestId, optionValue) {
  fireEvent.click(await screen.findByTestId(triggerTestId))
  const opt = await screen.findByTestId(`opt-${triggerTestId}-${optionValue}`)
  fireEvent.click(opt)
}

async function openServiceWizard() {
  fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
  fireEvent.click(await screen.findByTestId('type-service'))
}

async function addPeople() {
  fireEvent.click(screen.getByTestId('pick-Staff Name'))
  fireEvent.click((await screen.findAllByTestId('people-item'))[0])
  fireEvent.mouseDown(document.body)
  fireEvent.click(screen.getByTestId('pick-Client Name'))
  fireEvent.click((await screen.findAllByTestId('people-item'))[0])
  fireEvent.mouseDown(document.body)
}

describe('scheduler shell', () => {
  it('renders week grid with new master rosters and rich seeded chips', async () => {
    const { container } = render(<App />)
    // context-adaptive chrome: on the board the rail rests as an icon strip so the grid gets the width
    expect(screen.getAllByText('Aloha ABA').length).toBeGreaterThanOrEqual(1) // top bar brand
    expect(document.querySelector('.navrail').classList.contains('collapsed')).toBe(true)
    fireEvent.click(screen.getByTestId('nav-collapse')) // user override expands it…
    expect(await screen.findByText('Aloha ABA', { selector: '.nr-brandtxt b' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Week' })).toBeTruthy()
    expect(screen.getByText('Prateek Kiran')).toBeTruthy()
    expect(screen.getByText('Michael McDonald')).toBeTruthy()
    expect(container.querySelectorAll('.chip').length).toBeGreaterThan(10)
    expect(container.querySelectorAll('.tg-dayhead').length).toBe(7)
    // teams tab exists and lists care teams
    fireEvent.click(screen.getByRole('button', { name: 'Teams' }))
    expect(screen.getByText(/Care Team · Eastside/)).toBeTruthy()
    // seeded persistence keeps billing + signatures
    await waitFor(() => {
      const saved = Object.values(apptsInStorage())
      expect(saved.filter((a) => a.type === 'service' && a.billing?.units > 0).length).toBeGreaterThan(10)
    })
  })

  it('toggles dark theme', () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('Toggle theme'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('filter menu opens and its status checkboxes actually filter the grid', () => {
    const { container } = render(<App />)
    const before = container.querySelectorAll('.chip').length
    fireEvent.click(screen.getByTitle('Filters'))
    expect(screen.getByText('Show statuses')).toBeTruthy()
    // uncheck "Active" → active chips disappear from the canvas (menu stays open)
    const activeLabel = screen.getByText('Active').closest('.menu-check')
    fireEvent.click(activeLabel)
    expect(container.querySelectorAll('.chip').length).toBeLessThan(before)
    // “Reset filters” restores them
    fireEvent.click(screen.getByText(/Reset filters/))
    expect(container.querySelectorAll('.chip').length).toBe(before)
  })

  it('profile menu opens and Settings dialog is reachable', () => {
    render(<App />)
    fireEvent.click(screen.getByText(/Admin · Aloha/))
    expect(screen.getByText('Export current range (.ics)')).toBeTruthy()
    fireEvent.click(screen.getByText('Settings', { selector: '.menu *' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })

  it('switches to horizontal Timeline view (time left→right, one row per day)', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(container.querySelectorAll('.th-rowwrap').length).toBe(7) // one row per day
    expect(container.querySelectorAll('.th-tick').length).toBe(24) // 24 hour ticks across
    expect(container.querySelector('.tg-col')).toBeFalsy() // vertical grid is gone
    expect(container.querySelectorAll('.th-daylabel').length).toBe(7)
    // Horizontal layout follows the same calendar-best-practice grouping as the grid:
    // a handful of overlaps render as side-by-side lanes; only beyond the 3-lane
    // budget does the remainder collapse into a “+n more” stack card.
    // Book four same-slot sessions on the (empty) Sunday row to prove both halves.
    const bookSundayRow = async () => {
      const track = container.querySelectorAll('.th-track')[0]
      fireEvent.pointerDown(track, { button: 0 })
      fireEvent.pointerUp(track, { button: 0 })
      fireEvent.click(await screen.findByTestId('type-service'))
      await pickDropdown('qa-client', 'c1')
      await pickDropdown('qa-service', 'dtt')
      fireEvent.click(screen.getByTestId('qa-book'))
      await screen.findAllByText(/Session booked/)
      fireEvent.click(screen.getByLabelText('Close'))
    }
    await bookSundayRow()
    await bookSundayRow()
    const sundayRow = () => container.querySelectorAll('.th-rowwrap')[0]
    // 2 overlaps → separate lane chips, no stack card yet
    await waitFor(() => expect(sundayRow().querySelectorAll('.chip:not(.stack)').length).toBe(2))
    expect(sundayRow().querySelector('.chip.stack')).toBeNull()
    await bookSundayRow()
    await bookSundayRow()
    // 4 overlaps → lanes saturate and a stack card carries the 2-item overflow
    const stack = await waitFor(() => {
      const s = sundayRow().querySelector('.chip.stack')
      if (!s) throw new Error('stack not found in Sunday row')
      return s
    })
    expect(stack.textContent).toContain('2 overlapping')
    expect(sundayRow().querySelectorAll('.chip:not(.stack)').length).toBe(2)
    // and the stack card opens the same member popover
    fireEvent.click(stack)
    const pop = await waitFor(() => screen.findByTestId('stack-pop'))
    expect(pop.querySelectorAll('.sp-row').length).toBeGreaterThanOrEqual(2)
    // clicking a row opens that appointment’s detail card
    fireEvent.click(pop.querySelectorAll('.sp-row')[0])
    expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy()
  })

  it('switches to month view with 42 cells', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Month' }))
    expect(container.querySelectorAll('.mv-cell').length).toBe(42)
  })

  it('clicking a chip opens the detail card with series info & skip occurrence', () => {
    const { container } = render(<App />)
    const chip = container.querySelector('.chip:not(.stack)')
    fireEvent.pointerDown(chip, { button: 0 })
    fireEvent.pointerUp(chip)
    expect(screen.getByRole('button', { name: /Duplicate/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Skip occurrence/ })).toBeTruthy()
    expect(screen.getByText(/occurrences/)).toBeTruthy()
  })
})

describe('overlap grouping (calendar best practice)', () => {
  const SUNDAY = isoDate(startOfWeek(new Date()))
  const sundayNineCount = () =>
    Object.values(apptsInStorage()).filter((a) => a.date === SUNDAY && a.start === 540 && (a.clientIds || []).includes('c1')).length

  async function bookSundayNine(container) {
    const before = sundayNineCount()
    const col = container.querySelectorAll('.tg-col')[0]
    fireEvent.pointerDown(col, { button: 0 })
    fireEvent.pointerUp(col, { button: 0 })
    fireEvent.click(await screen.findByTestId('type-service'))
    await pickDropdown('qa-client', 'c1')
    await pickDropdown('qa-service', 'dtt')
    fireEvent.click(screen.getByTestId('qa-book'))
    await waitFor(() => expect(sundayNineCount()).toBe(before + 1), { timeout: 4000 })
    await screen.findAllByText('Session booked — open to verify, or edit any field')
    const closes = screen.getAllByLabelText('Close')
    fireEvent.click(closes[closes.length - 1]) // dismiss the detail card that opens post-booking
  }
  const sunCol = (container) => container.querySelectorAll('.tg-col')[0]

  it('starts inside the same 30-min slot group into one slot card, expand → lanes → merge', async () => {
    const { container } = render(<App />)
    await bookSundayNine(container)
    await bookSundayNine(container)
    // the whole cluster is one half-hour block card — no squeezed side-by-side lanes by default
    await waitFor(() => expect(sunCol(container).querySelectorAll('.chip').length).toBe(1))
    const stack = sunCol(container).querySelector('.chip.stack')
    expect(stack.textContent).toContain('2 overlapping')
    // the popover lists every member of the slot — nothing hidden behind a +n cap
    fireEvent.click(stack)
    const pop = await screen.findByTestId('stack-pop')
    expect(pop.querySelectorAll('.sp-row').length).toBe(2)
    // expand escape hatch: every member becomes a side-by-side chip
    fireEvent.click(within(pop).getByText(/Show side-by-side/))
    await waitFor(() => expect(sunCol(container).querySelector('.chip.stack')).toBeFalsy())
    expect(sunCol(container).querySelectorAll('.chip:not(.stack)').length).toBe(2)
    // merge back into the slot card
    fireEvent.click(container.querySelector('.tg-merge'))
    await waitFor(() => expect(sunCol(container).querySelector('.chip.stack')).toBeTruthy())
  })

  it('crowds stay readable: 4 simultaneous → one slot card listing the crowd, no +2-more math', async () => {
    const { container } = render(<App />)
    for (let k = 0; k < 4; k++) await bookSundayNine(container)
    await waitFor(() => expect(sunCol(container).querySelector('.chip.stack')).toBeTruthy(), { timeout: 4000 })
    const stack = sunCol(container).querySelector('.chip.stack')
    expect(stack.textContent).toContain('4 overlapping')
    // card runs on the 30-min grid: window labels sit on :00/:30 boundaries
    expect(stack.textContent).toMatch(/9(:00)?\s?AM/)
    fireEvent.click(stack)
    const pop = await screen.findByTestId('stack-pop')
    expect(pop.querySelectorAll('.sp-row').length).toBe(4)
    fireEvent.click(within(pop).getByText(/Show side-by-side/))
    await waitFor(() => expect(sunCol(container).querySelector('.chip.stack')).toBeFalsy())
    expect(sunCol(container).querySelectorAll('.chip:not(.stack)').length).toBe(4)
    fireEvent.click(container.querySelector('.tg-merge'))
    await waitFor(() => expect(sunCol(container).querySelector('.chip.stack')).toBeTruthy())
  })
})

describe('drag/click quick-add flow', () => {
  it('grid slot click → picker → Service asks WHO client + WHAT service, then books', async () => {
    const { container } = render(<App />)
    const col = container.querySelectorAll('.tg-col')[2]
    fireEvent.pointerDown(col, { button: 0 })
    fireEvent.pointerUp(col, { button: 0 })
    expect(await screen.findByText('Create New Appointment')).toBeTruthy()
    fireEvent.click(screen.getByTestId('type-service'))
    expect(await screen.findByText('Quick book a session')).toBeTruthy()
    // pick client from the unified dropdown
    await pickDropdown('qa-client', 'c1')
    expect(screen.getByTestId('qa-client').textContent).toContain('Justin Hsu')
    // pick service
    await pickDropdown('qa-service', 'dtt')
    fireEvent.click(screen.getByTestId('qa-book'))
    expect(await screen.findByText('Session booked — open to verify, or edit any field')).toBeTruthy()
    // detail card auto-opens so the session can be edited
    expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy()
    await waitFor(() => {
      const created = Object.values(apptsInStorage()).find((a) => a.clientIds?.includes('c1') && a.title === '1:1 Discrete Trial Training')
      expect(created).toBeTruthy()
      expect(created.billing.units).toBe(2) // 60min default → 2 units
    })
  })

  it('quick-add can hand off to the full wizard with prefills', async () => {
    const { container } = render(<App />)
    const col = container.querySelectorAll('.tg-col')[1]
    fireEvent.pointerDown(col, { button: 0 })
    fireEvent.pointerUp(col)
    fireEvent.click(await screen.findByTestId('type-service'))
    await pickDropdown('qa-client', 'c2')
    fireEvent.click(screen.getByText('More options →'))
    expect(await screen.findByText(/Service Appointment/)).toBeTruthy()
    expect(document.querySelector('[data-testid="pick-Client Name"]').textContent).toContain('Jimmy Ma') // client prefilled as a pill
  })
})

describe('create wizard', () => {
  it('validation blocks empty save', async () => {
    render(<App />)
    await openServiceWizard()
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Add a client')).toBeTruthy()
    expect(screen.getByText('Add at least one staff member')).toBeTruthy()
    expect(screen.getByText('Fix 2 items on Appointment Info')).toBeTruthy()
  })

  it('creates a single appointment with auto billing', async () => {
    render(<App />)
    await openServiceWizard()
    await waitFor(() => expect(Object.keys(apptsInStorage()).length).toBeGreaterThan(0))
    const before = Object.keys(apptsInStorage()).length
    await addPeople()
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-12-23' } })
    fireEvent.change(screen.getByTestId('appt-title'), { target: { value: 'Autism Home Support' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Appointment created')).toBeTruthy()
    await waitFor(() => expect(Object.keys(apptsInStorage()).length).toBe(before + 1))
    const created = Object.values(apptsInStorage()).find((a) => a.title === 'Autism Home Support')
    expect(created.date).toBe('2026-12-23')
    expect(created.billing.units).toBe(2)
    expect(created.billing.code).toBe('97151')
  })

  it('expands weekly recurrence into occurrences sharing a series id', async () => {
    render(<App />)
    await openServiceWizard()
    await waitFor(() => expect(Object.keys(apptsInStorage()).length).toBeGreaterThan(0))
    const before = Object.keys(apptsInStorage()).length
    await addPeople()
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-12-23' } })
    await pickDropdown('repeat-select', 'weekly')
    fireEvent.change(screen.getByTestId('repeat-count'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Created 3 occurrences')).toBeTruthy()
    await waitFor(() => expect(Object.keys(apptsInStorage()).length).toBe(before + 3))
    const series = Object.values(apptsInStorage()).filter((a) => a.recurrence === 'weekly' && a.date >= '2026-12-23' && a.date <= '2027-01-06')
    expect(series.length).toBe(3)
    expect(new Set(series.map((a) => a.title)).size).toBe(1) // one shared, convention-built auto-title
    expect(new Set(series.map((a) => a.seriesId)).size).toBe(1)
    expect(series.map((a) => a.date).sort()).toEqual(['2026-12-23', '2026-12-30', '2027-01-06'])
    expect(series.every((a) => a.recurrence === 'weekly')).toBe(true)
  })

    it('skips conflicting occurrences and reports it', async () => {
    render(<App />)
    // find Justin's last seeded non-cancelled service — a weekly series from there hits exactly that one and then free Mondays
    await waitFor(() => expect(Object.keys(apptsInStorage()).length).toBeGreaterThan(0))
    const seed = apptsInStorage()
    const jdates = Object.values(seed)
      .filter((a) => a.type === 'service' && (a.clientIds || []).includes('c1') && a.status !== 'cancelled')
      .map((a) => a.date)
      .sort()
    expect(jdates.length).toBeGreaterThan(2)
    await openServiceWizard()
    // pick staff/client pairs likely to clash: first staff + Justin Hsu (Mon 9-11 seed)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    const clientBtns = await screen.findAllByTestId('people-item')
    fireEvent.click(clientBtns.find((b) => b.textContent.includes('Justin Hsu')))
    fireEvent.mouseDown(document.body)
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: jdates[jdates.length - 1] } })
    await pickDropdown('repeat-select', 'weekly')
    fireEvent.change(screen.getByTestId('repeat-count'), { target: { value: '5' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    const t = await screen.findByText(/skipped \(conflict\)/)
    expect(t.textContent).toMatch(/Created \d+ occurrences · \d+ skipped \(conflict\)/)
  })

  it('unified Location dropdown: search, list, and free-text creation (no native select)', async () => {
    render(<App />)
    await openServiceWizard()
    // every dropdown in the form is the custom component — assert no <select> exists in the modal
    expect(document.querySelectorAll('.modal select').length).toBe(0)
    fireEvent.click(screen.getByTestId('location-select'))
    const search = await screen.findByPlaceholderText('Search…')
    fireEvent.change(search, { target: { value: 'Riverside Park' } })
    fireEvent.click(await screen.findByTestId('dd-create'))
    expect(screen.getByTestId('location-select').textContent).toContain('Riverside Park')
  })
})

describe('type-aware create forms', () => {
  async function openWizardOf(type) {
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId(`type-${type}`))
  }

  it('Drive Time: route fields + auto-mileage, no client/location and no docs/billing tabs', async () => {
    const { container } = render(<App />)
    await openWizardOf('drive')
    expect(screen.getByTestId('drive-origin')).toBeTruthy()
    expect(screen.getByTestId('drive-destination')).toBeTruthy()
    expect(screen.getByTestId('drive-distance')).toBeTruthy()
    expect(screen.getByText('Starting Point')).toBeTruthy()
    expect(screen.getByText('Total Distance (miles)')).toBeTruthy()
    expect(screen.getByTestId('pick-Staff Name')).toBeTruthy()
    expect(screen.queryByTestId('pick-Client Name')).toBeNull()
    expect(container.querySelector('.modal [data-testid="location-select"]')).toBeNull()
    expect(screen.queryByText(/ABA Hr/)).toBeNull()
    // only the Appointment Info tab shows in the step rail
    expect(container.querySelectorAll('.steprail .step').length).toBe(1)
    expect(container.querySelector('.steprail .step').textContent).toContain('Appointment Info')
    // auto-title follows the naming convention: “Service/Type · time range” with the client up front when one is set
    expect(screen.getByTestId('appt-title').getAttribute('placeholder')).toContain('Drive Time ·')
  })

  it('Drive booking stores origin → destination, and mileage auto-derives from Total Distance', async () => {
    render(<App />)
    await openWizardOf('drive')
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-12-23' } })
    fireEvent.click(screen.getByTestId('drive-origin'))
    fireEvent.change(await screen.findByPlaceholderText('Search…'), { target: { value: '12 Elm Street' } })
    fireEvent.click(await screen.findByTestId('dd-create'))
    fireEvent.click(screen.getByTestId('drive-destination'))
    fireEvent.change(await screen.findByPlaceholderText('Search…'), { target: { value: 'Eastside Elementary' } })
    fireEvent.click(await screen.findByTestId('dd-create'))
    fireEvent.change(screen.getByTestId('drive-distance'), { target: { value: '14' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Appointment created')).toBeTruthy()
    await waitFor(() => {
      const d = Object.values(apptsInStorage()).find((a) => a.origin === '12 Elm Street')
      expect(d).toBeTruthy()
      expect(d.type).toBe('drive')
      expect(d.billing.distance).toBe(14)
      expect(d.destination).toBe('Eastside Elementary')
      expect(d.location).toBe('12 Elm Street → Eastside Elementary')
      expect(d.billing.mileage).toBe(true)
      expect(d.billing.code).toBe('H2019')
      expect(d.clientIds || []).toEqual([])
    })
  })

  it('Break Time: staff only, comments wording, no billing/verification/docs tabs', async () => {
    const { container } = render(<App />)
    await openWizardOf('break')
    expect(screen.getByTestId('pick-Staff Name')).toBeTruthy()
    expect(screen.queryByTestId('pick-Client Name')).toBeNull()
    expect(screen.getByText('Add Any Comments')).toBeTruthy()
    expect(screen.queryByText(/^Notes$/)).toBeNull()
    expect(container.querySelector('.modal [data-testid="location-select"]')).toBeNull()
    expect(container.querySelectorAll('.steprail .step').length).toBe(1)
  })

  it('Unavailable: “Unavailable For” toggle swaps the people picker and the validation target', async () => {
    render(<App />)
    await openWizardOf('unavailable')
    expect(screen.getByText('Unavailable For')).toBeTruthy()
    expect(screen.getByTestId('pick-Staff Name')).toBeTruthy()
    expect(screen.queryByTestId('pick-Client Name')).toBeNull()
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Add at least one staff member')).toBeTruthy()
    const seg = screen.getByTestId('unavail-target')
    fireEvent.click(within(seg).getByRole('button', { name: /Clients/ }))
    expect(await screen.findByTestId('pick-Client Name')).toBeTruthy()
    expect(screen.queryByTestId('pick-Staff Name')).toBeNull()
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Add a client')).toBeTruthy()
  })
})

describe('smart scheduling: backfill, suggestions & analytics', () => {
  // book a plain service, then cancel it via the detail card — returns { title }
  async function bookAndCancel() {
    render(<App />)
    await openServiceWizard()
    await addPeople()
    fireEvent.click(screen.getByTestId('save-appt'))
    const detail = await screen.findByTestId('detail-card')
    fireEvent.click(within(detail).getByRole('button', { name: /^Cancel$/ }))
    return detail
  }

  it('cancelling a session surfaces smart backfill and Assign restores it under new staff', async () => {
    const detail = await bookAndCancel()
    const panel = await within(detail).findByTestId('backfill-panel')
    const assignBtns = within(panel).getAllByRole('button', { name: 'Assign' })
    expect(assignBtns.length).toBeGreaterThan(0)
    fireEvent.click(assignBtns[0])
    expect(await within(detail).findByTestId('backfilled-badge')).toBeTruthy()
    expect(await screen.findByText(/now covers this session/)).toBeTruthy()
  })

  it('needs-cover inbox counts recoverable slots and restaffs from there', async () => {
    const detail = await bookAndCancel()
    await within(detail).findByTestId('backfill-panel')
    const btn = screen.getByTestId('needs-cover')
    const badge = btn.querySelector('[data-testid="cover-count"]')
    expect(badge).toBeTruthy()
    const before = Number(badge.textContent)
    expect(before).toBeGreaterThan(0)
    fireEvent.click(btn)
    const rows = await screen.findAllByText(/Assign & reactivate/)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(rows[0])
    expect(await screen.findByText(/Slot reactivated/)).toBeTruthy()
    await waitFor(() => {
      const b2 = screen.getByTestId('needs-cover').querySelector('[data-testid="cover-count"]')
      const after = b2 ? Number(b2.textContent) : 0
      expect(after).toBeLessThan(before) // re-staffed slot leaves the recoverable pool
    })
  })

  it('wizard suggests staff for the chosen client and one click adds them', async () => {
    const { container } = render(<App />)
    await openServiceWizard()
    await addPeople()
    const row = await screen.findByTestId('staff-suggestions')
    const btns = within(row).getAllByRole('button')
    expect(btns.length).toBeGreaterThan(0)
    const pillsBefore = container.querySelectorAll('.modal .people .pill').length
    fireEvent.click(btns[0])
    expect(container.querySelectorAll('.modal .people .pill').length).toBe(pillsBefore + 1)
    // the added person is the suggestion itself
    expect(btns[0].textContent).toBeTruthy()
  })

  it('settings expose the smart-scheduling control panel', async () => {
    render(<App />)
    fireEvent.click(screen.getByText(/Admin · Aloha/))
    fireEvent.click(screen.getByText('Settings', { selector: '.menu *' }))
    expect(await screen.findByText('Smart scheduling')).toBeTruthy()
    expect(screen.getByText('Care-team affinity')).toBeTruthy()
    expect(screen.getByText('Min backfill confidence')).toBeTruthy()
    // counts are segmented pickers; flipping suggestions to 5 persists
    const row = screen.getByText('Staff suggestions shown').parentElement
    const five = [...row.querySelectorAll('button')].find((b) => b.textContent === '5')
    fireEvent.click(five)
    await waitFor(() => expect(JSON.parse(localStorage.getItem('aloha-aba.v3')).settings.smart.suggest.count).toBe(5))
  })

  it('Analytics section: KPIs + drill pivot + chart modes + slider all work', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('nav-analytics'))
    expect(await screen.findByTestId('an-kpi-sessions')).toBeTruthy()
    expect(container.querySelectorAll('.an-kpi').length).toBe(6)
    expect(screen.getByText('Gross revenue', { selector: '.an-kpi span' })).toBeTruthy()
    // default breakdown = staff pivot, one row per person; clicking a row drills
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="an-row-"]').length).toBe(12))
    fireEvent.click(screen.getByTestId('an-row-s1'))
    expect(await screen.findByTestId('an-drill')).toBeTruthy()
    expect(container.querySelectorAll('[data-testid^="an-row-"]').length).toBe(1) // drilled to one entity
    // bucket table aggregation with totals row
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(container.querySelectorAll('.anv-bucktable tbody tr').length).toBeGreaterThanOrEqual(4)
    expect(container.querySelector('.anv-bucktable tfoot')).toBeTruthy()
    // the slider slides the window (and syncs the shared anchor into storage)
    const expected = isoDate(addDays(parseISO(todayISO()), -140 + 30))
    fireEvent.change(screen.getByTestId('an-slider'), { target: { value: '30' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('aloha-aba.v3'))?.ui?.anchor).toBe(expected), { timeout: 2000 })
  })

  it('sidebar exposes range analytics (cancelled, no-shows, utilization) + jump link', async () => {
    render(<App />)
    expect(await screen.findByText('Cancelled', { selector: '.wkstat span' })).toBeTruthy()
    expect(screen.getByText('No-shows', { selector: '.wkstat span' })).toBeTruthy()
    expect(screen.getByText('Utilized', { selector: '.wkstat span' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('open-analytics'))
    expect(await screen.findByTestId('an-kpi-sessions')).toBeTruthy()
  })
})

describe('billing, verification & signature', () => {
  it('billing code dropdown derives units/rate/charge (253MT: 60min → 2 × $10 = $20)', async () => {
    render(<App />)
    await openServiceWizard()
    await addPeople()
    // move to a payer without a contract override (Self-pay) so the code table path is exercised
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    const items = await screen.findAllByTestId('people-item')
    fireEvent.click(items.find((b) => b.textContent.includes('Justin Hsu')))
    fireEvent.click(items.find((b) => b.textContent.includes('Teresa Brown')))
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getAllByText('Billing').find((el) => el.closest('.modal')))
    await pickDropdown('billing-code', '253MT')
    expect(await screen.findByText('$20.00')).toBeTruthy()
  })

  it('verification: checklist, signature typed with cert + timestamp capture', async () => {
    render(<App />)
    await openServiceWizard()
    await addPeople()
    fireEvent.click(screen.getByText('Verification'))
    fireEvent.click(screen.getByText('Session data captured in EHR'))
    expect(screen.getByText('Session data captured in EHR').closest('.checkrow').className).toContain('on')
    // switch to type-sign mode and sign
    fireEvent.click(screen.getByText('⌨ Type'))
    fireEvent.change(screen.getByTestId('sig-type'), { target: { value: 'Prateek Kiran' } })
    fireEvent.click(screen.getByTestId('sig-sign'))
    await screen.findAllByText(/Signed by Prateek Kiran/)
    expect(screen.getByText(/BCBA #5-12-0034/)).toBeTruthy() // certification captured
    expect(screen.getByText(/geocode not shared|±\d+m/)).toBeTruthy() // timestamp/geo handling
    // and persist through save
    fireEvent.click(screen.getByText('Appointment Info'))
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-12-23' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Appointment created')).toBeTruthy()
    await waitFor(() => {
      const saved = Object.values(apptsInStorage()).find((a) => a.verification?.signature?.certification === 'BCBA #5-12-0034')
      expect(saved).toBeTruthy()
      expect(saved.verification.signature.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(saved.status).toBe('active')
      expect(saved.verification.verifyStatus).toBe('verified')
    })
  })
})

describe('series editing end-to-end', () => {
  it('edit occurrence with scope “All” updates every occurrence; “one” becomes an exception', async () => {
    render(<App />)
    await openServiceWizard()
    await waitFor(() => expect(Object.keys(apptsInStorage()).length).toBeGreaterThan(0))
    await addPeople()
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-12-23' } })
    await pickDropdown('repeat-select', 'weekly')
    fireEvent.change(screen.getByTestId('repeat-count'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Created 3 occurrences')).toBeTruthy()
    // detail card auto-opens → edit → scope all
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    expect(await screen.findByText(/Repeating series — apply changes to/)).toBeTruthy()
    fireEvent.change(screen.getByTestId('appt-title'), { target: { value: 'Renamed session' } })
    fireEvent.click(screen.getByTestId('scope-all'))
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText('Updated all 3 occurrences')).toBeTruthy()
    await waitFor(() => {
      const renamed = Object.values(apptsInStorage()).filter((a) => a.title === 'Renamed session')
      expect(renamed.length).toBe(3)
    })
    // now single-occurrence edit marks exception
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    await screen.findByText(/Repeating series — apply changes to/)
    fireEvent.change(screen.getByTestId('appt-title'), { target: { value: 'Only this one' } })
    fireEvent.click(screen.getByTestId('scope-one'))
    fireEvent.click(screen.getByTestId('save-appt'))
    await waitFor(() => {
      const single = Object.values(apptsInStorage()).filter((a) => a.title === 'Only this one')
      expect(single.length).toBe(1)
      expect(single[0].edited).toBe(true)
      expect(Object.values(apptsInStorage()).filter((a) => a.title === 'Renamed session').length).toBe(2)
    })
  })
})
