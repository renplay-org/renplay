// The one search of the Library and the Catalog, in a browser, against the built library and a made-up API:
//   - one search per list, in the page's toolbar, as high as the control beside it, its shortcut shown on a desktop only
//   - it filters as you type, the address follows after a pause, / and Enter work as they should
//   - what a search finds and in what order: typos, accents, words in any order, developer and tag, the best match first
import { mock } from '../app-mock.mjs'
import { check, fieldOf, gridOf, isMain, isPhone, main, ready, SEARCH_PAGES, titlesOf } from './lib.mjs'

async function search(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label)
  const phone = isPhone(options)
  for (const [name, path, field, noun, , one] of SEARCH_PAGES) {
    await ready(page, base, path)
    const found = await page.evaluate((field) => {
      const inputs = [...document.querySelectorAll('input[type=text], input[type=search], input:not([type])')].filter((i) => i.getBoundingClientRect().width > 0)
      const input = document.querySelector(`input[aria-label="${field}"]`)
      const box = document.querySelector('.search-field')?.getBoundingClientRect()
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
        radius: getComputedStyle(document.querySelector('.search-field')).borderRadius,
        hint: !!hint && getComputedStyle(hint).display !== 'none',
        inLandmark: landmarks.some((l) => l.contains(input)),
        chipsInLandmark: landmarks.some((l) => l.querySelector('.chip-bar')),
        gridInLandmark: landmarks.some((l) => l.contains(document.querySelector('.grid[data-row]'))),
        shortcuts: input.getAttribute('aria-keyshortcuts'),
      }
    }, field)
    check(found.inputs === 1 && found.labelled === 1 && found.header === 0, `${label}: ${name} has one search and the header has none (${found.inputs} fields)`)
    check(found.placeholder === field && found.fits, `${label}: ${name}'s search says what it searches and the words fit (${found.room} px for "${found.placeholder}")`)
    check(found.height === found.beside && found.radius === '999px', `${label}: ${name}'s search is as high as the control beside it and a pill (${found.height} and ${found.beside} px, radius ${found.radius})`)
    check(found.hint === !phone, `${label}: ${name}'s shortcut hint is ${phone ? 'not shown on a phone' : 'shown on a desktop'}`)
    check(found.inLandmark && found.chipsInLandmark && !found.gridInLandmark, `${label}: ${name}'s field and tag chips are in a search landmark and the results are not`)
    check(/\//.test(found.shortcuts), `${label}: ${name}'s field names / as a shortcut (${found.shortcuts})`)

    // It filters as you type at once (the address follows after a pause, without a history entry per key).
    const before = (await gridOf(page)).tiles
    const entries = await page.evaluate(() => history.length)
    await fieldOf(page, field).click()
    await page.keyboard.type(one, { delay: 30 })
    await page.waitForTimeout(120)
    const after = (await gridOf(page)).tiles
    check(after > 0 && after < before, `${label}: ${name} filters as you type, before the address has caught up (${before} tiles, then ${after})`)
    await page.waitForTimeout(500)
    check(new URL(page.url()).searchParams.get('q') === one && (await page.evaluate(() => history.length)) === entries, `${label}: ${name}'s address follows the search and adds no history entries`)
    await page.click('.search-field .clear')
    await page.waitForTimeout(500)
    // The grid may have grown a batch: the toolbar is at the top then, and the end of the grid is near.
    check((await gridOf(page)).tiles >= before && !new URL(page.url()).searchParams.has('q'), `${label}: the clear button brings every game back`)

    // / goes to the search from anywhere but a field, and is just a letter inside one.
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('/')
    check(await page.evaluate((f) => document.activeElement?.getAttribute('aria-label') === f, field), `${label}: / focuses ${name}'s search`)
    await page.keyboard.type('a/b')
    check((await fieldOf(page, field).inputValue()) === 'a/b', `${label}: / typed inside the field stays text`)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    // The keyboard's Search key closes a phone's keyboard, so the results show. A desktop keeps its focus.
    await fieldOf(page, field).click()
    await page.keyboard.type(noun)
    await page.keyboard.press('Enter')
    const focused = await page.evaluate((f) => document.activeElement?.getAttribute('aria-label') === f, field)
    check(focused === !phone, `${label}: Enter in ${name}'s search ${phone ? 'closes the keyboard' : 'keeps the focus'}`)
    await fieldOf(page, field).fill('')
    await page.waitForTimeout(400)
  }
  // The Catalog's own filters are still there, and the Library has no All, Installed and Not installed picker.
  await page.goto(base + '/catalog')
  await page.waitForSelector('.grid[data-row] .card')
  const filters = await page.evaluate(() => ({ seg: [...document.querySelectorAll('.toolbar .seg button')].map((b) => b.textContent.trim()), tags: document.querySelectorAll('.chip').length }))
  check(filters.seg.length === 3 && filters.tags > 0, `${label}: the Catalog keeps its filters (${filters.seg.join(', ')}; ${filters.tags} tag chips)`)
  await page.goto(base + '/')
  await page.waitForSelector('.grid[data-row] .card')
  const picker = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^(Installed|Not installed)$/.test(t)))
  check(!picker.length, `${label}: the Library has no Installed and Not installed picker`)
  await ctx.close()
}

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

async function finds(browser, base, errors, options, label) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await mock(page, errors, label, { titled: true })
  const seen = []
  for (const [name, path, field] of SEARCH_PAGES) {
    await ready(page, base, path)
    const input = fieldOf(page, field)
    for (const [query, groups, why] of FINDS) {
      await input.fill(query)
      await page.waitForTimeout(150)
      const titles = await titlesOf(page)
      const empty = await page.evaluate(() => !!document.querySelector('.results .empty-filter'))
      const ok = inGroups(titles, groups) && empty === !groups.length
      check(ok, `${label}: ${name} finds "${query}" (${why}): ${titles.slice(0, 3).join(', ') || 'nothing'}${titles.length > 3 ? ` and ${titles.length - 3} more` : ''}`)
      seen.push(`${name} "${query}": ${titles.slice(0, 3).join(', ') || 'nothing'}`)
      if (name === 'the Library' && query === 'butterfy') {
        const marked = await page.evaluate(() => [...document.querySelectorAll('.card .ct mark')].map((m) => m.textContent))
        check(marked.join('') === 'Butterfl', `${label}: the matched letters of a title are marked (${marked.join(' | ')})`)
      }
      if (name === 'the Library' && query === 'soup butterfly') {
        const marked = await page.evaluate(() => [...document.querySelectorAll('.card .ct mark')].map((m) => m.textContent))
        check(marked.join(' ') === 'Butterfly Soup', `${label}: every word typed is marked in the title (${marked.join(' | ')})`)
      }
    }
    await input.fill('')
  }
  if (process.env.SHOW_FINDS) console.log(seen.join('\n'))

  // The order: best match while there is text, the sort control says so, and clearing returns to the chosen order.
  await ready(page, base, '/?sort=title')
  const chosen = await titlesOf(page)
  await fieldOf(page, 'Search your games').fill('ro')
  await page.waitForTimeout(150)
  const sortLabel = await page.evaluate(() => document.querySelector('.toolbar .sort')?.textContent.trim())
  check(sortLabel === 'Best match', `${label}: the sort control says Best match while there is text (${sortLabel})`)
  await fieldOf(page, 'Search your games').fill('')
  await page.waitForTimeout(150)
  const sortBack = await page.evaluate(() => document.querySelector('.toolbar .sort')?.textContent.trim())
  check(sortBack === 'Title' && (await titlesOf(page)).join() === chosen.join(), `${label}: clearing the field returns to the order chosen before (${sortBack})`)
  // Another order can still be picked for a search, and clearing forgets it.
  await fieldOf(page, 'Search your games').fill('o')
  await page.waitForTimeout(150)
  await page.click('.toolbar .sort')
  await page.getByRole('button', { name: 'Recently added', exact: true }).click()
  await page.waitForTimeout(150)
  check((await page.evaluate(() => document.querySelector('.toolbar .sort')?.textContent.trim())) === 'Recently added' && new URL(page.url()).searchParams.get('sort') === 'title', `${label}: another order can be picked for one search without changing the chosen one`)
  await fieldOf(page, 'Search your games').fill('')
  await page.waitForTimeout(150)
  check((await page.evaluate(() => document.querySelector('.toolbar .sort')?.textContent.trim())) === 'Title', `${label}: the order picked for a search ends with it`)
  await ctx.close()
}

export const tasks = ({ chrome, safari, base, errors, desktop, phone, iphone }) => [
  { name: 'search', label: 'desktop', run: () => search(chrome, base, errors, desktop, 'desktop') },
  { name: 'search', label: 'phone', run: () => search(chrome, base, errors, phone, 'phone') },
  { name: 'finds', label: 'desktop', run: () => finds(chrome, base, errors, desktop, 'desktop') },
  { name: 'finds', label: 'phone', run: () => finds(chrome, base, errors, phone, 'phone') },
  safari && { name: 'search', label: 'WebKit', run: () => search(safari, base, errors, iphone, 'phone (WebKit)') },
  safari && { name: 'finds', label: 'WebKit', run: () => finds(safari, base, errors, iphone, 'phone (WebKit)') },
]

if (isMain(import.meta.url)) await main([{ tasks }])
