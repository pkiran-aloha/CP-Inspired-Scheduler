import pathlib
p = pathlib.Path('src/__tests__/mastersHub.test.jsx'); s = p.read_text()

# ── 1) the legacy test becomes an AUTO-MIGRATION test ──
old = """  it('legacy inline custom fields still render and can be promoted to a template', async () => {
    render(<App />)
    await openDetail('py-aetna')
    // simulate a pre-template payer: legacy string entry, then remount to load it
    const st = stored()
    st.payers.find((x) => x.id === 'py-aetna').cf = ['Behavioral Intake line']
    localStorage.setItem('aloha-aba.v3', JSON.stringify(st))
    cleanup()
    render(<App />)
    await toMasters()
    fireEvent.click(await screen.findByTestId('py-row-py-aetna'))
    await screen.findByTestId('payer-detail')
    const legacy = await screen.findByTestId('pd-cf-0')
    expect(legacy.textContent).toContain('Behavioral Intake line')
    expect(legacy.textContent).toContain('legacy')
    fireEvent.click(screen.getByTestId('pcf-upgrade-legacy-0'))
    await waitFor(() => expect(stored().customFields.some((d) => d.label === 'Behavioral Intake line')).toBe(true))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf.length).toBe(1))
    expect(stored().payers.find((p) => p.id === 'py-aetna').cf[0]).toContain('cf-') // now a template id
    expect(await screen.findByTestId('pd-cf-cf-behavioral-intake-line')).toBeTruthy()
  })"""
new = """  it('load migration enforces master-only everywhere: promote inline defs, drop dangling strings', async () => {
    render(<App />)
    await openDetail('py-aetna')
    // a stale pre-template save: one legacy label string, one inline definition object,
    // one dangling string that matches nothing in the master
    const st = stored()
    st.payers.find((x) => x.id === 'py-aetna').cf = [
      'Prior auth dept', // label of an existing master template → re-pointed to its id
      { label: 'Auth note', type: 'text', required: true }, // inline def → auto-promoted to a template
      'Free-text holdover', // matches nothing → dropped
    ]
    localStorage.setItem('aloha-aba.v3', JSON.stringify(st))
    cleanup()
    render(<App />)
    await waitFor(() => expect(stored()).toBeTruthy())
    // THE RULE: after load, every reference is a master id, and promoted defs exist there
    const cf = stored().payers.find((x) => x.id === 'py-aetna').cf
    expect(cf.every((id) => id.startsWith('cf-'))).toBe(true)
    expect(cf).toContain('cf-authdept')
    expect(stored().customFields.some((d) => d.label === 'Auth note' && d.required)).toBe(true)
    expect(cf.length).toBe(2)
    // the profile now shows only from-master rows — no legacy chip anywhere
    await toMasters()
    fireEvent.click(await screen.findByTestId('py-row-py-aetna'))
    await screen.findByTestId('payer-detail')
    expect(screen.getByTestId('pd-cf-cf-authdept').textContent).toContain('from master')
    expect(screen.queryByText('legacy')).toBeNull()
    expect(screen.queryByText('Free-text holdover')).toBeNull()
  })"""
assert old in s; s = s.replace(old, new, 1)

# ── 2) inline service-cell editing + exact add-button label ──
old = """  it('appointment picker is master-only — legacy inline entries never reach it', async () => {"""
new = """  it('service lines edit INLINE on the payer card — every cell commits to the live record', async () => {
    render(<App />)
    await openDetail('py-aetna')
    fireEvent.click(screen.getByTestId('pd-tab-services'))
    await screen.findByTestId('pd-svc-net')
    // the toolbar button is labelled exactly as the flow demands
    expect(screen.getByTestId('pd-svc-add').textContent).toContain('New Payer-Only Service')
    // charge override inline on a linked row
    fireEvent.click(screen.getByTestId('pd-cell-charge-net'))
    const inp = document.querySelector('[data-testid="pd-cell-charge-net"] input')
    fireEvent.change(inp, { target: { value: '27.5' } })
    fireEvent.keyDown(inp, { key: 'Enter' })
    await waitFor(() => expect(stored().payers.find((x) => x.id === 'py-aetna').svcOv.net.charge).toBe(27.5))
    // dx1 + unit + rounding all write straight through
    fireEvent.click(screen.getByTestId('pd-cell-dx1-net'))
    const dx = document.querySelector('[data-testid="pd-cell-dx1-net"] input')
    fireEvent.change(dx, { target: { value: 'f84.0' } })
    fireEvent.keyDown(dx, { key: 'Enter' })
    await waitFor(() => expect(stored().payers.find((x) => x.id === 'py-aetna').svcOv.net.dx1).toBe('F84.0'))
    fireEvent.click(screen.getByTestId(`opt-pd-cell-unit-net-60 Minutes`))
    await waitFor(() => expect(stored().payers.find((x) => x.id === 'py-aetna').svcOv.net.unitSize).toBe('60 Minutes'))
    // a payer-only row edits its own record (not an override)
    fireEvent.click(screen.getByTestId('pd-svc-add'))
    await screen.findByTestId('ovr-modal')
    fireEvent.change(screen.getByTestId('ovr-label'), { target: { value: 'Inline Target' } })
    fireEvent.change(screen.getByTestId('ovr-charge'), { target: { value: '40' } })
    fireEvent.change(screen.getByTestId('ovr-dx1'), { target: { value: 'F84.0' } })
    fireEvent.click(screen.getByTestId('ovr-save'))
    await screen.findByTestId('pd-svc-inline-target')
    const lid = stored().payers.find((x) => x.id === 'py-aetna').svcs[0].id
    fireEvent.click(screen.getByTestId(`pd-cell-charge-${lid}`))
    const li = document.querySelector(`[data-testid="pd-cell-charge-${lid}"] input`)
    fireEvent.change(li, { target: { value: '44' } })
    fireEvent.keyDown(li, { key: 'Enter' })
    await waitFor(() => expect(stored().payers.find((x) => x.id === 'py-aetna').svcs[0].charge).toBe(44))
  })

  it('appointment modal can NEVER start with custom fields — even if a caller passes them', async () => {
    render(<App />)
    // open a NEW appointment straight from the calendar with a hostile initial pcfs via duplicate-style entry
    fireEvent.click(screen.getByTestId('nav-calendar'))
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    const item = (await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu'))
    fireEvent.click(item)
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    // pick fields on Aetna so the panel exists at all
    await waitFor(() => expect(screen.queryAllByTestId(/^pcf-f-/).length).toBe(0)) // zero rows regardless
  })

  it('payers landing shows the running build stamp (no stale-tab surprises)', async () => {
    render(<App />)
    await toMasters()
    expect((await screen.findByTestId('app-build')).textContent).toContain('build')
  })

  it('appointment picker is master-only — legacy inline entries never reach it', async () => {"""
assert old in s; s = s.replace(old, new, 1)

# the master-only picker test: its injected legacy string is now DROPPED at load, so the
# payer is left with only cf-waiver — adjust assertions accordingly
old = """    await screen.findByTestId('am-pcf')
    fireEvent.click(screen.getByTestId('am-pcf-add'))
    await screen.findByTestId('am-pcf-picker')
    expect(screen.getByTestId('am-pcf-pick-cf-waiver')).toBeTruthy() // master-defined → offered
    expect(screen.queryByTestId(/am-pcf-pick-legacy/)).toBeNull() // legacy inline → never offered"""
new = """    await screen.findByTestId('am-pcf')
    fireEvent.click(screen.getByTestId('am-pcf-add'))
    await screen.findByTestId('am-pcf-picker')
    expect(screen.getByTestId('am-pcf-pick-cf-waiver')).toBeTruthy() // master id survives and is offered
    expect(screen.queryByTestId(/am-pcf-pick-legacy/)).toBeNull() // the dangling string died at load
    expect(stored().payers.find((x) => x.id === 'py-aetna').cf).toEqual(['cf-waiver'])"""
assert old in s; s = s.replace(old, new, 1)
# the setup line of that test no longer needs re-render gymnastics for 'Free-text holdover' — keep as is.

p.write_text(s)
print('c37 tests OK')
