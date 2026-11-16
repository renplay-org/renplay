import sharp from 'sharp'
import { test, expect, open, settled } from './fixtures.mjs'
import { mock } from '../../app-mock.mjs'

// The Library's and the Catalog's toolbar is one 52 px line: the search, the tags as words, the sort (the Catalog's states
// first). On a phone the search is an icon that opens the field over the line. Stuck under the header, the header and the line
// are one solid area of ink with one hairline under it. Each test says one thing a person sees.

const PAGES = [
  ['Library', '/', 'Search your games'],
  ['Catalog', '/catalog', 'Search the catalog'],
]
const isPhone = (page) => page.viewportSize().width < 720

/** Scrolls until the toolbar is stuck under the header, with the page taller than the screen (130 made-up games). */
async function stick(page) {
  await page.evaluate(() => {
    const at = document.querySelector('.toolbar-top').getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(document.querySelector('.toolbar')).top)
    window.scrollTo({ top: at + 400, behavior: 'instant' })
  })
  await expect(page.locator('.toolbar-glass')).toHaveAttribute('data-stuck', '')
  await settled(page)
}

/** The glass and the header's own solid layer, as the eye meets them. */
const surfaces = (page) =>
  page.evaluate(() => {
    const glass = getComputedStyle(document.querySelector('.toolbar-glass'))
    const header = getComputedStyle(document.querySelector('.top'), '::after')
    return { glass: glass.backgroundColor, mask: glass.maskImage, glassOpacity: glass.opacity, shadow: glass.boxShadow, headerOpacity: header.opacity, headerShadow: header.boxShadow }
  })

/** The most a pixel of the band from the top of the screen to `height` is off the ink, with `hide` taken out of view. */
async function offInk(page, height, hide) {
  const style = await page.addStyleTag({ content: `${hide} { visibility: hidden !important }` })
  const { data, info } = await sharp(await page.screenshot({ clip: { x: 0, y: 0, width: page.viewportSize().width, height }, scale: 'css' })).raw().toBuffer({ resolveWithObject: true })
  await style.evaluate((el) => el.remove())
  const ink = [10, 10, 15]
  let most = 0
  for (let i = 0; i < data.length; i += info.channels) for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(data[i + c] - ink[c]))
  return most
}

for (const [name, path, label] of PAGES) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      // 130 made-up games, so the page is long enough to scroll with tiles under the line.
      await mock(page, [], 'line')
      await open(page, path)
      await settled(page)
    })

    test('the toolbar is one line of 52 px, at rest and stuck, holding the search, the words and the sort in a row', async ({ page }) => {
      const line = () =>
        page.evaluate(() => {
          const bar = document.querySelector('.toolbar.line')
          const box = bar.getBoundingClientRect()
          const parts = [bar.querySelector('.search-field .search-box'), bar.querySelector('.line-words'), bar.querySelector('.sort')].filter(Boolean)
          return { height: box.height, parts: parts.map((el) => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })), box: { top: box.top, bottom: box.bottom }, role: bar.getAttribute('role'), words: bar.querySelectorAll('.line-words .chip, .line-words .seg button').length }
        })
      const rest = await line()
      expect(rest.height, 'The line is 52 px').toBe(52)
      expect(rest.role).toBe('search')
      expect(rest.words, 'It holds words').toBeGreaterThanOrEqual(2)
      for (const part of rest.parts) {
        expect(part.top, 'Every part is inside the line').toBeGreaterThanOrEqual(rest.box.top - 0.5)
        expect(part.bottom).toBeLessThanOrEqual(rest.box.bottom + 0.5)
      }
      await stick(page)
      expect((await line()).height, 'The line is the same 52 px stuck').toBe(52)
    })

    test('stuck, the header and the line are one solid area of ink with one hairline under it, and nothing of the page reads through', async ({ page }) => {
      await stick(page)
      const looks = await surfaces(page)
      expect(looks.glass, 'The area is the ink, with no alpha').toBe('rgb(10, 10, 15)')
      expect(looks.mask, 'with no fade at its edge').toBe('none')
      expect(looks.glassOpacity).toBe('1')
      expect(looks.shadow, 'and one hairline under it').toMatch(/0px 1px 0px 0px/)
      expect(looks.headerOpacity, 'The header is solid too').toBe('1')
      expect(looks.headerShadow, 'and has no hairline of its own where the line is under it').toBe('none')
      const bottom = await page.evaluate(() => document.querySelector('.toolbar').getBoundingClientRect().bottom)
      for (const offset of [0, 140, 420]) {
        await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'instant' }), offset)
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
        expect(await offInk(page, Math.floor(bottom), '.top-in, .toolbar *'), `With the header's and the line's own marks taken away, the band is the ink at ${offset} px further`).toBeLessThanOrEqual(2)
      }
    })

    test('a filter that is on stays in the stuck line, lit, as a pressed word', async ({ page }) => {
      const word = page.locator('.line-words .chip', { hasText: /^(Romance|Fantasy|Drama)/ }).first()
      const text = (await word.textContent()).trim()
      await expect(word).toHaveAttribute('aria-pressed', 'false')
      await word.click()
      await expect(word, 'Pressing a tag presses it').toHaveAttribute('aria-pressed', 'true')
      await stick(page)
      const lit = page.locator('.line-words .chip[aria-pressed="true"]').first()
      await expect(lit, `${text} is still in the line, pressed, while stuck`).toBeVisible()
      const place = await lit.evaluate((el) => ({ box: el.getBoundingClientRect(), strip: document.querySelector('.toolbar-glass').getBoundingClientRect().bottom, header: document.querySelector('.top').getBoundingClientRect().bottom, line: getComputedStyle(el.querySelector('.u'), '::before').transform }))
      expect(place.box.top, 'It is under the header').toBeGreaterThanOrEqual(place.header - 0.5)
      expect(place.box.bottom, 'and inside the strip').toBeLessThanOrEqual(place.strip + 0.5)
      expect(place.line, 'with the lamp line drawn').toBe('matrix(1, 0, 0, 1, 0, 0)')
    })

    test('a word is underlined as wide as its text and no wider', async ({ page }) => {
      const word = page.locator('.line-words .chip', { hasText: /^(Romance|Fantasy|Drama)/ }).first()
      const sizes = await word.evaluate((el) => {
        const u = el.querySelector('.u')
        const range = document.createRange()
        range.selectNodeContents(u)
        return { u: u.getBoundingClientRect().width, text: range.getBoundingClientRect().width, line: Number.parseFloat(getComputedStyle(u, '::before').width) }
      })
      expect(Math.abs(sizes.u - sizes.text), 'The underlined box is the text').toBeLessThan(1)
      expect(Math.abs(sizes.line - sizes.u), 'and the line is that wide').toBeLessThan(1)
    })

    test('the field has a label, / opens it with focus, and the count and Clear filters are there', async ({ page }) => {
      const input = page.getByRole('textbox', { name: label })
      await expect(input, 'The field has a label').toHaveCount(1)
      await page.evaluate(() => document.activeElement?.blur())
      await page.keyboard.press('/')
      await expect(input, 'The opened field has focus').toBeFocused()
      if (isPhone(page)) {
        const box = await page.locator('.search-box').boundingBox()
        const line = await page.locator('.toolbar.line').boundingBox()
        expect(box.width, 'On a phone it opens over the whole line').toBeGreaterThan(line.width - 40)
      }
      await input.pressSequentially('mo')
      await expect(page.locator('.search-box .field-count'), 'The count says how many of all').toHaveText(/^\d+ of \d+$/)
      await page.keyboard.press('Escape')
      await page.evaluate(() => document.activeElement?.blur())
      await page.locator('.line-words .chip', { hasText: /^(Romance|Fantasy|Drama)/ }).first().click()
      await expect(page.locator('.line-words').getByRole('button', { name: 'Clear filters' }), 'Clear filters is in the line once a tag is on').toBeVisible()
    })

    test('All tags is the last word and opens every tag', async ({ page }) => {
      const all = page.getByRole('button', { name: 'All tags' })
      await expect(page.locator('.line-words > :last-child')).toHaveText('All tags')
      await all.click()
      await expect(page.getByRole('dialog', { name: 'Tags' })).toBeVisible()
    })
  })
}

test.describe('every page with a header', () => {
  for (const [name, path] of [['the Library', '/'], ['the Catalog', '/catalog'], ['a game page', '/game/game-000']]) {
    test(`${name}: at the top the header keeps its look, and once the page has scrolled it is solid ink with a hairline`, async ({ page }) => {
      await mock(page, [], 'line')
      await page.goto(path)
      await expect(page.locator('main')).toBeVisible()
      await settled(page)
      const header = () => page.evaluate(() => ({ opacity: getComputedStyle(document.querySelector('.top'), '::after').opacity, shadow: getComputedStyle(document.querySelector('.top'), '::after').boxShadow, stuck: document.documentElement.hasAttribute('data-bar-stuck') }))
      expect((await header()).opacity, 'At the top it is the header as it was').toBe('0')
      // The page's headings and its toolbar start below the header: nothing of them sits under it at rest.
      const under = await page.evaluate(() => { const bottom = document.querySelector('.top').getBoundingClientRect().bottom; return [...document.querySelectorAll('main .sec-h, main .toolbar[role="search"]')].filter((e) => e.getBoundingClientRect().top < bottom).map((e) => e.className) })
      expect(under, 'and nothing at rest sits under the header').toEqual([])
      await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' }))
      await expect.poll(async () => (await header()).opacity, { message: 'Scrolled, the header is solid' }).toBe('1')
      const solid = await header()
      if (!solid.stuck) expect(solid.shadow, 'with one hairline under it').toMatch(/0px 1px 0px 0px/)
      expect(await offInk(page, await page.evaluate(() => Math.floor(document.querySelector('.top').getBoundingClientRect().bottom)), '.top-in'), 'and nothing of the page reads through it').toBeLessThanOrEqual(2)
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await expect.poll(async () => (await header()).opacity, { message: 'Back at the top it goes back' }).toBe('0')
    })
  }
})

test.describe('a computer', () => {
  test.beforeEach(({ page }) => test.skip(isPhone(page), 'The phone has its own checks below'))

  test('the field is always shown, underlined, with its shortcut, beside the words and the sort', async ({ page }) => {
    await open(page, '/')
    await settled(page)
    const box = page.locator('.search-box')
    await expect(box).toBeVisible()
    const look = await box.evaluate((el) => ({ width: el.getBoundingClientRect().width, fill: getComputedStyle(el).backgroundColor, line: getComputedStyle(el, '::after').height }))
    expect(look.width, 'It is 300 px wide').toBe(300)
    expect(look.fill, 'with no fill').toBe('rgba(0, 0, 0, 0)')
    expect(look.line, 'and a hairline under it').toBe('1px')
    await page.locator('input').first().focus()
    expect(await box.evaluate((el) => getComputedStyle(el, '::after').height), 'The line is 2 px while it has focus').toBe('2px')
  })

  test('the line does not scroll with seven tags, and the Catalog has its states, a divider, then the tags, without a sort', async ({ page }) => {
    test.skip(page.viewportSize().width < 1200, 'A line with a 300 px field and seven tags scrolls on a narrower screen')
    await open(page, '/')
    await settled(page)
    expect(await page.locator('.line-words').evaluate((el) => el.scrollWidth - el.clientWidth), 'Nothing is cut off the Library line').toBeLessThanOrEqual(1)
    expect(await page.locator('.line-words').evaluate((el) => el.hasAttribute('data-more'))).toBe(false)
    await open(page, '/catalog')
    await settled(page)
    const order = await page.locator('.line-words > *').evaluateAll((els) => els.map((el) => (el.matches('.seg') ? 'states' : el.matches('.vr') ? 'divider' : el.matches('.chip.all') ? 'all' : el.matches('.chip') ? 'tag' : 'other')))
    expect(order.slice(0, 2), 'States, then a divider').toEqual(['states', 'divider'])
    expect(order.at(-1)).toBe('all')
    expect(new Set(order.slice(2, -1)), 'then tags').toEqual(new Set(['tag']))
    expect(await page.locator('.toolbar .sort').count(), 'The Catalog has no sort').toBe(0)
    const states = await page.locator('.line-words .seg button').allTextContents()
    expect(states.map((s) => s.replace(/\d+/, 'N'))).toEqual(['All N', 'Free', 'Completed'])
    await page.getByRole('button', { name: 'Free', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Free', exact: true }), 'A state is pressed like a tag').toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('a phone', () => {
  test.beforeEach(({ page }) => test.skip(!isPhone(page), 'A phone only'))

  /** What must not move when the field opens: the page's scroll, the line, the words, the first tile, the page's height. */
  const places = (page) =>
    page.evaluate(() => ({
      y: scrollY,
      line: document.querySelector('.toolbar.line').getBoundingClientRect().top,
      words: document.querySelector('.line-words').getBoundingClientRect().left,
      sort: document.querySelector('.sort')?.getBoundingClientRect().left ?? 0,
      tile: document.querySelector('.grid[data-row] .card').getBoundingClientRect().top,
      doc: document.documentElement.scrollHeight,
    }))

  test('the search is an icon 44 px wide that opens the field over the line, and nothing on the page moves', async ({ page }) => {
    await mock(page, [], 'line')
    await open(page, '/')
    await settled(page)
    const input = page.getByRole('textbox', { name: 'Search your games' })
    const closed = await page.locator('.search-box').boundingBox()
    expect(closed.width, 'Closed, it is an icon').toBe(44)
    expect(closed.height).toBe(44)
    await expect(page.locator('.search-box input'), 'whose text does not show').toHaveCSS('color', 'rgba(0, 0, 0, 0)')
    const before = await places(page)
    await page.evaluate(() => {
      window.__seen = []
      const read = () => window.__seen.push({ y: scrollY, line: document.querySelector('.toolbar.line').getBoundingClientRect().top, tile: document.querySelector('.grid[data-row] .card').getBoundingClientRect().top, doc: document.documentElement.scrollHeight })
      const tick = () => { read(); window.__tick = requestAnimationFrame(tick) }
      tick()
    })
    await input.tap()
    await expect(input, 'The opened field has focus').toBeFocused()
    await page.waitForTimeout(400)
    const seen = await page.evaluate(() => { cancelAnimationFrame(window.__tick); return window.__seen })
    const spread = (key) => Math.max(...seen.map((s) => s[key])) - Math.min(...seen.map((s) => s[key]))
    for (const key of ['y', 'line', 'tile', 'doc']) expect(spread(key), `${key} does not move on any frame while the field opens`).toBe(0)
    expect(await places(page), 'and everything stays where it was').toEqual(before)
    const opened = await page.locator('.search-box').boundingBox()
    expect(opened.width, 'The field has the whole line').toBeGreaterThan(300)
    expect(await page.locator('.line-words').evaluate((el) => getComputedStyle(el).visibility), 'The words under it are not drawn').toBe('hidden')
    await page.keyboard.press('Escape')
    await expect(input, 'Escape closes it').not.toBeFocused()
    expect((await page.locator('.search-box').boundingBox()).width).toBe(44)
    expect(await page.locator('.line-words').evaluate((el) => getComputedStyle(el).visibility), 'and the words are back').toBe('visible')
  })

  test('while the field holds text a word stays in the line, with a way to clear it, and tags and the search combine', async ({ page }) => {
    await open(page, '/')
    await settled(page)
    const input = page.getByRole('textbox', { name: 'Search your games' })
    await input.tap()
    await input.pressSequentially('mo')
    await expect(page.locator('.search-box .field-count'), 'The open field says the count and has a clear button').toHaveText(/^\d+ of \d+$/)
    await expect(page.getByRole('button', { name: 'Clear the search' }).first()).toBeVisible()
    await page.keyboard.press('Escape')
    const word = page.locator('.search-kept')
    await expect(word, 'The word is the query').toHaveText('“mo”')
    await expect(word, 'lit like a tag that is on').toHaveAttribute('aria-pressed', 'true')
    await expect(input).toHaveValue('mo')
    // A tag can be pressed beside it, and the two filter together.
    const shown = () => page.locator('.grid[data-row] .card').count()
    const searched = await shown()
    await page.locator('.line-words .chip', { hasText: /^(Romance|Fantasy|Drama|Mystery)/ }).first().tap()
    await expect.poll(shown, { message: 'a tag on top of the search narrows it' }).toBeLessThan(searched)
    expect(new URL(page.url()).searchParams.get('q'), 'The search is still in the address').toBe('mo')
    await word.tap()
    await expect(input, 'The word clears the search').toHaveValue('')
    await expect(word).toHaveCount(0)
    await expect(page.locator('.line-words .chip[aria-pressed="true"]'), 'and leaves the tag').toHaveCount(1)
  })

  test('stuck with a search kept, the line is the strip: the word, the tags and the sort stay in view', async ({ page }) => {
    await mock(page, [], 'line')
    await open(page, '/')
    await settled(page)
    const input = page.getByRole('textbox', { name: 'Search your games' })
    await input.tap()
    await input.pressSequentially('game')
    await page.keyboard.press('Escape')
    await stick(page)
    for (const [what, selector] of [['the search word', '.search-kept'], ['the tags', '.line-words'], ['the sort', '.sort']]) {
      const box = await page.locator(selector).boundingBox()
      const strip = await page.evaluate(() => document.querySelector('.toolbar-glass').getBoundingClientRect().bottom)
      expect(box.y + box.height, `${what} is inside the stuck strip`).toBeLessThanOrEqual(strip + 0.5)
      expect(box.y, `${what} is under the header`).toBeGreaterThan(40)
    }
  })

  test('with no tags in the library the field is simply shown', async ({ page }) => {
    await mock(page, [], 'line')
    await page.route('**/api/catalog', (route) => route.fulfill({ json: { status: { fetchedAt: Date.now(), urls: [], errors: [], count: 0, sources: [] }, vocabulary: {}, games: [] } }))
    // The games have no tags: the list's answer is read and its tags taken out.
    await page.addInitScript(() => {
      const ask = window.fetch
      window.fetch = async (...args) => {
        const answer = await ask(...args)
        if (!/\/api\/games(\?|$)/.test(String(args[0]?.url ?? args[0]))) return answer
        const body = await answer.json()
        return new Response(JSON.stringify({ ...body, games: body.games.map((g) => ({ ...g, tags: [], tagIds: [] })) }), { headers: { 'content-type': 'application/json' } })
      }
    })
    await open(page, '/')
    await settled(page)
    const box = await page.locator('.search-box').boundingBox()
    expect(box.width, 'The field is open, as wide as the line lets it').toBeGreaterThan(200)
    expect(await page.locator('.search-box input').evaluate((el) => getComputedStyle(el).color), 'with its text showing').not.toBe('rgba(0, 0, 0, 0)')
    expect(await page.locator('.line-words').count(), 'and there are no words').toBe(0)
    const input = page.getByRole('textbox', { name: 'Search your games' })
    await input.tap()
    await page.keyboard.type('ro')
    await page.keyboard.press('Escape')
    await expect(input, 'Escape clears it first, as on a computer').toHaveValue('')
  })

  test('the Catalog on a phone: the states, a divider and the tags scroll as one line, and its end fades', async ({ page }) => {
    await open(page, '/catalog')
    await settled(page)
    const line = page.locator('.line-words')
    expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth), 'More words than fit, so it scrolls').toBe(true)
    await expect(line, 'and its end fades').toHaveAttribute('data-more', '')
    await line.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }))
    await expect(line, 'once at the end, the fade is gone').not.toHaveAttribute('data-more', '')
    await expect(page.getByRole('button', { name: 'All tags' }), 'All tags is the last word').toBeVisible()
  })

  test('a word that takes focus is brought into the line', async ({ page }) => {
    await open(page, '/catalog')
    await settled(page)
    await page.getByRole('button', { name: 'All tags' }).focus()
    const inside = await page.evaluate(() => {
      const line = document.querySelector('.line-words').getBoundingClientRect()
      const word = document.activeElement.getBoundingClientRect()
      return word.left >= line.left - 1 && word.right <= line.right + 1
    })
    expect(inside, 'All tags is whole in the line').toBe(true)
  })
})
