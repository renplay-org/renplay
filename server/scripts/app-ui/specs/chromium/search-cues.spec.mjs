// What the search does to the page, in a browser, against the built library and a made-up API (its scrolling is in
// search-scroll.spec.mjs, the band under the header in search-band.spec.mjs):
//   - the count in the heading and in the field, the status region, Clear filters, and the empty result's buttons
//   - the tag chips with their counts, the order of the selected ones, and All tags
import { test, expect, check, until } from '../fixtures.mjs'
import { fieldOf, quiet, ready, SEARCH_PAGES, titlesOf } from '../helpers.mjs'

test.use({ mockOptions: { titled: true } })

// ---- the count, the status, Clear filters -------------------------------------------------

for (const [name, path, field] of SEARCH_PAGES) {
  test(`${name}: the count, the status for screen readers, Clear filters and the empty result`, async ({ page }, testInfo) => {
    const phone = !!testInfo.project.use.hasTouch
    await ready(page, path)
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
          clear: [...document.querySelectorAll('.line-words .chip')].some((c) => c.textContent.includes('Clear filters')),
          rows: document.querySelectorAll('.count-line').length,
          // The toolbar is one line of the same height whatever it holds.
          row: document.querySelector('.toolbar.line')?.getBoundingClientRect().height,
          field: { left: Math.round(box.left * 10) / 10, width: Math.round(box.width * 10) / 10 },
          seg: [...document.querySelectorAll('.toolbar .seg button')].map((b) => Math.round(b.getBoundingClientRect().left * 10) / 10),
          // From the place the toolbar rests to the results, on the page: a row for the count would make it longer.
          chips: Math.round((document.querySelector('.results')?.getBoundingClientRect().top - document.querySelector('.toolbar-top').getBoundingClientRect().top) * 10) / 10,
        }
      })
    /** Reads until the page shows what it should, then once more: a state that is there and stays. */
    const reads = async (what, ok) => {
      await until(async () => ok(await read()), what)
      return read()
    }
    const idle = await read()
    check(idle.heading === (library ? '12' : 'All 12') && idle.rows === 0 && !idle.clear && idle.inField === null && idle.hidden && idle.status === '12 games', `${name} says its count in ${library ? 'the heading' : 'the All segment'} with no row of its own, nothing to clear and a status for screen readers (${idle.heading}, "${idle.status}")`)
    await fieldOf(page, field).click()
    await page.keyboard.type('rom', { delay: 40 })
    // The toolbar is stuck under the header once the page has scrolled to it: then the field says the count.
    await page.waitForFunction(() => document.querySelector('.toolbar-glass')?.hasAttribute('data-stuck'))
    const typing = await reads('the field says its count while the toolbar is stuck', (r) => r.inField === '5 of 12')
    check(typing.heading === (library ? '5 of 12' : 'All 5') && !typing.clear, `${name} says "${typing.heading}" while searching, with no Clear filters (the search has its own clear button)`)
    check(typing.inField === '5 of 12', `${name}'s field says "${typing.inField}" at its right end while the toolbar is stuck`)
    check(typing.chips === idle.chips && typing.row === idle.row, `${name} has no row for the count: the chips stay ${typing.chips} px under the toolbar's place (${idle.chips} at rest)`)
    check(typing.field.left === idle.field.left && (phone || typing.field.width === idle.field.width) && typing.seg.join() === idle.seg.join(), `${name}'s field and controls keep their places while the order's name changes (${idle.field.left}, ${idle.field.width}; then ${typing.field.left}, ${typing.field.width})`)
    await page.keyboard.type('a')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('a')
    const slots = new Set()
    for (const text of ['m', 'a', 'n']) {
      await page.keyboard.type(text)
      // Its count is written after the page has filtered: the slot is what is there once it says so.
      await until(async () => (await read()).inField !== null, 'the field says its count')
      const now = await read()
      if (now.slot) slots.add(now.slot)
    }
    check(slots.size === 1, `${name}'s count in the field stays in a slot of one width while its words change (${[...slots].join(', ')} px)`)
    await fieldOf(page, field).fill('rom')
    // The address follows the search after a pause: Clear filters is read once it has.
    await expect.poll(() => new URL(page.url()).searchParams.get('q'), { message: 'the address follows the search' }).toBe('rom')
    const paused = await read()
    // Clear filters is the first chip of the row once a tag is chosen, and the row keeps its height. It takes the tags away
    // and leaves the search as it is.
    // On a phone the open field covers the line: the tag is chosen once it has closed, leaving the search as a word.
    if (phone) await page.evaluate(() => document.activeElement?.blur())
    await page.getByRole('button', { name: /^(Romance|Fantasy)/ }).first().click()
    await expect(page.getByRole('button', { name: 'Clear filters' }), 'Clear filters appears once a tag is chosen').toBeVisible()
    const tagged = await read()
    check(tagged.clear && tagged.row === paused.row && (await page.locator('.line-words .chip').first().textContent()).includes('Clear filters'), `${name} offers Clear filters first among the line's words once a tag is chosen, and the line keeps its height (${paused.row} then ${tagged.row} px)`)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.getByRole('button', { name: 'Clear filters' }), 'and takes it away').toHaveCount(0)
    await expect.poll(() => new URL(page.url()).searchParams.has('tag') || new URL(page.url()).searchParams.has('with'), { message: 'and the tags go from the address' }).toBe(false)
    const cleared = await read()
    const address = new URL(page.url()).searchParams
    check(!cleared.clear && cleared.heading === typing.heading && (await fieldOf(page, field).inputValue()) === 'rom' && address.get('q') === 'rom' && cleared.row === paused.row, `Clear filters clears the tags and leaves the search (${cleared.heading}, "${await fieldOf(page, field).inputValue()}")`)
    // An empty result from the search alone offers to clear the search. One with tags too offers both, and each does its own part.
    await fieldOf(page, field).fill('zzzzzz')
    const buttons = () => page.evaluate(() => [...document.querySelectorAll('.empty-filter .btn')].map((b) => b.textContent.trim()))
    const alone = library ? 'Clear the search,Search the catalog' : 'Clear the search'
    await until(async () => (await buttons()).join() === alone, `${name}'s empty result from the search alone offers Clear the search`)
    if (phone) await page.evaluate(() => document.activeElement?.blur())
    await page.getByRole('button', { name: /^(Romance|Fantasy)/ }).first().click()
    await page.locator('.empty-filter').getByRole('button', { name: 'Clear filters' }).click()
    await expect(fieldOf(page, field), "Clear filters in the empty result leaves the search").toHaveValue('zzzzzz')
    await until(async () => (await read()).heading === (library ? '0 of 12' : 'All 0'), `${name}'s empty result says its count`)
    await page.getByRole('button', { name: 'Clear the search' }).first().click()
    await expect(fieldOf(page, field), "Clear the search clears the search").toHaveValue('')
    await expect.poll(() => new URL(page.url()).searchParams.has('q'), { message: 'and takes it out of the address' }).toBe(false)
    await until(async () => (await read()).heading === (library ? '12' : 'All 12'), `${name} says its whole count again`)
  })
}

// ---- the tags -----------------------------------------------------------------------------

/** Chooses a tag by its chip, or in All tags when the row is shorter (Clear filters takes the place of two chips). */
async function choose(page, tag) {
  // A phone's open field covers the line: the field closes first.
  await page.evaluate(() => document.activeElement?.blur?.())
  // Choosing moves the page and the row: look once they have settled.
  await quiet(page)
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
}

for (const [name, path, field] of SEARCH_PAGES) {
  test(`${name}: the tag chips, their counts and order, and All tags`, async ({ page }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch
    const chips = () => page.evaluate(() => [...document.querySelectorAll('.line-words .chip')].filter((c) => !c.textContent.includes('Clear filters') && !c.classList.contains('all')).map((c) => ({ label: c.querySelector('.u').childNodes[0].textContent.trim(), n: Number(c.querySelector('.n')?.textContent), dim: c.classList.contains('dim'), on: c.getAttribute('aria-pressed') === 'true', width: c.getBoundingClientRect().width })))
    const order = (list) => list.map((c) => c.label).join(', ')
    await ready(page, path)
    const before = await chips()
    check(before.length >= 6 && before.every((c) => Number.isInteger(c.n)), `${name}'s tag chips show counts (${before.slice(0, 4).map((c) => `${c.label} ${c.n}`).join(', ')})`)
    // A search leaves the chips where they are and counts what it finds. A chip nothing would show is dim.
    await fieldOf(page, field).click()
    await page.keyboard.type('moon')
    await until(async () => (await chips()).some((c) => c.dim), 'the chips count what the search finds')
    const during = await chips()
    check(order(during) === order(before), `${name}'s chips keep their order while a search is typed`)
    const total = during.reduce((n, c) => n + c.n, 0)
    check(during.some((c) => c.n < before.find((b) => b.label === c.label).n) && during.some((c) => c.n === 0 && c.dim) && during.every((c) => c.dim === (c.n === 0)), `${name}'s chips count what the search finds (${during.map((c) => `${c.label} ${c.n}`).join(', ')}) and dim the empty ones`)
    check(total > 0 && Math.max(...during.map((c, i) => Math.abs(c.width - before[i].width))) <= 12, `${name}'s chips hardly change width while the counts do (${Math.max(...during.map((c, i) => Math.abs(c.width - before[i].width))).toFixed(1)} px)`)
    await fieldOf(page, field).fill('')
    await until(async () => order(await chips()) === order(before) && (await chips()).every((c, i) => c.n === before[i].n), 'the counts are the whole list again')
    // Selected chips come first, and the Library takes more than one tag: a game must have all.
    await choose(page, 'Drama')
    await choose(page, 'Mystery')
    const picked = await chips()
    const selected = picked.filter((c) => c.on)
    check(selected.length >= 1 && picked.slice(0, selected.length).every((c) => c.on), `${name}'s selected chips come first (${order(picked.slice(0, 3))})`)
    // A row that scrolls sideways on a phone goes back to its start, where the chosen chips now are.
    check(await page.evaluate(() => document.querySelector('.line-words').scrollLeft === 0), `${name}'s line of words shows its start, with the chosen chips, after a tag is chosen`)
    if (name === 'the Library') {
      const tagsInAddress = new URL(page.url()).searchParams.get('tag')?.split(',') ?? []
      const titles = await titlesOf(page)
      check(tagsInAddress.length === 2 && titles.length >= 1 && titles.length < 4, `the Library takes two tags and keeps them in the address (${tagsInAddress.join(', ')}: ${titles.join(', ')})`)
    }
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0)
    await quiet(page)
    // All tags, at the right end of the line's words on both pages, opens every tag with its count. The Library only includes.
    const allTags = page.getByRole('button', { name: 'All tags' })
    const rowBox = await page.locator('.line-words').boundingBox()
    const inset = await page.locator('.line-words').evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingRight))
    const buttonBox = await allTags.boundingBox()
    check(buttonBox.x + buttonBox.width >= rowBox.x + rowBox.width - inset - 2 && (await page.locator('.line-words > :last-child').textContent()) === 'All tags', `${name}'s All tags is the last of the line's words, at its right end`)
    await (touch ? allTags.tap() : allTags.click())
    const sheet = page.getByRole('dialog', { name: 'Tags' })
    await sheet.waitFor()
    const rows = await sheet.locator('.list .row.between').evaluateAll((els) => els.map((e) => e.firstElementChild.textContent.trim()))
    check(rows.length >= 6 && rows.every((r) => /\s\d+$/.test(r)), `${name}'s All tags lists every tag with its count (${rows.length} tags, ${rows.slice(0, 3).join(', ')})`)
    const leaveOut = await sheet.getByRole('button', { name: 'Leave out' }).count()
    check(name === 'the Library' ? leaveOut === 0 : leaveOut === rows.length, `${name}'s All tags ${name === 'the Library' ? 'only includes tags' : 'includes or leaves out each tag'}`)
    const fits = await sheet.evaluate((el) => { const box = el.getBoundingClientRect(); return [...el.querySelectorAll('button')].every((b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0 && r.height >= 30 }) && box.width <= innerWidth })
    check(fits, `${name}'s All tags fits the screen`)
    for (const tag of ['Fantasy', 'Mystery']) {
      const include = sheet.locator('.row.between', { hasText: new RegExp(`^${tag}`) }).getByRole('button', { name: 'Include' })
      await (touch ? include.tap() : include.click())
    }
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
    await until(async () => (await chips()).filter((c) => c.on).map((c) => c.label).sort().join() === 'Fantasy,Mystery', 'the chosen tags are on the chips')
    const chosen = await chips()
    const titles = await titlesOf(page)
    check(chosen.filter((c) => c.on).map((c) => c.label).sort().join() === 'Fantasy,Mystery' && titles.join() === 'Moonlight Library', `${name}: tags chosen in All tags are on the chips, and a game must have all of them (${chosen.filter((c) => c.on).map((c) => c.label)}: ${titles.join(', ')})`)
  })
}
