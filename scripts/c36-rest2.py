import pathlib
p = pathlib.Path('src/__tests__/mastersHub.test.jsx'); s = p.read_text()
# 1) single entry-point assertions at test start
old = """    expect((await screen.findByTestId('pd-cf')).textContent).toContain('No fields picked yet')"""
new = """    expect((await screen.findByTestId('pd-cf')).textContent).toContain('No fields picked yet')
    // chunk-36: ONE button on the profile, labelled exactly as asked — no second manage button
    expect(screen.getByTestId('pd-cf-pick').textContent).toContain('Add Custom Fields')
    expect(screen.queryByTestId('pd-cf-gomaster')).toBeNull()"""
assert old in s; s = s.replace(old, new, 1)
# 2) manage affordances inside the picker modal + jump link
old = """    // and the jump-to-master affordance works
    fireEvent.click(screen.getByTestId('pd-cf-gomaster'))
    expect(await screen.findByTestId('cfdefs-table')).toBeTruthy()"""
new = """    // ...and the manage affordances live INSIDE that modal: edit, guarded delete, new, jump
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    await screen.findByTestId('pd-cf-picker')
    expect(screen.getByTestId('pd-cfm-new')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pd-cfm-edit-cf-goals'))
    await screen.findByTestId('cf-modal')
    expect(screen.getByTestId('cf-label').value).toBe('Session focus areas')
    fireEvent.click(screen.getByTestId('cf-close'))
    expect(screen.getByTestId('pd-cfm-del-cf-authdept').disabled).toBe(true) // picked by this payer → blocked in place
    fireEvent.click(screen.getByTestId('pd-cf-gomaster'))
    expect(await screen.findByTestId('cfdefs-table')).toBeTruthy()"""
assert old in s; s = s.replace(old, new, 1)
# 3) wizard test: pick fields on the payer first (appointments are pick-driven now)
old = """    // book Justin (Aetna) — field panel with template controls
    fireEvent.click(screen.getByTestId('nav-calendar'))"""
new = """    // chunk-36: appointments only see what the payer profile PICKED — pick them now
    fireEvent.click(screen.getByTestId('masters-tab-payers'))
    await screen.findByTestId('payers-table')
    fireEvent.click(screen.getByTestId('py-row-py-aetna'))
    await screen.findByTestId('payer-detail')
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    await screen.findByTestId('pd-cf-picker')
    fireEvent.click((await screen.findByTestId('pd-cfpick-cf-authdept')).querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cfpick-cf-present').querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cf-picker-close'))
    await waitFor(() => expect(stored().payers.find((x) => x.id === 'py-aetna').cf).toEqual(['cf-authdept', 'cf-present']))
    // book Justin (Aetna) — field panel with template controls
    fireEvent.click(screen.getByTestId('nav-calendar'))"""
assert old in s; s = s.replace(old, new, 1)
# 4) structural landing test
old = "  it('Custom Fields master page: define list options and toggle labels right in the template editor', async () => {"
new = """  it('payers landing: structural band, stats chips and a sectioned list', async () => {
    render(<App />)
    await toMasters()
    const band = await screen.findByTestId('py-band')
    expect(band.textContent).toContain('Payer directory')
    expect(screen.getByTestId('py-stats').textContent).toContain('in use by clients')
    expect(screen.getByTestId('py-stats').textContent).toContain('with custom fields')
    expect(screen.getByTestId('py-sec').textContent).toContain('Master list')
    expect(screen.getByTestId('payers-table')).toBeTruthy()
    expect(screen.getByTestId('py-add').textContent).toContain('Add Payer')
    // stats are interactive: the active chip toggles the filter
    fireEvent.click(screen.getByTestId('py-stat-active'))
    expect(await screen.findByTestId('py-frow')).toBeTruthy()
    fireEvent.click(screen.getByTestId('py-stat-all'))
    expect(screen.queryByTestId('py-frow')).toBeNull()
  })

  it('Custom Fields master page: define list options and toggle labels right in the template editor', async () => {"""
assert old in s; s = s.replace(old, new, 1)
# 5) master-only appointment picker
old = "  it('payer profile keeps picked templates live: master edit renames everywhere, unlink is cheap', async () => {"
new = """  it('appointment picker is master-only — legacy inline entries never reach it', async () => {
    render(<App />)
    const st = stored()
    st.payers.find((x) => x.id === 'py-aetna').cf = ['cf-waiver', 'Free-text holdover'] // one master id + one legacy string
    localStorage.setItem('aloha-aba.v3', JSON.stringify(st))
    cleanup()
    render(<App />)
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
    await screen.findByTestId('am-pcf')
    fireEvent.click(screen.getByTestId('am-pcf-add'))
    await screen.findByTestId('am-pcf-picker')
    expect(screen.getByTestId('am-pcf-pick-cf-waiver')).toBeTruthy() // master-defined → offered
    expect(screen.queryByTestId(/am-pcf-pick-legacy/)).toBeNull() // legacy inline → never offered
  })

  it('payer profile keeps picked templates live: master edit renames everywhere, unlink is cheap', async () => {"""
assert old in s; s = s.replace(old, new, 1)
p.write_text(s); print('H) tests updated OK')
