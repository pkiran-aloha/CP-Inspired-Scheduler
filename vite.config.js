import fs from 'fs'
import { defineConfig } from 'vite'
// the running bundle embeds its own build id so it can detect (and announce) a newer deploy
let APP_BUILD = 'dev'
try { APP_BUILD = String(JSON.parse(fs.readFileSync('public/version.json', 'utf8')).build || 'dev') } catch { /* prebuild not run yet */ }
import react from '@vitejs/plugin-react'

// SHARE_INLINE=1 (the single-file `npm run share` build) folds every dynamic chunk
// into one bundle so the HTML has nothing external to fetch.
export default defineConfig({
  base: './', // path-relative assets: works on GitHub Pages project subpaths as well as domain roots
  define: { __APP_BUILD__: JSON.stringify(APP_BUILD) },
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  optimizeDeps: {
    // don't scan share/*.html (self-contained single-file builds confuse the dep scanner)
    entries: ['index.html'],
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    // Non-calendar sections, the wiki and jsPDF are lazy chunks. The entry (~1,015 kB) is
    // the calendar plus the store and the domain engines its reducer needs; this limit is
    // a tripwire for regrowth, not a waiver. Split further only by decoupling the reducer.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: process.env.SHARE_INLINE === '1' ? { inlineDynamicImports: true } : {},
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
    setupFiles: ['src/test/setup.js'],
  },
})
