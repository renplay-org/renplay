// What the search does to the page, in a browser, against the built library and a made-up API:
//   - steady while typing: the header, the toolbar, the tag chips and the first tile stay on the screen, the page scrolls once
//     when a search starts and never after, and the document is never shorter than the scroll
//   - the focus ring of the field is whole after Ctrl K, / and a tap
//   - the count line, the status region, the tag chips with their counts, and the fade of the tiles that come back
//   - nothing of the page reads through the header or the gaps of the toolbar once a search has parked it under the header
import sharp from 'sharp'
import { mock } from '../app-mock.mjs'
import { check, fieldOf, isMain, isPhone, main, pressShortcut, ready, SEARCH_PAGES, titlesOf } from './lib.mjs'

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
        toolbar: top('.toolbar[role="search"]'),
        chips: top('.chip-bar'),
        tile: top('.grid[data-row] .card'),
        count: document.querySelector('.count-line')?.getBoundingClientRect().height ?? null,
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
const spread = (frames, key) => {
  const values = frames.map((f) => f[key]).filter((v) => v != null)
  return values.length ? Math.max(...values) - Math.min(...values) : 0
}

/**
 * Types one letter and deletes it, from the top of the page and from scrolled down, and fails on any movement
 * but the one scroll when a search starts: the header, the toolbar, the tag chips and the first tile stay on the
 * screen, the document never gets shorter under the scroll, and nothing is scrolled on the later keys.
 */
async function steady(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  const tolerance = 1
  for (const [name, path, field, , letter] of SEARCH_PAGES) {
    for (const from of ['the top', 'scrolled down']) {
      const where = `${label}: ${name} from ${from}`
      await ready(page, base, path)
      if (from !== 'the top') {
        await page.evaluate(() => window.scrollTo({ top: 1500, behavior: 'instant' }))
        await page.waitForTimeout(300)
      }
      const keysBefore = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('renplay:scroll:')).length)
      const animations = await page.evaluate(() => document.querySelector('main')?.firstElementChild?.getAnimations().length)
      const root = await page.evaluate(() => { window.__root = document.querySelector('main')?.firstElementChild; return !!window.__root })
      const room = await page.evaluate(() => document.querySelector('.bd')?.outerHTML)
      await page.evaluate((f) => document.querySelector(`input[aria-label="${f}"]`).focus({ preventScroll: true }), field)
      await startSampling(page)
      await page.waitForTimeout(100)
      await takeFrames(page)
      // The first key of a search: one scroll, at once, that puts the toolbar under the header.
      await page.keyboard.type(letter)
      await page.waitForTimeout(500)
      const first = await takeFrames(page)
      const ys = [...new Set(first.frames.map((f) => Math.round(f.y)))]
      const bars = [...new Set(first.frames.map((f) => Math.round(f.toolbar)))]
      const stuck = first.frames.at(-1).toolbar
      check(ys.length <= 2 && bars.length <= 2 && first.frames.every((f) => f.header === 0), `${where}: the first letter scrolls once, at once (scroll positions ${ys.join(', ')}, toolbar at ${bars.join(', ')})`)
      check(Math.abs(stuck - first.frames.at(-1).header - (await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.toolbar[role="search"]')).top)))) <= tolerance, `${where}: the toolbar ends stuck under the header (${Math.round(stuck)} px from the top)`)
      check(first.frames.every((f) => f.doc >= f.y + f.vh - 1), `${where}: the page is never shorter than the scroll under the first letter`)
      // The second letter moves nothing, not even the scroll.
      await page.keyboard.type(letter === 'g' ? 'a' : 'e')
      await page.waitForTimeout(400)
      const second = await takeFrames(page)
      check(spread(second.frames, 'y') === 0 && spread(second.frames, 'toolbar') <= tolerance && spread(second.frames, 'chips') <= tolerance && spread(second.frames, 'count') === 0, `${where}: the second letter moves nothing (scroll ${spread(second.frames, 'y')}, toolbar ${spread(second.frames, 'toolbar').toFixed(2)}, chips ${spread(second.frames, 'chips').toFixed(2)})`)
      // Deleting both: the shelves come back above the view, and the toolbar, the chips and the tiles keep their places.
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(400)
      const back = await takeFrames(page)
      check(spread(back.frames, 'y') === 0 && spread(back.frames, 'toolbar') <= tolerance && spread(back.frames, 'chips') <= tolerance, `${where}: deleting a letter moves nothing`)
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(500)
      const cleared = await takeFrames(page)
      const ysC = [...new Set(cleared.frames.map((f) => Math.round(f.y)))]
      const moved = ['toolbar', 'chips', 'tile', 'count'].map((k) => [k, spread(cleared.frames, k)]).filter(([, v]) => v > tolerance)
      check(!moved.length && ysC.length <= 2 && cleared.frames.every((f) => f.doc >= f.y + f.vh - 1), `${where}: deleting the last letter keeps the toolbar, the chips and the tiles in place${moved.length ? ` (moved ${moved.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')})` : ''}`)
      const all = await takeFrames(page)
      const shifts = [...first.shifts, ...second.shifts, ...back.shifts, ...cleared.shifts, ...all.shifts]
      // Layout shift entries (Chromium): the first letter's scroll is the one allowed to move things.
      const later = [...second.shifts, ...back.shifts, ...cleared.shifts].reduce((a, b) => a + b, 0)
      check(later < 0.01, `${where}: no layout shift after the first letter (${later.toFixed(4)}${options.isMobile && !shifts.length ? ', none reported by this browser' : ''})`)
      const keysAfter = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('renplay:scroll:')).length)
      check(keysAfter <= keysBefore + 1, `${where}: a search adds no scroll memory of its own (${keysBefore} then ${keysAfter})`)
      const still = await page.evaluate((r) => ({ same: document.querySelector('main')?.firstElementChild === window.__root, animations: document.querySelector('main')?.firstElementChild?.getAnimations().length, room: document.querySelector('.bd')?.outerHTML === r }), room)
      check(still.same && still.animations === animations && still.room, `${where}: the page does not fade in again and the backdrop does not change`)
      await page.evaluate(() => cancelAnimationFrame(window.__loop))
    }
  }
  await ctx.close()
}

// ---- the focus ring, the count, the status, the fade, the tags -------------------------------------

/** The sides of a box (in CSS pixels) where the white focus ring 2 to 4 px outside it is not there: none when it is whole. */
async function ringAt(page, box) {
  const margin = 8
  const clip = { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin }
  const { data, info } = await sharp(await page.screenshot({ clip, scale: 'css' })).raw().toBuffer({ resolveWithObject: true })
  const px = (x, y) => {
    const i = (Math.round(y) * info.width + Math.round(x)) * info.channels
    return Math.min(data[i], data[i + 1], data[i + 2])
  }
  const at = (d) => d + margin
  // Three points on each side, 3 px outside the field: the ring is 2 to 4 px out.
  const w = box.width, h = box.height
  const points = []
  for (const f of [0.25, 0.5, 0.75]) points.push(['top', px(margin + w * f, at(-3))], ['bottom', px(margin + w * f, at(h + 3))])
  for (const f of [0.45, 0.5, 0.55]) points.push(['left', px(at(-3), margin + h * f)], ['right', px(at(w + 3), margin + h * f)])
  // Whole is white, cut is the page's dark: a pixel half way is the ring's edge on a screen that is not on a whole pixel.
  return points.filter(([, v]) => v < 128).map(([side]) => side)
}

async function ring(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  const phone = isPhone(options)
  for (const [name, path, field] of SEARCH_PAGES) {
    for (const how of ['the shortcut', '/', phone ? 'a tap' : 'a click']) {
      await ready(page, base, path)
      await page.evaluate(() => document.activeElement?.blur())
      if (how === 'the shortcut') await pressShortcut(page, 'k')
      else if (how === '/') await page.keyboard.press('/')
      else if (phone) {
        // A person scrolls the toolbar into view and taps it: the tab bar covers the bottom of the first screen.
        await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }))
        await page.waitForTimeout(200)
        await page.touchscreen.tap(...(await fieldOf(page, field).boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])))
      }
      else await fieldOf(page, field).click()
      await page.waitForTimeout(700)
      const state = await page.evaluate((f) => {
        const input = document.querySelector(`input[aria-label="${f}"]`)
        const box = document.querySelector('.search-field').getBoundingClientRect()
        return { focused: document.activeElement === input, box: { x: box.x, y: box.y, width: box.width, height: box.height }, inView: box.top >= 0 && box.bottom <= (document.querySelector('.tabbar') && getComputedStyle(document.querySelector('.tabbar')).display !== 'none' ? document.querySelector('.tabbar').getBoundingClientRect().top : innerHeight) }
      }, field)
      const cut = state.focused ? await ringAt(page, state.box) : ['not focused']
      check(state.focused && state.inView && !cut.length, `${label}: the focus ring on ${name} is whole after ${how}${cut.length ? ` (cut at ${cut.join(', ')})` : ''}`)
    }
  }
  await ctx.close()
}

async function cues(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label, { titled: true })
  for (const [name, path, field] of SEARCH_PAGES) {
    await ready(page, base, path)
    const read = () => page.evaluate(() => ({ line: document.querySelector('.count-line .count')?.textContent, status: document.querySelector('.count-line [role="status"]')?.textContent, clear: !!document.querySelector('.count-line .link'), height: document.querySelector('.count-line')?.getBoundingClientRect().height, seg: [...document.querySelectorAll('.toolbar .seg button, .toolbar .sort')].map((b) => Math.round(b.getBoundingClientRect().left * 10) / 10), chips: document.querySelector('.chip-bar')?.getBoundingClientRect().top }))
    const idle = await read()
    check(idle.line === '12 games' && !idle.clear, `${label}: ${name} counts its games with nothing typed (${idle.line})`)
    await fieldOf(page, field).click()
    await page.keyboard.type('rom', { delay: 40 })
    await page.waitForTimeout(150)
    const typing = await read()
    check(typing.line === '5 of 12 games' && typing.clear && typing.height === idle.height, `${label}: ${name} says "${typing.line}" with Clear all while searching, on a line of the same height`)
    check(typing.seg.join() === idle.seg.join(), `${label}: ${name}'s controls beside the search keep their places while the count changes (${idle.seg.join(', ')})`)
    check(typing.status === '12 games', `${label}: ${name}'s status region does not speak on every key (still "${typing.status}")`)
    await page.waitForTimeout(800)
    check((await read()).status === '5 of 12 games', `${label}: ${name}'s status region says the count once the person pauses`)
    // Clear all takes the search and the tags away at once.
    await page.getByRole('button', { name: /^(Romance|Fantasy)/ }).first().click()
    await page.waitForTimeout(150)
    await page.getByRole('button', { name: 'Clear all' }).click()
    await page.waitForTimeout(500)
    const cleared = await read()
    check(cleared.line === '12 games' && !cleared.clear && (await fieldOf(page, field).inputValue()) === '' && !new URL(page.url()).searchParams.has('q') && !new URL(page.url()).searchParams.has('tag') && !new URL(page.url()).searchParams.has('with'), `${label}: Clear all clears the search and the tags together (${cleared.line})`)
  }
  await ctx.close()
}

async function tags(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label, { titled: true })
  const chips = () => page.evaluate(() => [...document.querySelectorAll('.chip-bar .chips.wrap .chip')].map((c) => ({ label: c.childNodes[0].textContent.trim(), n: Number(c.querySelector('.n')?.textContent), dim: c.classList.contains('dim'), on: c.getAttribute('aria-pressed') === 'true', width: c.getBoundingClientRect().width })))
  const order = (list) => list.map((c) => c.label).join(', ')
  for (const [name, path, field] of SEARCH_PAGES) {
    await ready(page, base, path)
    const before = await chips()
    check(before.length >= 6 && before.every((c) => Number.isInteger(c.n)), `${label}: ${name}'s tag chips show counts (${before.slice(0, 4).map((c) => `${c.label} ${c.n}`).join(', ')})`)
    // A search leaves the chips where they are and counts what it finds. A chip nothing would show is dim.
    await fieldOf(page, field).click()
    await page.keyboard.type('moon')
    await page.waitForTimeout(200)
    const during = await chips()
    check(order(during) === order(before), `${label}: ${name}'s chips keep their order while a search is typed`)
    const total = during.reduce((n, c) => n + c.n, 0)
    check(during.some((c) => c.n < before.find((b) => b.label === c.label).n) && during.some((c) => c.n === 0 && c.dim) && during.every((c) => c.dim === (c.n === 0)), `${label}: ${name}'s chips count what the search finds (${during.map((c) => `${c.label} ${c.n}`).join(', ')}) and dim the empty ones`)
    check(total > 0 && Math.max(...during.map((c, i) => Math.abs(c.width - before[i].width))) <= 12, `${label}: ${name}'s chips hardly change width while the counts do (${Math.max(...during.map((c, i) => Math.abs(c.width - before[i].width))).toFixed(1)} px)`)
    await fieldOf(page, field).fill('')
    await page.waitForTimeout(200)
    // Selected chips come first, and the Library takes more than one tag: a game must have all.
    await page.getByRole('button', { name: /^Drama/ }).first().click()
    await page.getByRole('button', { name: /^Mystery/ }).first().click()
    await page.waitForTimeout(400)
    const picked = await chips()
    const selected = picked.filter((c) => c.on)
    check(selected.length >= 1 && picked.slice(0, selected.length).every((c) => c.on), `${label}: ${name}'s selected chips come first (${order(picked.slice(0, 3))})`)
    // A row that scrolls sideways on a phone goes back to its start, where the chosen chips now are.
    check(await page.evaluate(() => document.querySelector('.chip-bar .chips.wrap').scrollLeft === 0), `${label}: ${name}'s chip row shows its start, with the chosen chips, after a tag is chosen`)
    if (name === 'the Library') {
      const tagsInAddress = new URL(page.url()).searchParams.get('tag')?.split(',') ?? []
      const titles = await titlesOf(page)
      check(tagsInAddress.length === 2 && titles.length >= 1 && titles.length < 4, `${label}: the Library takes two tags and keeps them in the address (${tagsInAddress.join(', ')}: ${titles.join(', ')})`)
    }
    await page.getByRole('button', { name: 'Clear all' }).click()
    await page.waitForTimeout(300)
  }
  await ctx.close()
}

/** How many pixels differ by more than a little between two screenshots of the same size. */
async function differing(a, b) {
  const [x, y] = await Promise.all([a, b].map((png) => sharp(png).raw().toBuffer({ resolveWithObject: true })))
  if (x.info.width !== y.info.width || x.info.height !== y.info.height) return Infinity
  let n = 0
  for (let i = 0; i < x.data.length; i += x.info.channels) if (Math.abs(x.data[i] - y.data[i]) + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2]) > 6) n++
  return n
}

/**
 * Once a search has put the toolbar under the header, the band from the top of the screen to the bottom of the toolbar shows
 * none of the page: it looks the same with everything in the page but the toolbar hidden, at rest and at scrolls where tiles
 * pass under it. At the top of the page, with no search, the backdrop is not there.
 */
async function band(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  const veil = () => page.evaluate(() => { const v = document.querySelector('.toolbar-veil'); return { stuck: v.hasAttribute('data-stuck'), opacity: Number(getComputedStyle(v).opacity) } })
  const settle = () => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'))
  for (const [name, path, field, , letter] of SEARCH_PAGES) {
    await ready(page, base, path)
    const rest = await veil()
    check(!rest.stuck && rest.opacity === 0, `${label}: ${name}: at the top of the page the page's backdrop shows, with no veil over it`)
    await fieldOf(page, field).click()
    await page.keyboard.type(letter)
    await page.waitForFunction(() => document.querySelector('.toolbar-veil')?.hasAttribute('data-stuck'))
    await settle()
    // The toolbar stays where it is: the veil is no part of the layout.
    const parkedAt = await page.evaluate(() => ({ y: scrollY, top: document.querySelector('.toolbar[role="search"]').getBoundingClientRect().top }))
    await page.evaluate(() => document.activeElement?.blur())
    const bad = []
    for (const offset of [0, 140, 420, 1300]) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), parkedAt.y + offset)
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
      await settle()
      const clip = await page.evaluate(() => {
        const toolbar = document.querySelector('.toolbar[role="search"]').getBoundingClientRect()
        return { x: 0, y: 0, width: innerWidth, height: Math.ceil(toolbar.bottom) }
      })
      const shown = await page.screenshot({ clip, scale: 'css' })
      const style = await page.addStyleTag({ content: 'main :not(.toolbar):not(.toolbar *):not(.toolbar-veil) { visibility: hidden !important } .toolbar, .toolbar *, .toolbar-veil { visibility: visible !important }' })
      const bare = await page.screenshot({ clip, scale: 'css' })
      await style.evaluate((el) => el.remove())
      const n = await differing(shown, bare)
      const state = await veil()
      if (n || !state.stuck || state.opacity !== 1) bad.push(`at ${offset} px: ${n} pixels of the page show${state.stuck ? '' : ', no veil'}`)
    }
    check(!bad.length, `${label}: ${name}: nothing of the page shows between the top of the screen and the bottom of the toolbar, at rest and with tiles passing under it${bad.length ? ` (${bad.join('; ')})` : ''}`)
    const after = await page.evaluate(() => document.querySelector('.toolbar[role="search"]').getBoundingClientRect().top)
    check(Math.abs(after - parkedAt.top) <= 1, `${label}: ${name}: the toolbar stays under the header while the veil is on (${Math.round(parkedAt.top)} then ${Math.round(after)} px)`)
    // With the search cleared and the page back at the top the toolbar is not stuck, and the veil goes.
    await page.click('.search-field .clear')
    // The page keeps the toolbar where it is for half a second after the shelves come back.
    await page.waitForTimeout(600)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    await settle()
    const gone = await veil()
    check(!gone.stuck && gone.opacity === 0, `${label}: ${name}: the veil goes when the toolbar is no longer stuck`)
  }
  await ctx.close()
}

async function fade(browser, base, errors, options, label, { reduced = false } = {}) {
  const ctx = await browser.newContext({ ...options, reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label, { titled: true })
  for (const [name, path, field] of SEARCH_PAGES) {
    await ready(page, base, path)
    await page.evaluate(() => document.querySelectorAll('.grid[data-row] .card').forEach((c) => (c.__old = true)))
    await fieldOf(page, field).click()
    await page.keyboard.type('o')
    await page.waitForTimeout(400)
    const kept = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.grid[data-row] .card')]
      return { cards: cards.length, old: cards.filter((c) => c.__old).length, animating: cards.filter((c) => c.getAnimations().length).length }
    })
    check(kept.old === kept.cards && kept.animating === 0, `${label}: ${name}: tiles that stay are the same tiles and do not blink (${kept.old} of ${kept.cards} kept, ${kept.animating} fading)`)
    await page.keyboard.press('Backspace')
    // The tiles that come back fade in, over about 150 ms, and the others are left alone.
    const seen = await page.evaluate(
      () =>
        new Promise((done) => {
          const cards = () => [...document.querySelectorAll('.grid[data-row] .card')]
          let max = 0, stays = 0, length = 0
          const t0 = performance.now()
          const tick = () => {
            const fading = cards().filter((c) => c.getAnimations().length)
            max = Math.max(max, fading.length)
            stays += fading.filter((c) => c.__old).length
            for (const c of fading) for (const a of c.getAnimations()) length = Math.max(length, a.effect.getComputedTiming().duration)
            if (performance.now() - t0 < 500) requestAnimationFrame(tick)
            else done({ max, stays, length, cards: cards().length })
          }
          tick()
        }),
    )
    if (reduced) check(seen.max === 0, `${label}: ${name}: no fade with reduced motion`)
    else check(seen.max > 0 && seen.stays === 0 && seen.length >= 100 && seen.length <= 200, `${label}: ${name}: tiles that come back fade in over ${seen.length} ms and the ones already there do not (${seen.max} of ${seen.cards} fading)`)
  }
  await ctx.close()
}

export const tasks = ({ chrome, safari, base, errors, desktop, phone, iphone }) => [
  { name: 'steady', label: 'desktop', run: () => steady(chrome, base, errors, desktop, 'desktop') },
  { name: 'steady', label: 'phone', run: () => steady(chrome, base, errors, phone, 'phone') },
  { name: 'ring', label: 'desktop', run: () => ring(chrome, base, errors, desktop, 'desktop') },
  { name: 'ring', label: 'phone', run: () => ring(chrome, base, errors, phone, 'phone') },
  { name: 'cues', label: 'desktop', run: () => cues(chrome, base, errors, desktop, 'desktop') },
  { name: 'cues', label: 'phone', run: () => cues(chrome, base, errors, phone, 'phone') },
  { name: 'tags', label: 'desktop', run: () => tags(chrome, base, errors, desktop, 'desktop') },
  { name: 'tags', label: 'phone', run: () => tags(chrome, base, errors, phone, 'phone') },
  { name: 'band', label: 'desktop', run: () => band(chrome, base, errors, desktop, 'desktop') },
  { name: 'band', label: 'phone', run: () => band(chrome, base, errors, phone, 'phone') },
  { name: 'fade', label: 'desktop', run: () => fade(chrome, base, errors, desktop, 'desktop') },
  { name: 'fade', label: 'desktop, reduced motion', run: () => fade(chrome, base, errors, desktop, 'desktop, reduced motion', { reduced: true }) },
  { name: 'fade', label: 'phone', run: () => fade(chrome, base, errors, phone, 'phone') },
  { name: 'fade', label: 'phone, reduced motion', run: () => fade(chrome, base, errors, phone, 'phone, reduced motion', { reduced: true }) },
  safari && { name: 'steady', label: 'WebKit', run: () => steady(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'ring', label: 'WebKit', run: () => ring(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'cues', label: 'WebKit', run: () => cues(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'tags', label: 'WebKit', run: () => tags(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'band', label: 'WebKit', run: () => band(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'fade', label: 'WebKit', run: () => fade(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'fade', label: 'WebKit, reduced motion', run: () => fade(safari, base, errors, iphone, 'phone (WebKit), reduced motion', { reduced: true }) },
]

if (isMain(import.meta.url)) await main([{ tasks }])
