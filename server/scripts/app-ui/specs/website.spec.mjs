// The website (website/, built here from a made-up catalog), in a browser. Each test runs in the project that shows its behaviour (only()):
// chromium-desktop for the hand (the lantern, the screens that wake, the scene, the demo in two frames, the credits, the catalog) and
// webkit-portrait for the phone (one scroll, the box that keeps its height, the demo as a link, targets of 44 px); the weight of the first
// screen in both. The other projects see the same page.
import { test as base, expect } from '@playwright/test'
import { catalog, cover, demoPage, website } from '../website-fixture.mjs'

const SCENE = [
  'Evening. The house is quiet, and the story you started at your desk is still open.',
  'Every save went to your own server the moment you made it.',
  'So, where do you pick it up?',
]
const AFTER = 'Same line, same place. That is Renplay.'
const DEMO = 'https://demo.renplay.org/'

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
/** The box of the scene: its height, and how wide the page is against the window. */
const boxHeight = (page) => page.locator('#dlg').evaluate((el) => Math.round(el.getBoundingClientRect().height))
const widths = (page) => page.evaluate(() => ({ html: document.documentElement.scrollWidth, body: document.body.scrollWidth, window: innerWidth }))
/** A tap on the room, inside the first screen and off its controls: the scene's own way to the next line. */
const next = (page) => page.touchscreen.tap(60, 520)
/** A new tab opened from the page sees the stand-in demo too, and nothing else: a page's routes do not reach a tab it opens. */
const routeTabs = (page) => page.context().route('**/*', (route) => (route.request().url().startsWith(DEMO) ? route.fulfill({ contentType: 'text/html', body: demoPage }) : route.abort('blockedbyclient')))
/** Says the whole scene with the keyboard: each line is finished by one press (a press while it types finishes it) and the next asked for by another. */
const sayAll = async (page) => {
  const scene = page.locator('#scene')
  await scene.focus()
  await expect(page.locator('#typed .t')).toContainText(SCENE[0].slice(0, 8))
  for (const line of SCENE.slice(1)) {
    await page.keyboard.press('Space')
    await page.keyboard.press('Space')
    await expect(page.locator('#typed .t')).toHaveText(line)
  }
  await expect(scene).toHaveAttribute('data-scene', 'choice')
}

test('the scene says its three lines, asks, the screen that is picked wakes and stays on, and Replay puts it out', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The scene is the same on every screen, and the hand and keyboard are what this test uses')
  await home(page)
  await page.mouse.move(2, 2)
  const scene = page.locator('#scene')
  await expect(scene).toHaveAttribute('data-scene', 'line')
  await expect(page.locator('#typed .t')).toContainText(SCENE[0])
  await sayAll(page)
  await expect(page.locator('#choices a')).toHaveCount(3)
  await expect(page.locator('#choices a').first()).toBeVisible()
  for (const name of ['laptop', 'tablet', 'phone']) await expect.poll(() => wakeOf(page, name), { message: `The ${name} is dark before the choice` }).toBeLessThan(0.05)
  await page.keyboard.press('2')
  await expect(scene).toHaveAttribute('data-scene', 'after')
  await expect.poll(() => wakeOf(page, 'tablet'), { message: 'The screen picked is lit' }).toBeGreaterThan(0.95)
  for (const name of ['laptop', 'phone']) expect(await wakeOf(page, name), `The ${name} stays dark`).toBeLessThan(0.05)
  await page.keyboard.press('Space')
  await expect(scene).not.toHaveAttribute('data-typing', '1')
  await expect(page.locator('#typed .t')).toHaveText(AFTER)
  expect(await page.evaluate(() => sessionStorage.getItem('renplay-device'))).toBe('tablet')
  // The closing line is the end: another press changes nothing, and the choices are gone.
  await page.keyboard.press('Space')
  await page.mouse.click(700, 300)
  await expect(scene).toHaveAttribute('data-scene', 'after')
  await expect(page.locator('#choices a').first()).toBeHidden()
  // The hand no longer wakes the others: the choice is made.
  const at = await glass(page)
  await page.mouse.move(...at.laptop)
  await page.waitForTimeout(500)
  expect(await wakeOf(page, 'laptop')).toBeLessThan(0.05)
  await expect(page.locator('#replay')).toBeVisible()
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
  for (const a of await page.locator('#choices a').all()) await expect(a).toHaveAttribute('href', '#demo')
})

test('the first screen has the two ways on, Install on the page and the demo in its own tab, and the header\'s Demo is the demo', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The links are the same on every screen; the phone\'s menu is checked with its targets')
  await home(page)
  const ways = page.locator('#top .cta a')
  await expect(ways).toHaveCount(2)
  await expect(ways.nth(0)).toHaveText('Install')
  await expect(ways.nth(0)).toHaveAttribute('href', '#install')
  await expect(ways.nth(1)).toHaveText('Try the demo')
  await expect(ways.nth(1)).toHaveAttribute('href', DEMO)
  await expect(ways.nth(1)).toHaveAttribute('target', '_blank')
  // One lit Install at a time: the header's waits while the first screen, which has its own, is in view.
  const navInstall = page.locator('#nav > .btn')
  await expect(navInstall).toHaveAttribute('href', /#install$/)
  expect(await navInstall.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
  await scrollTo(page, 900)
  await expect.poll(() => navInstall.evaluate((el) => getComputedStyle(el).opacity), { message: 'The header\'s Install comes in as the page scrolls' }).toBe('1')
  // The header's Demo opens the demo itself, in a new tab, never a section of this page.
  const demo = page.locator('#nav-links a', { hasText: 'Demo' })
  await expect(demo).toHaveAttribute('href', DEMO)
  await routeTabs(page)
  const [popup] = await Promise.all([page.waitForEvent('popup'), demo.click()])
  await popup.waitForLoadState()
  expect(popup.url()).toBe(DEMO)
  await popup.close()
  // Catalog is the first link.
  await expect(page.locator('#nav-links a').first()).toHaveText('Catalog')
})

test('a search on the home page lands in the catalog with the words filled in', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'A form that goes to another page works the same on every screen')
  await home(page)
  await page.locator('#find-q').scrollIntoViewIfNeeded()
  await page.locator('#find-q').fill('game 3')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/catalog\/$/)
  await expect(page.locator('#q')).toHaveValue('game 3')
  await expect(page.locator('#games .card')).toHaveCount(1)
  await expect(page.locator('#count')).toHaveText('1 game')
  await expect(page.locator('#games .card a')).toHaveAttribute('href', /\/catalog\/game-3\/$/)
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
  await expect(page.locator('#pickup')).toBeHidden()
  await expect(page.locator('#open-demo')).toHaveAttribute('href', DEMO)
  await expect(page.locator('#live-text')).toHaveText('Live. Go on, press Play.')
  const laptop = page.frameLocator('#laptop-frame'), phone = page.frameLocator('#phone-frame')
  await laptop.locator('#save').click()
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
  await expect(page.locator('#laptop-screen .wait a')).toHaveAttribute('href', DEMO)
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
  expect(seen.length, 'The keyboard reaches the header, the scene, the two ways on, the search, the shelf, the demo, the install section and the questions').toBeGreaterThan(25)
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
  expect(page.asked.filter((u) => new URL(u).host === 'catalog.renplay.org'), 'Nothing is fetched before the answer').toEqual([])
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
  // The sheet of an adult game keeps its cover blurred too, and asks for no picture of it.
  await page.locator(`button[data-id="${adults[0]}"]`).click()
  await expect(page.locator('#detail')).toHaveAttribute('open', '')
  await expect(page.locator('#detail .sheet .cover.blurred')).toHaveCount(1)
  await expect(page.locator('#detail h2').first()).toBeVisible()
  expect(page.asked.some((u) => u.includes(`/${adults[0]}.jpg`)), 'The sheet does not ask for the cover either').toBe(false)
  await page.locator('#detail [data-close]').click()
  await expect(page.locator('#detail')).not.toHaveAttribute('open', '')
  // Only the person's own choice shows them, and the choice is to hide them again.
  await page.locator('#covers').click()
  await expect(page.locator('#games .cover.blurred')).toHaveCount(0)
  await expect.poll(() => page.asked.some((u) => u.includes(`/${adults[0]}.jpg`))).toBe(true)
  await page.locator('#covers').click()
  await expect(page.locator('#games .cover.blurred')).toHaveCount(adults.length)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('a missing page answers 404 with its own page, and is not indexed', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The same on every screen')
  const response = await home(page, '/not-a-page/')
  expect(response.status()).toBe(404)
  await expect(page.locator('h1')).toContainText('This page is not here.')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
})

// One test a width: each walks two long pages, and the three together would be too long for one WebKit test.
for (const width of [375, 390, 430]) {
  test(`on a phone ${width} px wide the page scrolls only up and down, from the first screen to the end`, async ({ page }, testInfo) => {
    only(testInfo, 'webkit-portrait', 'A phone is where the page used to be wider than the screen')
    await page.setViewportSize({ width, height: 844 })
    for (const path of ['/', '/catalog/']) {
      await home(page, path)
      await page.waitForTimeout(400)
      const check = async (where) => {
        const w = await widths(page)
        expect(w.html, `${path} at ${width}, ${where}: the page is as wide as the window`).toBeLessThanOrEqual(w.window)
        expect(w.body, `${path} at ${width}, ${where}: the body is as wide as the window`).toBeLessThanOrEqual(w.window)
        // Nothing to scroll to: an attempt to go sideways leaves the page where it is.
        await page.evaluate(() => scrollTo({ left: 10000, top: scrollY, behavior: 'instant' }))
        expect(await page.evaluate(() => Math.round(scrollX)), `${path} at ${width}, ${where}: the page cannot be scrolled sideways`).toBe(0)
      }
      await check('at the top')
      if (path === '/') {
        // The light swells under the box when the phone is picked: the lantern is 880 px wide and must not reach past the screen.
        await sayAll(page)
        await page.locator('#choices a[data-dev="phone"]').tap()
        await expect(page.locator('#scene')).toHaveAttribute('data-scene', 'after')
        await page.waitForTimeout(500)
        await check('after the choice')
      }
      const height = await page.evaluate(() => document.documentElement.scrollHeight)
      for (let y = 600; y < height; y += 900) {
        await scrollTo(page, y)
        await check(`at ${y}`)
      }
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      await page.waitForTimeout(300)
      await check('at the end')
    }
  })
}

test('on a phone the box of the scene keeps one height through every line, the question, the answer and a replay', async ({ page }, testInfo) => {
  only(testInfo, 'webkit-portrait', 'A phone is where the box used to grow as the lines changed')
  await home(page)
  const scene = page.locator('#scene')
  const first = await boxHeight(page)
  expect(first).toBeGreaterThan(100)
  const same = async (state) => expect(await boxHeight(page), `The box is ${first} px high ${state}`).toBe(first)
  await same('while the first line types')
  await next(page)
  await expect(scene).not.toHaveAttribute('data-typing', '1')
  await same('with the first line said')
  await next(page)
  await next(page)
  await expect(page.locator('#typed .t')).toHaveText(SCENE[1])
  await same('with the second line')
  await next(page)
  await next(page)
  await expect(scene).toHaveAttribute('data-scene', 'choice')
  await expect(page.locator('#choices a').first()).toBeVisible()
  await same('with the question and its choices')
  // The three choices are one row of targets, inside the box.
  const boxes = await Promise.all((await page.locator('#choices a').all()).map((a) => a.boundingBox()))
  expect(new Set(boxes.map((b) => Math.round(b.y))).size, 'The choices are in one row').toBe(1)
  const dlg = await page.locator('#dlg').boundingBox()
  for (const b of boxes) { expect(b.height).toBeGreaterThanOrEqual(44); expect(b.y + b.height).toBeLessThanOrEqual(dlg.y + dlg.height + 1) }
  await page.locator('#choices a[data-dev="phone"]').tap()
  await expect(scene).toHaveAttribute('data-scene', 'after')
  await expect.poll(() => wakeOf(page, 'phone'), { message: 'The phone on the sofa is lit' }).toBeGreaterThan(0.95)
  await expect(page.locator('#typed .t')).toHaveText(AFTER)
  await same('with the closing line')
  await expect(page.locator('#replay')).toBeVisible()
  await page.locator('#replay').tap()
  await expect(scene).toHaveAttribute('data-scene', 'line')
  await same('replayed')
  // The two ways on sit under the box, each 44 px, and the lit one is Install.
  const ways = page.locator('#top .cta a')
  await expect(ways).toHaveCount(2)
  for (const b of await Promise.all((await ways.all()).map((a) => a.boundingBox()))) { expect(b.height).toBeGreaterThanOrEqual(44); expect(b.y).toBeGreaterThan(dlg.y + dlg.height - 1) }
  await expect(ways.first()).toHaveClass(/primary/)
})

test('on a phone the demo is a drawn phone that opens the demo in its own tab, and no frame of it is loaded in the page', async ({ page }, testInfo) => {
  only(testInfo, 'webkit-portrait', 'A narrow touch screen gets the link, not the frames')
  await home(page)
  await page.locator('#phone').scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  expect(await page.locator('html').getAttribute('class')).not.toMatch(/taken|handheld/)
  await expect(page.locator('#laptop-wrap')).toBeHidden()
  await expect(page.locator('#phone-screen .poster')).toBeVisible()
  expect(await page.locator('#phone-frame').getAttribute('src'), 'The phone\'s frame is not loaded').toBeNull()
  expect(await page.locator('#laptop-frame').getAttribute('src'), 'The laptop\'s frame is not loaded').toBeNull()
  expect(page.asked.filter((u) => new URL(u).host === 'demo.renplay.org'), 'Nothing of the demo is asked for').toEqual([])
  const pickup = page.locator('#pickup')
  await expect(pickup).toBeVisible()
  await expect(pickup).toHaveAttribute('href', 'https://demo.renplay.org/game/the-question')
  await expect(pickup).toHaveAttribute('target', '_blank')
  await expect(page.locator('#open-demo')).toHaveAttribute('href', DEMO)
  await expect(page.locator('#open-demo')).toHaveAttribute('target', '_blank')
  const before = await page.evaluate(() => Math.round(scrollY))
  await routeTabs(page)
  const [popup] = await Promise.all([page.waitForEvent('popup'), pickup.tap()])
  await popup.waitForLoadState()
  expect(popup.url()).toBe('https://demo.renplay.org/game/the-question')
  await popup.close()
  // The page itself has not moved, and nothing took it over.
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(before)
  expect(await page.locator('html').getAttribute('class')).not.toMatch(/taken/)
})

test.describe('with less motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the scene is said at once, the choice lights the screen at once, and the credits are a still list', async ({ page }, testInfo) => {
    only(testInfo, 'webkit-portrait', 'Reduced motion is a setting of the device, shown here on the phone')
    await home(page)
    await expect(page.locator('#typed .t')).toContainText(SCENE[0])
    await expect(page.locator('#scene')).not.toHaveAttribute('data-typing', '1')
    expect(await page.locator('#roll').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    const first = await boxHeight(page)
    await next(page)
    await expect(page.locator('#typed .t')).toHaveText(SCENE[1])
    await next(page)
    await expect(page.locator('#scene')).toHaveAttribute('data-scene', 'choice')
    expect(await page.locator('.ripple').count()).toBe(0)
    await page.locator('#choices a[data-dev="tablet"]').tap()
    await expect(page.locator('#scene')).toHaveAttribute('data-scene', 'after')
    await expect(page.locator('#typed .t')).toHaveText(AFTER)
    expect(await wakeOf(page, 'tablet'), 'The tablet is lit without a frame loop').toBe(1)
    expect(await boxHeight(page)).toBe(first)
  })
})

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false })

  test('the story, the choices, the two ways on, the search, both commands, the answers and the links to the demo are all in the page', async ({ page }, testInfo) => {
    only(testInfo, 'webkit-portrait', 'What a page says without scripts does not depend on the screen')
    await home(page)
    await expect(page.locator('h1')).toContainText('Renplay')
    await expect(page.locator('#story p')).toHaveText(SCENE)
    for (const p of await page.locator('#story p').all()) await expect(p).toBeVisible()
    await expect(page.locator('#choices a')).toHaveCount(3)
    for (const a of await page.locator('#choices a, #top .cta a').all()) await expect(a).toBeVisible()
    await expect(page.locator('#top .cta a').nth(1)).toHaveAttribute('href', DEMO)
    await expect(page.locator('.define')).toContainText('self-hosted player for Ren’Py games in the browser')
    // The search is a plain form: it reaches the catalog without a script.
    await expect(page.locator('form.find')).toHaveAttribute('action', '/catalog/')
    await expect(page.locator('#find-q')).toHaveAttribute('name', 'q')
    await expect(page.locator('form.find button')).toBeVisible()
    for (const pre of await page.locator('.code pre').all()) await expect(pre).toBeVisible()
    await expect(page.locator('.code pre').first()).toContainText('docker run -d --name renplay')
    await expect(page.locator('.code pre').nth(1)).toContainText('image: ghcr.io/renplay-org/renplay:latest')
    await expect(page.locator('#numbers dt')).toHaveCount(3)
    await expect(page.locator('details')).toHaveCount(8)
    // Only the phone's poster is drawn on a phone, and it is the link to the demo.
    await expect(page.locator('#phone-screen .poster')).toBeVisible()
    await expect(page.locator('#pickup')).toHaveAttribute('href', 'https://demo.renplay.org/game/the-question')
    await expect(page.locator('#open-demo')).toHaveAttribute('href', DEMO)
    // The header's links are on the page, since the Menu button needs a script.
    for (const a of await page.locator('#nav-links a').all()) await expect(a).toBeVisible()
    await expect(page.locator('#nav-links a', { hasText: 'Demo' })).toHaveAttribute('href', DEMO)
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
  expect(page.asked.filter((u) => new URL(u).host === 'demo.renplay.org')).toEqual([])
})

test('on a phone every control is at least 44 px, in the page and in the menu', async ({ page }, testInfo) => {
  only(testInfo, 'webkit-portrait', 'A touch screen is where a target has to be big enough')
  await home(page)
  // A control is a button, a menu line, a tab or a link that stands on its own. A link in the middle of a sentence is not one.
  const small = () => page.evaluate(() => [...document.querySelectorAll('.btn, .links a, .nav-catalog, .cta a, .choices a, .tabs button, .platforms a, summary, .shelf-ctl button, .foot-links a, .page-foot .row a, .menu-btn, .replay, .find input, .find button, .chip-btn, .crumb, .recipe-link, .pickup')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width && r.height && getComputedStyle(el).visibility !== 'hidden' && r.height < 43.5)
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${el.className || el.id} "${el.textContent.trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`))
  expect(await small(), 'The first screen').toEqual([])
  await page.locator('#menu-btn').tap()
  await expect(page.locator('#nav')).toHaveClass(/open/)
  expect(await small(), 'The menu').toEqual([])
  await page.locator('#menu-btn').tap()
  await sayAll(page)
  expect(await small(), 'The choices').toEqual([])
  await page.locator('#choices a[data-dev="laptop"]').tap()
  await expect(page.locator('#replay')).toBeVisible()
  expect(await small(), 'The whole page').toEqual([])
})
