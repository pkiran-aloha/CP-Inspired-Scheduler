// Code-split sections and the jsPDF engine are fetched once before each test file, so UI
// tests render them synchronously, as before the split (preloadViews in App.jsx).
import { configure } from '@testing-library/react'
import { preloadViews } from '../App'
import { loadPdf } from '../lib/exportKit'

// findBy*/waitFor give up after 1 s by default. A full <App /> render can take longer than
// that when the machine is busy (two suites at once, a slow CI runner). A passing wait
// still returns as soon as it matches; only a real failure takes the longer to report.
configure({ asyncUtilTimeout: 5000 })

await Promise.all([preloadViews(), loadPdf()])
