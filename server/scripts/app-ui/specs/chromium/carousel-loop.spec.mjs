// The Up next carousel goes round, in a browser, against the built library and a made-up API: the end is another turn, in the same
// direction, with a silent jump off the copies at the ends, which are only there to look at. It is checked with the browser's
// `scrollend` and without it (the quiet after the last scroll event stands in for it: Safari before 26.2). The next and previous
// arrows with `scrollend` are in specs/carousel.spec.mjs.
import { test, expect, check, freeze, openClocked, until } from '../fixtures.mjs'
import { atSlide, carouselState, oneWay, rests, unwatch, watch } from '../carousel.mjs'

test.use({ mockOptions: {} })

/**
 * Waits until the carousel rests on a real slide. Where `scrollend` is missing the jump off a copy waits on a timer of the
 * page's clock, which is run once the scrolling has really stopped (on a slide's edge, and there for two reads).
 */
async function restsOnSlide(page, n) {
  const place = () => page.evaluate(() => { const c = document.querySelector('.carousel'); return c.scrollLeft % c.clientWidth === 0 ? c.scrollLeft : -1 })
  let last = -2
  await until(async () => {
    const x = await place()
    const same = x >= 0 && x === last
    last = x
    return same
  }, "The carousel stops on a slide's edge")
  await page.clock.runFor(300)
  await until(() => page.evaluate((n) => {
    const c = document.querySelector('.carousel')
    const at = c.scrollLeft / c.clientWidth
    return Number.isInteger(at) && at >= 1 && at <= n
  }, n), 'The carousel is on a real slide, not a copy')
}

/** A finger drawn across the carousel, `dir` 1 to the left (the next slide). */
async function swipeAcross(page, cdp, dir) {
  const y = await page.evaluate(() => { const r = document.querySelector('.carousel').getBoundingClientRect(); return Math.round(r.top + r.height / 2) })
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  const [from, to] = dir > 0 ? [330, 70] : [70, 330]
  await touch('touchStart', from)
  for (let x = from - dir * 20; dir > 0 ? x >= to : x <= to; x -= dir * 20) {
    await touch('touchMove', x)
    await page.waitForTimeout(16)
  }
  await touch('touchEnd', to)
}

for (const noScrollEnd of [false, true]) {
  test(`the carousel goes round${noScrollEnd ? ' without scrollend' : ''}`, async ({ page }, testInfo) => {
    // Every move waits for the browser to scroll, a swipe is a finger drawn in steps: a busy machine takes its time.
    test.slow()
    const phone = !!testInfo.project.use.hasTouch
    test.skip(phone && !noScrollEnd, 'A phone with scrollend turns on the same code as a desktop with it, and what a swipe adds is the swipe: that is checked without scrollend, as an iPhone before Safari 26.2 has it')
    // Without `scrollend` the quiet after the last scroll event stands in for it.
    if (noScrollEnd) {
      await page.addInitScript(() => {
        for (const o of [window, Window.prototype]) {
          try {
            delete o.onscrollend
          } catch {}
        }
        window.addEventListener('scrollend', (e) => e.stopImmediatePropagation(), true)
      })
    }
    await freeze(page)
    await openClocked(page)
    await expect(page.locator('.carousel .slide[role="group"]').first()).toBeAttached()
    const n = await page.evaluate(() => document.querySelectorAll('.carousel .slide:not(.copy)').length)
    const last = n - 1
    if (noScrollEnd) check(!(await page.evaluate(() => 'onscrollend' in window)), 'the browser has no scrollend (the fallback is what runs)')

    // The copies: one of the last slide in front, one of the first behind, hidden from screen readers and from focus.
    const copies = await page.evaluate(() => {
      const box = document.querySelector('.carousel')
      const all = [...box.children]
      const hidden = (c) => c.classList.contains('copy') && c.getAttribute('aria-hidden') === 'true' && c.inert
      const reachable = [...box.querySelectorAll('.copy a, .copy button')].filter((el) => {
        el.focus()
        return document.activeElement === el
      })
      return { front: hidden(all[0]), back: hidden(all.at(-1)), total: box.querySelectorAll('.copy').length, reachable: reachable.length, frontTitle: all[0].querySelector('.stage')?.dataset.id, lastTitle: all.at(-2).querySelector('.stage')?.dataset.id }
    })
    check(copies.total === 2 && copies.front && copies.back, 'the two copies are aria-hidden and inert')
    check(copies.reachable === 0, 'nothing in a copy can take focus')
    check(copies.frontTitle === copies.lastTitle, "the copy in front is the last slide's")
    check((await carouselState(page)).x === 0, 'it starts on the first slide, not on the copy')

    // The automatic turn after the last slide goes on to the first, forward, never back across the others.
    await atSlide(page, last)
    await watch(page)
    await page.clock.runFor(7500)
    await restsOnSlide(page, n)
    await rests(page, 0)
    let moved = oneWay(await unwatch(page), n, 1)
    let state = await carouselState(page)
    check(state.current === 0 && state.x === 0, `the automatic turn after the last slide shows the first (dot ${state.current + 1}, at ${state.x} px)`)
    check(moved.back === 0 && moved.jumps === 1, `it moved on to the copy and jumped silently (${moved.back} scrolls went back, ${moved.jumps} silent jump)`)
    await page.clock.runFor(7000)
    await restsOnSlide(page, n)
    await rests(page, 1, 'The jump did not stop the automatic turns: the next turn came')

    /** Moves to `from`, does `move`, and checks it landed on `to`, going `dir` all the way. */
    const wrap = async (what, from, to, dir, move) => {
      await atSlide(page, from)
      await watch(page)
      await move()
      await restsOnSlide(page, n)
      await rests(page, to)
      const frames = await unwatch(page)
      const moved = oneWay(frames, n, dir)
      const now = await carouselState(page)
      const real = await page.evaluate(() => [...document.querySelectorAll('.carousel .slide:not(.copy)')].filter((s) => !s.inert).map((s) => s.getAttribute('aria-label')))
      check(now.current === to && now.x === to * now.w, `${what} shows slide ${to + 1} (dot ${now.current + 1}, at ${now.x} of ${to * now.w} px)`)
      check(moved.back === 0 && moved.jumps === 1, `${what} moves ${dir > 0 ? 'forward' : 'back'} all the way, with one silent jump (${moved.back} scrolls went the other way, ${moved.jumps} jumps${moved.back === 0 && moved.jumps === 1 ? '' : `, scrolls ${frames.slice(-6).join(' ')}`})`)
      check(real.length === 1 && real[0] === `${to + 1} of ${n}`, `${what}: the slide in view says ${to + 1} of ${n} (${real.join(', ')})`)
    }

    if (phone) {
      // A finger holds it, and a move under it is the person's: a swipe is a finger drawn with touch events.
      const cdp = await page.context().newCDPSession(page)
      const pushed = (dir) => swipeAcross(page, cdp, dir)
      await wrap('a swipe left past the last slide', last, 0, 1, () => pushed(1))
      await wrap('a swipe right past the first slide', 0, last, -1, () => pushed(-1))
      // Keep going one way: every swipe is one slide, round the end and on.
      await atSlide(page, last - 1)
      const seen = []
      for (let i = 0; i < n + 2; i++) {
        await pushed(1)
        await restsOnSlide(page, n)
        seen.push((await carouselState(page)).current)
      }
      const want = Array.from({ length: n + 2 }, (_, i) => (last - 1 + i + 1) % n)
      check(seen.join() === want.join(), `swiping one way for ${n + 2} turns goes round and on (${seen.join(' ')})`)
    } else {
      const next = page.locator('.car-arrow.next')
      const prev = page.locator('.car-arrow.prev')
      check(await next.isVisible() && await prev.isVisible() && await next.isEnabled() && await prev.isEnabled(), 'both arrows show at every slide')
      // Native scrollend arrow wraps are in specs/carousel.spec.mjs. Keep the fallback here.
      if (noScrollEnd) {
        await wrap('the next arrow at the last slide', last, 0, 1, () => next.click())
        await wrap('the previous arrow at the first slide', 0, last, -1, () => prev.click())
      }
      await page.mouse.move(700, 880)
      await wrap('the Right key at the last slide', last, 0, 1, async () => {
        await page.locator('.carousel').focus()
        await page.keyboard.press('ArrowRight')
      })
      await wrap('the Left key at the first slide', 0, last, -1, () => page.keyboard.press('ArrowLeft'))
      // A dot goes straight to its slide.
      await atSlide(page, last)
      await page.locator('.dots .dot').nth(2).click()
      await restsOnSlide(page, n)
      await rests(page, 2)
      state = await carouselState(page)
      check(state.current === 2 && state.x === 2 * state.w, `a dot goes to its slide from the last one (dot ${state.current + 1}, at ${state.x} px)`)
    }
  })
}
