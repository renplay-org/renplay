#!/usr/bin/env node
/**
 * Cumulative Layout Shift of the built website (website/dist, website/dist-adult) and docs (docs/site/dist):
 * `mise run check:layout`, after `sh website/build.sh` and the docs build.
 *
 * Playwright loads each page at 390 px in WebKit (an iPhone) and at 1440 px in Chromium, waits until the page is still,
 * scrolls through it to the end, and fails when the shift is above 0.02. Chromium reports it through a
 * PerformanceObserver. WebKit has no Layout Instability API, so there the page measures it the same way itself: every
 * animation frame it compares where each visible element sits in the layout (transforms and scrolling do not count)
 * and adds up the share of the screen that moved times how far, which is the API's own formula.
 * Pictures from other hosts are answered with a small grey one, and the catalog's index comes from the catalog (or
 * CATALOG_INDEX_FILE), so the run does not depend on the network's speed. LAYOUT_DEBUG=1 lists what moved.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join, normalize } from 'node:path'

const { chromium, webkit } = createRequire(new URL('../server/package.json', import.meta.url))('playwright')
const dirs = {
  website: new URL('../website/dist/', import.meta.url).pathname,
  adult: new URL('../website/dist-adult/', import.meta.url).pathname,
  docs: new URL('../docs/site/dist/', import.meta.url).pathname,
}
for (const [name, dir] of Object.entries(dirs)) {
  if (!existsSync(dir)) {
    console.error(`Build the ${name} first: sh website/build.sh, and npm run build in docs/site`)
    process.exit(1)
  }
}
const LIMIT = 0.02
const CATALOG = 'https://catalog.renplay.org/'

// The built folders, served the way Cloudflare serves them: a folder with an index.html, a slash added to it.
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
function serve(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let file = normalize(join(root, decodeURIComponent(url.pathname)))
    if (!file.startsWith(root)) { res.writeHead(403).end(); return }
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end(); return }
      file = join(file, 'index.html')
    }
    if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })))
}

async function catalogIndex() {
  if (process.env.CATALOG_INDEX_FILE) return JSON.parse(readFileSync(process.env.CATALOG_INDEX_FILE, 'utf8'))
  const res = await fetch(`${CATALOG}index.v4.sfw.json`)
  if (!res.ok) throw new Error(`The catalog answered ${res.status}`)
  return res.json()
}

// A grey picture of 1x1, for every cover.
const GREY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOcPHXqfwAGdAL8yPDlNAAAAABJRU5ErkJggg==', 'base64')

/** What runs inside every page: the shift so far, in window.__shift. */
function measureInPage() {
  window.__shift = 0
  window.__last = performance.now()
  const supported = PerformanceObserver.supportedEntryTypes?.includes('layout-shift')
  if (supported) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) { window.__shift += e.value; window.__last = performance.now() }
    }).observe({ type: 'layout-shift', buffered: true })
    window.__api = 'PerformanceObserver'
    return
  }
  window.__api = 'frame comparison'
  window.__movers = []
  window.__debug = false
  // Where an element sits in the layout, without transforms and scrolling.
  const place = (el) => {
    let x = 0, y = 0
    for (let o = el; o; o = o.offsetParent) { x += o.offsetLeft; y += o.offsetTop }
    return [x, y, el.offsetWidth, el.offsetHeight]
  }
  let before = new Map()
  const frame = () => {
    const vw = innerWidth, vh = innerHeight
    const now = new Map()
    let moved = 0, far = 0
    for (const el of document.body.querySelectorAll('img, h1, h2, h3, h4, p, li, a, button, input, summary, pre, code, small, span:not(:has(*)), .art, section')) {
      if (el.children.length && el.tagName !== 'IMG' && !el.matches('.art, section')) continue
      if (getComputedStyle(el).position === 'fixed' || el.closest('nav')) continue
      const [x, y, w, h] = place(el)
      // Only what is on the screen now or was a frame ago counts.
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > vh || !w || !h) continue
      now.set(el, [x, y, w, h])
      const was = before.get(el)
      if (!was) continue
      const d = Math.max(Math.abs(was[0] - x), Math.abs(was[1] - y))
      if (d < 1 || el.matches('section')) continue
      const top = Math.max(0, Math.min(was[1], y) - scrollY), bottom = Math.min(vh, Math.max(was[1] + was[3], y + h) - scrollY)
      const left = Math.max(0, Math.min(was[0], x)), right = Math.min(vw, Math.max(was[0] + was[2], x + w))
      if (bottom > top && right > left) {
        moved += (bottom - top) * (right - left); far = Math.max(far, d)
        if (window.__debug) window.__movers.push(`${el.tagName.toLowerCase()}.${el.className} ${was.join(',')} -> ${x},${y},${w},${h}`)
      }
    }
    if (moved) {
      window.__shift += Math.min(1, moved / (vw * vh)) * (Math.min(far, Math.max(vw, vh)) / Math.max(vw, vh))
      window.__last = performance.now()
    }
    before = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

const stillFor = async (page, ms = 800, max = 8000) => {
  const start = Date.now()
  while (Date.now() - start < max) {
    await page.waitForTimeout(150)
    if (await page.evaluate((m) => performance.now() - window.__last > m, ms)) return
  }
}

async function scrollThrough(page) {
  const height = () => page.evaluate(() => document.documentElement.scrollHeight)
  const view = await page.evaluate(() => innerHeight)
  for (let y = 0; y < Math.min(await height(), 30 * view); y += Math.round(view * 0.7)) {
    await page.evaluate((top) => scrollTo(0, top), y)
    await page.waitForTimeout(120)
  }
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await stillFor(page)
}

const results = []
async function check(browser, label, name, open) {
  const ctx = await browser.newContext(label.startsWith('390') ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await ctx.addInitScript(measureInPage)
  if (process.env.LAYOUT_DEBUG) await ctx.addInitScript(() => { window.__debug = true })
  const index = await catalogIndex()
  // The adult catalog reads the full index. Here every fourth game is marked adult, so its blur is drawn, and no adult picture exists.
  await page.route(`${CATALOG}index.v4.json`, (r) => r.fulfill({ json: { ...index, games: index.games.map((g, i) => ({ ...g, nsfw: i % 4 === 1 })) } }))
  await page.route(`${CATALOG}index.v4.sfw.json`, (r) => r.fulfill({ json: index }))
  await page.route((url) => !['127.0.0.1', 'catalog.renplay.org'].includes(url.hostname), (r) => (r.request().resourceType() === 'image' ? r.fulfill({ body: GREY, contentType: 'image/png' }) : r.abort()))
  await open(page)
  await stillFor(page)
  await scrollThrough(page)
  const [shift, api] = await page.evaluate(() => [window.__shift, window.__api])
  if (process.env.LAYOUT_DEBUG && shift > LIMIT) console.log(await page.evaluate(() => (window.__movers ?? []).slice(0, 12).join('\n')))
  results.push({ label, name, shift, api, errors })
  await ctx.close()
}

const { server: ws, base: web } = await serve(dirs.website)
const { server: as, base: adult } = await serve(dirs.adult)
const { server: ds, base: docs } = await serve(dirs.docs)
const firstGame = readFileSync(join(dirs.website, 'sitemap.xml'), 'utf8').match(/<loc>https:\/\/renplay\.org\/(catalog\/[a-z0-9-]+\/)<\/loc>/g).map((l) => l.match(/renplay\.org(\/[^<]*)/)[1]).find((p) => p !== '/catalog/')
const pages = [
  ['home', (p) => p.goto(`${web}/`)],
  ['catalog', (p) => p.goto(`${web}/catalog/`)],
  [`game page ${firstGame}`, (p) => p.goto(`${web}${firstGame}`)],
  ['adult catalog after Yes', async (p) => { await p.goto(`${adult}/`); await stillFor(p); await p.click('#yes') }],
  ['docs home', (p) => p.goto(`${docs}/`)],
  ['docs guide', (p) => p.goto(`${docs}/start-here/quick-start/`)],
]
const runs = [[webkit, '390 px WebKit'], [chromium, '1440 px Chromium']]
for (const [engine, label] of runs) {
  const browser = await engine.launch()
  for (const [name, open] of pages) await check(browser, label, name, open)
  await browser.close()
}
for (const s of [ws, as, ds]) s.close()

let failed = false
for (const r of results) {
  const bad = r.shift > LIMIT || r.errors.length
  failed ||= bad
  console.log(`${bad ? 'FAIL' : 'ok  '} ${r.label.padEnd(16)} ${r.name.padEnd(34)} shift ${r.shift.toFixed(4)} (${r.api})${r.errors.length ? ` page errors: ${r.errors.join('; ')}` : ''}`)
}
if (failed) {
  console.error(`A page shifts by more than ${LIMIT}, or has a script error.`)
  process.exit(1)
}
console.log(`No page shifts by more than ${LIMIT}.`)
