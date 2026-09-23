import pathlib
p = pathlib.Path('src/__tests__/mastersHub.test.jsx'); s = p.read_text()
old = '''    const panel = await screen.findByTestId('am-pcf')
    expect(panel.textContent).toContain('Payer fields — Aetna')
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/Payer field “Prior auth dept” is required/)).toBeTruthy()
    // answer via radio chips; toggle offers the template's labelled options'''
new = '''    // chunk-34: the panel is opt-in — nothing auto-populates on a new appointment
    const panel = await screen.findByTestId('am-pcf')
    expect(panel.textContent).toContain('Custom fields — Aetna')
    expect(screen.queryByTestId('pcf-f-cf-authdept')).toBeNull()
    expect(screen.getByTestId('am-pcf-empty')).toBeTruthy()
    fireEvent.click(screen.getByTestId('save-appt')) // no added fields → not blocked
    expect(await screen.findByText('Appointment created')).toBeTruthy()
    await screen.findByText('Appointment created')
    // reopen… simpler: a fresh booking to exercise the picker flow
    fireEvent.click(screen.getByTestId('nav-calendar'))
    fireEvent.click(screen.getByRole('button', { name: 'Appointment' }))
    fireEvent.click(await screen.findByTestId('type-service'))
    fireEvent.click(screen.getByTestId('pick-Client Name'))
    fireEvent.click((await screen.findAllByTestId('people-item')).find((b) => b.textContent.includes('Justin Hsu')))
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByTestId('pick-Staff Name'))
    fireEvent.click((await screen.findAllByTestId('people-item'))[0])
    fireEvent.mouseDown(document.body)
    await screen.findByTestId('am-pcf')
    fireEvent.click(screen.getByTestId('am-pcf-add'))
    await screen.findByTestId('am-pcf-picker')
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-authdept').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-present').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-goals').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-picker-done'))
    expect(screen.queryByTestId('am-pcf-empty')).toBeNull()
    expect(screen.getByTestId('pcf-f-cf-goals')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pcf-del-cf-goals')) // removable again — it's optional
    expect(screen.queryByTestId('pcf-f-cf-goals')).toBeNull()
    fireEvent.click(screen.getByTestId('save-appt'))
    expect(await screen.findByText(/Payer field “Prior auth dept” is required/)).toBeTruthy()
    // answer via radio chips; toggle offers the template's labelled options'''
assert old in s; s = s.replace(old, new, 1)
# created-assertion: goals must not have leaked
s = s.replace("      expect(created.pcfs['cf-present'].value).toBe('With caregiver')",
              "      expect(created.pcfs['cf-present'].value).toBe('With caregiver')\n      expect(created.pcfs['cf-goals']).toBeUndefined()", 1)
p.write_text(s); print('test patched OK')
