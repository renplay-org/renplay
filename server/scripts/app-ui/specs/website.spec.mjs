// The website (website/, built here from a made-up catalog), in a browser. Each test runs in the project that shows its behaviour (only()):
// chromium-desktop for the hand (the lantern, the screens that wake, the scene, the credits, the catalog) and webkit-portrait for the
// touch (picking the phone up, targets of 44 px); the weight of the first screen in both. The other projects see the same page.
import { test as base, expect } from '@playwright/test'
import { catalog, cover, demoPage, website } from '../website-fixture.mjs'

const SCENE = [
  'The window turns violet and the house goes quiet.',
  'Somewhere in this room your story is still open, exactly where you left it. Every save is already on your own server.',
  'You have a few screens and one evening. Which do you reach for?',
]
const AFTER = 'The screen wakes on the very line you stopped at.'

let site
base.beforeAll(async () => { site = await website({ adult: 4 }) })
base.afterAll(async () => { await site?.close() })

/** Runs in this project only, and says why the others add nothing: the same page, a size or an input that shows nothing new. */
const only = (testInfo, project, why) => base.skip(testInfo.project.name !== project, why)

const test = base.extend({
  // Nothing leaves the machine: the demo is a stand-in page, the covers are flat pictures, the catalog's index is the made-up one.
  page: async ({ page }, use) => {
    const errors = [], asked = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
    await page.route('**/*', (route) => (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(route.request().url()) ? route.fallback() : route.abort('blockedbyclient')))
    await page.route('https://demo.renplay.org/**', (route) => { asked.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: demoPage }) })
    await page.route('http://127.0.0.1:59999/**', (route) => { asked.push(route.request().url()); return route.fulfill({ contentType: 'image/svg+xml', body: cover('#586dda') }) })
    await page.route('https://catalog.renplay.org/**', (route) => {
      asked.push(route.request().url())
      return route.fulfill({ json: route.request().url().endsWith('index.v4.json') ? site.full : site.sfw })
    })
    page.asked = asked
    await use(page)
    expect(errors, 'No page errors').toEqual([])
  },
})

const home = (page, path = '/') => page.goto(`${site.origin}${path}`)
const scrollTo = (page, top) => page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), top)
const wakeOf = (page, name) => page.locator(`.dev[data-dev="${name}"]`).evaluate((el) => Number(el.style.getPropertyValue('--w') || getComputedStyle(el).getPropertyValue('--w')))
/** The middle of each device's glass on the screen, as the page itself finds it for the light. */
const glass = (page) => page.evaluate(() => {
  const r = window.RENPLAY_ROOMS[matchMedia('(max-aspect-ratio: 1/1)').matches ? 'tall' : 'wide']
  const sr = document.getElementById('stage').getBoundingClientRect()
  return Object.fromEntries(['laptop', 'tablet', 'phone'].map((n) => [n, [sr.left + ((r[n].q[0][0] + r[n].q[2][0]) / 2) * sr.width / r.w, sr.top + ((r[n].q[0][1] + r[n].q[2][1]) / 2) * sr.height / r.h]]))
})

test('the scene says its three lines, asks, and the screen that is picked wakes and stays on', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The scene is the same on every screen, and the hand and keyboard are what this test uses')
  await home(page)
  await page.mouse.move(2, 2)
  const scene = page.locator('#scene')
  await expect(scene).toHaveAttribute('data-scene', 'line')
  await expect(page.locator('#typed .t')).toContainText(SCENE[0])
  await scene.focus()
  for (const line of SCENE.slice(1)) {
    await page.keyboard.press('Space')
    // A press while a line is still being typed finishes it, so a line is said once it shows whole.
    await expect(page.locator('#typed .t')).toContainText(line)
  }
  await expect(scene).toHaveAttribute('data-scene', 'choice')
  await expect(page.locator('#choices a')).toHaveCount(3)
  for (const name of ['laptop', 'tablet', 'phone']) await expect.poll(() => wakeOf(page, name), { message: `The ${name} is dark before the choice` }).toBeLessThan(0.05)
  await page.keyboard.press('2')
  await expect(scene).toHaveAttribute('data-scene', 'after')
  await expect.poll(() => wakeOf(page, 'tablet'), { message: 'The screen picked is lit' }).toBeGreaterThan(0.95)
  for (const name of ['laptop', 'phone']) expect(await wakeOf(page, name), `The ${name} stays dark`).toBeLessThan(0.05)
  await expect(page.locator('#typed .t')).toContainText(AFTER)
  await expect(scene).not.toHaveAttribute('data-typing', '1')
  expect(await page.evaluate(() => sessionStorage.getItem('renplay-device'))).toBe('tablet')
  // The hand no longer wakes the others: the choice is made.
  const at = await glass(page)
  await page.mouse.move(...at.laptop)
  await page.waitForTimeout(500)
  expect(await wakeOf(page, 'laptop')).toBeLessThan(0.05)
  await page.mouse.click(700, 300)
  await expect(scene).toHaveAttribute('data-scene', 'menu')
  await expect(page.locator('#menu a')).toHaveCount(4)
  await expect(page.locator('#menu')).toBeVisible()
  await page.locator('#replay').click()
  await expect(scene).toHaveAttribute('data-scene', 'line')
  await expect.poll(() => wakeOf(page, 'tablet'), { message: 'Replaying puts the screen out' }).toBeLessThan(0.05)
})

test('a click finishes the line being typed, and a link of the choice is a link', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The same on every screen: the typing and the click are the page\'s own')
  await home(page)
  await expect(page.locator('#scene')).toHaveAttribute('data-typing', '1')
  await page.mouse.click(600, 300)
  await expect(page.locator('#scene')).not.toHaveAttribute('data-typing', '1')
  await expect(page.locator('#typed .t')).toContainText(SCENE[0])
  // A screen reader is told each line as it is said, in the story's live region.
  await expect(page.locator('#story p')).toHaveText(SCENE[0])
})

test('a screen wakes as the light comes near it and goes dark when the light leaves', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The hand is a mouse here, and a finger on a phone drags the same light')
  await home(page)
  await page.mouse.move(2, 2)
  const at = await glass(page)
  for (const name of ['laptop', 'tablet', 'phone']) await expect.poll(() => wakeOf(page, name), { message: `The ${name} starts dark` }).toBeLessThan(0.05)
  for (const name of ['laptop', 'tablet', 'phone']) {
    await page.mouse.move(...at[name], { steps: 6 })
    await expect.poll(() => wakeOf(page, name), { message: `The ${name} wakes under the light` }).toBeGreaterThan(0.6)
    for (const other of ['laptop', 'tablet', 'phone'].filter((n) => n !== name)) await expect.poll(() => wakeOf(page, other), { message: `The ${other} is not woken by the ${name}'s light` }).toBeLessThan(0.3)
  }
  await page.mouse.move(2, 2, { steps: 6 })
  for (const name of ['laptop', 'tablet', 'phone']) await expect.poll(() => wakeOf(page, name), { message: `The ${name} goes dark again` }).toBeLessThan(0.05)
})

test('the demo plays in place with no key, and a save in one frame refreshes the other', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'A large screen plays the demo in the page, nothing takes it over')
  await home(page)
  await expect(page.locator('#duo')).toHaveAttribute('data-fitted', '')
  await expect(page.locator('#laptop-frame')).not.toHaveAttribute('src', /./)
  await page.locator('#duo').scrollIntoViewIfNeeded()
  for (const name of ['laptop', 'phone']) {
    await expect(page.locator(`#${name}-frame`)).toHaveAttribute('src', `https://demo.renplay.org/game/the-question?embed=${name}`)
    await expect(page.locator(`#${name}-screen`)).toHaveClass(/ready/)
  }
  expect(await page.locator('html').getAttribute('class')).not.toMatch(/taken|handheld/)
  await expect(page.locator('#open-demo')).toHaveAttribute('href', 'https://demo.renplay.org/')
  const laptop = page.frameLocator('#laptop-frame'), phone = page.frameLocator('#phone-frame')
  await expect(page.locator('#after-demo')).not.toHaveClass(/show/)
  await laptop.locator('#save').click()
  await expect(page.locator('#after-demo')).toHaveClass(/show/)
  await expect(page.locator('#live-text')).toHaveText('Saved. Look at the phone.')
  await expect.poll(() => phone.locator('body').evaluate(() => window.received)).toContain('renplay-embed:refresh')
  await expect(phone.locator('#save')).toBeVisible()
})

test('when the demo cannot be reached the posters stay and say so', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The message and the poster are the same on every screen')
  await page.route('https://demo.renplay.org/**', (route) => route.abort('connectionrefused'))
  await home(page)
  await page.locator('#duo').scrollIntoViewIfNeeded()
  await expect(page.locator('#laptop-screen')).toHaveClass(/late/, { timeout: 10000 })
  await expect(page.locator('#laptop-screen .wait')).toBeVisible()
  await expect(page.locator('#laptop-screen .wait')).toContainText('could not be reached')
  await expect(page.locator('#laptop-screen .poster')).toBeVisible()
  await expect(page.locator('#live-text')).toHaveText('The demo could not be reached just now.')
  await expect(page.locator('#laptop-screen .wait a')).toHaveAttribute('href', 'https://demo.renplay.org/')
})

test('the credits are drawn by the scroll: empty below, complete at the end, and back down again', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The roll follows the page\'s own scroll, which is the same on every screen')
  await home(page)
  const height = page.viewportSize().height
  /** How much of the roll is drawn: 0 when it is below its window, 1 when it sits in it. */
  const drawn = () => page.evaluate(() => {
    const roll = document.getElementById('roll').getBoundingClientRect(), win = document.getElementById('roll-window').getBoundingClientRect()
    return 1 - (roll.top - win.top) / roll.height
  })
  const windowTop = await page.evaluate(() => document.getElementById('roll-window').getBoundingClientRect().top + scrollY)
  // As the window comes up from the bottom of the screen the roll is not drawn yet.
  await scrollTo(page, windowTop - height * 0.97)
  await expect.poll(drawn, { message: 'Empty as its window comes in' }).toBeLessThan(0.1)
  await scrollTo(page, windowTop - height * 0.5)
  await expect.poll(drawn, { message: 'Part of the way as the window rises' }).toBeGreaterThan(0.25)
  expect(await drawn()).toBeLessThan(0.95)
  // At the end of the page it is complete.
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  await expect.poll(drawn, { message: 'Complete at the end of the page' }).toBeGreaterThan(0.97)
  // Coming back up empties it again: it is the scroll that draws it, not a timer.
  await scrollTo(page, windowTop - height * 0.97)
  await expect.poll(drawn, { message: 'Empty again as the page goes back up' }).toBeLessThan(0.1)
})

test('with the keyboard, a link in the credits opens the roll', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'Keyboard focus works the same on every screen')
  await home(page)
  await scrollTo(page, 0)
  await page.locator('#roll a').first().focus()
  await expect.poll(() => page.evaluate(() => { const r = document.getElementById('roll').getBoundingClientRect(), w = document.getElementById('roll-window').getBoundingClientRect(); return Math.abs(r.top - w.top) < 8 })).toBe(true)
})

test('the shelf moves with its arrows and is lit by the game in its middle', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The arrows are for a mouse and a keyboard, and a finger moves the shelf itself')
  await home(page)
  const shelf = page.locator('#shelf')
  await shelf.scrollIntoViewIfNeeded()
  const before = await shelf.evaluate((el) => el.scrollLeft)
  await page.locator('#shelf-next').click()
  await expect.poll(() => shelf.evaluate((el) => el.scrollLeft), { message: 'The shelf has moved on' }).toBeGreaterThan(before + 100)
  const lit = () => page.evaluate(() => {
    const wrap = document.querySelector('.shelf-wrap'), list = document.getElementById('shelf'), box = list.getBoundingClientRect()
    const middle = [...list.children].sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.offsetWidth / 2 - (box.left + box.width / 2)) - Math.abs(b.getBoundingClientRect().left + b.offsetWidth / 2 - (box.left + box.width / 2)))[0]
    return wrap.style.getPropertyValue('--tint') === middle.dataset.tint
  })
  await expect.poll(lit, { message: 'The light behind the shelf is the colour of the game in its middle' }).toBe(true)
  await page.locator('#shelf-prev').click()
  await expect.poll(() => shelf.evaluate((el) => el.scrollLeft)).toBeLessThan(before + 100)
  await expect(page.locator('#shelf .card a').first()).toHaveAttribute('href', /^\/catalog\/game-\d+\/$/)
})

test('every control the keyboard reaches shows where it is', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'Keyboard focus is the same on every screen')
  await home(page)
  const seen = []
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab')
    const at = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body || el.closest('iframe')) return null
      const style = getComputedStyle(el)
      const shown = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'
      return { what: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} "${el.textContent.trim().slice(0, 24)}"`, shown, scene: el.id === 'scene' }
    })
    if (at && !seen.some((s) => s.what === at.what)) seen.push(at)
  }
  expect(seen.length, 'The keyboard reaches the header, the scene, the demo, the shelf, the install section and the answers').toBeGreaterThan(25)
  expect(seen.filter((s) => !s.shown && !s.scene).map((s) => s.what), 'Each has a ring (the scene takes keys, and is not outlined)').toEqual([])
})

test('the catalog finds a game by its name, and its card leads to the game\'s page', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The same on every screen: the page is drawn by the build and read by the browser')
  await home(page, '/catalog/')
  await expect(page.locator('#games .card')).toHaveCount(14)
  await expect(page.locator('#count')).toHaveText('14 games')
  await page.locator('#q').fill('game 3')
  await expect(page.locator('#games .card')).toHaveCount(1)
  await page.locator('#games .card a').click()
  await expect(page).toHaveURL(/\/catalog\/game-3\/$/)
  await expect(page.locator('h1')).toHaveText('Game 3')
  await expect(page.locator('.crumbs')).toContainText('Catalog')
})

test('the age question comes first, and no adult cover is asked for until it is shown', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The same on every screen: the question and the blur are the page\'s own')
  await page.goto(`${site.adultOrigin}/`)
  await expect(page.locator('h1')).toHaveText('Are you 18 or older?')
  await expect(page.locator('.after-gate')).toBeHidden()
  expect(page.asked.filter((u) => u.includes('catalog.renplay.org')), 'Nothing is fetched before the answer').toEqual([])
  await page.locator('#yes').click()
  await expect(page.locator('#games .card')).toHaveCount(14)
  const adults = site.full.games.filter((g) => g.nsfw).map((g) => g.id)
  expect(adults.length).toBeGreaterThan(0)
  await page.waitForTimeout(400)
  for (const id of adults) {
    expect(page.asked.some((u) => u.includes(`/${id}.jpg`)), `The cover of ${id} is not asked for`).toBe(false)
    await expect(page.locator(`button[data-id="${id}"] .cover.blurred`)).toHaveCount(1)
    await expect(page.locator(`button[data-id="${id}"] img[src^="http"]`)).toHaveCount(0)
  }
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('a missing page answers 404 with its own page, and is not indexed', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The same on every screen')
  const response = await home(page, '/not-a-page/')
  expect(response.status()).toBe(404)
  await expect(page.locator('h1')).toContainText('This page is not here.')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
})

test('picking the phone up fills the window, and every way out puts it back where the page was', async ({ page }, testInfo) => {
  only(testInfo, 'webkit-portrait', 'Picking up is for a narrow touch screen')
  await home(page)
  await expect(page.locator('html')).toHaveClass(/handheld/)
  await page.locator('#phone').scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const before = await page.evaluate(() => Math.round(scrollY))
  expect(before).toBeGreaterThan(300)
  await expect(page.locator('#phone-cap')).toHaveText('Tap the phone to pick it up')
  const ways = [
    ['the button', () => page.locator('#demo-back').tap()],
    ['Esc', () => page.keyboard.press('Escape')],
    ['the browser\'s Back', () => page.goBack()],
  ]
  for (const [name, out] of ways) {
    await page.locator('#pickup').tap()
    await expect(page.locator('html')).toHaveClass(/taken/)
    await expect(page.locator('html')).not.toHaveClass(/rising/)
    const box = await page.locator('#demo-stage').boundingBox()
    const view = page.viewportSize()
    expect(Math.round(box.width), `Up, the screen is the window's width (${name})`).toBe(view.width)
    expect(Math.round(box.height), `Up, the screen is the window's height (${name})`).toBe(view.height)
    await expect(page.frameLocator('#phone-frame').locator('#save')).toBeVisible()
    await out()
    await expect(page.locator('html')).not.toHaveClass(/taken/)
    await expect.poll(() => page.evaluate(() => Math.round(scrollY)), { message: `The page is where it was after ${name}` }).toBeGreaterThan(before - 3)
    expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThan(before + 3)
    await expect(page.locator('#pickup')).toBeVisible()
  }
})

test('on a phone the page scrolls over the demo frame, and a save in it is shown in the card once the phone is put down', async ({ page }, testInfo) => {
  only(testInfo, 'webkit-portrait', 'The card and the inert frame are for a narrow touch screen')
  await home(page)
  await page.locator('#phone').scrollIntoViewIfNeeded()
  await expect(page.locator('#phone-screen')).toHaveClass(/ready/)
  expect(await page.locator('#phone-frame').evaluate((f) => getComputedStyle(f).pointerEvents)).toBe('none')
  expect(await page.locator('#laptop-frame').getAttribute('src')).toBeNull()
  await page.locator('#pickup').tap()
  await expect(page.locator('html')).toHaveClass(/taken/)
  // The screen rises for half a second, and a finger put down on it in that time lands on a moving thing.
  await expect(page.locator('html')).not.toHaveClass(/rising/)
  await page.frameLocator('#phone-frame').locator('#save').tap()
  await expect(page.locator('#card-state')).toContainText('Continue')
  await page.locator('#demo-back').tap()
  await expect(page.locator('#card-state')).toContainText('Continue')
})

test.describe('with less motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the scene is said at once, the credits are a still list and the demo is a plain switch', async ({ page }, testInfo) => {
    only(testInfo, 'webkit-portrait', 'Reduced motion is a setting of the device, shown here on the phone')
    await home(page)
    await expect(page.locator('#typed .t')).toContainText(SCENE[0])
    await expect(page.locator('#scene')).not.toHaveAttribute('data-typing', '1')
    expect(await page.locator('#roll').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    expect(await page.locator('.ripple').count()).toBe(0)
    await page.locator('#phone').scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    const before = await page.evaluate(() => Math.round(scrollY))
    await page.locator('#pickup').tap()
    await expect(page.locator('html')).toHaveClass(/taken/)
    expect(await page.locator('html').getAttribute('class')).not.toMatch(/rising/)
    await page.locator('#demo-back').tap()
    await expect(page.locator('html')).not.toHaveClass(/taken/)
    expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(3)
  })
})

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false })

  test('the story, the choices, the menu, both commands, the answers and the links to the demo are all in the page', async ({ page }, testInfo) => {
    only(testInfo, 'webkit-portrait', 'What a page says without scripts does not depend on the screen')
    await home(page)
    await expect(page.locator('h1')).toContainText('Renplay')
    await expect(page.locator('#story p')).toHaveText(SCENE)
    for (const p of await page.locator('#story p').all()) await expect(p).toBeVisible()
    await expect(page.locator('#choices a')).toHaveCount(3)
    for (const a of await page.locator('#choices a, #menu a').all()) await expect(a).toBeVisible()
    await expect(page.locator('.define')).toContainText('self-hosted player for Ren’Py games in the browser')
    for (const pre of await page.locator('.code pre').all()) await expect(pre).toBeVisible()
    await expect(page.locator('.code pre').first()).toContainText('docker run -d --name renplay')
    await expect(page.locator('.code pre').nth(1)).toContainText('image: ghcr.io/renplay-org/renplay:latest')
    await expect(page.locator('details')).toHaveCount(9)
    // The laptop is a card on a phone: only the phone's poster is drawn, and the card that says what the demo is for is not (it needs the page's script).
    await expect(page.locator('#phone-screen .poster')).toBeVisible()
    await expect(page.locator('#livecard')).toBeHidden()
    await expect(page.locator('#pickup')).toHaveAttribute('href', 'https://demo.renplay.org/game/the-question')
    await expect(page.locator('#after-demo a').nth(1)).toHaveAttribute('href', 'https://demo.renplay.org/')
    // The header's links are on the page, since the Menu button needs a script.
    for (const a of await page.locator('#nav-links a').all()) await expect(a).toBeVisible()
    await expect(page.locator('#menu-btn')).toBeHidden()
    await expect(page.locator('#roll dd').first()).toBeVisible()
    for (const a of await page.locator('#roll a').all()) await expect(a).toBeVisible()
    await expect(page.locator('#shelf .card a').first()).toHaveAttribute('href', /^\/catalog\/game-\d+\/$/)
  })
})

test('the first screen is light enough to open on a phone: at most 700 KB on a desktop and 450 KB on a phone', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'webkit-portrait'
  only(testInfo, phone ? 'webkit-portrait' : 'chromium-desktop', 'Weighed at the two sizes the design names, on the screen each is made for')
  let bytes = 0
  const seen = []
  page.on('response', async (r) => {
    const body = await r.body().catch(() => null)
    // What is downloaded: the length the server sends, which is the compressed one for text.
    if (body && r.url().startsWith(site.origin)) { const sent = Number(r.headers()['content-length'] ?? body.length); bytes += sent; seen.push([r.url().replace(site.origin, ''), sent]) }
  })
  await home(page)
  await page.waitForLoadState('load')
  await page.waitForTimeout(2500)
  const budget = phone ? 450e3 : 700e3
  expect(bytes, `The first screen weighs ${Math.round(bytes / 1000)} KB: ${seen.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([u, n]) => `${u} ${n}`).join(', ')}`).toBeLessThan(budget)
  // Nothing of the demo is asked for until its section is near.
  expect(page.asked.filter((u) => u.includes('demo.renplay.org'))).toEqual([])
})

test('on a phone every control is at least 44 px, in the page and in the menu', async ({ page }, testInfo) => {
  only(testInfo, 'webkit-portrait', 'A touch screen is where a target has to be big enough')
  await home(page)
  // A control is a button, a menu line, a tab or a link that stands on its own. A link in the middle of a sentence is not one.
  const small = () => page.evaluate(() => [...document.querySelectorAll('.btn, .links a, .menu a, .choices a, .tabs button, .platforms a, summary, .shelf-ctl button, .foot-links a, .page-foot .row a, .menu-btn, .back, .replay, .chip-btn, .crumb, .recipe-link, .pickup')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width && r.height && getComputedStyle(el).visibility !== 'hidden' && r.height < 43.5)
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${el.className || el.id} "${el.textContent.trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`))
  expect(await small(), 'The first screen').toEqual([])
  await page.locator('#menu-btn').tap()
  await expect(page.locator('#nav')).toHaveClass(/open/)
  expect(await small(), 'The menu').toEqual([])
  await page.locator('#menu-btn').tap()
  expect(await small(), 'The whole page').toEqual([])
})
