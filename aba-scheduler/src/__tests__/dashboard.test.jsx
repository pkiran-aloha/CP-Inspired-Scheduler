import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import App from '../App'
import { reducer, blankState } from '../state/store'
import { apptsFiltered, sumMetric, topBreakdown, mixOf, heatGrid, pulseKpis, trendSeries, DEFAULT_DASH } from '../lib/dash'

const KEY = 'aloha-aba.v3'
const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
beforeEach(() => { localStorage.clear(); renderCleanup() })
afterEach(() => renderCleanup())
let _r = null
function renderCleanup() { if (_r) { _r.unmount(); _r = null } }
const R = (ui) => { if (_r) _r.unmount(); _r = render(ui); return _r }

/* ---------- pure engine ---------- */

const A = {
  a1: { id: 'a1', date: '2026-09-14', start: 540, end: 600, type: 'service', status: 'completed', staffIds: ['s1'], clientIds: ['c1'], billing: { units: 1, rate: 10 } },
  a2: { id: 'a2', date: '2026-09-14', start: 600, end: 660, type: 'evaluation', status: 'no-show', staffIds: ['s1', 's2'], clientIds: ['c1'], billing: { units: 0, rate: 0 } },
  a3: { id: 'a3', date: '2026-09-15', start: 540, end: 600, type: 'service', status: 'cancelled', staffIds: ['s2'], clientIds: ['c2'], billing: { units: 2, rate: 10 } },
  a4: { id: 'a4', date: '2026-09-15', start: 540, end: 600, type: 'service', status: 'completed', staffIds: ['s2'], clientIds: ['c2'], billing: { units: 2, rate: 10 } },
}
const CLIENTS = { c1: { id: 'c1', name: 'Alpha', program: 'EIBI', insurer: 'Aetna' }, c2: { id: 'c2', name: 'Beta', program: 'NET', insurer: 'Medicaid (CA)' } }
const STAFF = { s1: { id: 's1', name: 'One' }, s2: { id: 's2', name: 'Two' } }
const DAYS = ['2026-09-14', '2026-09-15']

describe('dash engine', () => {
  it('filters cancelled rows and aggregates every metric', () => {
    const live = apptsFiltered(A, {}, CLIENTS)
    expect(live.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a4'])
    expect(sumMetric(live, 'sessions')).toBe(3)
    expect(sumMetric(live, 'revenue')).toBe(30) // only completed deliver time: 1×$10 + 2×$10
    expect(sumMetric(live, 'hours')).toBe(2) // no-show contributes nothing
  })
  it('widget filters slice the same ledger', () => {
    expect(sumMetric(apptsFiltered(A, { type: 'service' }, CLIENTS), 'sessions')).toBe(2)
    expect(sumMetric(apptsFiltered(A, { staff: 's2' }, CLIENTS), 'sessions')).toBe(2) // s2 also on the no-show row
    expect(sumMetric(apptsFiltered(A, { payer: 'Aetna' }, CLIENTS), 'sessions')).toBe(2)
  })
  it('topBreakdown splits shared sessions and respects dim + metric', () => {
    const staffRows = topBreakdown(A, DAYS, { dim: 'staff', metric: 'revenue', top: 8 }, CLIENTS, STAFF, {})
    expect(staffRows.map((r) => [r.key, r.value])).toEqual([['s2', 20], ['s1', 10]])
    const sess = topBreakdown(A, DAYS, { dim: 'staff', metric: 'sessions', top: 8 }, CLIENTS, STAFF, {})
    expect(sess.find((r) => r.key === 's1').value).toBe(1.5) // a2 is shared with s2
    expect(topBreakdown(A, DAYS, { dim: 'payer', metric: 'sessions', top: 8 }, CLIENTS, STAFF, {})[0].label).toBe('Aetna')
  })
  it('mix, heat and pulse KPIs', () => {
    const slices = mixOf(A, DAYS, { field: 'type' }, {})
    expect(slices[0]).toMatchObject({ key: 'service', value: 2 })
    const heat = heatGrid(A, DAYS, {}, [8, 18])
    expect(heat.grid[1][1]).toMatchObject({ count: 1, minutes: 60 }) // Mon 9:00
    expect(heat.firstDateByDow[1]).toBe('2026-09-14')
    const k = pulseKpis(A, DAYS, ['2026-09-13'], {}, CLIENTS)
    expect(k.find((x) => x.k === 'sessions').value).toBe(3)
    expect(k.find((x) => x.k === 'attendance').value).toBe(67)
    expect(k.find((x) => x.k === 'noshow').value).toBe(1)
    const trend = trendSeries(A, DAYS, [{ key: 'b1', label: 'B1', days: ['2026-09-14'] }, { key: 'b2', label: 'B2', days: ['2026-09-15'] }], 'sessions', {}, CLIENTS)
    expect(trend.map((t) => t.value)).toEqual([2, 1])
  })
})

/* ---------- the page ---------- */

describe('dashboard page', () => {
  it('ships the standard five widgets, all rendering real graphics', async () => {
    const { container } = R(<App />)
    fireEvent.click(screen.getByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    expect(container.querySelectorAll('.dsh-w').length).toBe(5)
    expect(screen.getByTestId('dash-widget-w-trend').querySelector('svg .dw-spark-line')).toBeTruthy()
    expect(screen.getByTestId('dash-widget-w-mix').querySelectorAll('.dw-slice').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.dw-heat-cell').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.dw-bar-row').length).toBeGreaterThan(0)
    expect(screen.getByTestId('dw-kpi-sessions')).toBeTruthy()
  })

  it('add from the gallery, remove, reorder — all persisted', async () => {
    const { container } = R(<App />)
    fireEvent.click(screen.getByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    fireEvent.click(screen.getByTestId('dash-add'))
    await screen.findByTestId('dash-gallery')
    fireEvent.click(screen.getByTestId('dash-add-heat'))
    await waitFor(() => expect(container.querySelectorAll('.dsh-w').length).toBe(6))
    await waitFor(() => expect(stored().dash.widgets.length).toBe(6))
    // remove the mix donut
    fireEvent.click(screen.getByTestId('dw-rm-w-mix'))
    await waitFor(() => expect(container.querySelectorAll('.dsh-w').length).toBe(5))
    await waitFor(() => expect(stored().dash.widgets.find((w) => w.id === 'w-mix')).toBeFalsy())
    // reorder: push trend left of pulse
    fireEvent.click(screen.getByTestId('dw-mv-w-trend-l'))
    await waitFor(() => expect(stored().dash.widgets.map((w) => w.id).slice(0, 2)).toEqual(['w-trend', 'w-pulse']))
    // reset restores the standard board
    fireEvent.click(screen.getByTestId('dash-reset'))
    await waitFor(() => expect(stored().dash.widgets.map((w) => w.id)).toEqual(['w-pulse', 'w-trend', 'w-mix', 'w-bars', 'w-heat']))
  })

  it('every control re-aggregates live and persists cfg', async () => {
    R(<App />)
    fireEvent.click(screen.getByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    const before = screen.getByTestId('dash-widget-w-trend').querySelector('.dw-plot-top b').textContent
    fireEvent.change(screen.getByTestId('dw-cfg-w-trend-metric'), { target: { value: 'revenue' } })
    await waitFor(() => expect(stored().dash.widgets.find((w) => w.id === 'w-trend').cfg.metric).toBe('revenue'))
    await waitFor(() => expect(screen.getByTestId('dash-widget-w-trend').querySelector('.dw-plot-top b').textContent).not.toBe(before))
    // bars widget → program dimension
    fireEvent.change(screen.getByTestId('dw-cfg-w-bars-dim'), { target: { value: 'program' } })
    await waitFor(() => expect(stored().dash.widgets.find((w) => w.id === 'w-bars').cfg.dim).toBe('program'))
    // donut flips to status mix
    fireEvent.click(screen.getByTestId('dw-cfg-w-mix-field-status'))
    await waitFor(() => expect(stored().dash.widgets.find((w) => w.id === 'w-mix').cfg.field).toBe('status'))
  })

  it('clicking a donut slice filters the whole board; the chip clears it', async () => {
    const { container } = R(<App />)
    fireEvent.click(screen.getByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-mix')
    const slice = await screen.findByTestId('dw-slice-service')
    const barsBefore = container.querySelectorAll('.dw-bar-row').length
    fireEvent.click(slice)
    await screen.findByTestId('dash-filter-type')
    expect(screen.getByTestId('dash-filter-type').textContent).toMatch(/Type/i)
    await waitFor(() => expect(stored().ui.dashFilter.type).toBe('service'))
    // bars now only see service rows (fewer or equal)
    expect(container.querySelectorAll('.dw-bar-row').length).toBeLessThanOrEqual(barsBefore)
    // the legend chip stays visible even when only one slice remains — toggles off from there
    fireEvent.click(await screen.findByTestId('dash-filter-type'))
    await waitFor(() => expect(screen.queryByTestId('dash-filter-type')).toBeFalsy())
    await waitFor(() => expect(stored().ui.dashFilter).toBeFalsy())
  })

  it('a bar row filters to that staff member and heat cells jump to the calendar', async () => {
    R(<App />)
    fireEvent.click(screen.getByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-bars')
    const row = document.querySelector('[data-testid^="dw-bar-s"]')
    fireEvent.click(row)
    await screen.findByTestId('dash-filter-staff')
    fireEvent.click(screen.getByTestId('dash-filter-clear'))
    await waitFor(() => expect(screen.queryByTestId('dash-filter-staff')).toBeFalsy())
    const lit = container_queryLit()
    expect(lit).toBeTruthy()
    fireEvent.click(lit)
    await waitFor(() => expect(screen.getByTestId('nav-calendar').className).toMatch(/on/))
    function container_queryLit() { return document.querySelector('.dw-heat-cell.lit') }
  })

  it('remove everything → guided empty state, add back from there', async () => {
    const { container } = R(<App />)
    fireEvent.click(screen.getByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    for (const id of ['w-pulse', 'w-trend', 'w-mix', 'w-bars', 'w-heat']) fireEvent.click(screen.getByTestId(`dw-rm-${id}`))
    await screen.findByTestId('dash-empty')
    expect(container.querySelectorAll('.dsh-w').length).toBe(0)
    fireEvent.click(screen.getByTestId('dash-empty-add'))
    fireEvent.click(await screen.findByTestId('dash-add-kpis'))
    await waitFor(() => expect(container.querySelectorAll('.dsh-w').length).toBe(1))
  })

  it('range control re-ranges every widget', async () => {
    R(<App />)
    fireEvent.click(screen.getByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    fireEvent.change(screen.getByTestId('dash-range'), { target: { value: 'week' } })
    await waitFor(() => expect(stored().ui.dashPreset).toBe('week'))
    expect(screen.getByTestId('dash-widget-w-trend')).toBeTruthy()
  })
})

describe('board layout reducer', () => {
  const base = () => ({ ...blankState(), dash: { widgets: DEFAULT_DASH.map((w) => ({ ...w, cfg: { ...w.cfg } })) } })
  it('resize clamps and persists the span; order moves across rows', () => {
    let st = base()
    st = reducer(st, { type: 'dash', mode: 'resize', id: 'w-mix', span: 5 })
    expect(st.dash.widgets.find((w) => w.id === 'w-mix').span).toBe(5)
    st = reducer(st, { type: 'dash', mode: 'resize', id: 'w-mix', span: 99 })
    expect(st.dash.widgets.find((w) => w.id === 'w-mix').span).toBe(6)
    st = reducer(st, { type: 'dash', mode: 'order', id: 'w-pulse', index: 5 }) // after the last card
    expect(st.dash.widgets.map((w) => w.id)).toEqual(['w-trend', 'w-mix', 'w-bars', 'w-heat', 'w-pulse'])
    st = reducer(st, { type: 'dash', mode: 'order', id: 'w-pulse', index: 0 })
    expect(st.dash.widgets[0].id).toBe('w-pulse')
    expect(st.dash.widgets.find((w) => w.id === 'w-mix').span).toBe(6) // span survives reorder
  })
  it('added widgets carry the registry default span', () => {
    let st = base()
    st = reducer(st, { type: 'dash', mode: 'add', wtype: 'heat' })
    const added = st.dash.widgets[st.dash.widgets.length - 1]
    expect(added.span).toBe(3)
  })
})

describe('drag & resize affordances', () => {
  it('every widget exposes a move grip and a resize handle; range select uses the readable class', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    const w = (await screen.findByTestId('dash-widget-w-pulse')).dataset.wid
    expect(screen.getByTestId(`dw-drag-${w}`)).toBeTruthy()
    expect(screen.getByTestId(`dw-resize-${w}`)).toBeTruthy()
    expect(screen.getByTestId('dw-resize-w-mix')).toBeTruthy()
    expect(screen.getByTestId('dash-widget-w-mix').getAttribute('data-span')).toBe('2')
    expect(screen.getByTestId('dash-range').className).toContain('dsh-rsel')
  })
})

describe('widget layout menu & sizing', () => {
  const base = () => ({ ...blankState(), dash: { widgets: DEFAULT_DASH.map((w) => ({ ...w, cfg: { ...w.cfg } })) } })
  it('clone inserts an independent copy; height clamps; new-row toggles', () => {
    let st = base()
    st = reducer(st, { type: 'dash', mode: 'clone', id: 'w-trend' })
    expect(st.dash.widgets.length).toBe(6)
    const [a, b] = st.dash.widgets.filter((w) => w.type === 'trend')
    expect(b.id).not.toBe(a.id)
    expect(b.span).toBe(a.span)
    st = reducer(st, { type: 'dash', mode: 'cfg', id: a.id, patch: { metric: 'charge' } })
    expect(st.dash.widgets.find((w) => w.id === b.id).cfg.metric).toBe('sessions') // copy is detached
    st = reducer(st, { type: 'dash', mode: 'height', id: 'w-heat', h: 9 })
    expect(st.dash.widgets.find((w) => w.id === 'w-heat').h).toBe(3)
    st = reducer(st, { type: 'dash', mode: 'height', id: 'w-heat', h: 0 })
    expect(st.dash.widgets.find((w) => w.id === 'w-heat').h).toBe(1)
    st = reducer(st, { type: 'dash', mode: 'line', id: 'w-trend', nl: true })
    expect(st.dash.widgets.find((w) => w.id === 'w-trend').nl).toBe(true)
    st = reducer(st, { type: 'dash', mode: 'line', id: 'w-trend', nl: false })
    expect(st.dash.widgets.find((w) => w.id === 'w-trend').nl).toBe(false)
  })
  it('menu actions on the page persist width, height and clone', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    fireEvent.click(screen.getByTestId('dw-more-w-trend'))
    expect(screen.getByTestId('dw-menu-w-trend')).toBeTruthy()
    fireEvent.click(screen.getByTestId('dw-size-w-trend-6'))
    await waitFor(() => expect(screen.getByTestId('dash-widget-w-trend').getAttribute('data-span')).toBe('6'))
    fireEvent.click(screen.getByTestId('dw-more-w-trend'))
    fireEvent.click(screen.getByTestId('dw-h-w-trend-2'))
    await waitFor(() => expect(stored().dash.widgets.find((w) => w.id === 'w-trend').h).toBe(2))
    fireEvent.click(screen.getByTestId('dw-more-w-trend'))
    fireEvent.click(screen.getByTestId('dw-newline-w-trend'))
    await waitFor(() => expect(stored().dash.widgets.find((w) => w.id === 'w-trend').nl).toBe(true))
    fireEvent.click(screen.getByTestId('dw-more-w-trend'))
    fireEvent.click(screen.getByTestId('dw-clone-w-trend'))
    await waitFor(() => expect(stored().dash.widgets.length).toBe(6))
    expect(stored().dash.widgets[2].type).toBe('trend') // clone lands right after its source
    expect(stored().dash.widgets[2].span).toBe(6)
  })
})

describe('boards, per-widget range & CSV export', () => {
  const base2 = () => ({ ...blankState(), dash: { widgets: DEFAULT_DASH.map((w) => ({ ...w, cfg: { ...w.cfg } })) } })
  it('saveBoard deep-clones, loadBoard restores, delBoard removes', () => {
    let st = base2()
    st = reducer(st, { type: 'dash', mode: 'saveBoard', name: '  Morning  ' })
    expect(st.dash.boards[0].name).toBe('Morning')
    const bid = st.dash.boards[0].id
    st = reducer(st, { type: 'dash', mode: 'cfg', id: 'w-trend', patch: { metric: 'revenue' } })
    st = reducer(st, { type: 'dash', mode: 'remove', id: 'w-mix' })
    expect(st.dash.widgets.length).toBe(4)
    st = reducer(st, { type: 'dash', mode: 'loadBoard', id: bid })
    expect(st.dash.widgets.length).toBe(5)
    expect(st.dash.widgets.find((w) => w.id === 'w-trend').cfg.metric).toBe('sessions') // snapshot wins
    st = reducer(st, { type: 'dash', mode: 'delBoard', id: bid })
    expect(st.dash.boards).toEqual([])
    st = reducer(st, { type: 'dash', mode: 'loadBoard', id: 'ghost' })
    expect(st.dash.widgets.length).toBe(5)
  })
  it('per-widget range override: menu select → pill → clear', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-heat')
    fireEvent.click(screen.getByTestId('dw-more-w-heat'))
    fireEvent.change(screen.getByTestId('dw-range-w-heat'), { target: { value: 'last13' } })
    await waitFor(() => expect(stored().dash.widgets.find((w) => w.id === 'w-heat').cfg.range).toBe('last13'))
    const pill = await screen.findByTestId('dw-rpill-w-heat')
    expect(pill.textContent).toContain('Last 13 weeks')
    fireEvent.click(pill)
    await waitFor(() => expect(stored().dash.widgets.find((w) => w.id === 'w-heat').cfg.range).toBe(''))
    expect(screen.queryByTestId('dw-rpill-w-heat')).toBeNull()
  })
  it('board chip saves, restores a removed widget, and deletes with a two-step', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-bars')
    fireEvent.click(screen.getByTestId('dash-board-save'))
    fireEvent.change(screen.getByTestId('dash-bname'), { target: { value: 'Huddle' } })
    fireEvent.click(screen.getByTestId('dash-bpop-save'))
    await waitFor(() => expect(stored().dash.boards[0].name).toBe('Huddle'))
    const bid = stored().dash.boards[0].id
    fireEvent.click(screen.getByTestId('dw-rm-w-bars'))
    await waitFor(() => expect(stored().dash.widgets.length).toBe(4))
    fireEvent.click(screen.getByTestId(`dash-board-${bid}`))
    await waitFor(() => expect(stored().dash.widgets.length).toBe(5))
    fireEvent.click(screen.getByTestId(`dash-board-del-${bid}`))
    expect(screen.getByTestId(`dash-board-del-${bid}`)).toBeTruthy() // armed, not deleted yet
    fireEvent.click(screen.getByTestId(`dash-board-del-${bid}`))
    await waitFor(() => expect(stored().dash.boards).toEqual([]))
  })
  it('CSV export serializes the live rows behind the chart, quoted', async () => {
    let captured = null
    const orig = URL.createObjectURL
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = () => {}
    URL.createObjectURL = (b) => { captured = b; return 'blob:stub' }
    URL.revokeObjectURL = () => {}
    const readBlob = (b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsText(b) })
    try {
      R(<App />)
      fireEvent.click(await screen.findByTestId('nav-dashboard'))
      await screen.findByTestId('dash-widget-w-trend')
      fireEvent.click(screen.getByTestId('dw-more-w-trend'))
      fireEvent.click(screen.getByTestId('dw-csv-w-trend'))
      expect(captured).toBeTruthy()
      const text = await readBlob(captured)
      const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(captured) })
      expect(dataUrl).toMatch(/^data:text\/csv;charset=utf-8;base64,77u\//) // UTF-8 BOM present for Excel
      const rows = text.trim().split('\r\n')
      expect(rows[0]).toBe('bucket,Sessions')
      expect(rows.length).toBeGreaterThan(3)
      fireEvent.click(screen.getByTestId('dw-more-w-pulse'))
      fireEvent.click(screen.getByTestId('dw-csv-w-pulse'))
      const kpi = await readBlob(captured)
      expect(kpi).toContain('metric,current')
      expect(kpi).toContain('Sessions,')
    } finally {
      URL.createObjectURL = orig
      HTMLAnchorElement.prototype.click = origClick
    }
  })
})

describe('drill-down drawer', () => {
  it('opens from the widget menu, lists appointments with convention titles, jumps to the calendar', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    fireEvent.click(screen.getByTestId('dw-more-w-trend'))
    const dataBtn = await screen.findByTestId('dw-data-w-trend')
    expect(dataBtn.textContent).toMatch(/Underlying data \(\d+\)/)
    fireEvent.click(dataBtn)
    const drawer = await screen.findByTestId('dsh-drawer')
    expect(drawer.textContent).toContain('the data behind it')
    const rows = Array.from(drawer.querySelectorAll('.dd-row'))
    expect(rows.length).toBeGreaterThan(10)
    const firstDate = rows[0].querySelector('time').textContent
    expect(firstDate).toMatch(/·/)
    fireEvent.click(rows[0])
    await waitFor(() => expect(stored().ui.section).toBe('calendar'))
    expect(await screen.findByTestId('dsh-drawer').catch(() => null)).toBeNull()
  })
  it('KPI tiles open their own slice; no-shows differ from all sessions', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    await screen.findByTestId('dw-kpi-sessions')
    fireEvent.click(screen.getByTestId('dw-kpi-sessions'))
    let d = await screen.findByTestId('dsh-drawer')
    const allCount = Number(d.querySelector('.dd-head span').textContent.match(/(\d+) appointment/)[1])
    fireEvent.click(screen.getByTestId('dd-close'))
    fireEvent.click(await screen.findByTestId('dw-kpi-noshow'))
    d = await screen.findByTestId('dsh-drawer')
    expect(d.textContent).toContain('No-show appointments')
    const nsCount = Number(d.querySelector('.dd-head span').textContent.match(/(\d+) appointment/)[1])
    expect(nsCount).toBeLessThan(allCount)
    expect(nsCount).toBeGreaterThan(0)
    // status pills all read no-show
    Array.from(d.querySelectorAll('.dd-row')).slice(0, 5).forEach((r) => expect(r.querySelector('.dd-st').textContent).toBe('no-show'))
    // Esc closes
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('dsh-drawer')).toBeNull())
  })
  it('bars drawer respects the dimension set and export button is wired', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-bars')
    let captured = null
    const orig = URL.createObjectURL
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = () => {}
    URL.createObjectURL = (b) => { captured = b; return 'blob:stub' }
    URL.revokeObjectURL = () => {}
    try {
      fireEvent.click(screen.getByTestId('dw-more-w-bars'))
      fireEvent.click(screen.getByTestId('dw-data-w-bars'))
      const drawer = await screen.findByTestId('dsh-drawer')
      expect(drawer.querySelectorAll('.dd-row').length).toBeGreaterThan(0)
      fireEvent.click(screen.getByTestId('dd-export'))
      expect(captured).toBeTruthy()
    } finally {
      URL.createObjectURL = orig
      HTMLAnchorElement.prototype.click = origClick
    }
  })
})

describe('drawer detail-link & extras settings', () => {
  it('row opens the full record via the detail card (works outside the calendar section)', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    fireEvent.click(screen.getByTestId('dw-more-w-trend'))
    fireEvent.click(screen.getByTestId('dw-data-w-trend'))
    const drawer = await screen.findByTestId('dsh-drawer')
    const row = drawer.querySelector('.dd-row')
    const id = row.getAttribute('data-testid').replace('dd-row-', '')
    // seeded schedules are conflict-free by design
    expect(drawer.querySelectorAll('.dd-conf').length).toBe(0)
    fireEvent.click(screen.getByTestId(`dd-open-${id}`))
    const card = await screen.findByTestId('detail-card')
    expect(card.textContent.length).toBeGreaterThan(30)
    fireEvent.click(card.querySelector('.modal-x'))
    await waitFor(() => expect(screen.queryByTestId('detail-card')).toBeNull())
    expect(screen.queryByTestId('dsh-drawer')).toBeNull() // drawer closed on open
  })
  it('settings: extras chips persist and re-render the live preview', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-settings'))
    await screen.findByTestId('set-extras')
    const preview = () => screen.getByTestId('set-name-preview').textContent
    expect(preview()).not.toContain('@')
    fireEvent.click(screen.getByTestId('set-extra-location'))
    await waitFor(() => expect(stored().settings.apptTitleExtras.location).toBe(true))
    expect(preview()).toContain('@ Main Center')
    fireEvent.click(screen.getByTestId('set-extra-service'))
    await waitFor(() => expect(preview()).toContain('Discrete Trial Training'))
    fireEvent.click(screen.getByTestId('set-name-code'))
    await waitFor(() => expect(preview()).toContain('97151')) // curated CPT replaces the generic code
  })
})

describe('appointment ledger widget', () => {
  it('adds from the gallery, lists convention titles, opens records and exports', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    await screen.findByTestId('dash-widget-w-trend')
    fireEvent.click(screen.getByTestId('dash-add'))
    fireEvent.click(await screen.findByTestId('dash-add-ledger'))
    await waitFor(() => expect(stored().dash.widgets.some((w) => w.type === 'ledger')).toBe(true))
    const wid = stored().dash.widgets.find((w) => w.type === 'ledger').id
    const widget = await screen.findByTestId(`dash-widget-${wid}`)
    const rows = widget.querySelectorAll('.wlx')
    expect(rows.length).toBe(12) // cfg default
    expect(widget.querySelector('.wlx-foot span').textContent).toMatch(/appointment/)
    // row opens the full record
    const apptId = rows[0].getAttribute('data-testid').replace(`wl-${wid}-`, '')
    fireEvent.click(rows[0])
    const card = await screen.findByTestId('detail-card')
    fireEvent.click(card.querySelector('.modal-x'))
    // CSV includes ledger header
    let captured = null
    const orig = URL.createObjectURL
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = () => {}
    URL.createObjectURL = (b) => { captured = b; return 'blob:stub' }
    URL.revokeObjectURL = () => {}
    try {
      fireEvent.click(screen.getByTestId(`wlx-csv-${wid}`))
      expect(captured).toBeTruthy()
    } finally {
      URL.createObjectURL = orig
      HTMLAnchorElement.prototype.click = origClick
    }
    // rows config shrinks the list
    fireEvent.click(screen.getByTestId(`dw-cfg-${wid}-rows`))
  })
  it('rows config select changes visible ledger rows and order reverses', async () => {
    R(<App />)
    fireEvent.click(await screen.findByTestId('nav-dashboard'))
    fireEvent.click(screen.getByTestId('dash-add'))
    fireEvent.click(await screen.findByTestId('dash-add-ledger'))
    await waitFor(() => expect(stored().dash.widgets.some((w) => w.type === 'ledger')).toBe(true))
    const wid = stored().dash.widgets.find((w) => w.type === 'ledger').id
    await screen.findByTestId(`dash-widget-${wid}`)
    fireEvent.change(screen.getByTestId(`dw-cfg-${wid}-rows`), { target: { value: '8' } })
    await waitFor(() => expect(screen.getByTestId(`dash-widget-${wid}`).querySelectorAll('.wlx').length).toBe(8))
    const firstAsc = screen.getByTestId(`dash-widget-${wid}`).querySelector('.wlx time').textContent
    fireEvent.change(screen.getByTestId(`dw-cfg-${wid}-order`), { target: { value: 'desc' } })
    await waitFor(() => expect(screen.getByTestId(`dash-widget-${wid}`).querySelector('.wlx time').textContent).not.toBe(firstAsc))
    // See-all hands off to the drawer
    fireEvent.click(screen.getByTestId(`wlx-all-${wid}`))
    expect(await screen.findByTestId('dsh-drawer')).toBeTruthy()
  })
})
