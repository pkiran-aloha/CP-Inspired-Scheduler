// Code-split sections and the jsPDF engine are fetched once before each test file, so UI
// tests render them synchronously, as before the split (preloadViews in App.jsx).
import { preloadViews } from '../App'
import { loadPdf } from '../lib/exportKit'

await Promise.all([preloadViews(), loadPdf()])
