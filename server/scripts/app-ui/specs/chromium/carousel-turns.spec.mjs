// The Up next carousel, in a browser, against the built library and a made-up API: it turns by itself, holds while the mouse, a
// finger or focus is on it, stops for good once a person moves it (arrows, dots, keys, a swipe), does not turn with reduced
// motion, fills a 390 px screen without a neighbour's edge, snaps, and has a dot of 40 x 40 px for each slide.
// Its turning is timed by the page's clock, which only moves when a test says so.
import { test, expect, check, freeze, only, openClocked, until } from '../fixtures.mjs'
import { atSlide, carouselState, forgetTurns, rests, spyTurns, turns } from '../carousel.mjs'

test.use({ mockOptions: {} })

/** The Library, loaded, with the clock stopped. */
async function openFrozen(page) {
  await freeze(page)
  await spyTurns(page)
  await openClocked(page)
  await expect(page.locator('.carousel .slide[role="group"]').first()).toBeAttached()
}
/** Runs the page's clock forward: what turns by itself in that time has been asked for when it returns. */
const pass = (page, ms) => page.clock.runFor(ms)
/** The page asked for no turn however long the clock ran, and the carousel is where it was. */
async function held(page, i, what) {
  expect(await turns(page), `${what}: no turn was asked for`).toEqual([])
  check((await carouselState(page)).current === i, `${what}: the carousel stays on slide ${i + 1}`)
}

test('the carousel turns by itself, holds, and stays where a person puts it', async ({ page }, testInfo) => {
  const phone = !!testInfo.project.use.hasTouch
  await openFrozen(page)
  const counts = await page.evaluate(() => ({ slides: document.querySelectorAll('.carousel .slide:not(.copy)').length, dots: document.querySelectorAll('.dots .dot').length, small: [...document.querySelectorAll('.dots .dot')].filter((d) => d.offsetWidth < 40 || d.offsetHeight < 40).length }))
  check(counts.slides >= 6 && counts.slides <= 8 && counts.dots === counts.slides, `Up next is 6 to 8 slides with a dot for each (${counts.slides} slides, ${counts.dots} dots)`)
  check(counts.small === 0, 'every dot is at least 40 x 40 px')
  check((await carouselState(page)).current === 0, 'the first dot is the current one')

  if (phone) {
    // Fills the screen: a slide is as wide as the page, and no edge of the next one shows.
    const fit = await page.evaluate(() => {
      const [a, b] = [...document.querySelectorAll('.carousel .slide:not(.copy)')].map((e) => e.getBoundingClientRect())
      return { left: Math.round(a.left), right: Math.round(a.right), next: Math.round(b.left), width: innerWidth, snap: getComputedStyle(document.querySelector('.carousel')).scrollSnapType }
    })
    check(fit.left === 0 && fit.right === fit.width && fit.next >= fit.width, `a slide fills the ${fit.width} px screen and the next one's edge is out of sight (slide ${fit.left} to ${fit.right}, next from ${fit.next})`)
    check(/x mandatory/.test(fit.snap), `it scrolls sideways with snapping (${fit.snap})`)
  }

  // It turns by itself, about every seven seconds: the first turn comes within 7 seconds of the page loading,
  // and the next one 7 seconds after that.
  await pass(page, 7500)
  await rests(page, 1)
  const turned = await carouselState(page)
  check(turned.current === 1 && turned.x === turned.w, `it turns by itself (dot ${turned.current + 1}, at ${turned.x} of ${turned.w} px)`)
  await forgetTurns(page)
  await pass(page, 3000)
  await held(page, 1, 'it stays on a slide for longer than 3 seconds')
  await pass(page, 4000)
  await rests(page, 2)
  check((await carouselState(page)).current === 2, 'and turns again 7 seconds after the last turn')
  // Back to the second slide, for the holds below.
  await atSlide(page, 1)
  await forgetTurns(page)

  if (phone) {
    // A finger on it holds it. A finger is drawn across it with touch events (a synthesized scroll gesture is ignored by a headless runner).
    await page.evaluate(() => document.querySelector('.carousel').dispatchEvent(new Event('touchstart', { bubbles: true })))
    await pass(page, 30000)
    await held(page, 1, 'it holds while a finger is on it')
    const cdp = await page.context().newCDPSession(page)
    const y = await page.evaluate(() => { const r = document.querySelector('.carousel').getBoundingClientRect(); return Math.round(r.top + r.height / 2) })
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    await touch('touchStart', 330)
    for (let x = 310; x >= 70; x -= 20) {
      await touch('touchMove', x)
      await page.waitForTimeout(16)
    }
    await touch('touchEnd', 70)
    // A slow machine finishes the gesture and the snap later: wait for the carousel to rest on a slide past the first.
    await until(() => page.evaluate(() => { const c = document.querySelector('.carousel'); return c.scrollLeft > c.clientWidth * 2.5 && c.scrollLeft % c.clientWidth === 0 }), 'The swipe snaps to the next slide')
    await page.evaluate(() => document.querySelector('.carousel').dispatchEvent(new Event('touchend', { bubbles: true })))
    const swiped = await carouselState(page)
    check(swiped.current === 2 && swiped.x === 2 * swiped.w, `a swipe sideways snaps to the next slide (dot ${swiped.current + 1}, at ${swiped.x} of ${2 * swiped.w} px)`)
    await forgetTurns(page)
    await pass(page, 30000)
    await held(page, 2, 'once a person has moved it by hand it stays where they put it')
  } else {
    // The mouse over it holds it.
    await page.mouse.move(700, 300)
    await pass(page, 30000)
    await held(page, 1, 'it holds while the mouse is over it')
    await page.mouse.move(700, 880)
    // Focus in it holds it too.
    await page.locator('.carousel .slide:not(.copy)').nth(1).locator('a:has-text("Game page")').focus()
    await pass(page, 30000)
    await held(page, 1, 'it holds while keyboard focus is in it')
    await page.evaluate(() => document.activeElement?.blur())
    await pass(page, 7500)
    await rests(page, 2)
    check((await carouselState(page)).current === 2, 'it turns again when the hold ends')
    // The arrow keys move it while it has focus, and a person who moved it stops it for good.
    await page.locator('.carousel').focus()
    await page.keyboard.press('ArrowRight')
    await rests(page, 3)
    await page.keyboard.press('ArrowLeft')
    await rests(page, 2)
    await page.evaluate(() => document.activeElement?.blur())
    await forgetTurns(page)
    await pass(page, 30000)
    await held(page, 2, 'once a person has moved it by hand it stays where they put it')
    // Dots and arrows.
    await page.locator('.dots .dot').nth(5).click()
    await rests(page, 5)
    const dot = await carouselState(page)
    check(dot.current === 5 && dot.x === 5 * dot.w, `a dot selects its slide (dot ${dot.current + 1}, at ${dot.x} of ${5 * dot.w} px)`)
    await page.locator('.car-arrow.next').click()
    await rests(page, 6)
    check(!(await page.locator('.car-arrow.next').isDisabled()) && !(await page.locator('.car-arrow.prev').isDisabled()), 'both arrows stay on, at the last slide too')
    await page.locator('.car-arrow.prev').click()
    await rests(page, 5)
  }
  // Only the slide in view has anything to tab to.
  const tabbable = await page.evaluate(() => [...document.querySelectorAll('.carousel .slide:not(.copy)')].map((s) => s.inert))
  check(tabbable.filter((x) => !x).length === 1, 'only the slide in view can be focused')
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('with reduced motion the carousel does not turn by itself', async ({ page }, testInfo) => {
    only(testInfo, 'chromium-desktop', 'The same on a phone: the turning is the page\'s, not the screen\'s')
    await openFrozen(page)
    await pass(page, 40000)
    await held(page, 0, 'with reduced motion it does not turn by itself')
  })
})
