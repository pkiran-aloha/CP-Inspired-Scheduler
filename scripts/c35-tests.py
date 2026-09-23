import pathlib
p = pathlib.Path('src/__tests__/mastersHub.test.jsx'); s = p.read_text()

# --- cfdefs master test: usage starts at 0; pick first, then delete is blocked ---
old = "    expect(screen.getByTestId('cf-usedby-cf-authdept').textContent).toBe('1') // Aetna picks it"
new = "    expect(screen.getByTestId('cf-usedby-cf-authdept').textContent).toBe('0') // chunk-35: nothing pre-picked"
assert old in s; s = s.replace(old, new, 1)
old = """    // delete: blocked while a payer still picks it, allowed once unused
    fireEvent.click(screen.getByTestId('cf-del-cf-authdept'))
    expect(await screen.findByText(/is picked by 1 payer/)).toBeTruthy()
    expect(stored().customFields.find((d) => d.id === 'cf-authdept')).toBeTruthy()"""
new = """    // delete: blocked while a payer still picks it, allowed once unused — so pick it first
    await openDetail('py-aetna')
    fireEvent.click(await screen.findByTestId('pd-cf-pick'))
    fireEvent.click((await screen.findByTestId('pd-cfpick-cf-authdept')).querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cf-picker-close'))
    await waitFor(() => expect(stored().payers.find((x) => x.id === 'py-aetna').cf).toEqual(['cf-authdept']))
    await toMasters('cfdefs')
    await screen.findByTestId('cfdefs-table')
    expect(await screen.findByTestId('cf-usedby-cf-authdept').textContent).toBe('1')
    fireEvent.click(screen.getByTestId('cf-del-cf-authdept'))
    expect(await screen.findByText(/is picked by 1 payer/)).toBeTruthy()
    expect(stored().customFields.find((d) => d.id === 'cf-authdept')).toBeTruthy()
    fireEvent.click(screen.getByTestId(`pcf-unlink-cf-authdept`)).catch(() => {})
    await openDetail('py-aetna')
    fireEvent.click(await screen.findByTestId('pcf-unlink-cf-authdept'))
    await waitFor(() => expect(stored().payers.find((x) => x.id === 'py-aetna').cf).toEqual([]))
    await toMasters('cfdefs')
    await screen.findByTestId('cfdefs-table')"""
assert old in s; s = s.replace(old, new, 1)

# --- payers-only-pick test: starts empty, everything is a deliberate pick ---
old = """    render(<App />)
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
    // inactive templates can't be newly picked
    expect(screen.getByTestId('pd-cfpick-cf-teleconf').querySelector('input').disabled).toBe(true)
    fireEvent.click(pick.querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cf-picker-close'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toEqual(['cf-authdept', 'cf-goals']))"""
new = """    render(<App />)
    await openDetail('py-aetna')
    // chunk-35: seeded payers carry NO pre-picked fields — selectable only
    expect(await screen.findByTestId('payer-detail')).toBeTruthy()
    expect(screen.queryByTestId('pd-cf-cf-authdept')).toBeNull()
    expect((await screen.findByTestId('pd-cf-card')).textContent).toContain('No fields picked yet')
    // pick from the template list — nothing else is possible here (no free-form designer)
    expect(screen.queryByTestId('pd-cf-label')).toBeNull()
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    const pickA = await screen.findByTestId('pd-cfpick-cf-authdept')
    fireEvent.click(pickA.querySelector('input'))
    fireEvent.click((await screen.findByTestId('pd-cfpick-cf-present')).querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cf-picker-close'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toEqual(['cf-authdept', 'cf-present']))
    // picked fields resolve their labels from the master
    const row = await screen.findByTestId('pd-cf-cf-authdept')
    expect(row.textContent).toContain('Prior auth dept')
    expect(row.textContent).toContain('from master')
    expect(screen.getByTestId('pd-cf-cf-present').textContent).toContain('Caregiver present')
    // unlinking only detaches from this payer — the template survives
    fireEvent.click(screen.getByTestId('pcf-unlink-cf-present'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toEqual(['cf-authdept']))
    expect(stored().customFields.find((d) => d.id === 'cf-present')).toBeTruthy()
    // pick another; inactive templates can't be newly picked
    fireEvent.click(screen.getByTestId('pd-cf-pick'))
    expect(screen.getByTestId('pd-cfpick-cf-teleconf').querySelector('input').disabled).toBe(true)
    fireEvent.click((await screen.findByTestId('pd-cfpick-cf-goals')).querySelector('input'))
    fireEvent.click(screen.getByTestId('pd-cf-picker-close'))
    await waitFor(() => expect(stored().payers.find((p) => p.id === 'py-aetna').cf).toEqual(['cf-authdept', 'cf-goals']))"""
assert old in s; s = s.replace(old, new, 1)
p.write_text(s); print('tests OK')
