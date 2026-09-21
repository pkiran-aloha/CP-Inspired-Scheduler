// Builds a fully self-contained single-file HTML from the vite dist (npm run share)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'

const dist = join(process.cwd(), 'dist')
const outDir = join(process.cwd(), 'share')
mkdirSync(outDir, { recursive: true })

let html = readFileSync(join(dist, 'index.html'), 'utf8')
const assets = readdirSync(join(dist, 'assets'))
const css = readFileSync(join(dist, 'assets', assets.find((f) => f.endsWith('.css'))), 'utf8')
// the entry bundle is the largest JS file — guards against helper chunks sorting first
const jsFile = assets.filter((f) => f.endsWith('.js')).sort((a, b) => statSync(join(dist, 'assets', b)).size - statSync(join(dist, 'assets', a)).size)[0]
const js = readFileSync(join(dist, 'assets', jsFile), 'utf8')

// escape closing tags that would break inline parsing
const jsSafe = js.replace(/<\/(script|style)/g, '<\\/$1')
const cssSafe = css.replace(/<\/style/g, '<\\/style')

html = html
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${cssSafe}\n</style>`)
  .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => `<script type="module">\n${jsSafe}\n</script>`)

if (/(?:src|href)="\.?\/assets\//.test(html)) throw new Error('external asset references remain — check index.html')

writeFileSync(join(outDir, 'Aloha-ABA.html'), html)
console.log('wrote share/Aloha-ABA.html', (html.length / 1024).toFixed(1) + ' KB')
