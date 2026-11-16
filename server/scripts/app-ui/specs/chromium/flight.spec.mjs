// The picture that flies from a tile to the game page and back, in a browser, against the built library and a made-up API:
//   - the flying picture keeps a 2:3 shape on every frame seen, forward and back, and lands on the stage's cover or on the tile
//     it came from, leaving no picture behind, from the Up next cover and from a grid tile
//   - a tile that is off screen once the list has restored its place gets no flight back
//   - it lands with no flicker: every frame from the tap to the end of the flight shows either the flying picture or a cover
//     that is fully there (opaque, its picture in and shown, not its placeholder), from a plain tile and from a search result
//   - Resume on a slide of the carousel flies the artwork from that slide's cover
import { test, expect, check } from '../fixtures.mjs'
import { fieldOf, onGamePage, quiet, ready, recordGhost, shapeOk, takeGhost } from '../helpers.mjs'

test.use({ mockOptions: {} })

const near = (a, b) => Math.abs(a.x - b.x) <= 3 && Math.abs(a.y - b.y) <= 3 && Math.abs((a.w ?? a.width) - b.width) <= 3

test('the picture flies from a tile to the game page and back, in its own shape, and lands on its place', async ({ page }) => {
  // A pointer left over a tile lifts it and tilts it (lantern/lean.ts): the tile's place is measured without that.
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.head.insertAdjacentHTML('beforeend', '<style>.card:not(.on):hover .tilt { transform: none !important; translate: none !important }</style>')))
  const rectOf = (selector) => page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect()
    return r && { x: r.x, y: r.y, width: r.width, height: r.height }
  }, selector)
  // The Up next carousel's cover and a grid tile: each flies to the game page's cover and back.
  const homeOf = { '.carousel .slide:not(.copy) .cover a': (id) => `.carousel .stage[data-id="${id}"] .cover .frame`, '.grid[data-row] .card': (id) => `.grid[data-row] .card[data-id="${id}"] .frame` }
  for (const [where, selector, n] of [['the Up next cover', '.carousel .slide:not(.copy) .cover a', 0], ['a grid tile', '.grid[data-row] .card', 5]]) {
    await page.goto('/')
    await page.waitForSelector(selector)
    const tile = page.locator(selector).nth(n)
    await tile.scrollIntoViewIfNeeded()
    await quiet(page)
    const gameId = await tile.evaluate((el) => (el.closest('.stage') ?? el).dataset.id)
    await recordGhost(page)
    await tile.click()
    await onGamePage(page)
    const forward = await takeGhost(page)
    check(shapeOk(forward.frames), `from ${where} the picture keeps a 2:3 shape on every frame seen`)
    const cover = await rectOf('.stage .cover .frame')
    check(!!forward.end && near(forward.end, cover), `from ${where} it lands on the stage's cover${forward.end && !near(forward.end, cover) ? ` (ends at ${JSON.stringify(forward.end)}, cover ${JSON.stringify(cover)})` : ''}`)
    await recordGhost(page)
    await page.goBack()
    await page.waitForSelector('.grid[data-row] .card')
    const back = await takeGhost(page)
    check(shapeOk(back.frames), `back to ${where} the picture keeps a 2:3 shape on every frame seen`)
    const home = await rectOf(homeOf[selector](gameId))
    check(!!back.end && near(back.end, home) && (await page.evaluate(() => document.querySelectorAll('.ghost').length)) === 0, `back to ${where} it lands on the tile and leaves no picture behind${back.end && !near(back.end, home) ? ` (ends at ${JSON.stringify(back.end)}, tile ${JSON.stringify(home)})` : ''}`)
  }
})

test('a tile that is off screen once the list has restored its place gets no flight back', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.grid[data-row] .card')
  // The last tile of the first batch: off screen at the top of the list on every screen size (a wide
  // screen shows its first rows).
  await page.locator('.grid[data-row] .card').last().scrollIntoViewIfNeeded()
  await recordGhost(page)
  await page.locator('.grid[data-row] .card').last().click()
  await onGamePage(page)
  // The flight forward has landed: the ghost the check looks for is the one back.
  await takeGhost(page)
  await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('renplay:scroll:')).forEach((k) => sessionStorage.setItem(k, '0')))
  await recordGhost(page)
  await page.goBack()
  // The flight back starts when the list is in place and has its scroll: wait for that, and for the page to be still.
  await page.waitForSelector('.grid[data-row] .card')
  await quiet(page, 400)
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  expect(await page.evaluate(() => (cancelAnimationFrame(window.__recording), window.__ghost.length)), 'No picture flew back').toBe(0)
})

/** Every frame: the flying picture, and the game page's cover with its opacity (all the way up) and its picture. */
const record = (page) =>
  page.evaluate(() => {
    window.__landing = []
    const opacityOf = (el) => {
      let o = 1
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
      return o
    }
    const sample = () => {
      const cover = document.querySelector('main .stage .cover .frame')
      const art = cover?.querySelector('img.art')
      const ghost = document.querySelector('.ghost')
      window.__landing.push({
        ghost: !!ghost,
        duration: ghost?.getAnimations()[0]?.effect.getTiming().duration ?? null,
        cover: !!cover,
        opacity: cover ? opacityOf(cover) : 0,
        hidden: cover ? getComputedStyle(cover).visibility === 'hidden' : true,
        drawn: !!art && art.complete && art.naturalWidth > 0 && !art.classList.contains('loading') && Number(getComputedStyle(art).opacity) === 1,
      })
    }
    // Noted the moment the picture is added too, so a flight is seen on a machine too slow to draw a frame during it.
    window.__added = new MutationObserver((list) => list.some((m) => [...m.addedNodes].some((n) => n.classList?.contains('ghost'))) && sample())
    window.__added.observe(document.body, { childList: true })
    const tick = () => {
      sample()
      window.__loop = requestAnimationFrame(tick)
    }
    tick()
  })

test.describe('landing', () => {
  // A blurred placeholder under every picture and a delay the first time a picture is asked for, as a library has.
  test.use({ mockOptions: { delay: 40, thumbhash: true } })
  for (const from of ['a plain tile', 'a search result']) {
  test(`the flight from ${from} lands with no flicker: every frame shows the flying picture or a fully drawn cover`, async ({ page }, testInfo) => {
    await ready(page, '/')
    if (from === 'a search result') {
      await fieldOf(page, 'Search your games').click()
      await page.keyboard.type('game 1', { delay: 30 })
      await expect(page.locator('.grid[data-row] .card'), 'The search has filtered the grid').not.toHaveCount(130)
      await page.evaluate(() => document.activeElement?.blur())
    }
    const tile = page.locator('.grid[data-row] .card').nth(2)
    await tile.scrollIntoViewIfNeeded()
    await quiet(page)
    await record(page)
    await (testInfo.project.use.hasTouch ? tile.tap() : tile.click())
    await page.waitForFunction(() => location.pathname.startsWith('/game/'))
    await page.waitForFunction(() => window.__landing.some((f) => f.ghost) && !document.querySelector('.ghost'), null, { timeout: 5000 })
    // The cover is drawn, and stays so, once the picture has landed.
    await page.waitForFunction(() => { const f = window.__landing.at(-1); return f.cover && !f.hidden && f.opacity === 1 && f.drawn })
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.__loop)
      window.__added.disconnect()
      return window.__landing
    })
    const first = frames.findIndex((f) => f.ghost)
    const flight = frames.slice(first)
    const bad = flight.map((f, i) => [f, i]).filter(([f]) => !f.ghost && !(f.cover && !f.hidden && f.opacity === 1 && f.drawn))
    // A flight of at least eight frames at 60 Hz: its length is the animation's, not what a slow machine draws of it.
    const duration = flight.find((f) => f.ghost)?.duration ?? 0
    check(first >= 0 && duration >= 8 * (1000 / 60), `the cover flies from ${from} (a flight of ${duration} ms)`)
    check(!bad.length, `the flight from ${from} lands with no flicker: every frame shows the flying picture or a fully drawn cover${bad.length ? ` (${bad.length} frames showed neither, from frame ${bad[0][1]} of ${flight.length}: ${JSON.stringify(bad[0][0])})` : ''}`)
  })
  }
})

test("Resume on the third slide flies from that slide's cover", async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch, 'The dots are a desktop control')
  await page.goto('/')
  await page.waitForSelector('.carousel .slide')
  await page.locator('.dots .dot').nth(2).click()
  await expect.poll(() => page.evaluate(() => { const c = document.querySelector('.carousel'); return Math.abs(c.scrollLeft - 3 * c.clientWidth) < 1 }), { message: 'The carousel rests on the third slide' }).toBe(true)
  const cover = await page.evaluate(() => {
    const r = document.querySelectorAll('.carousel .slide:not(.copy)')[2].querySelector('.cover .frame').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width }
  })
  await page.evaluate(() => {
    window.__first = null
    const note = (el) => {
      if (window.__first) return
      const r = el.getBoundingClientRect()
      window.__first = { x: r.x, y: r.y, w: r.width }
    }
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => n.classList?.contains('ghost') && note(n)))).observe(document.body, { childList: true })
  })
  await page.locator('.carousel .slide:not(.copy)').nth(2).locator('a.btn.p').click()
  await expect.poll(() => page.evaluate(() => window.__first), { message: 'The picture takes off' }).not.toBeNull()
  const first = await page.evaluate(() => window.__first)
  check(Math.abs(first.x - cover.x) < 40 && Math.abs(first.y - cover.y) < 40, `Resume on the third slide flies from that slide's cover (cover at ${Math.round(cover.x)}, ${Math.round(cover.y)}, flight starts at ${Math.round(first.x)}, ${Math.round(first.y)})`)
})
