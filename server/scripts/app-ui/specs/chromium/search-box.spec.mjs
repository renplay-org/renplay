// The one search of the Library and the Catalog, in a browser, against the built library and a made-up API:
//   - one search per list, in the page's toolbar line: an underlined field at least as high as the control beside it on a computer,
//     an icon that opens the field on a phone, its shortcut shown on a desktop only
//   - it filters as you type, the clear button and Enter work as they should (the address's timing is in specs/search.spec.mjs)
//   - what a search finds and in what order: typos, accents, words in any order, developer and tag, the best match first
import { test, expect, check, only } from '../fixtures.mjs'
import { fieldOf, gridOf, ready, SEARCH_PAGES, titlesOf } from '../helpers.mjs'

test.use({ mockOptions: {} })

for (const [name, path, field, noun, , one] of SEARCH_PAGES) {
  test(`${name}: one search, filtering as you type, a clear button and Enter`, async ({ page }, testInfo) => {
    const phone = !!testInfo.project.use.hasTouch
    await ready(page, path)
    const found = await page.evaluate((field) => {
      // The placeholder is read with the field open: on a phone it is an icon until it has focus.
      document.querySelector(`input[aria-label="${field}"]`).focus()
      const inputs = [...document.querySelectorAll('input[type=text], input[type=search], input:not([type])')].filter((i) => i.getBoundingClientRect().width > 0)
      const input = document.querySelector(`input[aria-label="${field}"]`)
      const box = document.querySelector('.search-box')?.getBoundingClientRect()
      const pill = document.querySelector('.toolbar .sort, .toolbar .seg')?.getBoundingClientRect()
      const hint = document.querySelector('.search-field .shortcut')
      // The placeholder, as wide as it is drawn, against the room the field leaves it.
      const style = getComputedStyle(input, '::placeholder')
      const ctx2 = document.createElement('canvas').getContext('2d')
      ctx2.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const room = input.clientWidth - Number.parseFloat(getComputedStyle(input).paddingLeft) - Number.parseFloat(getComputedStyle(input).paddingRight)
      const landmarks = [...document.querySelectorAll('[role="search"], search')]
      return {
        inputs: inputs.length,
        labelled: document.querySelectorAll(`input[aria-label="${field}"]`).length,
        placeholder: input.placeholder,
        fits: ctx2.measureText(input.placeholder).width <= room,
        room: Math.round(room),
        header: document.querySelectorAll('header .search, header button[aria-keyshortcuts]').length,
        height: box && Math.round(box.height),
        beside: pill && Math.round(pill.height),
        // A computer's field is the website's: one hairline under the text, no fill and no corners.
        underline: getComputedStyle(document.querySelector('.search-box'), '::after').height,
        fill: getComputedStyle(document.querySelector('.search-box')).backgroundColor,
        hint: !!hint && getComputedStyle(hint).display !== 'none',
        inLandmark: landmarks.some((l) => l.contains(input)),
        chipsInLandmark: landmarks.some((l) => l.querySelector('.line-words')),
        gridInLandmark: landmarks.some((l) => l.contains(document.querySelector('.grid[data-row]'))),
        shortcuts: input.getAttribute('aria-keyshortcuts'),
      }
    }, field)
    check(found.inputs === 1 && found.labelled === 1 && found.header === 0, `${name} has one search and the header has none (${found.inputs} fields)`)
    check(found.placeholder === field && found.fits, `${name}'s search says what it searches and the words fit (${found.room} px for "${found.placeholder}")`)
    check(found.height >= found.beside && found.height <= 52 && found.fill === 'rgba(0, 0, 0, 0)' && (phone || found.underline === '1px' || found.underline === '2px'), `${name}'s search is as high as the control beside it and fits the 52 px line, with no box${phone ? '' : ', one line under it'} (${found.height} and ${found.beside} px, ${found.underline} line)`)
    check(found.hint === !phone, `${name}'s shortcut hint is ${phone ? 'not shown on a phone' : 'shown on a desktop'}`)
    check(found.inLandmark && found.chipsInLandmark && !found.gridInLandmark, `${name}'s field and tag chips are in a search landmark and the results are not`)
    check(/\//.test(found.shortcuts), `${name}'s field names / as a shortcut (${found.shortcuts})`)

    // It filters as you type at once, before the address has caught up.
    const before = (await gridOf(page)).tiles
    await fieldOf(page, field).click()
    await page.keyboard.type(one)
    // The page has drawn two frames since the last key: the grid is already filtered, with no wait for the address.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    const after = (await gridOf(page)).tiles
    check(after > 0 && after < before, `${name} filters as you type, before the address has caught up (${before} tiles, then ${after})`)
    await page.click('.search-field .clear')
    // The grid may have grown a batch: the toolbar is at the top then, and the end of the grid is near.
    await expect.poll(async () => (await gridOf(page)).tiles, { message: `the clear button brings every game back (${before} tiles)` }).toBeGreaterThanOrEqual(before)
    await expect.poll(() => new URL(page.url()).searchParams.has('q'), { message: 'and takes the search out of the address' }).toBe(false)

    // The keyboard's Search key closes a phone's keyboard, so the results show. A desktop keeps its focus.
    await fieldOf(page, field).click()
    await page.keyboard.type(noun)
    await page.keyboard.press('Enter')
    const focused = await page.evaluate((f) => document.activeElement?.getAttribute('aria-label') === f, field)
    check(focused === !phone, `Enter in ${name}'s search ${phone ? 'closes the keyboard' : 'keeps the focus'}`)
  })
}

test("the Catalog keeps its filters, and the Library has no Installed and Not installed picker", async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The same on a phone: what is there, not where')
  await page.goto('/catalog')
  await page.waitForSelector('.grid[data-row] .card')
  const filters = await page.evaluate(() => ({ seg: [...document.querySelectorAll('.toolbar .seg button')].map((b) => b.textContent.trim()), tags: document.querySelectorAll('.chip').length }))
  check(filters.seg.length === 3 && filters.tags > 0, `the Catalog keeps its filters (${filters.seg.join(', ')}; ${filters.tags} tag chips)`)
  await page.goto('/')
  await page.waitForSelector('.grid[data-row] .card')
  const picker = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^(Installed|Not installed)$/.test(t)))
  check(!picker.length, 'the Library has no Installed and Not installed picker')
})

// ---- what a search finds, and in what order -------------------------------------------------------

/** The queries, and the titles each finds: best first, a group of titles of the same rank in any order. */
const FINDS = [
  ['ro', [['Rooftop Sunset'], ['Heroes of Rome'], ['Ripples']], 'a word start in a title, then the developer, and no Romance tag'],
  ['rom', [['Heroes of Rome'], ['Butterfly Soup', 'Starry Flowers', 'Café Enchanté', 'Paper Lanterns']], 'a title first, then the tag from three letters'],
  ['romance', [['Butterfly Soup', 'Starry Flowers', 'Café Enchanté', 'Paper Lanterns']], 'the tag as a whole word'],
  ['butterfy', [['Butterfly Soup']], 'one letter missing'],
  ['stary', [['Starry Flowers']], 'one letter missing, in the middle'],
  ['soup butterfly', [['Butterfly Soup']], 'words in any order'],
  ['brianna', [['Butterfly Soup']], 'a developer'],
  ['cafe enchante', [['Café Enchanté']], 'accents on both sides'],
  ['café', [['Café Enchanté']], 'an accent typed'],
  ['pokemon', [], 'nothing, like any word that is not there'],
  ['a', [['A Date with Death']], 'one letter starts a word only'],
  ['monsters', [['Dawn of the Monsters']], 'a word in the middle of a title'],
  ['zzzq', [], 'nothing'],
]

/** Whether `titles` is `groups`: the groups in order, each in any order. */
const inGroups = (titles, groups) => {
  if (titles.length !== groups.flat().length) return false
  let at = 0
  return groups.every((group) => {
    const part = titles.slice(at, (at += group.length))
    return part.length === group.length && group.every((t) => part.includes(t))
  })
}

test.describe('what a search finds', () => {
  test.use({ mockOptions: { titled: true } })

  for (const [name, path, field] of SEARCH_PAGES) {
    test(`${name}: what a search finds and in what order`, async ({ page }, testInfo) => {
      only(testInfo, 'chromium-desktop', 'What a search finds does not depend on the screen')
      await ready(page, path)
      const input = fieldOf(page, field)
      for (const [query, groups, why] of FINDS) {
        await input.fill(query)
        await expect.poll(async () => inGroups(await titlesOf(page), groups) && (await page.evaluate(() => !!document.querySelector('.results .empty-filter'))) === !groups.length, { message: `${name} finds "${query}" (${why})` }).toBe(true)
        if (name === 'the Library' && query === 'butterfy') {
          const marked = await page.evaluate(() => [...document.querySelectorAll('.card .ct mark')].map((m) => m.textContent))
          check(marked.join('') === 'Butterfl', `the matched letters of a title are marked (${marked.join(' | ')})`)
        }
        if (name === 'the Library' && query === 'soup butterfly') {
          const marked = await page.evaluate(() => [...document.querySelectorAll('.card .ct mark')].map((m) => m.textContent))
          check(marked.join(' ') === 'Butterfly Soup', `every word typed is marked in the title (${marked.join(' | ')})`)
        }
      }
    })
  }

  test('the best match comes first while there is text, the sort control says so, and clearing returns to the chosen order', async ({ page }, testInfo) => {
    only(testInfo, 'chromium-desktop', 'What a search finds does not depend on the screen')
    await ready(page, '/?sort=title')
    const chosen = await titlesOf(page)
    const sort = page.locator('.toolbar .sort')
    await fieldOf(page, 'Search your games').fill('ro')
    await expect(sort, 'the sort control says Best match while there is text').toHaveText('Best match')
    await fieldOf(page, 'Search your games').fill('')
    await expect(sort, 'clearing the field returns to the order chosen before').toHaveText('Title')
    expect(await titlesOf(page), 'and its order').toEqual(chosen)
    // Another order can still be picked for a search, and clearing forgets it.
    await fieldOf(page, 'Search your games').fill('o')
    await expect(sort).toHaveText('Best match')
    await page.click('.toolbar .sort')
    await page.getByRole('button', { name: 'Recently added', exact: true }).click()
    await expect(sort, 'another order can be picked for one search').toHaveText('Recently added')
    expect(new URL(page.url()).searchParams.get('sort'), 'without changing the chosen one').toBe('title')
    await fieldOf(page, 'Search your games').fill('')
    await expect(sort, 'the order picked for a search ends with it').toHaveText('Title')
  })
})
