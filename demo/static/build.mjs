// Builds the static demo: the library, the stand-in service worker and the snapshot of a running demo server, as plain
// files for a static host. See demo/README.md.
//
//   node build.mjs <outDir> --seed <dir> [--base http://127.0.0.1:8080] [--embedder https://renplay.org]
//
// --seed is the demo image's seed output (/data and /games of its seed stage). --base is a running demo server, which
// is read and never changed. --embedder is the one origin the demo's bridge talks to and may frame it.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { headersFor } from './headers.mjs'
import { writeSnapshot } from './snapshot.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const selector = resolve(here, '../../selector')

/** What a Cloudflare static assets deployment accepts on the free plan. */
const LIMITS = { files: 20000, fileBytes: 25 * 1024 * 1024 }

/** The page waits for the worker before the library starts, since the first request goes to /api/me. */
const loader = (entry) => `<script>
(function () {
  var sw = navigator.serviceWorker
  if (!sw) { document.documentElement.textContent = 'This demo needs service workers, which this browser has turned off.'; return }
  // The worker's word that something changed reaches the library as the event it already hears.
  sw.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'renplay-demo:changed') window.dispatchEvent(new Event('renplay:saves-changed'))
  })
  var start = function () { import('${entry}') }
  if (sw.controller) return start()
  // A browser sometimes leaves a page uncontrolled even with an active worker (seen in WebKit): ask again by reloading.
  var retry = function () {
    var n = Number(sessionStorage.getItem('renplay-sw-retry') || 0)
    if (n < 3) { sessionStorage.setItem('renplay-sw-retry', String(n + 1)); location.reload() }
  }
  sw.register('/sw.js', { scope: '/' }).then(function () { return sw.ready }).then(function () {
    if (sw.controller) return start()
    sw.addEventListener('controllerchange', start, { once: true })
    setTimeout(function () { if (!sw.controller) retry() }, 1500)
  })
})()
</script>`

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
}

function main() {
  const args = process.argv.slice(2)
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
  const out = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : ''
  const seed = opt('--seed', '')
  if (!out || !seed) throw new Error('usage: node build.mjs <outDir> --seed <dir> [--base <url>] [--embedder <origin>]')
  return build({ out, seed: resolve(seed), base: opt('--base', 'http://127.0.0.1:8080'), embedder: opt('--embedder', 'https://renplay.org') })
}

async function build({ out, seed, base, embedder }) {
  const headers = headersFor(embedder)
  const { build: viteBuild } = await import(join(selector, 'node_modules/vite/dist/node/index.js'))

  // 1. The library, as it is built for the server.
  execFileSync(join(selector, 'node_modules/.bin/vite'), ['build', '--outDir', out, '--emptyOutDir'], { cwd: selector, stdio: 'inherit' })
  // The PDF reader's files are for walkthroughs, which the demo's games do not have.
  for (const name of readdirSync(join(out, 'assets'))) if (/^pdfjs-[\d.]+$/.test(name)) rmSync(join(out, 'assets', name), { recursive: true })

  // 2. The stand-in, as /sw.js (the name the library registers).
  await viteBuild({
    root: here,
    configFile: false,
    logLevel: 'warn',
    build: { outDir: out, emptyOutDir: false, target: 'es2022', minify: true, lib: { entry: join(here, 'sw/stand-in.ts'), formats: ['iife'], name: 'standIn', fileName: () => 'sw.js' } },
  })

  // 3. What the demo shows: the answers, the pictures and the games.
  const games = await writeSnapshot({ out, base, seed, embedder })

  // 4. The page that waits for the worker, and the headers.
  const indexPath = join(out, 'index.html')
  const index = readFileSync(indexPath, 'utf8')
  const entry = index.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/)
  if (!entry) throw new Error('The built index.html has no module script')
  writeFileSync(indexPath, index.replace(entry[0], loader(entry[1])))
  writeFileSync(join(out, '_headers'), headers)

  // 5. It must fit the host.
  const all = files(out)
  const largest = all.map((p) => [p, statSync(p).size]).sort((a, b) => b[1] - a[1])[0]
  if (all.length > LIMITS.files || largest[1] > LIMITS.fileBytes) throw new Error(`The output does not fit: ${all.length} files, the largest is ${largest[0]} at ${largest[1]} bytes`)
  const total = all.reduce((n, p) => n + statSync(p).size, 0)
  console.log(`Static demo of ${games.join(', ')} in ${out}: ${all.length} files, ${(total / 1048576).toFixed(1)} MB, the largest ${(largest[1] / 1048576).toFixed(1)} MB`)
}

await main()
