// The search's scrolling, in a browser, against the built library and a made-up API. Every frame is sampled, and the only
// movement the page may make while a search is typed is one smooth scroll that puts the toolbar under the header:
//   - the first letter, from the top and from scrolled down, scrolls there smoothly (no frame moves by more than a third of
//     the way, never back, and it ends with the toolbar stuck under the header)
//   - a later key, with the toolbar there already, moves nothing, and with the person scrolled away it takes them back the same way
//   - a key on the way to it takes it to the same place, with no stutter
//   - deleting the search moves nothing (the Library's shelves return above the view)
//   - with reduced motion the same scrolls are one jump
import { mock } from '../app-mock.mjs'
import { check, isMain, main, quiet, ready, SEARCH_PAGES } from './lib.mjs'

/** Samples the page on every frame: where things are, how tall it is, the shifts the browser reports (Chromium only). */
const startSampling = (page) =>
  page.evaluate(() => {
    window.__frames = []
    window.__shifts = []
    try {
      // A container that grows upward is reported with the same visible box before and after: nothing moved on screen.
      const moved = (e) => e.sources.some((s) => JSON.stringify(s.previousRect) !== JSON.stringify(s.currentRect))
      new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__shifts.push(moved(e) ? e.value : 0))).observe({ type: 'layout-shift', buffered: false })
    } catch {}
    const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null
    const tick = () => {
      window.__frames.push({
        y: scrollY,
        header: top('header.top'),
        // Where the toolbar rests, on the screen: it moves with the page and keeps its place when the shelves above it go.
        anchor: top('.toolbar-top'),
        toolbar: top('.toolbar[role="search"]'),
        chips: top('.chip-bar'),
        tile: top('.grid[data-row] .card'),
        doc: document.documentElement.scrollHeight,
        vh: innerHeight,
      })
      window.__loop = requestAnimationFrame(tick)
    }
    tick()
  })
/** The frames since the last call. */
const takeFrames = (page) =>
  page.evaluate(() => {
    const out = { frames: window.__frames, shifts: window.__shifts }
    window.__frames = []
    window.__shifts = []
    return out
  })
/** Waits for the page to have scrolled to the toolbar under the header and to be still there. */
const parked = async (page) => {
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
const spread = (frames, key) => {
  const values = frames.map((f) => f[key]).filter((v) => v != null)
  return values.length ? Math.max(...values) - Math.min(...values) : 0
}

/** What the scroll did, seen by where the toolbar's resting place was on the screen on each frame (a jump of 1 px is rounding). */
function glide(frames) {
  const at = frames.map((f) => f.anchor)
  const distance = Math.abs(at.at(-1) - at[0])
  let biggest = 0
  let turns = 0
  let way = 0
  let moving = 0
  for (let i = 1; i < at.length; i++) {
    const d = at[i] - at[i - 1]
    if (Math.abs(d) <= 1) continue
    moving++
    biggest = Math.max(biggest, Math.abs(d))
    if (way && Math.sign(d) !== way) turns++
    way = Math.sign(d)
  }
  return { distance, biggest, turns, moving, series: at.filter((v, i) => !i || Math.abs(v - at[i - 1]) > 1).map(Math.round) }
}
const describe = (g) => `${Math.round(g.distance)} px in ${g.moving} frames, the biggest ${Math.round(g.biggest)} px, ${g.turns} turns${g.turns ? `: ${g.series.join(' ')}` : ''}`
/** Smooth: more than a jump, no frame covering more than a third of the way, and never back. */
const smooth = (g) => g.distance > 12 && g.moving >= 3 && g.biggest <= g.distance / 3 + 1 && g.turns === 0

/** Whether the toolbar ends stuck under the header, and the page was never shorter than the screen under it. */
const parkedAfter = (frames, stick) => {
  const last = frames.at(-1)
  return Math.abs(last.toolbar - last.header - stick) <= 1
}

async function steady(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  const tolerance = 1
  for (const [name, path, field, noun] of SEARCH_PAGES) {
    const word = noun.toLowerCase()
    for (const from of ['the top', 'scrolled down']) {
      const where = `${label}: ${name} from ${from}`
      await ready(page, base, path)
      if (from !== 'the top') {
        await page.evaluate(() => window.scrollTo({ top: 1500, behavior: 'instant' }))
        await page.waitForTimeout(300)
      }
      const stick = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.toolbar[role="search"]')).top))
      const keysBefore = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('renplay:scroll:')).length)
      const animations = await page.evaluate(() => document.querySelector('main')?.firstElementChild?.getAnimations().length)
      await page.evaluate(() => { window.__root = document.querySelector('main')?.firstElementChild })
      const room = await page.evaluate(() => document.querySelector('.bd')?.outerHTML)
      await page.evaluate((f) => document.querySelector(`input[aria-label="${f}"]`).focus({ preventScroll: true }), field)
      await startSampling(page)
      await page.waitForTimeout(100)
      await takeFrames(page)

      // The first key of a search: one smooth scroll that puts the toolbar under the header.
      await page.keyboard.type(word[0])
      await parked(page)
      const first = await takeFrames(page)
      const one = glide(first.frames)
      check(smooth(one) && first.frames.every((f) => f.header === 0), `${where}: the first letter scrolls smoothly to the toolbar under the header (${describe(one)})`)
      check(parkedAfter(first.frames, stick), `${where}: the toolbar ends stuck under the header (${Math.round(first.frames.at(-1).toolbar)} px from the top)`)
      check(first.frames.every((f) => f.doc >= f.y + f.vh - 1), `${where}: the page is never shorter than the scroll under the first letter`)

      // The second letter, with the toolbar there, moves nothing.
      await page.keyboard.type(word[1])
      await parked(page)
      const second = await takeFrames(page)
      check(spread(second.frames, 'anchor') <= tolerance && spread(second.frames, 'toolbar') <= tolerance && spread(second.frames, 'chips') <= tolerance && spread(second.frames, 'tile') <= tolerance, `${where}: the second letter moves nothing (anchor ${spread(second.frames, 'anchor').toFixed(2)}, toolbar ${spread(second.frames, 'toolbar').toFixed(2)}, chips ${spread(second.frames, 'chips').toFixed(2)})`)

      // The person scrolls down through the results and types: the page takes them back to the toolbar, smoothly.
      await page.evaluate(() => window.scrollBy({ top: 700, behavior: 'instant' }))
      await takeFrames(page)
      await page.keyboard.type(word[2])
      await parked(page)
      const back = await takeFrames(page)
      const returned = glide(back.frames.slice(1))
      check(smooth(returned) && parkedAfter(back.frames, stick), `${where}: a letter typed after scrolling down takes the page back to the toolbar smoothly (${describe(returned)})`)

      // So does a key that deletes.
      await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'instant' }))
      await takeFrames(page)
      await page.keyboard.press('Backspace')
      await parked(page)
      const deleted = await takeFrames(page)
      const returnedAgain = glide(deleted.frames.slice(1))
      check(smooth(returnedAgain) && parkedAfter(deleted.frames, stick), `${where}: deleting a letter after scrolling down takes the page back to the toolbar smoothly (${describe(returnedAgain)})`)

      // A key on the way takes the scroll to the same place, with no stutter.
      await page.evaluate(() => window.scrollBy({ top: 900, behavior: 'instant' }))
      await takeFrames(page)
      await page.keyboard.type(word[2])
      await page.waitForTimeout(120)
      await page.keyboard.type(word[3])
      await parked(page)
      const retargeted = await takeFrames(page)
      const onTheWay = glide(retargeted.frames.slice(1))
      check(smooth(onTheWay) && parkedAfter(retargeted.frames, stick), `${where}: a second key on the way keeps the scroll smooth and ends at the toolbar (${describe(onTheWay)})`)

      // Deleting it all: the shelves come back above the view, and the toolbar, the chips and the tiles keep their places.
      await page.keyboard.press('Backspace')
      await quiet(page)
      const less = await takeFrames(page)
      check(spread(less.frames, 'anchor') <= tolerance && spread(less.frames, 'toolbar') <= tolerance && spread(less.frames, 'chips') <= tolerance, `${where}: deleting a letter with the toolbar there moves nothing`)
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Backspace')
      await quiet(page, 400)
      const cleared = await takeFrames(page)
      const moved = ['anchor', 'toolbar', 'chips', 'tile'].map((k) => [k, spread(cleared.frames, k)]).filter(([, v]) => v > tolerance)
      check(!moved.length && cleared.frames.every((f) => f.doc >= f.y + f.vh - 1), `${where}: deleting the whole search keeps the toolbar, the chips and the tiles in place${moved.length ? ` (moved ${moved.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')})` : ''}`)
      const all = await takeFrames(page)
      // Layout shift entries (Chromium): the scrolling is not one, and nothing else after the first letter may be.
      const later = [...second.shifts, ...back.shifts, ...deleted.shifts, ...less.shifts, ...cleared.shifts, ...all.shifts].reduce((a, b) => a + b, 0)
      check(later < 0.01, `${where}: no layout shift while typing after the first letter (${later.toFixed(4)})`)
      const keysAfter = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('renplay:scroll:')).length)
      check(keysAfter <= keysBefore + 1, `${where}: a search adds no scroll memory of its own (${keysBefore} then ${keysAfter})`)
      const still = await page.evaluate((r) => ({ same: document.querySelector('main')?.firstElementChild === window.__root, animations: document.querySelector('main')?.firstElementChild?.getAnimations().length, room: document.querySelector('.bd')?.outerHTML === r }), room)
      check(still.same && still.animations === animations && still.room, `${where}: the page does not fade in again and the backdrop does not change`)
      await page.evaluate(() => cancelAnimationFrame(window.__loop))
    }
  }
  await ctx.close()
}

/** With reduced motion the first letter, and a later one after scrolling away, put the toolbar under the header in one jump. */
async function reduced(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  for (const [name, path, field, noun] of SEARCH_PAGES) {
    const word = noun.toLowerCase()
    await ready(page, base, path)
    const stick = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.toolbar[role="search"]')).top))
    await page.evaluate((f) => document.querySelector(`input[aria-label="${f}"]`).focus({ preventScroll: true }), field)
    await startSampling(page)
    await takeFrames(page)
    await page.keyboard.type(word[0])
    await quiet(page)
    const first = await takeFrames(page)
    const jump = glide(first.frames)
    check(jump.moving <= 1 && parkedAfter(first.frames, stick), `${label}: ${name}: with reduced motion the first letter jumps to the toolbar at once (${describe(jump)})`)
    await page.evaluate(() => window.scrollBy({ top: 700, behavior: 'instant' }))
    await takeFrames(page)
    await page.keyboard.type(word[1])
    await quiet(page)
    const again = await takeFrames(page)
    const back = glide(again.frames.slice(1))
    check(back.moving <= 1 && parkedAfter(again.frames, stick), `${label}: ${name}: with reduced motion a later letter takes the page back at once (${describe(back)})`)
    await page.evaluate(() => cancelAnimationFrame(window.__loop))
  }
  await ctx.close()
}

export const tasks = ({ chrome, safari, base, errors, desktop, phone, iphone }) => [
  { name: 'steady', label: 'desktop', run: () => steady(chrome, base, errors, desktop, 'desktop') },
  { name: 'steady', label: 'phone', run: () => steady(chrome, base, errors, phone, 'phone') },
  { name: 'reduced', label: 'desktop', run: () => reduced(chrome, base, errors, desktop, 'desktop') },
  { name: 'reduced', label: 'phone', run: () => reduced(chrome, base, errors, phone, 'phone') },
  safari && { name: 'steady', label: 'WebKit', run: () => steady(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'reduced', label: 'WebKit', run: () => reduced(safari, base, errors, iphone, 'phone (WebKit)') },
]

if (isMain(import.meta.url)) await main([{ tasks }])
