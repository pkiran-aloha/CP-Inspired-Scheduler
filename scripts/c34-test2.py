import pathlib
p = pathlib.Path('src/__tests__/mastersHub.test.jsx'); s = p.read_text()
old = '''    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-authdept').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-present').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-goals').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-picker-done'))
    expect(screen.queryByTestId('am-pcf-empty')).toBeNull()
    expect(screen.getByTestId('pcf-f-cf-goals')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pcf-del-cf-goals')) // removable again — it's optional
    expect(screen.queryByTestId('pcf-f-cf-goals')).toBeNull()'''
new = '''    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-authdept').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-pick-cf-present').querySelector('input'))
    fireEvent.click(screen.getByTestId('am-pcf-picker-done'))
    expect(screen.queryByTestId('am-pcf-empty')).toBeNull()
    expect(screen.getByTestId('pcf-f-cf-present')).toBeTruthy()
    fireEvent.click(screen.getByTestId('pcf-del-cf-present')) // removable again — it's optional
    expect(screen.queryByTestId('pcf-f-cf-present')).toBeNull()
    fireEvent.click(screen.getByTestId('am-pcf-add')) // re-add from the picker
    fireEvent.click(await screen.findByTestId('am-pcf-pick-cf-present').then((el) => el.querySelector('input')))
    fireEvent.click(screen.getByTestId('am-pcf-picker-done'))
    expect(screen.getByTestId('pcf-f-cf-present')).toBeTruthy()'''
assert old in s; s = s.replace(old, new, 1)
s = s.replace("\n      expect(created.pcfs['cf-goals']).toBeUndefined()", '', 1)
p.write_text(s); print('ok')
