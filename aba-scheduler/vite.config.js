import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// SHARE_INLINE=1 (the single-file `npm run share` build) folds every dynamic chunk
// into one bundle so the HTML has nothing external to fetch.
export default defineConfig({
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
    rollupOptions: {
      output: process.env.SHARE_INLINE === '1' ? { inlineDynamicImports: true } : {},
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
})
