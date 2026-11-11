// The flight from a tile to the game page, in a browser: it must land with no flicker. Every frame from the tap to the end of the
// flight is sampled, from a plain tile and from a result of a search, and each frame must show either the flying picture or a cover
// that is fully there (opaque, its picture in and shown, not its placeholder). The flight is where the picture lands, and a frame
// with neither is a flicker.
import { mock } from '../app-mock.mjs'
import { check, fieldOf, isMain, isPhone, main, ready } from './lib.mjs'

/** Every frame: the flying picture, and the game page's cover with its opacity (all the way up) and its picture. */
const record = (page) =>
  page.evaluate(() => {
    window.__landing = []
    const opacityOf = (el) => {
      let o = 1
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
      return o
    }
    const tick = () => {
      const cover = document.querySelector('main .stage .cover .frame')
      const art = cover?.querySelector('img.art')
      window.__landing.push({
        path: location.pathname,
        ghost: !!document.querySelector('.ghost'),
        cover: !!cover,
        opacity: cover ? opacityOf(cover) : 0,
        hidden: cover ? getComputedStyle(cover).visibility === 'hidden' : true,
        drawn: !!art && art.complete && art.naturalWidth > 0 && !art.classList.contains('loading') && Number(getComputedStyle(art).opacity) === 1,
      })
      window.__loop = requestAnimationFrame(tick)
    }
    tick()
  })

async function landing(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label, { delay: 40, thumbhash: true })
  const phone = isPhone(options)
  for (const from of ['a plain tile', 'a search result']) {
    await ready(page, base, '/')
    if (from === 'a search result') {
      await fieldOf(page, 'Search your games').click()
      await page.keyboard.type('game 1', { delay: 30 })
      await page.waitForTimeout(900)
      await page.evaluate(() => document.activeElement?.blur())
    }
    const tile = page.locator('.grid[data-row] .card').nth(2)
    await tile.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await record(page)
    await (phone && options.hasTouch ? tile.tap() : tile.click())
    await page.waitForFunction(() => location.pathname.startsWith('/game/'))
    await page.waitForFunction(() => window.__landing.some((f) => f.ghost) && !document.querySelector('.ghost'), null, { timeout: 5000 })
    await page.waitForTimeout(700)
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.__loop)
      return window.__landing
    })
    const first = frames.findIndex((f) => f.ghost)
    const flight = frames.slice(first)
    const flying = flight.filter((f) => f.ghost).length
    const bad = flight.map((f, i) => [f, i]).filter(([f]) => !f.ghost && !(f.cover && !f.hidden && f.opacity === 1 && f.drawn))
    check(first >= 0 && flying >= 8, `${label}: the cover flies from ${from} (${flying} frames with the flying picture)`)
    check(!bad.length, `${label}: the flight from ${from} lands with no flicker: every frame shows the flying picture or a fully drawn cover${bad.length ? ` (${bad.length} frames showed neither, from frame ${bad[0][1]} of ${flight.length}: ${JSON.stringify(bad[0][0])})` : ''}`)
  }
  await ctx.close()
}

export const tasks = ({ chrome, safari, base, errors, desktop, phone, iphone }) => [
  { name: 'landing', label: 'desktop', run: () => landing(chrome, base, errors, desktop, 'desktop') },
  { name: 'landing', label: 'phone', run: () => landing(chrome, base, errors, phone, 'phone') },
  safari && { name: 'landing', label: 'WebKit', run: () => landing(safari, base, errors, iphone, 'phone (WebKit)') },
]

if (isMain(import.meta.url)) await main([{ tasks }])
