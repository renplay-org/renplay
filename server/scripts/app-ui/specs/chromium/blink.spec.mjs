// Typing in the search must not make a tile blink. Against a made-up API with a blurred placeholder under every picture and a
// delay the first time a picture is asked for, the page's own changes to the tiles in view are noted as they happen (the
// browser says when an element is replaced, when a picture shows its placeholder, and when an animation or a transition
// starts, whatever frames a slow machine draws) while the person types and deletes. It fails when
//   - a tile in view before and after a key was replaced by another element, was dimmer, ran an animation or a transition, or
//     showed its placeholder again in between, or
//   - a tile that comes in with a picture the page has shown before was not showing it at once (no placeholder, no fade).
import { test, expect, check } from '../fixtures.mjs'
import { fieldOf, parked, ready, SEARCH_PAGES } from '../helpers.mjs'

test.use({ mockOptions: { delay: 60, thumbhash: true } })

/** The tiles in view, from now on: what happens to each is noted until `finish`. */
const watch = (page) =>
  page.evaluate(() => {
    const cards = () => [...document.querySelectorAll('.grid[data-row] .card')]
    const inView = (card) => {
      const box = card.getBoundingClientRect()
      return box.bottom >= 0 && box.top <= innerHeight
    }
    const opacityOf = (card) => {
      const art = card.querySelector('img.art')
      return Math.min(Number(getComputedStyle(card).opacity), art ? Number(getComputedStyle(art).opacity) : 1)
    }
    const known = window.__blink?.shown ?? new Set()
    for (const card of cards()) {
      const art = card.querySelector('img.art')
      const src = art?.getAttribute('src')
      if (src && !art.classList.contains('loading') && inView(card)) known.add(src)
    }
    const state = {
      shown: new Set(known),
      known,
      before: new Map(cards().filter(inView).map((card) => [card.dataset.id, { card, art: card.querySelector('img.art'), opacity: opacityOf(card), loading: !!card.querySelector('img.art.loading') }])),
      noted: {},
      arrivals: {},
    }
    const note = (id, what) => id && ((state.noted[id] ??= new Set()).add(what))
    const idOf = (node) => node.closest?.('.card')?.dataset.id
    // A tile's own element or picture taken out of the page, a picture that goes back to its placeholder, an animation or a
    // transition under a tile.
    state.observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target.matches('img.art') && r.target.classList.contains('loading') && !(r.oldValue ?? '').split(' ').includes('loading')) note(idOf(r.target), 'showed its placeholder')
        for (const node of r.removedNodes) {
          if (node.nodeType !== 1) continue
          for (const [id, was] of state.before) if (node === was.card || node === was.art || node.contains(was.card) || node.contains(was.art)) note(id, 'changed element')
        }
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1) continue
          for (const card of node.matches('.card') ? [node] : node.querySelectorAll('.card')) {
            const art = card.querySelector('img.art')
            const src = art?.getAttribute('src') ?? ''
            state.arrivals[card.dataset.id] = { known: state.known.has(src), placeholder: !!art?.classList.contains('loading'), opacity: opacityOf(card), notes: new Set() }
          }
        }
      }
      for (const card of cards()) {
        const art = card.querySelector('img.art')
        const src = art?.getAttribute('src')
        if (src && !art.classList.contains('loading') && inView(card)) state.shown.add(src)
      }
    })
    state.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
    const animated = (e) => {
      const card = e.target.closest?.('.card')
      if (!card) return
      note(card.dataset.id, 'animated')
      state.arrivals[card.dataset.id]?.notes.add('fade')
    }
    for (const type of ['animationstart', 'transitionrun']) document.addEventListener(type, animated, true)
    state.animated = animated
    window.__blink = state
  })

/** Waits for the tiles in view to rest: no picture on its way, nothing animating. Then says what the key did. */
async function finish(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.grid[data-row] .card')]
    .filter((c) => c.getBoundingClientRect().bottom > 0 && c.getBoundingClientRect().top < innerHeight)
    .every((c) => !c.querySelector('img.art.loading') && !c.getAnimations({ subtree: true }).length)), { message: 'The tiles in view come to rest' }).toBe(true)
  return page.evaluate(() => {
    const state = window.__blink
    state.observer.disconnect()
    for (const type of ['animationstart', 'transitionrun']) document.removeEventListener(type, state.animated, true)
    const inView = (card) => {
      const box = card.getBoundingClientRect()
      return box.bottom >= 0 && box.top <= innerHeight
    }
    const out = { stayed: 0, blinked: [], arrived: 0, arrivedKnown: 0, arrivedLate: [] }
    const now = new Map([...document.querySelectorAll('.grid[data-row] .card')].filter(inView).map((card) => [card.dataset.id, card]))
    for (const [id, was] of state.before) {
      const card = now.get(id)
      if (!card) continue
      out.stayed++
      const why = [...(state.noted[id] ?? [])]
      if (card !== was.card || card.querySelector('img.art') !== was.art) why.push('changed element')
      const art = card.querySelector('img.art')
      if (Math.abs(Math.min(Number(getComputedStyle(card).opacity), art ? Number(getComputedStyle(art).opacity) : 1) - was.opacity) > 0.01) why.push('opacity changed')
      if (!!art?.classList.contains('loading') !== was.loading) why.push('showed its placeholder')
      if (why.length) out.blinked.push(`${id}: ${[...new Set(why)].join(', ')}`)
    }
    for (const [id, card] of now) {
      if (state.before.has(id)) continue
      out.arrived++
      const arrival = state.arrivals[id]
      if (!arrival?.known) continue
      out.arrivedKnown++
      const why = []
      if (arrival.placeholder) why.push('placeholder')
      if (arrival.notes.size) why.push('fade')
      const art = card.querySelector('img.art')
      if (Math.abs(arrival.opacity - Math.min(Number(getComputedStyle(card).opacity), art ? Number(getComputedStyle(art).opacity) : 1)) > 0.01) why.push('opacity')
      if (why.length) out.arrivedLate.push(`${id}: ${why.join(', ')}`)
    }
    return out
  })
}

for (const [name, path, field, word] of SEARCH_PAGES) {
  test(`${name}: no tile that stays in view blinks while typing and deleting, and a tile that comes back shows its picture at once`, async ({ page }) => {
    await ready(page, path)
    await fieldOf(page, field).click()
    // The pointer rests on the list, as a person's does while they type: a tile that lands under it must not lift.
    const view = page.viewportSize()
    await page.mouse.move(view.width * 0.4, view.height * 0.7)
    await watch(page)
    // The first letter starts the search and scrolls once: it is not part of what is measured.
    await page.keyboard.type(word[0].toLowerCase())
    await parked(page)
    await finish(page)
    const keys = [...word.slice(1).toLowerCase(), ' ', '1', '2', '3', 'Backspace', 'Backspace', 'Backspace', 'Backspace', '1', 'Backspace']
    const total = { stayed: 0, blinked: [], arrived: 0, arrivedKnown: 0, arrivedLate: [] }
    for (const key of keys) {
      await watch(page)
      if (key === 'Backspace') await page.keyboard.press(key)
      else await page.keyboard.type(key)
      const one = await finish(page)
      const shown = key === 'Backspace' ? '<-' : key
      total.stayed += one.stayed
      total.arrived += one.arrived
      total.arrivedKnown += one.arrivedKnown
      total.blinked.push(...one.blinked.map((b) => `${shown}: ${b}`))
      total.arrivedLate.push(...one.arrivedLate.map((b) => `${shown}: ${b}`))
    }
    check(total.stayed >= 20 && total.arrivedKnown >= 3, `the typing check saw tiles stay (${total.stayed}) and come back (${total.arrivedKnown} of ${total.arrived} arrivals had been shown before)`)
    check(!total.blinked.length, `no tile that stays in view blinks while typing and deleting${total.blinked.length ? ` (${total.blinked.length}: ${total.blinked.slice(0, 3).join('; ')})` : ''}`)
    check(!total.arrivedLate.length, `a tile that comes back shows its picture at once, with no placeholder and no fade${total.arrivedLate.length ? ` (${total.arrivedLate.length}: ${total.arrivedLate.slice(0, 3).join('; ')})` : ''}`)
  })
}
