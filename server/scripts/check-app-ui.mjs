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
//   - the Up next carousel: it turns by itself, holds while the mouse, a finger or focus is on it, stops for good once a
//     person moves it (arrows, dots, keys, a swipe), does not turn with reduced motion, fills a 390 px screen without a
//     neighbour's edge, snaps, and has a dot of 40 x 40 px for each slide
//   - one search per list, filtering as you type, with its shortcut shown on a desktop only
// --webkit adds the flight, the rows and the carousel in WebKit. Needs the browsers once: npx playwright install chromium webkit
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
  // The Up next carousel's cover and a grid tile: each flies to the game page's cover and back.
  const homeOf = { '.carousel .slide .cover a': (id) => `.carousel .stage[data-id="${id}"] .cover .frame`, '.grid[data-row] .card': (id) => `.grid[data-row] .card[data-id="${id}"] .frame` }
  for (const [where, selector, n] of [['the Up next cover', '.carousel .slide .cover a', 0], ['a grid tile', '.grid[data-row] .card', 5]]) {
    await page.goto(base + '/')
    await page.waitForSelector(selector)
    const tile = page.locator(selector).nth(n)
    await tile.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    const gameId = await tile.evaluate((el) => (el.closest('.stage') ?? el).dataset.id)
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
    const home = await rectOf(homeOf[selector](gameId))
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


// ---- the Up next carousel and the search --------------------------------------------------------

const carouselState = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.carousel')
    return { x: Math.round(box.scrollLeft), w: box.clientWidth, current: [...document.querySelectorAll('.dots .dot')].findIndex((d) => d.getAttribute('aria-current') === 'true') }
  })
/** Waits until a smooth scroll has stopped. */
const stillScroll = async (page) => {
  let last = -1
  for (let i = 0; i < 40; i++) {
    const x = await page.evaluate(() => document.querySelector('.carousel').scrollLeft)
    if (x === last) return
    last = x
    await page.waitForTimeout(150)
  }
}
/** Runs the page's clock forward, then lets a smooth scroll finish (the browser's own time). */
const pass = async (page, ms) => {
  await page.clock.runFor(ms)
  await page.waitForTimeout(900)
}

/** The Library, loaded, and then its clock stops: the turning is timed by it, which only moves when a check says so. */
async function openFrozen(page, base) {
  await page.clock.install()
  await page.goto(base + '/')
  await page.waitForSelector('.carousel .slide[role="group"]')
  await page.waitForTimeout(600)
  await page.clock.pauseAt(new Date(Date.now() + 100))
}

async function carousel(browser, base, errors, options, label, { swipe = false } = {}) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  await openFrozen(page, base)
  const phone = (options.viewport?.width ?? 1440) < 720 || !!options.isMobile
  const counts = await page.evaluate(() => ({ slides: document.querySelectorAll('.carousel .slide').length, dots: document.querySelectorAll('.dots .dot').length, small: [...document.querySelectorAll('.dots .dot')].filter((d) => d.offsetWidth < 40 || d.offsetHeight < 40).length }))
  check(counts.slides >= 6 && counts.slides <= 8 && counts.dots === counts.slides, `${label}: Up next is 6 to 8 slides with a dot for each (${counts.slides} slides, ${counts.dots} dots)`)
  check(counts.small === 0, `${label}: every dot is at least 40 x 40 px`)
  check((await carouselState(page)).current === 0, `${label}: the first dot is the current one`)

  if (phone) {
    // Fills the screen: a slide is as wide as the page, and no edge of the next one shows.
    const fit = await page.evaluate(() => {
      const [a, b] = [...document.querySelectorAll('.carousel .slide')].map((e) => e.getBoundingClientRect())
      return { left: Math.round(a.left), right: Math.round(a.right), next: Math.round(b.left), width: innerWidth, snap: getComputedStyle(document.querySelector('.carousel')).scrollSnapType }
    })
    check(fit.left === 0 && fit.right === fit.width && fit.next >= fit.width, `${label}: a slide fills the ${fit.width} px screen and the next one's edge is out of sight (slide ${fit.left} to ${fit.right}, next from ${fit.next})`)
    check(/x mandatory/.test(fit.snap), `${label}: it scrolls sideways with snapping (${fit.snap})`)
  }

  // It turns by itself, about every seven seconds: the first turn comes within 7 seconds of the page loading,
  // and the next one 7 seconds after that.
  await pass(page, 7500)
  const turned = await carouselState(page)
  check(turned.current === 1 && turned.x === turned.w, `${label}: it turns by itself (dot ${turned.current + 1}, at ${turned.x} of ${turned.w} px)`)
  await pass(page, 3000)
  check((await carouselState(page)).current === 1, `${label}: it stays on a slide for longer than 3 seconds`)
  await pass(page, 4000)
  check((await carouselState(page)).current === 2, `${label}: and turns again 7 seconds after the last turn`)
  // Back to the second slide, for the holds below.
  await page.evaluate(() => document.querySelector('.carousel').scrollTo({ left: document.querySelector('.carousel').clientWidth, behavior: 'instant' }))
  await page.waitForTimeout(300)

  if (phone) {
    // A finger on it holds it. Playwright cannot swipe in WebKit, so the finger is its touch events and the move is a scroll under it.
    await page.evaluate(() => document.querySelector('.carousel').dispatchEvent(new Event('touchstart', { bubbles: true })))
    await pass(page, 30000)
    check((await carouselState(page)).current === 1, `${label}: it holds while a finger is on it`)
    if (swipe) {
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Input.synthesizeScrollGesture', { x: 300, y: 300, xDistance: -260, yDistance: 0, gestureSourceType: 'touch', speed: 900 })
      // A slow machine (CI) finishes the gesture and the snap later: wait for the carousel to rest on a slide past the first.
      await page.waitForFunction(() => {
        const c = document.querySelector('.carousel')
        return c.scrollLeft > c.clientWidth * 1.5 && c.scrollLeft % c.clientWidth === 0
      }, null, { timeout: 4000, polling: 100 }).catch(() => {})
      await page.waitForTimeout(300)
    } else {
      await page.evaluate(() => document.querySelector('.carousel').scrollBy({ left: 370, behavior: 'instant' }))
      await page.waitForTimeout(900)
    }
    await page.evaluate(() => document.querySelector('.carousel').dispatchEvent(new Event('touchend', { bubbles: true })))
    const swiped = await carouselState(page)
    check(swiped.current === 2 && swiped.x === 2 * swiped.w, `${label}: a ${swipe ? 'swipe' : 'scroll'} sideways snaps to the next slide (dot ${swiped.current + 1}, at ${swiped.x} of ${2 * swiped.w} px)`)
    await pass(page, 30000)
    check((await carouselState(page)).current === 2, `${label}: once a person has moved it by hand it stays where they put it`)
  } else {
    // The mouse over it holds it.
    await page.mouse.move(700, 300)
    await pass(page, 30000)
    check((await carouselState(page)).current === 1, `${label}: it holds while the mouse is over it`)
    await page.mouse.move(700, 880)
    // Focus in it holds it too.
    await page.locator('.carousel .slide').nth(1).locator('a:has-text("Game page")').focus()
    await pass(page, 30000)
    check((await carouselState(page)).current === 1, `${label}: it holds while keyboard focus is in it`)
    await page.evaluate(() => document.activeElement?.blur())
    await pass(page, 7500)
    check((await carouselState(page)).current === 2, `${label}: it turns again when the hold ends`)
    // The arrow keys move it while it has focus, and a person who moved it stops it for good.
    await page.locator('.carousel').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(900)
    check((await carouselState(page)).current === 3, `${label}: the arrow keys move it while it has focus`)
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(900)
    check((await carouselState(page)).current === 2, `${label}: the left arrow key moves it back`)
    await page.evaluate(() => document.activeElement?.blur())
    await pass(page, 30000)
    check((await carouselState(page)).current === 2, `${label}: once a person has moved it by hand it stays where they put it`)
    // Dots and arrows.
    await page.locator('.dots .dot').nth(5).click()
    await stillScroll(page)
    const dot = await carouselState(page)
    check(dot.current === 5 && dot.x === 5 * dot.w, `${label}: a dot selects its slide (dot ${dot.current + 1}, at ${dot.x} of ${5 * dot.w} px)`)
    await page.locator('.car-arrow.next').click()
    await page.waitForTimeout(900)
    check((await carouselState(page)).current === 6, `${label}: the next arrow moves it on`)
    check(await page.locator('.car-arrow.next').isDisabled(), `${label}: at the last slide the next arrow is off`)
    await page.locator('.car-arrow.prev').click()
    await page.waitForTimeout(900)
    check((await carouselState(page)).current === 5, `${label}: the previous arrow moves it back`)
  }
  // Only the slide in view has anything to tab to.
  const tabbable = await page.evaluate(() => [...document.querySelectorAll('.carousel .slide')].map((s) => s.inert))
  check(tabbable.filter((x) => !x).length === 1, `${label}: only the slide in view can be focused`)
  await ctx.close()
}

/** A dot, a finger and the keys all move it, and nothing turns it for a person who asks for less motion. */
async function carouselStill(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  await openFrozen(page, base)
  await pass(page, 40000)
  check((await carouselState(page)).current === 0, `${label}: with reduced motion it does not turn by itself`)
  await ctx.close()
}

/** The slide a person presses Resume on is where the artwork's flight starts. */
async function resumeFlight(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  await page.goto(base + '/')
  await page.waitForSelector('.carousel .slide')
  await page.locator('.dots .dot').nth(2).click()
  await page.waitForTimeout(1200)
  const cover = await page.evaluate(() => {
    const r = document.querySelectorAll('.carousel .slide')[2].querySelector('.cover .frame').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width }
  })
  await page.evaluate(() => {
    window.__first = null
    const tick = () => {
      const el = document.querySelector('.ghost')
      if (el && !window.__first) {
        const r = el.getBoundingClientRect()
        window.__first = { x: r.x, y: r.y, w: r.width }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.locator('.carousel .slide').nth(2).locator('a.btn.p').click()
  await page.waitForTimeout(500)
  const first = await page.evaluate(() => window.__first)
  check(!!first && Math.abs(first.x - cover.x) < 40 && Math.abs(first.y - cover.y) < 40, `${label}: Resume on the third slide flies from that slide's cover (cover at ${Math.round(cover.x)}, ${Math.round(cover.y)}, flight starts at ${first ? `${Math.round(first.x)}, ${Math.round(first.y)}` : 'nowhere'})`)
  await ctx.close()
}

async function search(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  const phone = (options.viewport?.width ?? 1440) < 720 || !!options.isMobile
  for (const [name, path, field, ready] of [['the Library', '/', 'Search your games', '.grid[data-row] .card'], ['the Catalog', '/catalog', 'Search the catalog', '.grid[data-row] .card']]) {
    await page.goto(base + path)
    await page.waitForSelector(ready)
    const found = await page.evaluate((field) => {
      const inputs = [...document.querySelectorAll('input[type=text], input[type=search], input:not([type])')].filter((i) => i.getBoundingClientRect().width > 0)
      const box = document.querySelector('.search-field')?.getBoundingClientRect()
      const pill = document.querySelector('.toolbar .sort, .toolbar .seg')?.getBoundingClientRect()
      const hint = document.querySelector('.search-field .shortcut')
      return {
        inputs: inputs.length,
        labelled: document.querySelectorAll(`input[aria-label="${field}"]`).length,
        placeholder: document.querySelector(`input[aria-label="${field}"]`)?.placeholder,
        header: document.querySelectorAll('header .search, header button[aria-keyshortcuts]').length,
        height: box && Math.round(box.height),
        beside: pill && Math.round(pill.height),
        radius: getComputedStyle(document.querySelector('.search-field')).borderRadius,
        hint: !!hint && getComputedStyle(hint).display !== 'none',
      }
    }, field)
    check(found.inputs === 1 && found.labelled === 1 && found.header === 0, `${label}: ${name} has one search and the header has none (${found.inputs} fields)`)
    check(found.placeholder === field, `${label}: ${name}'s search says what it searches ("${found.placeholder}")`)
    check(found.height === found.beside && found.radius === '999px', `${label}: ${name}'s search is as high as the control beside it and a pill (${found.height} and ${found.beside} px, radius ${found.radius})`)
    check(found.hint === !phone, `${label}: ${name}'s shortcut hint is ${phone ? 'not shown on a phone' : 'shown on a desktop'}`)
    // It filters as you type, and the address keeps the search.
    const before = (await gridOf(page)).tiles
    await page.fill(`input[aria-label="${field}"]`, path === '/' ? 'Game 12' : 'Recipe 12')
    await page.waitForTimeout(600)
    const after = (await gridOf(page)).tiles
    check(after > 0 && after < before && new URL(page.url()).searchParams.has('q'), `${label}: ${name} filters as you type (${before} tiles, then ${after})`)
    await page.click('.search-field .clear')
    await page.waitForTimeout(600)
    check((await gridOf(page)).tiles === before, `${label}: the clear button brings every game back`)
  }
  // The Catalog's own filters are still there, and the Library has no All, Installed and Not installed picker.
  await page.goto(base + '/catalog')
  await page.waitForSelector('.grid[data-row] .card')
  const filters = await page.evaluate(() => ({ seg: [...document.querySelectorAll('.toolbar .seg button')].map((b) => b.textContent.trim()), tags: document.querySelectorAll('.chip').length }))
  check(filters.seg.length === 3 && filters.tags > 0, `${label}: the Catalog keeps its filters (${filters.seg.join(', ')}; ${filters.tags} tag chips)`)
  await page.goto(base + '/')
  await page.waitForSelector('.grid[data-row] .card')
  const picker = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^(Installed|Not installed)$/.test(t)))
  check(!picker.length, `${label}: the Library has no Installed and Not installed picker`)
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
    await carousel(chrome, served.url, errors, desktop, 'desktop')
    await carouselStill(chrome, served.url, errors, desktop, 'desktop')
    await carousel(chrome, served.url, errors, phoneChromium, 'phone', { swipe: true })
    await resumeFlight(chrome, served.url, errors, desktop, 'desktop')
    await search(chrome, served.url, errors, desktop, 'desktop')
    await search(chrome, served.url, errors, phoneChromium, 'phone')
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
  await carousel(safari, served.url, errors, devices['iPhone 15 Pro'], 'phone (WebKit)')
  await carouselStill(safari, served.url, errors, devices['iPhone 15 Pro'], 'phone (WebKit)')
  await search(safari, served.url, errors, devices['iPhone 15 Pro'], 'phone (WebKit)')
  await safari.close()
}
served.close()

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join('; ')}` : ''}`)
console.log(`${failures.length ? `${failures.length} failed` : 'All passed'} in ${Math.round((Date.now() - started) / 1000)} s`)
process.exitCode = failures.length ? 1 : 0
