// What the specs of the Up next carousel share. Its turning is timed by the page's clock (fixtures.mjs `freeze`), which only
// moves when a test says so, and its scrolling by the browser's own time: the clock is run, then the place it comes to is waited for.
import { until } from './fixtures.mjs'

/** The place in slides' widths from the first slide (the copy in front takes one off), and the current dot. */
export const carouselState = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.carousel')
    return { x: Math.round(box.scrollLeft - box.clientWidth), w: box.clientWidth, current: [...document.querySelectorAll('.dots .dot')].findIndex((d) => d.getAttribute('aria-current') === 'true') }
  })

/** Puts the carousel on a slide at once, as if it had been there, and waits for the page to have seen it. */
export async function atSlide(page, i) {
  await page.evaluate((i) => { const c = document.querySelector('.carousel'); c.scrollTo({ left: (i + 1) * c.clientWidth, behavior: 'instant' }) }, i)
  await rests(page, i)
}

/** Waits until the carousel rests on slide `i`: its dot is the current one and it is exactly there. */
export const rests = (page, i, message = `The carousel comes to rest on slide ${i + 1}`) =>
  until(() => page.evaluate((i) => {
    const c = document.querySelector('.carousel')
    const current = [...document.querySelectorAll('.dots .dot')].findIndex((d) => d.getAttribute('aria-current') === 'true')
    return current === i && Math.abs(c.scrollLeft - (i + 1) * c.clientWidth) < 1
  }, i), message)

/**
 * Notes every turn the page asks for (a smooth scroll of the carousel): a hold is that nothing asked for one, however long
 * the clock runs, and does not wait for a browser to show what was not asked for.
 */
export const spyTurns = (page) =>
  page.addInitScript(() => {
    window.__turns = []
    const scroll = Element.prototype.scrollTo
    Element.prototype.scrollTo = function (options, ...args) {
      if (this.classList.contains('carousel') && options?.behavior === 'smooth') window.__turns.push(options.left)
      return scroll.call(this, options, ...args)
    }
  })
export const turns = (page) => page.evaluate(() => window.__turns)
export const forgetTurns = (page) => page.evaluate(() => { window.__turns = [] })

/** The place of the carousel in slides' widths from the first slide, at every scroll event it makes. */
export const watch = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.carousel')
    window.__xs = []
    window.__watch = () => window.__xs.push(+((c.scrollLeft - c.clientWidth) / c.clientWidth).toFixed(3))
    c.addEventListener('scroll', window.__watch)
  })
export async function unwatch(page) {
  // The scroll event of a jump comes a frame after it: wait for the last one to have been seen.
  await until(() => page.evaluate(() => { const c = document.querySelector('.carousel'); return window.__xs.length === 0 || window.__xs.at(-1) === +((c.scrollLeft - c.clientWidth) / c.clientWidth).toFixed(3) }), 'The last scroll of the carousel has been seen')
  return page.evaluate(() => {
    document.querySelector('.carousel').removeEventListener('scroll', window.__watch)
    return window.__xs
  })
}
/**
 * Whether a move went one way only: no scroll goes back, except the one silent jump from a copy to the slide that
 * looks the same (about `n` slides' widths). `jumps` counts those.
 */
export const oneWay = (xs, n, dir) => {
  let jumps = 0
  let back = 0
  for (let i = 1; i < xs.length; i++) {
    const d = (xs[i] - xs[i - 1]) * dir
    if (d < -n / 2) jumps++
    else if (d < -0.01) back++
  }
  return { jumps, back }
}
