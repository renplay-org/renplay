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
//   - layout shift under 0.02 on the Library, the Catalog and a game page (Chromium only: WebKit does not report it)
// --webkit adds the flight and the rows in WebKit. Needs the browsers once: npx playwright install chromium webkit
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices, webkit } from 'playwright'

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

// ---- the made-up API ----------------------------------------------------------------------------

const GAMES = 130
const RECIPES = 120
const id = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`
const art = (slug) => ({
  grid: { url1x: `/api/art/${slug}-grid.svg`, url2x: null, width: 600, height: 900, thumbhash: null, tint: '#6a7ad0', made: null },
  wide: { url1x: `/api/art/${slug}-wide.svg`, url2x: null, width: 920, height: 430, thumbhash: null, tint: '#6a7ad0', made: null },
  hero: { url1x: `/api/art/${slug}-hero.svg`, url2x: null, width: 1920, height: 620, thumbhash: null, tint: '#6a7ad0', made: null },
  icon: { url1x: `/api/art/${slug}-icon.svg`, url2x: null, width: 512, height: 512, thumbhash: null, tint: '#6a7ad0', made: 'crop' },
})
const games = Array.from({ length: GAMES }, (_, i) => ({
  id: id('game', i), title: `Game ${i}`, developer: 'Studio', tags: ['romance'], tagIds: ['romance'], content: [], state: 'completed', summary: 'A short story.',
  art: art(id('game', i)), nsfw: false, walkthroughs: [], status: 'installed', build: 'b1', playUrl: `/g/${id('game', i)}/b1/`, family: 'renpy', engineLabel: null,
  version: '1.0', detectedVersion: '1.0', favoriteAt: null, finishedAt: null, playTime: 0, playStatus: null, rating: null, notNowAt: null, phone: null, latestSave: null,
  free: true, renpyVersion: '8.3.7', engine: '8.5.3', sizeBytes: 1e8, fileCount: 4, screen: [1280, 720], saveDir: `save-${i}`, source: { archive: null, size: null },
  canReinstall: false, recipe: null, update: null, createdAt: '2026-01-01T00:00:00.000Z', installedAt: '2026-01-01T00:00:00.000Z',
  lastPlayedAt: i < 4 ? `2026-11-0${9 - i}T10:00:00.000Z` : null, saves: { count: 0, latest: 0 }, mods: { files: 0, hash: '', applied: false }, job: null,
}))
const recipes = Array.from({ length: RECIPES }, (_, i) => ({
  id: id('game', i), title: `Recipe ${i}`, developer: 'Studio', tags: ['romance', i % 2 ? 'fantasy' : 'drama'], tagIds: ['romance', i % 2 ? 'fantasy' : 'drama'], content: [], state: 'completed', summary: 'A short story.',
  nsfw: false, free: true, art: art(id('recipe', i)), links: {}, saveDir: `r${i}`, match: [], runtime: '8.5.3', releases: [], engine: 'renpy',
  local: i < 4 ? { id: id('game', i), status: 'installed', version: '1.0', detectedVersion: '1.0' } : null,
}))
const vocabulary = { romance: { label: 'Romance', group: 'story' }, fantasy: { label: 'Fantasy', group: 'story' }, drama: { label: 'Drama', group: 'story' } }
const catalog = { status: { fetchedAt: Date.now(), urls: [], errors: [], count: RECIPES, sources: [] }, vocabulary, games: recipes }
const me = { user: { id: 1, username: 'owner', name: 'Owner', role: 'admin', disabled: 0, created_at: '2026-01-01T00:00:00.000Z', prefs: '{}', avatar: '', avatar_uploaded: 0, admin_source: 'manual', admin_provider: '', admin_subject: '', adult_ceiling: 'off', adult_choice: 'off', adult_access: 0, hasPin: false }, auth: false, demo: false, unclaimed: false, hasPassword: false }

const answers = (url) => {
  const path = url.pathname
  if (path === '/api/games') return { games }
  const one = path.match(/^\/api\/games\/([^/]+)$/)
  if (one) return { game: games.find((g) => g.id === one[1]) }
  if (path === '/api/catalog') return catalog
  if (path === '/api/me') return me
  if (path === '/api/me/tags') return { include: [], exclude: [], source: 'default' }
  if (path === '/api/me/adult') return { installation: { level: 'off', fixed: true, chosen: true }, ceiling: { level: 'off', managed: null }, choice: 'off', effective: 'off' }
  if (path === '/api/content') return { installation: { level: 'off', fixed: true, chosen: true, variable: 'RENPLAY_ADULT_GAMES' }, starting: { level: 'off', variable: 'RENPLAY_ADULT_DEFAULT' }, groups: { oidc: null, ldap: null } }
  if (path === '/api/auth/providers') return { enabled: false, setup: false, local: true, oidc: null, ldap: false, demo: false }
  if (path === '/api/jobs') return { jobs: [], busy: false, total: 0 }
  if (path === '/api/health') return { ok: true, uptime: 1, version: '0.0.0' }
  if (path === '/api/defaults') return { tagsExclude: [], lighterBackground: null, textSize: null, rollback: null, skip: null }
  if (path.startsWith('/api/saves/')) return { saveDir: 'x', slots: [], other: [], conflicts: [], sync: false }
  if (path === '/api/history') return { totals: { seconds: 0, sessions: 0, games: 0, since: null }, days: [], games: [], next: null }
  return {}
}

/** A picture in the shape its name says, in a colour from the game's name. */
function picture(url) {
  const [, name, kind] = url.pathname.match(/\/api\/art\/(.+)-(grid|wide|hero|icon)\.svg$/) ?? []
  const [w, h] = { grid: [600, 900], wide: [920, 430], hero: [1920, 620], icon: [512, 512] }[kind ?? 'grid']
  const hue = [...(name ?? '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="hsl(${hue} 55% 45%)"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="hsl(${hue} 60% 70%)"/></svg>`
}

async function mock(page, errors, label) {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/art/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: picture(url) })
    if (request.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers(url)) })
  })
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

/** The flying picture on every frame of the next `ms`: its shape and where it started and landed. */
const recordGhost = (page) =>
  page.evaluate(() => {
    window.__ghost = []
    const tick = () => {
      const el = document.querySelector('.ghost')
      if (el) {
        const r = el.getBoundingClientRect()
        window.__ghost.push({ w: r.width, h: r.height, x: r.x, y: r.y })
      }
      window.__recording = requestAnimationFrame(tick)
    }
    window.__recording = requestAnimationFrame(tick)
  })
const takeGhost = (page) =>
  page.evaluate(() => {
    cancelAnimationFrame(window.__recording)
    return window.__ghost
  })

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
  const near = (a, b) => Math.abs(a.x - b.x) <= 3 && Math.abs(a.y - b.y) <= 3 && Math.abs(a.w - b.width) <= 3
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
    check(shapeOk(forward), `${label}: from ${where} the picture keeps a 2:3 shape on all ${forward.length} frames`)
    check(forward.length > 0 && near(forward.at(-1), await rectOf('.stage .cover .frame')), `${label}: from ${where} it lands on the stage's cover`)
    await recordGhost(page)
    await page.goBack()
    await page.waitForSelector('.grid[data-row] .card')
    await page.waitForTimeout(900)
    const back = await takeGhost(page)
    check(shapeOk(back), `${label}: back to ${where} the picture keeps a 2:3 shape on all ${back.length} frames`)
    const home = await rectOf(`${selector.split(' ')[0] === '.shelf' ? '.shelf' : '.grid[data-row]'} .card[data-id="${gameId}"] .frame`)
    check(back.length > 0 && near(back.at(-1), home) && (await page.evaluate(() => document.querySelectorAll('.ghost').length)) === 0, `${label}: back to ${where} it lands on the tile and leaves no picture behind`)
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
  await page.waitForTimeout(1200)
  check((await takeGhost(page)).length === 0, `${label}: a tile off screen gets no flight back`)
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

// ---- run ----------------------------------------------------------------------------------------

const errors = []
const served = baseArg ? { url: baseArg, close() {} } : await serveDist()
const started = Date.now()
const desktop = { viewport: { width: 1440, height: 900 } }
const phoneChromium = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }

const chrome = await chromium.launch()
await rowsAt(chrome, served.url, errors)
await memory(chrome, served.url, errors, desktop, 'desktop')
await flight(chrome, served.url, errors, desktop, 'desktop')
await flight(chrome, served.url, errors, phoneChromium, 'phone')
await skeleton(chrome, served.url, errors, desktop, 'desktop')
await skeleton(chrome, served.url, errors, phoneChromium, 'phone')
await shift(chrome, served.url, errors)
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
