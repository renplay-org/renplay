// The app's lists and pages, in a browser, against the built library and a made-up API (no server, no games: every /api answer
// comes from app-mock.mjs):
//   - whole rows: at every column count (3, 4, 5, 6 and 8) and on both sides of each change, the Library's and the Catalog's
//     grids hold a whole number of rows after every batch, until the list ends
//   - scroll memory: scroll far, open a game, go back: the same place and the same tiles. The Catalog's search is in the
//     address, and an open game is a history entry that back closes
//   - layout shift under 0.02 on the Library, the Catalog and a game page (Chromium only: WebKit does not report it)
//   - the Library's loading state has the loaded page's shape: its grid starts where the loaded grid does
//   - on a phone, every link, button and field is at least 40 x 40 px, every aria-label starts with the control's visible
//     text, and the page can be zoomed
import { GAMES, RECIPES } from '../../../app-mock.mjs'
import { test, expect, check, only } from '../fixtures.mjs'
import { gridOf, growBy, onGamePage, parked, quiet, scrollToEnd, settledGrid } from '../helpers.mjs'

test.use({ mockOptions: {} })

// The grid's columns are the layout's (--cols, which the grid's tracks and the batch both come from): 3 below 720 px, 4 from 720,
// 5 from 1000, 6 from 1280 and 8 from 1680. A width in each, and both sides of every change.
const WIDTHS = [360, 540, 719, 720, 860, 999, 1000, 1140, 1279, 1280, 1480, 1679, 1680, 1920]

// Four lanes of widths, each its own test, so that they run side by side.
for (const lane of [0, 1, 2, 3]) {
  test(`grids hold whole rows at every column count and on both sides of each change, every batch (widths ${lane + 1} of 4)`, async ({ page }, testInfo) => {
    only(testInfo, 'chromium-desktop', 'The widths are set here, whatever the project')
    // A lane loads each of its widths twice, and a busy machine takes its time over every load.
    test.slow()
    // The rows are the grid's, not the pictures': none is asked for.
    await page.route('**/api/art/**', (route) => route.abort())
    const bad = []
    for (const width of WIDTHS.filter((_, i) => i % 4 === lane)) {
      await page.setViewportSize({ width, height: 800 })
      for (const [path, total] of [['/', GAMES], ['/catalog', RECIPES]]) {
        await page.goto(path)
        await page.waitForSelector('.grid[data-row] .card')
        const sizes = await growBy(page, 3)
        for (const { tiles, cols } of sizes) if (tiles % cols && tiles !== total) bad.push(`${path} at ${width}: ${tiles} tiles in ${cols} columns`)
        if (sizes.length < 2) bad.push(`${path} at ${width}: the list never grew`)
      }
    }
    check(!bad.length, `grids hold whole rows${bad.length ? `: ${bad.slice(0, 4).join('; ')}` : ''}`)
  })
}

/** The grid's place and size, read until it is the one expected and then once more after the page has stopped moving. */
async function restored(page, want, what) {
  const read = () => page.evaluate(() => ({ y: Math.round(scrollY), tiles: document.querySelectorAll('.grid[data-row] .card').length }))
  const matches = (now) => now.tiles === want.tiles && Math.abs(now.y - want.y) <= 2
  await expect.poll(async () => matches(await read()), { message: `${what}: the place and the tiles come back (scroll ${want.y}, tiles ${want.tiles})` }).toBe(true)
  await quiet(page)
  const now = await read()
  check(matches(now), `${what}: and stay (scroll ${want.y} then ${now.y}, tiles ${want.tiles} then ${now.tiles})`)
}

test('back from a game restores the Library, and the Catalog keeps its search, its open game and its rows', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The same in every size: the place is the browser\'s and the app\'s, not the layout\'s')
  await page.goto('/')
  await page.waitForSelector('.grid[data-row] .card')
  await growBy(page, 2)
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight * 0.55, behavior: 'instant' }))
  const before = await page.evaluate(() => ({ y: Math.round(scrollY), tiles: document.querySelectorAll('.grid[data-row] .card').length }))
  const target = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.grid[data-row] .card')].find((c) => c.getBoundingClientRect().top > 120 && c.getBoundingClientRect().bottom < innerHeight - 90)
    return t?.dataset.id
  })
  await page.locator(`.grid[data-row] .card[data-id="${target}"]`).click()
  await onGamePage(page)
  await page.goBack()
  await page.waitForSelector('.grid[data-row] .card')
  await restored(page, before, 'back from a game restores the Library')

  // The Catalog: the search is in the address, a game's sheet is an entry of its own, back closes it.
  await page.goto('/catalog')
  await page.waitForSelector('.grid[data-row] .card')
  await page.fill('input[aria-label="Search the catalog"]', 'recipe')
  // The page scrolls to the toolbar under the header: the check's own scrolls come after it has.
  await parked(page)
  check(new URL(page.url()).searchParams.get('q') === 'recipe', "the Catalog's search is in the address")
  const total = (await gridOf(page)).tiles
  await growBy(page, 4)
  const open = page.locator('.grid[data-row] a.card:not([href^="/game/"])').nth(70)
  await open.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  // The grid grows ahead of the place the page is at, a batch at a time: it is measured once it has stopped.
  await settledGrid(page)
  const c0 = await page.evaluate(() => ({ y: Math.round(scrollY), tiles: document.querySelectorAll('.grid[data-row] .card').length }))
  const lengthBefore = await page.evaluate(() => history.length)
  await open.click()
  await page.waitForSelector('[role="dialog"]')
  check((await page.evaluate(() => history.length)) === lengthBefore + 1 && new URL(page.url()).searchParams.has('game'), 'an open game is a history entry')
  await page.goBack()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  await settledGrid(page)
  const c1 = await page.evaluate(() => ({ y: Math.round(scrollY), tiles: document.querySelectorAll('.grid[data-row] .card').length, dialog: !!document.querySelector('[role="dialog"]'), q: new URL(location.href).searchParams.get('q') }))
  check(!c1.dialog && c1.q === 'recipe' && Math.abs(c1.y - c0.y) <= 2 && c1.tiles === c0.tiles, `back closes the sheet and leaves the list where it was (scroll ${c0.y} then ${c1.y}, tiles ${c0.tiles} then ${c1.tiles}, first batch ${total})`)
  // And out to a game and back, with the search kept.
  await page.evaluate(() => [...document.querySelectorAll('.grid[data-row] .card')].find((c) => c.getAttribute('href').startsWith('/game/'))?.click())
  await onGamePage(page)
  await page.goBack()
  await page.waitForSelector('.grid[data-row] .card')
  await settledGrid(page)
  const c2 = await page.evaluate(() => ({ tiles: document.querySelectorAll('.grid[data-row] .card').length, q: new URL(location.href).searchParams.get('q') }))
  check(c2.q === 'recipe' && c2.tiles === c0.tiles, "back from a game keeps the Catalog's search and loaded rows")
})

test('layout shift stays under 0.02 on the Library, the Catalog and a game page', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'Chromium reports layout shift, at the size the website and docs are measured at')
  // Three pages are loaded and scrolled through to their end.
  test.slow()
  await page.addInitScript(() => {
    window.__cls = 0
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
  for (const [name, path, ready] of [['the Library', '/', '.grid[data-row] .card'], ['the Catalog', '/catalog', '.grid[data-row] .card'], ['a game page', '/game/game-000', '.stage']]) {
    await page.goto(path)
    await page.waitForSelector(ready)
    // Whatever the page is still to ask for (its pictures, a late answer) has come, and it has faded in.
    await page.waitForLoadState('networkidle')
    await expect.poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState === 'finished')), { message: `${name} has faded in` }).toBe(true)
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    const loaded = await page.evaluate(() => window.__cls)
    // Then a person's scroll to the end: a screen at a time, so the grid grows ahead of them.
    for (let i = 0; i < 40; i++) {
      const more = await page.evaluate(() => {
        window.scrollBy({ top: innerHeight * 0.8, behavior: 'instant' })
        return scrollY + innerHeight < document.documentElement.scrollHeight - 2
      })
      // The grid grows ahead of a person who scrolls: wait for it to have grown, as a quick machine does within the 80 ms.
      await settledGrid(page)
      if (!more) break
    }
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    const cls = await page.evaluate(() => window.__cls)
    check(cls < 0.02, `layout shift on ${name} is ${loaded.toFixed(4)} at load and ${cls.toFixed(4)} after scrolling through (under 0.02)`)
  }
})

test("the Library's loading state has the loaded page's shape", async ({ page }) => {
  let release
  const gate = new Promise((done) => (release = done))
  await page.route('**/api/games', async (route) => {
    await gate
    await route.fallback()
  })
  const gridTop = () => page.evaluate(() => Math.round(document.querySelector('.grid').getBoundingClientRect().top + scrollY))
  await page.goto('/')
  await page.waitForSelector('.sec .skel-line')
  const loading = await gridTop()
  release()
  await page.waitForSelector('.card .frame')
  await expect.poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState === 'finished')), { message: 'The loaded page has faded in' }).toBe(true)
  const loaded = await gridTop()
  check(Math.abs(loading - loaded) <= 12, `the Library's loading state has the loaded page's shape (its grid starts at ${loading}, loaded at ${loaded})`)
})

test('on a phone every control is at least 40 x 40 px, every aria-label starts with its visible text, and the page can be zoomed', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-phone', 'A phone')
  for (const [name, path] of [['the Library', '/'], ['the Catalog', '/catalog'], ['a game page', '/game/game-001'], ['Add games', '/add']]) {
    await page.goto(path)
    await page.waitForSelector('main')
    await page.waitForLoadState('networkidle')
    await expect.poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState === 'finished')), { message: `${name} has faded in` }).toBe(true)
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
    check(!found.small.length, `every control on ${name} is at least 40 x 40 px${found.small.length ? `: ${found.small.slice(0, 4).join(', ')}` : ''}`)
    check(!found.labels.length, `every aria-label on ${name} starts with its visible text${found.labels.length ? `: ${found.labels.slice(0, 3).join(', ')}` : ''}`)
  }
  const viewport = await page.evaluate(() => document.querySelector('meta[name=viewport]').content)
  check(!/maximum-scale|user-scalable/.test(viewport), 'the page can be pinch-zoomed (the viewport has no maximum-scale)')
})
