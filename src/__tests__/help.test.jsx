import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import App from '../App'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

const article = () => screen.getByTestId('help-article')

async function openHelp() {
  render(<App />)
  fireEvent.click(await screen.findByTestId('nav-help'))
  return screen.findByTestId('help-view')
}

describe('Help & Wiki', () => {
  it('opens from the navigation rail on the wiki home', async () => {
    await openHelp()
    expect(article().querySelector('h1').textContent).toMatch(/wiki/i)
    expect(screen.getByTestId('help-page-readme').getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('help-page-faq')).toBeTruthy()
    expect(screen.getByTestId('nav-help').getAttribute('aria-current')).toBe('page')
  })

  it('searches every page and opens the chosen result', async () => {
    await openHelp()
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: 'recoupment' } })
    const first = screen.getByTestId('help-result-0')
    const heading = first.querySelector('.help-result-head').textContent
    fireEvent.click(first)
    expect(screen.queryByTestId('help-results')).toBeNull()
    expect(screen.getByTestId('help-search').value).toBe('')
    expect([...article().querySelectorAll('h1, h2, h3, h4')].map((h) => h.textContent.trim())).toContain(heading)
  })

  it('says so when nothing matches', async () => {
    await openHelp()
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: 'zzzq qqqz' } })
    expect(screen.getByTestId('help-results').textContent).toContain('No matches for "zzzq qqqz".')
  })

  it('follows a link from the FAQ to the detailed page', async () => {
    await openHelp()
    fireEvent.click(screen.getByTestId('help-page-faq'))
    const link = article().querySelector('a[data-wiki-page]:not([data-wiki-page="faq"])')
    expect(link).toBeTruthy()
    const target = link.getAttribute('data-wiki-page')
    fireEvent.click(link)
    expect(screen.getByTestId(`help-page-${target}`).getAttribute('aria-current')).toBe('page')
  })

  it('opens from the command palette', async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'wiki' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByTestId('help-view')).toBeTruthy()
  })
})
