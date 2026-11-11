// Typing in the search must not make a tile blink. Against the built library and a made-up API with a blurred placeholder
// under every picture and a delay the first time a picture is asked for, a browser samples every frame of the tiles in view
// while the person types and deletes, and fails when
//   - a tile in view before and after a key changed element, dipped below its opacity, ran an animation or showed its
//     placeholder again in between, or
//   - a tile that comes in with a picture the page has shown before was not showing it at once (no placeholder, no fade).
import { mock } from '../app-mock.mjs'
import { check, fieldOf, isMain, main, ready, SEARCH_PAGES } from './lib.mjs'

/** Every frame, the tiles in view: which element each is, how opaque, whether its picture is in, what animates. */
const record = (page) =>
  page.evaluate(() => {
    const ids = new WeakMap()
    let next = 0
    const idOf = (el) => (ids.has(el) ? ids.get(el) : (ids.set(el, ++next), next))
    window.__frames = []
    window.__shown = new Set()
    window.__known = new Set()
    const tick = () => {
      const tiles = {}
      for (const card of document.querySelectorAll('.grid[data-row] .card')) {
        const box = card.getBoundingClientRect()
        if (box.bottom < 0 || box.top > innerHeight) continue
        const art = card.querySelector('img.art')
        const src = art?.getAttribute('src') ?? ''
        const loading = !!art?.classList.contains('loading')
        if (src && !loading) window.__shown.add(src)
        tiles[card.dataset.id] = {
          el: idOf(card),
          art: art ? idOf(art) : 0,
          opacity: Math.min(Number(getComputedStyle(card).opacity), art ? Number(getComputedStyle(art).opacity) : 1),
          loading,
          animations: card.getAnimations({ subtree: true }).length,
          known: window.__known.has(src),
        }
      }
      window.__frames.push(tiles)
      window.__loop = requestAnimationFrame(tick)
    }
    tick()
  })

/** Presses a key, waits for the page to settle, and says what happened to the tiles in view. */
async function press(page, key) {
  // A picture that is still on its way, or fading in for the first time, is not what is measured: wait for the tiles in view to rest.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.grid[data-row] .card')]
          .filter((c) => c.getBoundingClientRect().bottom > 0 && c.getBoundingClientRect().top < innerHeight)
          .every((c) => !c.querySelector('img.art.loading') && !c.getAnimations({ subtree: true }).length),
      null,
      { timeout: 3000 },
    )
    .catch(() => {})
  await page.evaluate(() => {
    window.__known = new Set(window.__shown)
    window.__frames = window.__frames.slice(-1)
  })
  if (key === 'Backspace') await page.keyboard.press(key)
  else await page.keyboard.type(key)
  await page.waitForTimeout(450)
  return page.evaluate(() => {
    const [before, ...frames] = window.__frames
    const after = frames.at(-1)
    const out = { stayed: 0, blinked: [], arrived: 0, arrivedKnown: 0, arrivedLate: [] }
    for (const [id, was] of Object.entries(before)) {
      const now = after[id]
      if (!now) continue
      out.stayed++
      const seq = frames.map((f) => f[id]).filter(Boolean)
      const why = []
      if (seq.some((t) => t.el !== was.el || t.art !== was.art)) why.push('changed element')
      if (seq.some((t) => Math.abs(t.opacity - was.opacity) > 0.01)) why.push('opacity changed')
      if (seq.some((t) => t.animations > 0)) why.push('animated')
      if (seq.some((t) => t.loading !== was.loading)) why.push('showed its placeholder')
      if (why.length) out.blinked.push(`${id}: ${why.join(', ')}`)
    }
    for (const [id, now] of Object.entries(after)) {
      if (id in before) continue
      out.arrived++
      if (!now.known) continue
      out.arrivedKnown++
      const seq = frames.map((f) => f[id]).filter(Boolean)
      const why = []
      if (seq.some((t) => t.loading)) why.push('placeholder')
      if (seq.some((t) => t.animations > 0)) why.push('fade')
      if (seq.some((t) => Math.abs(t.opacity - now.opacity) > 0.01)) why.push('opacity')
      if (why.length) out.arrivedLate.push(`${id}: ${why.join(', ')}`)
    }
    return out
  })
}

/**
 * Types a few words and deletes them, from the first letter on (that one scrolls the toolbar under the header), and fails if
 * any key makes a tile in view blink.
 */
async function blink(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label, { delay: 60, thumbhash: true })
  for (const [name, path, field, word] of SEARCH_PAGES) {
    await ready(page, base, path)
    await fieldOf(page, field).click()
    // The pointer rests on the list, as a person's does while they type: a tile that lands under it must not lift.
    const view = page.viewportSize()
    await page.mouse.move(view.width * 0.4, view.height * 0.7)
    await record(page)
    // The first letter starts the search and scrolls once: it is not part of what is measured.
    await page.keyboard.type(word[0].toLowerCase())
    await page.waitForTimeout(600)
    const keys = [...word.slice(1).toLowerCase(), ' ', '1', '2', '3', 'Backspace', 'Backspace', 'Backspace', 'Backspace', '1', 'Backspace']
    const total = { stayed: 0, blinked: [], arrived: 0, arrivedKnown: 0, arrivedLate: [] }
    for (const key of keys) {
      const one = await press(page, key)
      total.stayed += one.stayed
      total.arrived += one.arrived
      total.arrivedKnown += one.arrivedKnown
      total.blinked.push(...one.blinked.map((b) => `${key === 'Backspace' ? '<-' : key}: ${b}`))
      total.arrivedLate.push(...one.arrivedLate.map((b) => `${key === 'Backspace' ? '<-' : key}: ${b}`))
    }
    await page.evaluate(() => cancelAnimationFrame(window.__loop))
    check(total.stayed >= 20 && total.arrivedKnown >= 3, `${label}: ${name}: the typing check saw tiles stay (${total.stayed}) and come back (${total.arrivedKnown} of ${total.arrived} arrivals had been shown before)`)
    check(!total.blinked.length, `${label}: ${name}: no tile that stays in view blinks while typing and deleting${total.blinked.length ? ` (${total.blinked.length}: ${total.blinked.slice(0, 3).join('; ')})` : ''}`)
    check(!total.arrivedLate.length, `${label}: ${name}: a tile that comes back shows its picture at once, with no placeholder and no fade${total.arrivedLate.length ? ` (${total.arrivedLate.length}: ${total.arrivedLate.slice(0, 3).join('; ')})` : ''}`)
  }
  await ctx.close()
}

export const tasks = ({ chrome, safari, base, errors, desktop, phone, iphone }) => [
  { name: 'blink', label: 'desktop', run: () => blink(chrome, base, errors, desktop, 'desktop') },
  { name: 'blink', label: 'phone', run: () => blink(chrome, base, errors, phone, 'phone') },
  safari && { name: 'blink', label: 'WebKit', run: () => blink(safari, base, errors, iphone, 'phone (WebKit)') },
]

if (isMain(import.meta.url)) await main([{ tasks }])
