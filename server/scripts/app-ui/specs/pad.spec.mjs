import { test, expect, open, settled } from './fixtures.mjs'
import { mock } from '../../app-mock.mjs'
import { withPad, tap, feed, watchFocus, moves } from './pad.mjs'

const desktopOnly = (testInfo) => test.skip(testInfo.project.name !== 'chromium-desktop', 'A computer with a controller')

/** The library of 130 games with a controller, and the first tile of All games focused. */
async function library(page, path = '/') {
  await withPad(page)
  await mock(page, [], 'pad')
  await open(page, path)
  await settled(page)
  await page.locator('.grid[data-row] .card').first().focus()
  await watchFocus(page)
}

test.describe('one press is one move', () => {
  test('a stick resting near its threshold makes one move, not one for every time it crosses', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await library(page)
    // Down at about half: a thumb that rests and trembles, for a third of a second.
    const noisy = Array.from({ length: 20 }, (_, i) => [0, [0.45, 0.62, 0.48, 0.66, 0.52, 0.7, 0.44, 0.61][i % 8]])
    await feed(page, noisy)
    expect((await moves(page)).length, 'the trembling stick moved focus once').toBe(1)
  })

  test('a stick that drifts to one side a little does nothing', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await library(page)
    await feed(page, Array.from({ length: 40 }, (_, i) => [0.3 + (i % 3) * 0.04, 0.28 + (i % 4) * 0.05]))
    expect(await moves(page), 'a drifting stick below the dead zone moved nothing').toEqual([])
  })

  test('a short tap of the d-pad is one move, and a stick pushed with it does not make another', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await library(page)
    await tap(page, 'down', 60)
    expect((await moves(page)).length, 'a 60 ms tap').toBe(1)
    // Each change is waited for in frames, not in time: a slow machine that draws a frame late is not a longer hold, which repeats.
    await page.evaluate(async () => { window.__hold('down', true); window.__stick(0, 0.9); await window.__seen() })
    await page.evaluate(async () => { window.__hold('down', false); await window.__seen() })
    await page.evaluate(async () => { window.__stick(0, 0); await window.__seen() })
    expect((await moves(page)).length, 'the d-pad and the stick together are one press').toBe(2)
  })

  test('a press held for half a second is still one move, and a longer hold repeats', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await library(page)
    await tap(page, 'down', 500)
    expect((await moves(page)).length, 'a half second press').toBe(1)
    await tap(page, 'down', 1500)
    expect((await moves(page)).length, 'a long hold moves again').toBeGreaterThan(3)
    expect((await moves(page)).length, 'at a pace a person can follow').toBeLessThan(14)
  })
})

/** Where the focused thing is on the screen, and what is over the screen's top and bottom. */
const place = (page) => page.evaluate(() => {
  const el = document.activeElement
  const r = el.getBoundingClientRect()
  const header = document.querySelector('.top').getBoundingClientRect().bottom
  const glass = document.querySelector('.toolbar-glass[data-stuck]')?.getBoundingClientRect().bottom ?? 0
  const bar = document.querySelector('.tabbar')
  const floor = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight
  return { id: el.getAttribute('data-id') ?? el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 30), top: r.top, bottom: r.bottom, ceiling: Math.max(header, glass), floor }
})

test.describe('reaching every game', () => {
  test('the d-pad goes down through All games to the last tile, each one whole and clear of the toolbar, and A opens it', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    // A press for each of dozens of tiles, each seen by the page: a busy machine takes its time.
    test.slow()
    await library(page)
    const seen = []
    let last = null
    for (let i = 0; i < 80; i++) {
      await tap(page, 'down', 60)
      const at = await place(page)
      if (!at.id.startsWith('game-')) break
      last = at.id
      seen.push(at.id)
      expect(at.top, `${at.id} starts below the header and toolbar`).toBeGreaterThanOrEqual(at.ceiling)
      expect(at.bottom, `${at.id} ends above the bottom of the screen`).toBeLessThanOrEqual(at.floor)
    }
    expect(await page.locator('.grid[data-row] .card').count(), 'the growing grid loaded every row on the way').toBe(130)
    expect(new Set(seen).size, 'one tile on each row going down, none along the last row').toBe(seen.length)
    // The last row is short: right goes along it to the last tile, and not on past it.
    const end = await page.locator('.grid[data-row] .card').last().getAttribute('data-id')
    for (let i = 0; i < 6 && (await place(page)).id !== end; i++) await tap(page, 'right', 60)
    expect((await place(page)).id, 'right reaches the last tile of the list').toBe(end)
    await tap(page, 'a')
    await expect(page, 'A opens the game').toHaveURL(new RegExp(`/game/${end}$`))
  })

  test('right and left across the rows keep each tile whole and clear of the header, the stuck toolbar and the bottom', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    // A press for each of dozens of tiles, each seen by the page: a busy machine takes its time.
    test.slow()
    await library(page)
    for (const button of ['right', 'left']) {
      for (let i = 0; i < (button === 'right' ? 40 : 30); i++) {
        await tap(page, button, 60)
        const at = await place(page)
        expect(at.top, `${at.id} starts below the header and toolbar going ${button}`).toBeGreaterThanOrEqual(at.ceiling)
        expect(at.bottom, `${at.id} ends above the bottom of the screen going ${button}`).toBeLessThanOrEqual(at.floor)
      }
    }
  })

  test('up from the first row reaches the search, the tags and the Up next buttons, and right moves along them', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await library(page)
    const stops = []
    for (let i = 0; i < 3; i++) {
      await tap(page, 'up', 60)
      stops.push((await place(page)).id)
    }
    expect(stops, 'the tags, the search field and the first Up next button, in that order').toEqual(['Romance 130, any', 'Search your games', 'Play'])
    await tap(page, 'right', 60)
    expect((await place(page)).id, 'right goes along the buttons, not on to the next slide').toBe('Game page')
    await tap(page, 'a', 60)
    await expect(page, 'A opens the game page').toHaveURL(/\/game\/game-000$/)
  })
})

test.describe('the first press', () => {
  for (const button of ['down', 'right', 'a']) {
    test(`${button} with nothing selected goes into the page's content, not to the header, the page or the carousel's box`, async ({ page }, testInfo) => {
      desktopOnly(testInfo)
      await withPad(page)
      await open(page, '/')
      await settled(page)
      await tap(page, button, 60)
      const at = await page.evaluate(() => { const el = document.activeElement; return { inMain: !!el.closest('main'), box: el.classList.contains('carousel'), body: el === document.body, scrolled: scrollY } })
      expect(at).toEqual({ inMain: true, box: false, body: false, scrolled: 0 })
    })
  }
})

test.describe('scrolling', () => {
  test('the right stick scrolls the page, and a d-pad press with nothing to move to scrolls it too', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await withPad(page)
    await mock(page, [], 'pad')
    await page.goto('/game/game-000')
    await expect(page.locator('.stage')).toBeVisible()
    await settled(page)
    expect(await page.evaluate(() => scrollY)).toBe(0)
    await feed(page, Array.from({ length: 30 }, () => [0, 0, 0, 0.9]))
    const down = await page.evaluate(() => scrollY)
    expect(down, 'the right stick scrolled the page').toBeGreaterThan(300)
    await feed(page, Array.from({ length: 30 }, () => [0, 0, 0, -0.9]))
    expect(await page.evaluate(() => scrollY), 'and back').toBeLessThan(down - 300)
  })

  test('a right stick that only rests off the middle does not scroll', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await withPad(page)
    await mock(page, [], 'pad')
    await page.goto('/game/game-000')
    await expect(page.locator('.stage')).toBeVisible()
    await settled(page)
    await feed(page, Array.from({ length: 40 }, () => [0, 0, 0.1, 0.15]))
    expect(await page.evaluate(() => scrollY)).toBe(0)
  })
})

test.describe('the bumpers', () => {
  test('LB and RB go through Library, Catalog, Add games, Activity and You, round the ends, from any page', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await library(page)
    const path = () => page.evaluate(() => location.pathname)
    for (const next of ['/catalog', '/add', '/activity', '/account', '/']) {
      await tap(page, 'rb', 60)
      await expect.poll(path).toBe(next)
    }
    await tap(page, 'lb', 60)
    await expect.poll(path).toBe('/account')
    // A page of one's own: the game page belongs to the Library, and the history to You.
    await page.goto('/game/game-000')
    await expect(page.locator('.stage')).toBeVisible()
    await tap(page, 'rb', 60)
    await expect.poll(path).toBe('/catalog')
    await page.goto('/history')
    await expect(page.locator('main')).toContainText(/\w/)
    await tap(page, 'lb', 60)
    await expect.poll(path).toBe('/activity')
  })
})

test.describe('the legend', () => {
  test('shows what A, B and the bumpers do while the controller is used, and goes when a hand is back on the mouse', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await library(page)
    const legend = page.locator('.pad-legend')
    await expect(legend, 'nothing before the controller is pressed').toHaveCount(0)
    await tap(page, 'down', 60)
    await expect(legend).toBeVisible()
    await expect(legend).toHaveText(/Select\s*Back\s*LBRB\s*Pages|Select.*Back.*Pages/)
    await page.mouse.move(300, 300)
    await page.mouse.move(340, 320)
    await expect(legend, 'gone with the mouse').toHaveCount(0)
    await tap(page, 'down', 60)
    await expect(legend, 'back with the controller').toBeVisible()
    await page.keyboard.press('Tab')
    await expect(legend, 'gone with the keyboard').toHaveCount(0)
  })
})

test.describe('B', () => {
  test('goes back from a game page to the library, does nothing on the library itself, and leaves a menu or a field to close first', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await library(page)
    const path = () => page.evaluate(() => location.pathname)
    await tap(page, 'b', 60)
    expect(await path(), 'B on the first page of the library has nowhere to go').toBe('/')
    await page.locator('.grid[data-row] .card').first().focus()
    await tap(page, 'a', 60)
    await expect.poll(path).toMatch(/^\/game\//)
    await tap(page, 'b', 60)
    await expect.poll(path, 'B goes back').toBe('/')
    // A menu closes first, and the page stays.
    await page.getByRole('button', { name: /Your account/ }).focus()
    await tap(page, 'a', 60)
    await expect(page.locator('[data-actions-menu]')).toBeVisible()
    await tap(page, 'b', 60)
    await expect(page.locator('[data-actions-menu]')).toHaveCount(0)
    expect(await path()).toBe('/')
    // So does a field: Escape leaves it, and the next B is the page's.
    await page.getByRole('textbox', { name: 'Search your games' }).focus()
    await tap(page, 'b', 60)
    await expect(page.getByRole('textbox', { name: 'Search your games' })).not.toBeFocused()
    expect(await path()).toBe('/')
  })
})

test.describe('sheets', () => {
  test('A on a catalog tile opens its sheet with focus inside, the d-pad stays in it, and B closes it and gives focus back to the tile', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await withPad(page)
    await mock(page, [], 'pad')
    await open(page, '/catalog')
    await settled(page)
    // A recipe not in the library opens its sheet; one that is goes to its game page.
    const tile = page.locator('.grid[data-row] .card:not(:has(.corner))').first()
    await tile.focus()
    await tap(page, 'a', 60)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    for (let i = 0; i < 12; i++) {
      await tap(page, 'down', 60)
      expect(await sheet.evaluate((el) => el.contains(document.activeElement)), 'the d-pad keeps to the sheet').toBe(true)
    }
    await tap(page, 'b', 60)
    await expect(sheet).toHaveCount(0)
    await expect(tile, 'focus is back on the tile that opened it').toBeFocused()
  })
})
