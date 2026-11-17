// What the browser specs share for the Library and the Catalog: the search pages, waiting for a page to be at rest, and
// the pictures that fly from a tile to a game page and back.
import { expect } from './fixtures.mjs'

// The page, its path, the field's label, the words its made-up titles start with, a letter in them, one title in full.
export const SEARCH_PAGES = [
  ['the Library', '/', 'Search your games', 'Game', 'g', 'Game 125'],
  ['the Catalog', '/catalog', 'Search the catalog', 'Recipe', 'r', 'Recipe 119'],
]
export const fieldOf = (page, label) => page.locator(`input[aria-label="${label}"]`)
export const titlesOf = (page) => page.evaluate(() => [...document.querySelectorAll('.grid[data-row] .card .ct')].map((e) => e.textContent))
export const gridOf = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('.grid[data-row]')
    return grid ? { tiles: grid.children.length, cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length } : null
  })
export const scrollToEnd = (page) => page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))

/**
 * Scrolls to the end of the grid until it stops growing, or `batches` batches came. Every size seen is returned. The grid
 * grows a batch at a time ahead of the person: a batch is waited for, and a list that does not grow in three seconds has ended.
 */
export async function growBy(page, batches) {
  const sizes = []
  for (let guard = 0; guard < 40 && sizes.length <= batches; guard++) {
    const g = await gridOf(page)
    if (!g) break
    if (sizes.at(-1)?.tiles !== g.tiles) sizes.push(g)
    await scrollToEnd(page)
    const grew = await page.waitForFunction((n) => document.querySelector('.grid[data-row]').children.length > n, g.tiles, { timeout: 3000 }).then(() => true, () => false)
    if (!grew) break
  }
  return sizes
}

/** The page, loaded: the grid, the page's first fade and the room's crossfade (it drops the old layer after 650 ms) over. */
export async function ready(page, path) {
  await page.goto(path)
  await page.waitForSelector('.grid[data-row] .card')
  await expect.poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState === 'finished') && document.querySelectorAll('.bd .l').length <= 1), { message: 'The page has faded in and the room has settled' }).toBe(true)
}

/** Waits until the grid has stopped growing: the same number of tiles on four frames in a row. */
export const settledGrid = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        let last = -1
        let still = 0
        const tick = () => {
          const tiles = document.querySelectorAll('.grid[data-row] .card').length
          still = tiles === last ? still + 1 : 0
          last = tiles
          if (still >= 4) done()
          else requestAnimationFrame(tick)
        }
        tick()
      }),
  )

/** Waits until the page has not scrolled for a moment, or for a few seconds at most. */
export const quiet = (page, ms = 250) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        let timer = setTimeout(finish, ms)
        const stop = setTimeout(finish, 5000)
        const bump = () => {
          clearTimeout(timer)
          timer = setTimeout(finish, ms)
        }
        function finish() {
          clearTimeout(timer)
          clearTimeout(stop)
          window.removeEventListener('scroll', bump)
          done()
        }
        window.addEventListener('scroll', bump, { passive: true })
      }),
    ms,
  )

/** Waits for the page to have scrolled to the toolbar under the header and to be still there. */
export const parked = async (page) => {
  await page.waitForFunction(
    () => {
      const toolbar = document.querySelector('.toolbar[role="search"]')
      const style = getComputedStyle(toolbar)
      // The place the toolbar rests, on the screen, is where it sticks less its own margin.
      return Math.abs(document.querySelector('.toolbar-top').getBoundingClientRect().top - (parseFloat(style.top) - parseFloat(style.marginTop))) <= 1
    },
    null,
    { timeout: 8000 },
  )
  await quiet(page, 350)
}

/** Waits until the game page is on screen and the list it came from is gone: the stage of the Library's carousel is not the game's. */
export const onGamePage = (page) => page.waitForFunction(() => location.pathname.startsWith('/game/') && !document.querySelector('.grid[data-row]') && document.querySelector('main .stage'))

/**
 * Notes the flying picture the moment it is added to the page (so a flight is seen on a machine too slow to draw a frame
 * during it), and where its animation ends: its last keyframe, since the last frame seen may be a few hundredths of a second
 * short of it. Every frame after that is noted too.
 */
export const recordGhost = (page) =>
  page.evaluate(() => {
    window.__ghost = []
    window.__end = null
    const note = (el) => {
      const r = el.getBoundingClientRect()
      window.__ghost.push({ w: r.width, h: r.height, x: r.x, y: r.y })
      if (!window.__end) {
        const animation = el.getAnimations()[0]
        const last = animation?.effect.getKeyframes().at(-1)
        const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(last?.transform ?? '')
        if (m) window.__end = { x: +m[1], y: +m[2], width: el.offsetWidth * +m[3], duration: animation.effect.getTiming().duration }
      }
    }
    window.__added = new MutationObserver((list) => {
      for (const m of list) for (const el of m.addedNodes) if (el.classList?.contains('ghost')) note(el)
    })
    window.__added.observe(document.body, { childList: true })
    const tick = () => {
      const el = document.querySelector('.ghost')
      if (el) note(el)
      window.__recording = requestAnimationFrame(tick)
    }
    window.__recording = requestAnimationFrame(tick)
  })
/** The frames recorded, once the flying picture has been seen and has landed. */
export const takeGhost = async (page) => {
  await page.waitForFunction(() => window.__ghost.length > 0, null, { timeout: 10000 }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('.ghost'), null, { timeout: 5000 })
  return page.evaluate(() => {
    cancelAnimationFrame(window.__recording)
    window.__added.disconnect()
    return { frames: window.__ghost, end: window.__end }
  })
}

// Every picture seen keeps 2:3, and one was seen: how many frames a slow machine draws during a short flight is not for a check.
export const shapeOk = (frames) => frames.length >= 1 && frames.every((f) => Math.abs(f.h / f.w - 1.5) < 0.02)
