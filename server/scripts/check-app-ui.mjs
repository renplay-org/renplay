// Checks of the app's lists and the artwork's flight, in a browser, against the built library and a
// made-up API (no server, no games: every /api answer comes from here).
//
//   node scripts/check-app-ui.mjs [--base http://localhost:5199] [--webkit]
//
// Without --base it serves selector/dist (npm run build there first). Checks:
//   - whole rows: at every width from 360 to 1920 (step 40), the Library's and the Catalog's grids hold a
//     whole number of rows after every batch, until the list ends
//   - scroll memory: scroll far, open a game, go back: the same place and the same tiles; the Catalog's
//     search is in the address, and an open game is a history entry that back closes
//   - the flight: the flying picture keeps a 2:3 shape on every frame, forward and back, on a desktop and a phone
//   - the Library's loading state has the loaded page's shape: its grid starts where the loaded grid does
//   - on a phone, every link, button and field is at least 40 x 40 px, every aria-label starts with the control's visible
//     text, and the page can be zoomed
//   - layout shift under 0.02 on the Library, the Catalog and a game page (Chromium only: WebKit does not report it)
// --webkit adds the flight and the rows in WebKit. Needs the browsers once: npx playwright install chromium webkit
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices, webkit } from 'playwright'
import { GAMES, mock, RECIPES } from './app-mock.mjs'

const args = process.argv.slice(2)
const withWebkit = args.includes('--webkit')
const baseArg = args.includes('--base') ? args[args.indexOf('--base') + 1] : null
const dist = fileURLToPath(new URL('../../selector/dist', import.meta.url))

// ---- what the app is served ---------------------------------------------------------------------

async function serveDist() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png' }
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = await readFile(join(dist, path)).then((b) => ({ b, type: types[extname(path)] ?? 'application/octet-stream' })).catch(() => null)
    const sent = file ?? { b: await readFile(join(dist, 'index.html')), type: 'text/html' }
    res.writeHead(200, { 'content-type': sent.type }).end(sent.b)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

// ---- helpers ------------------------------------------------------------------------------------

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const gridOf = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('.grid[data-row]')
    return grid ? { tiles: grid.children.length, cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length } : null
  })

/** Scroll to the end of the grid until it stops growing, or `batches` batches came. Every size seen is returned. */
async function growBy(page, batches) {
  const sizes = []
  for (let guard = 0; guard < 40 && sizes.length <= batches; guard++) {
    const g = await gridOf(page)
    if (!g) break
    if (sizes.at(-1)?.tiles !== g.tiles) sizes.push(g)
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(90)
  }
  return sizes
}

/**
 * The flying picture on every frame, and where its animation ends (the last keyframe, since the last frame seen
 * may be a few hundredths of a second short of it): its shape and place.
 */
const recordGhost = (page) =>
  page.evaluate(() => {
    window.__ghost = []
    window.__end = null
    const tick = () => {
      const el = document.querySelector('.ghost')
      if (el) {
        const r = el.getBoundingClientRect()
        window.__ghost.push({ w: r.width, h: r.height, x: r.x, y: r.y })
        if (!window.__end) {
          const last = el.getAnimations()[0]?.effect.getKeyframes().at(-1)
          const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(last?.transform ?? '')
          if (m) window.__end = { x: +m[1], y: +m[2], width: el.offsetWidth * +m[3] }
        }
      }
      window.__recording = requestAnimationFrame(tick)
    }
    window.__recording = requestAnimationFrame(tick)
  })
/** The frames recorded, once the flying picture has landed. */
const takeGhost = async (page) => {
  await page.waitForTimeout(300)
  await page.waitForFunction(() => !document.querySelector('.ghost'), null, { timeout: 5000 })
  return page.evaluate(() => {
    cancelAnimationFrame(window.__recording)
    return { frames: window.__ghost, end: window.__end }
  })
}

const shapeOk = (frames) => frames.length >= 6 && frames.every((f) => Math.abs(f.h / f.w - 1.5) < 0.02)

// ---- the checks ---------------------------------------------------------------------------------

async function rowsAt(browser, base, errors) {
  const widths = Array.from({ length: 29 }, (_, i) => 360 + i * 40)
  const bad = []
  await Promise.all(
    [0, 1, 2, 3].map(async (lane) => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, serviceWorkers: 'block' })
      const page = await ctx.newPage()
      await mock(page, errors, 'rows')
      for (const width of widths.filter((_, i) => i % 4 === lane)) {
        await page.setViewportSize({ width, height: 800 })
        for (const [path, total] of [['/', GAMES], ['/catalog', RECIPES]]) {
          await page.goto(base + path)
          await page.waitForSelector('.grid[data-row] .card')
          const sizes = await growBy(page, 3)
          for (const { tiles, cols } of sizes) if (tiles % cols && tiles !== total) bad.push(`${path} at ${width}: ${tiles} tiles in ${cols} columns`)
          if (sizes.length < 2) bad.push(`${path} at ${width}: the list never grew`)
        }
      }
      await ctx.close()
    }),
  )
  check(!bad.length, `grids hold whole rows at 360 to 1920 px (${widths.length} widths, both lists, every batch)${bad.length ? `: ${bad.slice(0, 4).join('; ')}` : ''}`)
}

async function memory(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  await page.goto(base + '/')
  await page.waitForSelector('.grid[data-row] .card')
  await growBy(page, 2)
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight * 0.55, behavior: 'instant' }))
  await page.waitForTimeout(400)
  const before = await page.evaluate(() => ({ y: Math.round(scrollY), tiles: document.querySelectorAll('.grid[data-row] .card').length }))
  const target = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.grid[data-row] .card')].find((c) => c.getBoundingClientRect().top > 120 && c.getBoundingClientRect().bottom < innerHeight - 90)
    return t?.dataset.id
  })
  await page.locator(`.grid[data-row] .card[data-id="${target}"]`).click()
  await page.waitForSelector('.stage')
  await page.waitForTimeout(700)
  await page.goBack()
  await page.waitForSelector('.grid[data-row] .card')
  await page.waitForTimeout(900)
  const after = await page.evaluate(() => ({ y: Math.round(scrollY), tiles: document.querySelectorAll('.grid[data-row] .card').length }))
  check(after.tiles === before.tiles && Math.abs(after.y - before.y) <= 2, `${label}: back from a game restores the Library (scroll ${before.y} then ${after.y}, tiles ${before.tiles} then ${after.tiles})`)

  // The Catalog: the search is in the address, a game's sheet is an entry of its own, back closes it.
  await page.goto(base + '/catalog')
  await page.waitForSelector('.grid[data-row] .card')
  await page.fill('input[aria-label="Search the catalog"]', 'recipe')
  await page.waitForTimeout(500)
  check(new URL(page.url()).searchParams.get('q') === 'recipe', `${label}: the Catalog's search is in the address`)
  const total = (await gridOf(page)).tiles
  await growBy(page, 4)
  const open = page.locator('.grid[data-row] a.card:not([href^="/game/"])').nth(70)
  await open.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.waitForTimeout(400)
  const c0 = await page.evaluate(() => ({ y: Math.round(scrollY), tiles: document.querySelectorAll('.grid[data-row] .card').length }))
  const lengthBefore = await page.evaluate(() => history.length)
  await open.click()
  await page.waitForSelector('[role="dialog"]')
  check((await page.evaluate(() => history.length)) === lengthBefore + 1 && new URL(page.url()).searchParams.has('game'), `${label}: an open game is a history entry`)
  await page.goBack()
  await page.waitForTimeout(500)
  const c1 = await page.evaluate(() => ({ y: Math.round(scrollY), tiles: document.querySelectorAll('.grid[data-row] .card').length, dialog: !!document.querySelector('[role="dialog"]'), q: new URL(location.href).searchParams.get('q') }))
  check(!c1.dialog && c1.q === 'recipe' && Math.abs(c1.y - c0.y) <= 2 && c1.tiles === c0.tiles, `${label}: back closes the sheet and leaves the list where it was (scroll ${c0.y} then ${c1.y}, tiles ${c0.tiles} then ${c1.tiles}, first batch ${total})`)
  // And out to a game and back, with the search kept.
  await page.evaluate(() => [...document.querySelectorAll('.grid[data-row] .card')].find((c) => c.getAttribute('href').startsWith('/game/'))?.click())
  await page.waitForSelector('.stage')
  await page.waitForTimeout(600)
  await page.goBack()
  await page.waitForSelector('.grid[data-row] .card')
  await page.waitForTimeout(500)
  const c2 = await page.evaluate(() => ({ tiles: document.querySelectorAll('.grid[data-row] .card').length, q: new URL(location.href).searchParams.get('q') }))
  check(c2.q === 'recipe' && c2.tiles === c0.tiles, `${label}: back from a game keeps the Catalog's search and loaded rows`)
  await ctx.close()
}

async function flight(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  // A pointer left over a tile lifts it 4 percent: the tile's place is measured without that.
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.head.insertAdjacentHTML('beforeend', '<style>.card:not(.on):hover .frame { transform: none !important }</style>')))
  const near = (a, b) => Math.abs(a.x - b.x) <= 3 && Math.abs(a.y - b.y) <= 3 && Math.abs((a.w ?? a.width) - b.width) <= 3
  const rectOf = (selector) => page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect()
    return r && { x: r.x, y: r.y, width: r.width, height: r.height }
  }, selector)
  for (const [where, selector, n] of [['a shelf tile', '.shelf .card', 0], ['a grid tile', '.grid[data-row] .card', 5]]) {
    await page.goto(base + '/')
    await page.waitForSelector(selector)
    const tile = page.locator(selector).nth(n)
    await tile.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    const gameId = await tile.getAttribute('data-id')
    await recordGhost(page)
    await tile.click()
    await page.waitForSelector('.stage')
    await page.waitForTimeout(900)
    const forward = await takeGhost(page)
    check(shapeOk(forward.frames), `${label}: from ${where} the picture keeps a 2:3 shape on all ${forward.frames.length} frames`)
    const cover = await rectOf('.stage .cover .frame')
    check(!!forward.end && near(forward.end, cover), `${label}: from ${where} it lands on the stage's cover${forward.end && !near(forward.end, cover) ? ` (ends at ${JSON.stringify(forward.end)}, cover ${JSON.stringify(cover)})` : ''}`)
    await recordGhost(page)
    await page.goBack()
    await page.waitForSelector('.grid[data-row] .card')
    await page.waitForTimeout(900)
    const back = await takeGhost(page)
    check(shapeOk(back.frames), `${label}: back to ${where} the picture keeps a 2:3 shape on all ${back.frames.length} frames`)
    const home = await rectOf(`${selector.split(' ')[0] === '.shelf' ? '.shelf' : '.grid[data-row]'} .card[data-id="${gameId}"] .frame`)
    check(!!back.end && near(back.end, home) && (await page.evaluate(() => document.querySelectorAll('.ghost').length)) === 0, `${label}: back to ${where} it lands on the tile and leaves no picture behind${back.end && !near(back.end, home) ? ` (ends at ${JSON.stringify(back.end)}, tile ${JSON.stringify(home)})` : ''}`)
  }
  // A tile that is off screen once the list has restored its place gets no flight back.
  await page.goto(base + '/')
  await page.waitForSelector('.grid[data-row] .card')
  await page.locator('.grid[data-row] .card').nth(5).scrollIntoViewIfNeeded()
  await page.locator('.grid[data-row] .card').nth(5).click()
  await page.waitForSelector('.stage')
  await page.waitForTimeout(800)
  await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('renplay:scroll:')).forEach((k) => sessionStorage.setItem(k, '0')))
  await recordGhost(page)
  await page.goBack()
  await page.waitForTimeout(1500)
  check((await page.evaluate(() => (cancelAnimationFrame(window.__recording), window.__ghost.length))) === 0, `${label}: a tile off screen gets no flight back`)
  await ctx.close()
}

async function shift(browser, base, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, 'shift')
  await page.addInitScript(() => {
    window.__cls = 0
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
  for (const [name, path, ready] of [['the Library', '/', '.grid[data-row] .card'], ['the Catalog', '/catalog', '.grid[data-row] .card'], ['a game page', '/game/game-000', '.stage']]) {
    await page.goto(base + path)
    await page.waitForSelector(ready)
    await page.waitForTimeout(2000)
    const loaded = await page.evaluate(() => window.__cls)
    // Then a person's scroll to the end: a screen at a time, so the grid grows ahead of them.
    for (let i = 0; i < 40; i++) {
      const more = await page.evaluate(() => {
        window.scrollBy({ top: innerHeight * 0.8, behavior: 'instant' })
        return scrollY + innerHeight < document.documentElement.scrollHeight - 2
      })
      await page.waitForTimeout(80)
      if (!more) break
    }
    await page.waitForTimeout(400)
    const cls = await page.evaluate(() => window.__cls)
    check(cls < 0.02, `layout shift on ${name} is ${loaded.toFixed(4)} at load and ${cls.toFixed(4)} after scrolling through (under 0.02)`)
  }
  await ctx.close()
}

async function skeleton(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  let release
  const gate = new Promise((done) => (release = done))
  await page.route('**/api/games', async (route) => {
    await gate
    await route.fallback()
  })
  const gridTop = () => page.evaluate(() => Math.round(document.querySelector('.grid').getBoundingClientRect().top + scrollY))
  await page.goto(base + '/')
  await page.waitForSelector('.sec .skel-line')
  const loading = await gridTop()
  release()
  await page.waitForSelector('.card .frame')
  await page.waitForTimeout(500)
  const loaded = await gridTop()
  check(Math.abs(loading - loaded) <= 12, `${label}: the Library's loading state has the loaded page's shape (its grid starts at ${loading}, loaded at ${loaded})`)
  await ctx.close()
}

async function touch(browser, base, errors) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, 'touch')
  for (const [name, path] of [['the Library', '/'], ['the Catalog', '/catalog'], ['a game page', '/game/game-001'], ['Add games', '/add']]) {
    await page.goto(base + path)
    await page.waitForSelector('main')
    await page.waitForTimeout(800)
    const found = await page.evaluate(() => {
      const shown = (e) => {
        const r = e.getBoundingClientRect()
        const style = getComputedStyle(e)
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !e.classList.contains('sr-only')
      }
      const small = []
      const labels = []
      const squash = (text) => text.toLowerCase().replace(/\s+/g, '')
      for (const e of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=switch]')) {
        if (!shown(e)) continue
        const r = e.getBoundingClientRect()
        const text = e.tagName === 'SELECT' ? '' : (e.textContent ?? '').trim()
        if (r.width < 40 || r.height < 40) small.push(`${text || e.getAttribute('aria-label') || e.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`)
        const label = e.getAttribute('aria-label')
        if (label && text && !squash(label).startsWith(squash(text))) labels.push(`"${label}" for "${text}"`)
      }
      return { small, labels }
    })
    check(!found.small.length, `phone: every control on ${name} is at least 40 x 40 px${found.small.length ? `: ${found.small.slice(0, 4).join(', ')}` : ''}`)
    check(!found.labels.length, `phone: every aria-label on ${name} starts with its visible text${found.labels.length ? `: ${found.labels.slice(0, 3).join(', ')}` : ''}`)
  }
  const viewport = await page.evaluate(() => document.querySelector('meta[name=viewport]').content)
  check(!/maximum-scale|user-scalable/.test(viewport), 'the page can be pinch-zoomed (the viewport has no maximum-scale)')
  await ctx.close()
}

// ---- run ----------------------------------------------------------------------------------------

const errors = []
const served = baseArg ? { url: baseArg, close() {} } : await serveDist()
const started = Date.now()
const desktop = { viewport: { width: 1440, height: 900 } }
const phoneChromium = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }

const chrome = await chromium.launch()
// The rows take the longest and need no timing, so they run beside the rest, which does.
await Promise.all([
  rowsAt(chrome, served.url, errors),
  (async () => {
    await memory(chrome, served.url, errors, desktop, 'desktop')
    await flight(chrome, served.url, errors, desktop, 'desktop')
    await flight(chrome, served.url, errors, phoneChromium, 'phone')
    await touch(chrome, served.url, errors)
    await skeleton(chrome, served.url, errors, desktop, 'desktop')
    await skeleton(chrome, served.url, errors, phoneChromium, 'phone')
    await shift(chrome, served.url, errors)
  })(),
])
await chrome.close()

if (withWebkit) {
  const safari = await webkit.launch()
  await flight(safari, served.url, errors, devices['iPhone 15 Pro'], 'phone (WebKit)')
  await memory(safari, served.url, errors, devices['iPhone 15 Pro'], 'phone (WebKit)')
  await safari.close()
}
served.close()

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join('; ')}` : ''}`)
console.log(`${failures.length ? `${failures.length} failed` : 'All passed'} in ${Math.round((Date.now() - started) / 1000)} s`)
process.exitCode = failures.length ? 1 : 0
