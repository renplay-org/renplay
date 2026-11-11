// The Up next carousel, in a browser, against the built library and a made-up API:
//   - it turns by itself, holds while the mouse, a finger or focus is on it, stops for good once a person moves it (arrows,
//     dots, keys, a swipe), does not turn with reduced motion, fills a 390 px screen without a neighbour's edge, snaps, and
//     has a dot of 40 x 40 px for each slide
//   - it goes round: the end is another turn in the same direction, with a silent jump off the copies at the ends
//   - Resume on a slide flies the artwork from that slide's cover
// Its turning is timed by the page's clock, which only moves when a check says so.
import { mock } from '../app-mock.mjs'
import { check, isMain, main } from './lib.mjs'

const carouselState = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.carousel')
    // The place in slides' widths from the first slide: the copy in front takes one off.
    return { x: Math.round(box.scrollLeft - box.clientWidth), w: box.clientWidth, current: [...document.querySelectorAll('.dots .dot')].findIndex((d) => d.getAttribute('aria-current') === 'true') }
  })
/** Puts the carousel on a slide at once, as if it had been there. */
const atSlide = (page, i) => page.evaluate((i) => { const c = document.querySelector('.carousel'); c.scrollTo({ left: (i + 1) * c.clientWidth, behavior: 'instant' }) }, i)
/** Runs the page's clock forward, then lets a smooth scroll finish (the browser's own time). */
const pass = async (page, ms) => {
  await page.clock.runFor(ms)
  await page.waitForTimeout(900)
}

/** Waits until the carousel has turned to slide `i` and rests on it (as long as it takes, a few seconds at most), so the check reads where it came to. */
const rest = (page, i) =>
  page
    .waitForFunction(
      (i) => {
        const c = document.querySelector('.carousel')
        const current = [...document.querySelectorAll('.dots .dot')].findIndex((d) => d.getAttribute('aria-current') === 'true')
        return current === i && Math.abs(c.scrollLeft - (i + 1) * c.clientWidth) < 1
      },
      i,
      { timeout: 10000, polling: 100 },
    )
    .catch(() => {})

/** The Library, loaded, and then its clock stops: the turning is timed by it, which only moves when a check says so. */
async function openFrozen(page, base) {
  await page.clock.install()
  await page.goto(base + '/')
  await page.waitForSelector('.carousel .slide[role="group"]')
  await page.waitForTimeout(600)
  // The clock is stopped a moment ahead of the page's own time. On a slow machine that moment can be over before the call arrives: ask again.
  for (;;) {
    const now = await page.evaluate(() => Date.now())
    try {
      return await page.clock.pauseAt(new Date(now + 100))
    } catch (e) {
      if (!/past/.test(e.message)) throw e
    }
  }
}

async function carousel(browser, base, errors, options, label, { swipe = false } = {}) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  await openFrozen(page, base)
  const phone = (options.viewport?.width ?? 1440) < 720 || !!options.isMobile
  const counts = await page.evaluate(() => ({ slides: document.querySelectorAll('.carousel .slide:not(.copy)').length, dots: document.querySelectorAll('.dots .dot').length, small: [...document.querySelectorAll('.dots .dot')].filter((d) => d.offsetWidth < 40 || d.offsetHeight < 40).length }))
  check(counts.slides >= 6 && counts.slides <= 8 && counts.dots === counts.slides, `${label}: Up next is 6 to 8 slides with a dot for each (${counts.slides} slides, ${counts.dots} dots)`)
  check(counts.small === 0, `${label}: every dot is at least 40 x 40 px`)
  check((await carouselState(page)).current === 0, `${label}: the first dot is the current one`)

  if (phone) {
    // Fills the screen: a slide is as wide as the page, and no edge of the next one shows.
    const fit = await page.evaluate(() => {
      const [a, b] = [...document.querySelectorAll('.carousel .slide:not(.copy)')].map((e) => e.getBoundingClientRect())
      return { left: Math.round(a.left), right: Math.round(a.right), next: Math.round(b.left), width: innerWidth, snap: getComputedStyle(document.querySelector('.carousel')).scrollSnapType }
    })
    check(fit.left === 0 && fit.right === fit.width && fit.next >= fit.width, `${label}: a slide fills the ${fit.width} px screen and the next one's edge is out of sight (slide ${fit.left} to ${fit.right}, next from ${fit.next})`)
    check(/x mandatory/.test(fit.snap), `${label}: it scrolls sideways with snapping (${fit.snap})`)
  }

  // It turns by itself, about every seven seconds: the first turn comes within 7 seconds of the page loading,
  // and the next one 7 seconds after that.
  await pass(page, 7500)
  await rest(page, 1)
  const turned = await carouselState(page)
  check(turned.current === 1 && turned.x === turned.w, `${label}: it turns by itself (dot ${turned.current + 1}, at ${turned.x} of ${turned.w} px)`)
  await pass(page, 3000)
  check((await carouselState(page)).current === 1, `${label}: it stays on a slide for longer than 3 seconds`)
  await pass(page, 4000)
  await rest(page, 2)
  check((await carouselState(page)).current === 2, `${label}: and turns again 7 seconds after the last turn`)
  // Back to the second slide, for the holds below.
  await atSlide(page, 1)
  await page.waitForTimeout(300)

  if (phone) {
    // A finger on it holds it. Playwright cannot swipe in WebKit, so the finger is its touch events and the move is a scroll under it.
    await page.evaluate(() => document.querySelector('.carousel').dispatchEvent(new Event('touchstart', { bubbles: true })))
    await pass(page, 30000)
    check((await carouselState(page)).current === 1, `${label}: it holds while a finger is on it`)
    if (swipe) {
      const cdp = await ctx.newCDPSession(page)
      // A finger drawn across it with touch events (a synthesized scroll gesture is ignored by a headless runner).
      const at = await page.evaluate(() => { const r = document.querySelector('.carousel').getBoundingClientRect(); return { y: Math.round(r.top + r.height / 2) } })
      const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: at.y }] })
      await touch('touchStart', 330)
      for (let x = 310; x >= 70; x -= 20) {
        await touch('touchMove', x)
        await page.waitForTimeout(16)
      }
      await touch('touchEnd', 70)
      // A slow machine (CI) finishes the gesture and the snap later: wait for the carousel to rest on a slide past the first.
      await page.waitForFunction(() => {
        const c = document.querySelector('.carousel')
        return c.scrollLeft > c.clientWidth * 2.5 && c.scrollLeft % c.clientWidth === 0
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
    await page.locator('.carousel .slide:not(.copy)').nth(1).locator('a:has-text("Game page")').focus()
    await pass(page, 30000)
    check((await carouselState(page)).current === 1, `${label}: it holds while keyboard focus is in it`)
    await page.evaluate(() => document.activeElement?.blur())
    await pass(page, 7500)
    await rest(page, 2)
    check((await carouselState(page)).current === 2, `${label}: it turns again when the hold ends`)
    // The arrow keys move it while it has focus, and a person who moved it stops it for good.
    await page.locator('.carousel').focus()
    await page.keyboard.press('ArrowRight')
    await rest(page, 3)
    check((await carouselState(page)).current === 3, `${label}: the arrow keys move it while it has focus`)
    await page.keyboard.press('ArrowLeft')
    await rest(page, 2)
    check((await carouselState(page)).current === 2, `${label}: the left arrow key moves it back`)
    await page.evaluate(() => document.activeElement?.blur())
    await pass(page, 30000)
    check((await carouselState(page)).current === 2, `${label}: once a person has moved it by hand it stays where they put it`)
    // Dots and arrows.
    await page.locator('.dots .dot').nth(5).click()
    await rest(page, 5)
    const dot = await carouselState(page)
    check(dot.current === 5 && dot.x === 5 * dot.w, `${label}: a dot selects its slide (dot ${dot.current + 1}, at ${dot.x} of ${5 * dot.w} px)`)
    await page.locator('.car-arrow.next').click()
    await rest(page, 6)
    check((await carouselState(page)).current === 6, `${label}: the next arrow moves it on`)
    check(!(await page.locator('.car-arrow.next').isDisabled()) && !(await page.locator('.car-arrow.prev').isDisabled()), `${label}: both arrows stay on, at the last slide too`)
    await page.locator('.car-arrow.prev').click()
    await rest(page, 5)
    check((await carouselState(page)).current === 5, `${label}: the previous arrow moves it back`)
  }
  // Only the slide in view has anything to tab to.
  const tabbable = await page.evaluate(() => [...document.querySelectorAll('.carousel .slide:not(.copy)')].map((s) => s.inert))
  check(tabbable.filter((x) => !x).length === 1, `${label}: only the slide in view can be focused`)
  await ctx.close()
}

/** The place of the carousel in slides' widths from the first slide, on every frame it scrolls. */
const watch = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.carousel')
    window.__xs = []
    window.__watch = () => window.__xs.push(+((c.scrollLeft - c.clientWidth) / c.clientWidth).toFixed(3))
    c.addEventListener('scroll', window.__watch)
  })
const unwatch = async (page) => {
  // The scroll event of a jump comes a frame after it.
  await page.waitForTimeout(100)
  return page.evaluate(() => {
    document.querySelector('.carousel').removeEventListener('scroll', window.__watch)
    return window.__xs
  })
}
/**
 * Whether a move went one way only: no frame goes back, except the one silent jump from a copy to the slide that
 * looks the same (about `n` slides' widths). `jumps` counts those.
 */
const oneWay = (xs, n, dir) => {
  let jumps = 0
  let back = 0
  for (let i = 1; i < xs.length; i++) {
    const d = (xs[i] - xs[i - 1]) * dir
    if (d < -n / 2) jumps++
    else if (d < -0.01) back++
  }
  return { jumps, back }
}
/**
 * Waits until the carousel rests on a real slide. Where `scrollend` is missing the jump off a copy waits on a timer of the
 * page's clock, which is run once the scrolling has really stopped.
 */
async function restOnSlide(page, n) {
  const place = () => page.evaluate(() => { const c = document.querySelector('.carousel'); return [c.scrollLeft, c.clientWidth] })
  for (let still = 0, last = -1, i = 0; still < 4 && i < 60; i++) {
    await page.waitForTimeout(100)
    const [x] = await place()
    still = x === last ? still + 1 : 0
    last = x
  }
  await page.clock.runFor(300)
  for (let i = 0; i < 20; i++) {
    const [x, w] = await place()
    if (Number.isInteger(x / w) && x / w >= 1 && x / w <= n) return
    await page.waitForTimeout(100)
  }
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

/** The carousel goes round: the end is another turn, in the same direction, and the copies at the ends are only to look at. */
async function carouselLoop(browser, base, errors, options, label, { swipe = false, noScrollEnd = false } = {}) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  // Without `scrollend` the quiet after the last scroll event stands in for it: Safari before 26.2.
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
  await openFrozen(page, base)
  const phone = (options.viewport?.width ?? 1440) < 720 || !!options.isMobile
  const n = await page.evaluate(() => document.querySelectorAll('.carousel .slide:not(.copy)').length)
  const last = n - 1
  if (noScrollEnd) check(!(await page.evaluate(() => 'onscrollend' in window)), `${label}: the browser has no scrollend (the fallback is what runs)`)

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
  check(copies.total === 2 && copies.front && copies.back, `${label}: the two copies are aria-hidden and inert`)
  check(copies.reachable === 0, `${label}: nothing in a copy can take focus`)
  check(copies.frontTitle === copies.lastTitle, `${label}: the copy in front is the last slide's`)
  check((await carouselState(page)).x === 0, `${label}: it starts on the first slide, not on the copy`)

  // The automatic turn after the last slide goes on to the first, forward, never back across the others.
  await atSlide(page, last)
  await page.waitForTimeout(200)
  await watch(page)
  await pass(page, 7500)
  await restOnSlide(page, n)
  let moved = oneWay(await unwatch(page), n, 1)
  let state = await carouselState(page)
  check(state.current === 0 && state.x === 0, `${label}: the automatic turn after the last slide shows the first (dot ${state.current + 1}, at ${state.x} px)`)
  check(moved.back === 0 && moved.jumps === 1, `${label}: it moved on to the copy and jumped silently (${moved.back} frames went back, ${moved.jumps} silent jump)`)
  await pass(page, 7000)
  await restOnSlide(page, n)
  check((await carouselState(page)).current === 1, `${label}: the jump did not stop the automatic turns (the next turn came)`)

  /** Moves to the last slide, does `move`, and checks it landed on `to`, going `dir` all the way. */
  const wrap = async (what, from, to, dir, move) => {
    await atSlide(page, from)
    await page.waitForTimeout(200)
    await watch(page)
    await move()
    await restOnSlide(page, n)
    const frames = await unwatch(page)
    const moved = oneWay(frames, n, dir)
    const now = await carouselState(page)
    const real = await page.evaluate(() => [...document.querySelectorAll('.carousel .slide:not(.copy)')].filter((s) => !s.inert).map((s) => s.getAttribute('aria-label')))
    check(now.current === to && now.x === to * now.w, `${label}: ${what} shows slide ${to + 1} (dot ${now.current + 1}, at ${now.x} of ${to * now.w} px)`)
    check(moved.back === 0 && moved.jumps === 1, `${label}: ${what} moves ${dir > 0 ? 'forward' : 'back'} all the way, with one silent jump (${moved.back} frames went the other way, ${moved.jumps} jumps${moved.back === 0 && moved.jumps === 1 ? '' : `, frames ${frames.slice(-6).join(' ')}`})`)
    check(real.length === 1 && real[0] === `${to + 1} of ${n}`, `${label}: ${what}: the slide in view says ${to + 1} of ${n} (${real.join(', ')})`)
  }

  if (phone) {
    // A finger holds it, and a move under it is the person's. Chromium swipes with touch events; WebKit scrolls under synthetic ones.
    const cdp = swipe ? await ctx.newCDPSession(page) : null
    const pushed = async (dir) => {
      if (cdp) {
        await swipeAcross(page, cdp, dir)
      } else {
        await page.evaluate(() => document.querySelector('.carousel').dispatchEvent(new Event('touchstart', { bubbles: true })))
        await page.evaluate((dir) => document.querySelector('.carousel').scrollBy({ left: 370 * dir, behavior: 'instant' }), dir)
        await page.waitForTimeout(700)
        await page.evaluate(() => document.querySelector('.carousel').dispatchEvent(new Event('touchend', { bubbles: true })))
      }
    }
    await wrap('a swipe left past the last slide', last, 0, 1, () => pushed(1))
    await wrap('a swipe right past the first slide', 0, last, -1, () => pushed(-1))
    // Keep going one way: every swipe is one slide, round the end and on.
    await atSlide(page, last - 1)
    await page.waitForTimeout(200)
    const seen = []
    for (let i = 0; i < n + 2; i++) {
      await pushed(1)
      await restOnSlide(page, n)
      seen.push((await carouselState(page)).current)
    }
    const want = Array.from({ length: n + 2 }, (_, i) => (last - 1 + i + 1) % n)
    check(seen.join() === want.join(), `${label}: swiping one way for ${n + 2} turns goes round and on (${seen.join(' ')})`)
  } else {
    const next = page.locator('.car-arrow.next')
    const prev = page.locator('.car-arrow.prev')
    check(await next.isVisible() && await prev.isVisible() && await next.isEnabled() && await prev.isEnabled(), `${label}: both arrows show at every slide`)
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
    await page.waitForTimeout(200)
    await page.locator('.dots .dot').nth(2).click()
    await restOnSlide(page, n)
    state = await carouselState(page)
    check(state.current === 2 && state.x === 2 * state.w, `${label}: a dot goes to its slide from the last one (dot ${state.current + 1}, at ${state.x} px)`)
  }
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
    const r = document.querySelectorAll('.carousel .slide:not(.copy)')[2].querySelector('.cover .frame').getBoundingClientRect()
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
  await page.locator('.carousel .slide:not(.copy)').nth(2).locator('a.btn.p').click()
  await page.waitForTimeout(500)
  const first = await page.evaluate(() => window.__first)
  check(!!first && Math.abs(first.x - cover.x) < 40 && Math.abs(first.y - cover.y) < 40, `${label}: Resume on the third slide flies from that slide's cover (cover at ${Math.round(cover.x)}, ${Math.round(cover.y)}, flight starts at ${first ? `${Math.round(first.x)}, ${Math.round(first.y)}` : 'nowhere'})`)
  await ctx.close()
}

export const tasks = ({ chrome, safari, base, errors, desktop, phone, iphone }) => [
  { name: 'carousel', label: 'desktop', run: () => carousel(chrome, base, errors, desktop, 'desktop') },
  { name: 'loop', label: 'phone', run: () => carouselLoop(chrome, base, errors, phone, 'phone', { swipe: true }) },
  { name: 'loop', label: 'phone without scrollend', run: () => carouselLoop(chrome, base, errors, phone, 'phone without scrollend', { swipe: true, noScrollEnd: true }) },
  { name: 'loop', label: 'desktop', run: () => carouselLoop(chrome, base, errors, desktop, 'desktop') },
  { name: 'loop', label: 'desktop without scrollend', run: () => carouselLoop(chrome, base, errors, desktop, 'desktop without scrollend', { noScrollEnd: true }) },
  { name: 'carousel', label: 'phone', run: () => carousel(chrome, base, errors, phone, 'phone', { swipe: true }) },
  { name: 'still', label: 'desktop', run: () => carouselStill(chrome, base, errors, desktop, 'desktop') },
  { name: 'resume', run: () => resumeFlight(chrome, base, errors, desktop, 'desktop') },
  safari && { name: 'carousel', label: 'WebKit', run: () => carousel(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'loop', label: 'WebKit', run: () => carouselLoop(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'loop', label: 'WebKit without scrollend', run: () => carouselLoop(safari, base, errors, iphone, 'phone (WebKit) without scrollend', { noScrollEnd: true }) },
  safari && { name: 'still', label: 'WebKit', run: () => carouselStill(safari, base, errors, iphone, 'phone (WebKit)') },
]

if (isMain(import.meta.url)) await main([{ tasks }])
