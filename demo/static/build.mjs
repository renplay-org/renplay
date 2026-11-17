// Builds the static demo: the library, the stand-in service worker and the snapshot of a running demo server, as plain
// files for a static host. See demo/README.md.
//
//   node build.mjs <outDir> --seed <dir> [--base http://127.0.0.1:8080] [--embedder https://renplay.org]
//
// --seed is the demo image's seed output (/data and /games of its seed stage). --base is a running demo server, which
// is read and never changed. --embedder is the one origin the demo's bridge talks to and may frame it.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkArt } from './art.mjs'
import { headersFor } from './headers.mjs'
import { ROBOTS_TXT, demoHead } from './seo.mjs'
import { writeSnapshot } from './snapshot.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const selector = resolve(here, '../../selector')

/** What a Cloudflare static assets deployment accepts on the free plan. */
const LIMITS = { files: 20000, fileBytes: 25 * 1024 * 1024 }

/**
 * The page waits for the stand-in before the library starts, since the first request goes to /api/me. A worker that
 * controls the page is not enough: a visitor who came back from the server demo still has that demo's worker (the same
 * /sw.js) until the stand-in is downloaded and takes over, and it would answer /api/me from a server that is not there.
 * So the page asks the worker that controls it, and starts when the stand-in answers with this build's version.
 */
const loader = (entry, version) => `<script>
(function () {
  var sw = navigator.serviceWorker
  if (!sw) { document.documentElement.textContent = 'This demo needs service workers, which this browser has turned off.'; return }
  var started = false
  var start = function () { if (!started) { started = true; import('${entry}') } }
  sw.addEventListener('message', function (e) {
    var d = e.data
    if (!d) return
    // The worker's word that something changed reaches the library as the event it already hears.
    if (d.type === 'renplay-demo:changed') window.dispatchEvent(new Event('renplay:saves-changed'))
    if (d.type === 'renplay-demo:ready' && d.version === '${version}') start()
  })
  var ask = function () { if (!started && sw.controller) sw.controller.postMessage({ type: 'renplay-demo:hello' }) }
  sw.addEventListener('controllerchange', ask)
  // A browser sometimes leaves a page uncontrolled even with an active worker (seen in WebKit): ask again by reloading.
  var retry = function () {
    if (started) return
    var n = Number(sessionStorage.getItem('renplay-sw-retry') || 0)
    if (n < 3) { sessionStorage.setItem('renplay-sw-retry', String(n + 1)); location.reload() }
  }
  sw.register('/sw.js', { scope: '/' }).then(function () { return sw.ready }).then(function () {
    ask()
    // A worker that is not the stand-in yet says nothing. The stand-in's turn comes by controllerchange, and this asks again meanwhile.
    var again = setInterval(function () { if (started) clearInterval(again); else ask() }, 500)
    setTimeout(retry, sw.controller ? 10000 : 1500)
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
  // Names this build's worker and its page, which must be of one build to start the library.
  const version = randomBytes(8).toString('hex')
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
    define: { __STAND_IN_VERSION__: JSON.stringify(version) },
    build: { outDir: out, emptyOutDir: false, target: 'es2022', minify: true, lib: { entry: join(here, 'sw/stand-in.ts'), formats: ['iife'], name: 'standIn', fileName: () => 'sw.js' } },
  })

  // 3. What the demo shows: the answers, the pictures and the games.
  const games = await writeSnapshot({ out, base, seed, embedder })
  // The stand-in leaves the pictures to the host: one the answers name and the output lacks is a 404 for the visitor.
  checkArt(out)

  // 4. The page that waits for the worker, what search engines read, and the headers.
  const indexPath = join(out, 'index.html')
  const index = readFileSync(indexPath, 'utf8')
  const entry = index.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/)
  if (!entry) throw new Error('The built index.html has no module script')
  writeFileSync(indexPath, demoHead(index.replace(entry[0], loader(entry[1], version))))
writeFileSync(join(out, 'robots.txt'), ROBOTS_TXT)
  writeFileSync(join(out, '_headers'), headers)

  // 5. It must fit the host.
  const all = files(out)
  const largest = all.map((p) => [p, statSync(p).size]).sort((a, b) => b[1] - a[1])[0]
  if (all.length > LIMITS.files || largest[1] > LIMITS.fileBytes) throw new Error(`The output does not fit: ${all.length} files, the largest is ${largest[0]} at ${largest[1]} bytes`)
  const total = all.reduce((n, p) => n + statSync(p).size, 0)
  console.log(`Static demo of ${games.join(', ')} in ${out}: ${all.length} files, ${(total / 1048576).toFixed(1)} MB, the largest ${(largest[1] / 1048576).toFixed(1)} MB`)
}

await main()
