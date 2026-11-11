// What the search does to the page, in a browser, against the built library and a made-up API (its scrolling is in scroll.mjs):
//   - the count in the heading and in the field, the status region, Clear filters, and the tag chips with their counts
//   - nothing of the page reads through the header or the gaps of the toolbar once a search has parked it under the header
import sharp from 'sharp'
import { mock } from '../app-mock.mjs'
import { check, fieldOf, isMain, isPhone, main, quiet, ready, SEARCH_PAGES, titlesOf } from './lib.mjs'

// ---- the focus ring, the count, the status, the tags -------------------------------------

async function cues(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label, { titled: true })
  const phone = isPhone(options)
  for (const [name, path, field] of SEARCH_PAGES) {
    await ready(page, base, path)
    const library = name === 'the Library'
    const read = () =>
      page.evaluate(() => {
        const input = document.querySelector('.search-field')
        const count = input.querySelector('.field-count')
        const status = input.querySelector('[role="status"]')
        const box = input.getBoundingClientRect()
        return {
          // Where the page says the count at rest: the Library's heading, the Catalog's All segment.
          heading: document.querySelector('.sec-h .n')?.textContent ?? document.querySelector('.toolbar .seg .all')?.textContent,
          inField: count && getComputedStyle(count).display !== 'none' ? count.textContent : null,
          slot: count && getComputedStyle(count).display !== 'none' ? Math.round(count.getBoundingClientRect().width * 10) / 10 : null,
          status: status?.textContent,
          hidden: !!status && status.getBoundingClientRect().width <= 1 && status.getBoundingClientRect().height <= 1,
          clear: [...document.querySelectorAll('.chip-bar .chip')].some((c) => c.textContent.includes('Clear filters')),
          rows: document.querySelectorAll('.count-line').length,
          row: document.querySelector('.chip-bar')?.getBoundingClientRect().height,
          field: { left: Math.round(box.left * 10) / 10, width: Math.round(box.width * 10) / 10 },
          seg: [...document.querySelectorAll('.toolbar .seg button')].map((b) => Math.round(b.getBoundingClientRect().left * 10) / 10),
          // From the place the toolbar rests to the chips, on the page: a row for the count would make it longer.
          chips: Math.round((document.querySelector('.chip-bar')?.getBoundingClientRect().top - document.querySelector('.toolbar-top').getBoundingClientRect().top) * 10) / 10,
        }
      })
    const idle = await read()
    check(idle.heading === (library ? '12' : 'All 12') && idle.rows === 0 && !idle.clear && idle.inField === null && idle.hidden && idle.status === '12 games', `${label}: ${name} says its count in ${library ? 'the heading' : 'the All segment'} with no row of its own, nothing to clear and a status for screen readers (${idle.heading}, "${idle.status}")`)
    await fieldOf(page, field).click()
    await page.keyboard.type('rom', { delay: 40 })
    // The toolbar is stuck under the header once the page has scrolled to it: then the field says the count.
    await page.waitForFunction(() => document.querySelector('.toolbar-glass')?.hasAttribute('data-stuck'))
    const typing = await read()
    check(typing.heading === (library ? '5 of 12' : 'All 5') && !typing.clear, `${label}: ${name} says "${typing.heading}" while searching, with no Clear filters (the search has its own clear button)`)
    check(typing.inField === '5 of 12', `${label}: ${name}'s field says "${typing.inField}" at its right end while the toolbar is stuck`)
    check(typing.chips === idle.chips && typing.row === idle.row, `${label}: ${name} has no row for the count: the chips stay ${typing.chips} px under the toolbar's place (${idle.chips} at rest)`)
    check(typing.field.left === idle.field.left && (phone || typing.field.width === idle.field.width) && typing.seg.join() === idle.seg.join(), `${label}: ${name}'s field and controls keep their places while the order's name changes (${idle.field.left}, ${idle.field.width}; then ${typing.field.left}, ${typing.field.width})`)
    await page.keyboard.type('a')
    await page.waitForTimeout(100)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(100)
    await page.keyboard.type('a')
    const slots = new Set()
    for (const text of ['m', 'a', 'n']) {
      await page.keyboard.type(text)
      await page.waitForTimeout(80)
      const now = await read()
      if (now.slot) slots.add(now.slot)
    }
    check(slots.size === 1, `${label}: ${name}'s count in the field stays in a slot of one width while its words change (${[...slots].join(', ')} px)`)
    await fieldOf(page, field).fill('rom')
    await page.waitForTimeout(800)
    const paused = await read()
    // Clear filters is the first chip of the row once a tag is chosen, and the row keeps its height. It takes the tags away
    // and leaves the search as it is.
    await page.getByRole('button', { name: /^(Romance|Fantasy)/ }).first().click()
    await page.waitForTimeout(150)
    const tagged = await read()
    check(tagged.clear && tagged.row === paused.row && (await page.locator('.chip-bar .chip').first().textContent()).includes('Clear filters'), `${label}: ${name} offers Clear filters first in the chip row once a tag is chosen, and the row keeps its height (${paused.row} then ${tagged.row} px)`)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.waitForTimeout(500)
    const cleared = await read()
    const address = new URL(page.url()).searchParams
    check(!cleared.clear && cleared.heading === typing.heading && (await fieldOf(page, field).inputValue()) === 'rom' && address.get('q') === 'rom' && !address.has('tag') && !address.has('with') && cleared.row === paused.row, `${label}: Clear filters clears the tags and leaves the search (${cleared.heading}, "${await fieldOf(page, field).inputValue()}")`)
    // An empty result from the search alone offers to clear the search. One with tags too offers both, and each does its own part.
    await fieldOf(page, field).fill('zzzzzz')
    await page.waitForTimeout(300)
    const buttons = () => page.evaluate(() => [...document.querySelectorAll('.empty-filter .btn')].map((b) => b.textContent.trim()))
    check((await buttons()).join() === (library ? 'Clear the search,Search the catalog' : 'Clear the search'), `${label}: ${name}'s empty result from the search alone offers Clear the search (${(await buttons()).join(', ')})`)
    await page.getByRole('button', { name: /^(Romance|Fantasy)/ }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.empty-filter').getByRole('button', { name: 'Clear filters' }).click()
    await page.waitForTimeout(400)
    check((await fieldOf(page, field).inputValue()) === 'zzzzzz' && (await read()).heading === (library ? '0 of 12' : 'All 0'), `${label}: ${name}'s Clear filters in the empty result leaves the search (${(await fieldOf(page, field).inputValue())})`)
    await page.getByRole('button', { name: 'Clear the search' }).first().click()
    await page.waitForTimeout(500)
    check((await fieldOf(page, field).inputValue()) === '' && !new URL(page.url()).searchParams.has('q') && (await read()).heading === (library ? '12' : 'All 12'), `${label}: ${name}'s Clear the search clears the search (${(await read()).heading})`)
  }
  await ctx.close()
}

/** Chooses a tag by its chip, or in All tags when the row is shorter (Clear filters takes the place of two chips). */
async function choose(page, tag) {
  // Choosing moves the page and the row: look once they have settled.
  await quiet(page)
  await page.waitForTimeout(150)
  const chip = page.getByRole('button', { name: new RegExp(`^${tag}`) }).first()
  if (await chip.count()) await chip.click()
  else {
    await page.getByRole('button', { name: 'All tags' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tags' })
    await sheet.locator('.row.between', { hasText: new RegExp(`^${tag}`) }).getByRole('button', { name: 'Include' }).click()
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
  }
  await quiet(page)
  await page.waitForTimeout(150)
}

async function tags(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label, { titled: true })
  const chips = () => page.evaluate(() => [...document.querySelectorAll('.chip-bar .chips.wrap .chip')].filter((c) => !c.textContent.includes('Clear filters')).map((c) => ({ label: c.childNodes[0].textContent.trim(), n: Number(c.querySelector('.n')?.textContent), dim: c.classList.contains('dim'), on: c.getAttribute('aria-pressed') === 'true', width: c.getBoundingClientRect().width })))
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
    await choose(page, 'Drama')
    await choose(page, 'Mystery')
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
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.waitForTimeout(300)
    // All tags, at the right end of the row on both pages, opens every tag with its count. The Library only includes.
    const allTags = page.getByRole('button', { name: 'All tags' })
    const rowBox = await page.locator('.chip-bar').boundingBox()
    const buttonBox = await allTags.boundingBox()
    check(buttonBox.x + buttonBox.width >= rowBox.x + rowBox.width - 2, `${label}: ${name}'s All tags is at the right end of the chip row`)
    await (options.hasTouch ? allTags.tap() : allTags.click())
    const sheet = page.getByRole('dialog', { name: 'Tags' })
    await sheet.waitFor()
    const rows = await sheet.locator('.list .row.between').evaluateAll((els) => els.map((e) => e.firstElementChild.textContent.trim()))
    check(rows.length >= 6 && rows.every((r) => /\s\d+$/.test(r)), `${label}: ${name}'s All tags lists every tag with its count (${rows.length} tags, ${rows.slice(0, 3).join(', ')})`)
    const leaveOut = await sheet.getByRole('button', { name: 'Leave out' }).count()
    check(name === 'the Library' ? leaveOut === 0 : leaveOut === rows.length, `${label}: ${name}'s All tags ${name === 'the Library' ? 'only includes tags' : 'includes or leaves out each tag'}`)
    const fits = await sheet.evaluate((el) => { const box = el.getBoundingClientRect(); return [...el.querySelectorAll('button')].every((b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0 && r.height >= 30 }) && box.width <= innerWidth })
    check(fits, `${label}: ${name}'s All tags fits the screen`)
    for (const tag of ['Fantasy', 'Mystery']) {
      const include = sheet.locator('.row.between', { hasText: new RegExp(`^${tag}`) }).getByRole('button', { name: 'Include' })
      await (options.hasTouch ? include.tap() : include.click())
    }
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
    const chosen = await chips()
    const titles = await titlesOf(page)
    check(chosen.filter((c) => c.on).map((c) => c.label).sort().join() === 'Fantasy,Mystery' && titles.join() === 'Moonlight Library', `${label}: ${name}: tags chosen in All tags are on the chips, and a game must have all of them (${chosen.filter((c) => c.on).map((c) => c.label)}: ${titles.join(', ')})`)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.waitForTimeout(300)
  }
  await ctx.close()
}

/**
 * How readable the page is through the band: the sharpest edge in the difference between the band as it is and the band
 * with everything in the page but the toolbar hidden (0 to 255, from one pixel to the next). Text that shows through,
 * even faintly, makes edges of tens. A soft shape, a blurred picture or a tint makes edges of a few.
 */
async function sharpest(a, b) {
  const [x, y] = await Promise.all([a, b].map((png) => sharp(png).raw().toBuffer({ resolveWithObject: true })))
  const { width, height, channels } = x.info
  if (width !== y.info.width || height !== y.info.height) return Infinity
  const diff = new Float32Array(width * height)
  for (let i = 0; i < diff.length; i++) {
    let sum = 0
    for (let c = 0; c < 3; c++) sum += Math.abs(x.data[i * channels + c] - y.data[i * channels + c])
    diff[i] = sum / 3
  }
  let most = 0
  for (let row = 0; row < height - 1; row++)
    for (let col = 0; col < width - 1; col++) {
      const at = row * width + col
      most = Math.max(most, Math.abs(diff[at + 1] - diff[at]), Math.abs(diff[at + width] - diff[at]))
    }
  return most
}

/** The glass fades out over its last 16 px, where the page comes out from under it: that is not in the band. */
const FADE = 16

/** The most that may show of the page in the band, as `sharpest` measures it. Without the glass the edges are above 100. */
const FAINT = 20

/**
 * Once a search has put the toolbar under the header, nothing of the page reads in the band from the top of the screen to
 * the bottom of the toolbar, at rest and at scrolls where tiles pass under it: the rows above the toolbar are out of
 * sight (and keep their space), and what passes under it shows only as a soft shade. At the top of the page, with no
 * search, the glass is not there.
 */
async function band(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  const glass = () => page.evaluate(() => { const v = document.querySelector('.toolbar-glass'); return { stuck: v.hasAttribute('data-stuck'), opacity: Number(getComputedStyle(v).opacity) } })
  const settle = () => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'))
  // The rows above the toolbar, in the toolbar's own parent: whether any is visible, and where the toolbar is.
  const above = () => page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar[role="search"]')
    const rows = [...toolbar.parentElement.children].filter((e) => e.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING && !e.matches('.toolbar-top, .toolbar-glass'))
    return { rows: rows.length, visible: rows.filter((e) => getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0).length, top: toolbar.getBoundingClientRect().top }
  })
  for (const [name, path, field, , letter] of SEARCH_PAGES) {
    await ready(page, base, path)
    const rest = await glass()
    const rows = await above()
    check(!rest.stuck && rest.opacity === 0 && rows.rows > 0 && rows.visible === rows.rows, `${label}: ${name}: at the top of the page the header and the page look as they did, with no glass and the rows above the toolbar in place`)
    await fieldOf(page, field).click()
    await page.keyboard.type(letter)
    await page.waitForFunction(() => document.querySelector('.toolbar-glass')?.hasAttribute('data-stuck'))
    await settle()
    // The toolbar stays where it is: the glass is no part of the layout.
    const parkedAt = await page.evaluate(() => ({ y: scrollY, top: document.querySelector('.toolbar[role="search"]').getBoundingClientRect().top }))
    await page.evaluate(() => document.activeElement?.blur())
    const bad = []
    for (const offset of [0, 140, 420, 1300]) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), parkedAt.y + offset)
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
      await settle()
      const clip = await page.evaluate((fadeEdge) => {
        const toolbar = document.querySelector('.toolbar[role="search"]').getBoundingClientRect()
        return { x: 0, y: 0, width: innerWidth, height: Math.ceil(toolbar.bottom) - fadeEdge }
      }, FADE)
      const shown = await page.screenshot({ clip, scale: 'css' })
      const style = await page.addStyleTag({ content: 'main :not(.toolbar):not(.toolbar *):not(.toolbar-glass) { visibility: hidden !important } .toolbar, .toolbar *, .toolbar-glass { visibility: visible !important }' })
      const bare = await page.screenshot({ clip, scale: 'css' })
      await style.evaluate((el) => el.remove())
      const edge = await sharpest(shown, bare)
      const state = await glass()
      const rows = await above()
      if (edge > FAINT || !state.stuck || state.opacity !== 1 || rows.visible) bad.push(`at ${offset} px: edges of ${edge.toFixed(0)} show${state.stuck ? '' : ', no glass'}${rows.visible ? `, ${rows.visible} rows above the toolbar are visible` : ''}`)
    }
    check(!bad.length, `${label}: ${name}: nothing of the page reads between the top of the screen and the bottom of the toolbar, at rest and with tiles passing under it${bad.length ? ` (${bad.join('; ')})` : ''}`)
    const after = await page.evaluate(() => document.querySelector('.toolbar[role="search"]').getBoundingClientRect().top)
    check(Math.abs(after - parkedAt.top) <= 1, `${label}: ${name}: the toolbar stays under the header while the glass is on (${Math.round(parkedAt.top)} then ${Math.round(after)} px)`)
    // With the search cleared and the page back at the top the toolbar is not stuck, and the glass goes.
    await page.click('.search-field .clear')
    // The page keeps the toolbar where it is for half a second after the shelves come back.
    await page.waitForTimeout(600)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    await settle()
    const gone = await glass()
    const back = await above()
    check(!gone.stuck && gone.opacity === 0 && back.visible === back.rows, `${label}: ${name}: the glass goes and the rows above the toolbar come back when the toolbar is no longer stuck`)
  }
  await ctx.close()
}

export const tasks = ({ chrome, safari, base, errors, desktop, phone, iphone }) => [
  { name: 'cues', label: 'desktop', run: () => cues(chrome, base, errors, desktop, 'desktop') },
  { name: 'cues', label: 'phone', run: () => cues(chrome, base, errors, phone, 'phone') },
  { name: 'tags', label: 'desktop', run: () => tags(chrome, base, errors, desktop, 'desktop') },
  { name: 'tags', label: 'phone', run: () => tags(chrome, base, errors, phone, 'phone') },
  { name: 'band', label: 'desktop', run: () => band(chrome, base, errors, desktop, 'desktop') },
  { name: 'band', label: 'phone', run: () => band(chrome, base, errors, phone, 'phone') },
  safari && { name: 'cues', label: 'WebKit', run: () => cues(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'tags', label: 'WebKit', run: () => tags(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'band', label: 'WebKit', run: () => band(safari, base, errors, iphone, 'phone (WebKit)') },
]

if (isMain(import.meta.url)) await main([{ tasks }])
