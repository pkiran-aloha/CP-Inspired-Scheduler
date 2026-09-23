p = 'src/lib/seed.js'
s = open(p).read()
s = s.replace("type: 'select', options: ['Behavioral Intake 2', 'Auth Review Unit 3', 'School Liaison'], required: true,",
              "type: 'select', options: ['Behavioral Intake 2', 'Auth Review Unit 3', 'School Liaison'], required: false,")
open(p, 'w').write(s)
print('seed: authdept not required by default (demo bookings stay frictionless)')

p = 'src/__tests__/mastersHub.test.jsx'
s = open(p).read()

# helper: cfdefs branch
s = s.replace("""  if (tab === 'svcs') {
    fireEvent.click(screen.getByTestId('masters-tab-svcs'))
    await screen.findByTestId('svcs-table')
  }""",
"""  if (tab === 'svcs') {
    fireEvent.click(screen.getByTestId('masters-tab-svcs'))
    await screen.findByTestId('svcs-table')
  }
  if (tab === 'cfdefs') {
    fireEvent.click(screen.getByTestId('masters-tab-cfdefs'))
    await screen.findByTestId('cfdefs-table')
  }""")

# nav sub test: now three items
s = s.replace("expect(screen.getByTestId('nav-sub-svcs')).toBeTruthy()",
"expect(screen.getByTestId('nav-sub-svcs')).toBeTruthy()\n    expect(screen.getByTestId('nav-sub-cfdefs')).toBeTruthy()")

# ── replace the v7 inline-designer test with master-page CRUD + payer picking ──
start = s.index("  it('custom fields: typed designer — add a select, its options editor, then remove'")
end = s.index("  it('services tab: default-all note, narrowing contracts via the + picker'", start)
newCfTests = """  it('Custom Fields master page: define list options and toggle labels right in the template editor', async () => {
    render(<App />)
    await toMasters('cfdefs')
    // seeded templates render with their type, options and usage
    expect(await screen.findByTestId('cf-row-cf-authdept')).toBeTruthy()
    expect(screen.getByTestId('cf-row-cf-authdept').textContent).toContain('Single select (radio)')
    expect(screen.getByTestId('cf-usedby-cf-authdept').textContent).toBe('1') // Aetna picks it
    expect(screen.getByTestId('cf-row-cf-goals').textContent).toContain('+3') // 6 options, 3 shown
    expect(screen.getByTestId('cf-status-cf-teleconf').textContent).toContain('Inactive')
    // create a select template with a live option list
    fireEvent.click(screen.getByTestId('cf-add'))
    await screen.findByTestId('cf-modal')
    fireEvent.click(screen.getByTestId('cf-save'))
    expect(await screen.findByText('Give the field a label')).toBeTruthy()
    fireEvent.change(screen.getByTestId('cf-label'), { target: { value: 'Reward menu' } })
    await pickDropdown('cf-type', 'select')
    expect(await screen.findByTestId('cf-opt-0')).toBeTruthy() // one editable option row by default
    fireEvent.change(screen.getByTestId('cf-opt-0'), { target: { value: 'Stickers' } })
    fireEvent.click(screen.getByTestId('cf-opt-add'))
    fireEvent.change(screen.getByTestId('cf-opt-1'), { target: { value: 'Extra screen time' } })
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.some((d) => d.label === 'Reward menu')).toBe(true))
    const nf = stored().customFields.find((d) => d.label === 'Reward menu')
    expect(nf.options).toEqual(['Stickers', 'Extra screen time'])
    // options are reorderable inline
    fireEvent.click(screen.getByTestId(`cf-row-${nf.id}`))
    await screen.findByTestId('cf-modal')
    fireEvent.click(screen.getByTestId(`cf-opt-up-1`))
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === nf.id).options).toEqual(['Extra screen time', 'Stickers']))
    // toggle template: its on/off labels are first-class options
    fireEvent.click(screen.getByTestId('cf-add'))
    await screen.findByTestId('cf-modal')
    fireEvent.change(screen.getByTestId('cf-label'), { target: { value: 'Interp needed' } })
    await pickDropdown('cf-type', 'toggle')
    fireEvent.change(screen.getByTestId('cf-on-label'), { target: { value: 'Book interpreter' } })
    fireEvent.change(screen.getByTestId('cf-off-label'), { target: { value: 'No interpreter' } })
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.find((d) => d.label === 'Interp needed')?.onLabel).toBe('Book interpreter'))
    // inline required + status chips on the rows
    fireEvent.click(screen.getByTestId(`cf-req-${nf.id}`))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === nf.id).required).toBe(true))
    fireEvent.click(screen.getByTestId(`cf-status-${nf.id}`))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === nf.id).status).toBe('inactive'))
    fireEvent.click(screen.getByTestId(`cf-status-${nf.id}`))
    // delete: blocked while a payer still picks it, allowed once unused
    fireEvent.click(screen.getByTestId('cf-del-cf-authdept'))
    expect(await screen.findByText(/is picked by 1 payer/)).toBeTruthy()
    expect(stored().customFields.find((d) => d.id === 'cf-authdept')).toBeTruthy()
    fireEvent.click(screen.getByTestId(`cf-del-${nf.id}`))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === nf.id)).toBeUndefined())
  })

  it('payers only pick templates — no free-form definitions, legacy inline entries upgrade cleanly', async () => {
    render(<App />)
    await openDetail('py-aetna')
    // Aetna's picked fields resolve from the master: labels come from templates
    const row = await screen.findByTestId('pd-cf-cf-authdept')
    expect(row.textContent).toContain('Prior auth dept')
    expect(row.textContent).toContain('from master')
    expect(screen.getByTestId('pd-cf-cf-present').textContent).toContain('Caregiver present')
    // there is no designer here any more — only picking and unlinking
    expect(screen.queryByTestId('pd-cf-label')).toBeNull()
    // unlink a field from this payer (the template itself survives)
    fireEvent.click(screen.getByTestId('pcf-unlink-cf-present'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toEqual(['cf-authdept']))
    expect(stored().customFields.find((d) => d.id === 'cf-present')).toBeTruthy()
    // pick another from the template list
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    const pick = await screen.findByTestId('pd-cfpick-cf-goals')
    fireEvent.click(pick.querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cf-picker-close'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toEqual(['cf-authdept', 'cf-goals']))
    // inactive templates can't be newly picked
    expect(screen.getByTestId('pd-cfpick-cf-teleconf').querySelector('input').disabled).toBe(true)
    // and the jump-to-master affordance works
    fireEvent.click(screen.getByTestId('pd-cf-gomaster'))
    expect(await screen.findByTestId('cfdefs-table')).toBeTruthy()
  })

"""
s = s[:start] + newCfTests + s[end:]

# ── replace the old wizard typed-fields test with the master-template flow ──
start = s.index("  it('wizard: typed payer fields render per definition, block a required one, persist snapshots'")
end = s.index("  it('wizard books a payer-only service at its own contract rate'", start)
newWiz = """  it('wizard renders picked templates, required blocks completion, answers persist as snapshots', async () => {
    render(<App />)
    await toMasters('cfdefs')
    // make Prior auth dept required — every payer picking it enforces it now
    fireEvent.click(await screen.findByTestId('cf-req-cf-authdept'))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === 'cf-authdept').required).toBe(true))
    // and switch the Caregiver toggle's labels so the wizard shows them
    fireEvent.click(screen.getByTestId('cf-row-cf-present'))
    await screen.findByTestId('cf-modal')
    fireEvent.change(screen.getByTestId('cf-on-label'), { target: { value: 'With caregiver' } })
    fireEvent.click(screen.getByTestId('cf-save'))
    await waitFor(() => expect(stored().customFields.find((d) => d.id === 'cf-present').onLabel).toBe('With caregiver'))
    // book Justin (Aetna) — field panel with template controls
    fireEvent.click(screen.getByTestId('nav-calendar'))
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu')))
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    const panel = await screen.findByTestId('am-pcf')
    expect(panel.textContent).toContain('Payer fields — Aetna')
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/Payer field “Prior auth dept” is required/)).toBeTruthy()
    // answer via radio chips; toggle offers the template's labelled options
    fireEvent.click(screen.getByTestId('pcf-opt-cf-authdept-Behavioral Intake 2'))
    fireEvent.click(screen.getByTestId('pcf-toption-cf-present-1'))
    expect(screen.getByTestId('pcf-toption-cf-present-1').textContent).toBe('With caregiver')
    fireEvent.click(screen.getByTestId('save-appt'))
    await screen.findByText('Appointment created')
    await waitFor(() => {
      const created = Object.values(stored().appts).find((a) => a.pcfs && a.pcfs['cf-authdept'])
      expect(created).toBeTruthy()
      expect(created.pcfs['cf-authdept'].value).toBe('Behavioral Intake 2')
      expect(created.pcfs['cf-authdept'].label).toBe('Prior auth dept')
      expect(created.pcfs['cf-present'].value).toBe('With caregiver')
    })
  })

  it('legacy inline custom fields still render and can be promoted to a template', async () => {
    render(<App />)
    await openDetail('py-aetna')
    expect((await screen.findByTestId('pd-cf-cf-authdept')).textContent).toContain('from master')
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
  })
"""
s = s[:start] + newWiz + s[end:]
open(p, 'w').write(s)
print('wizard + cf tests replaced')
