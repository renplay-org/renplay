import { test, expect } from './fixtures.mjs'
import { ringShown } from '../focus-ring.mjs'
import { GUIDE, PDF, TEXT, play } from './player-fixture.mjs'

// The guide, Renplay's own reader: PDFs drawn by PDF.js, pictures and text, the bar, the keys, the controller,
// the window, the sheet and the whole screen on a phone, and pop out. The game is the made-up one of player-fixture.mjs.
const touch = (testInfo) => !!testInfo.project.use.hasTouch
const press = (testInfo, locator) => (touch(testInfo) ? locator.tap() : locator.click())
const guideOf = (page) => page.getByRole('dialog', { name: /^Walkthrough/ })
const desktopOnly = (testInfo) => test.skip(testInfo.project.name !== 'chromium-desktop', 'A computer with a keyboard')

/** Opens the guide the way the device does: the backslash on a computer, Menu then Guide on a phone. */
async function openGuide(page, testInfo) {
  if (!touch(testInfo)) return page.keyboard.press('Backslash')
  await page.locator('.rp-pill').first().tap()
  await page.getByRole('dialog', { name: /the player menu/ }).getByRole('button', { name: 'Guide' }).tap()
}

/** How many of a canvas's pixels are dark: a page with text on it has hundreds, a blank one none. */
const ink = (canvas) =>
  canvas.evaluate((c) => {
    if (!c.width) return 0
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < data.length; i += 28) if (data[i] < 100) n++
    return n
  })
/** The share of a canvas that is dark: the same page has about the same at any size, and a page of missing glyphs has several times more. */
const inkShare = (canvas) =>
  canvas.evaluate((c) => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 100) n++
    return n / (c.width * c.height)
  })
const pageCanvas = (guide, n) => guide.locator(`canvas[aria-label="Page ${n}"]`)
const pageNow = (guide) => guide.getByRole('status')

test('on a phone held upright a PDF shows page 1 drawn, goes to page 2, and the sheet drags to 92 percent', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-portrait', 'A phone held upright')
  await play(page, { walkthroughs: [PDF] })
  await openGuide(page, testInfo)
  const sheet = guideOf(page)
  await expect(sheet).toBeVisible()
  await expect(pageNow(sheet)).toHaveText('1 of 3')
  await expect.poll(() => ink(pageCanvas(sheet, 1)), { message: 'Page 1 is drawn' }).toBeGreaterThan(50)
  // On a phone a PDF opens at 100 percent (a Letter page is 816 px wide), and is panned. A pinch zooms, a double tap fits it, and again undoes it.
  const width = async () => (await sheet.locator('.gr-page').first().boundingBox()).width
  expect(await width()).toBeCloseTo(816, 0)
  // A pinch zooms: two fingers, as pointer events, move apart.
  await sheet.locator('.gr-view').evaluate((el) => {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const y = r.top + r.height / 2
    const fire = (type, id, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true }))
    fire('pointerdown', 1, cx - 40)
    fire('pointerdown', 2, cx + 40)
    for (let i = 1; i <= 6; i++) {
      fire('pointermove', 1, cx - 40 - i * 15)
      fire('pointermove', 2, cx + 40 + i * 15)
    }
    fire('pointerup', 1, cx - 130)
    fire('pointerup', 2, cx + 130)
  })
  await expect.poll(width, { message: 'A pinch zooms in' }).toBeGreaterThan(816 * 2)
  const view = await sheet.locator('.gr-view').boundingBox()
  const at = { x: view.x + view.width / 2, y: view.y + view.height / 2 }
  await page.touchscreen.tap(at.x, at.y)
  await page.touchscreen.tap(at.x, at.y)
  await expect.poll(width, { message: 'A double tap fits the page to the width' }).toBeLessThan(390)
  await page.touchscreen.tap(at.x, at.y)
  await page.touchscreen.tap(at.x, at.y)
  await expect.poll(width).toBeCloseTo(816, 0)
  // Next page.
  await sheet.getByRole('button', { name: 'Next page' }).tap()
  await expect(pageNow(sheet)).toHaveText('2 of 3')
  await expect.poll(() => ink(pageCanvas(sheet, 2)), { message: 'Page 2 is drawn' }).toBeGreaterThan(50)
  // Two heights: 58 percent of the screen, and the handle dragged up makes it 92.
  const screen = await page.evaluate(() => innerHeight)
  const height = async () => (await sheet.boundingBox()).height
  expect(Math.abs((await height()) - screen * 0.58)).toBeLessThan(3)
  await page.screenshot({ path: testInfo.outputPath('sheet-58.png') })
  const handle = await sheet.getByRole('button', { name: 'Make the guide taller' }).boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 120, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => Math.abs((await height()) - screen * 0.92), { message: 'The sheet is 92 percent' }).toBeLessThan(3)
  await page.screenshot({ path: testInfo.outputPath('sheet-92.png') })
  // And down again to 58.
  const down = await sheet.getByRole('button', { name: 'Make the guide shorter' }).boundingBox()
  await page.mouse.move(down.x + down.width / 2, down.y + down.height / 2)
  await page.mouse.down()
  await page.mouse.move(down.x + down.width / 2, down.y + 150, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => Math.abs((await height()) - screen * 0.58)).toBeLessThan(3)
})

test('on a phone held sideways the guide fills the screen, and the Guide pill brings the game back in one tap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-landscape', 'A phone held sideways')
  await play(page, { walkthroughs: [PDF] })
  const pill = page.locator('.rp-pills').getByRole('button', { name: 'Guide' })
  // There is no Guide pill before a guide was opened.
  await expect(pill).toHaveCount(0)
  await openGuide(page, testInfo)
  const cover = guideOf(page)
  await expect(cover).toBeVisible()
  const { width, height } = page.viewportSize()
  expect(await cover.boundingBox()).toEqual({ x: 0, y: 0, width, height })
  await expect.poll(() => ink(pageCanvas(cover, 1))).toBeGreaterThan(50)
  await page.screenshot({ path: testInfo.outputPath('cover.png') })
  // The pill stays over the guide: one tap and the game is back, one more and the guide is.
  await expect(pill).toBeVisible()
  await pill.tap()
  await expect(cover).toBeHidden()
  await expect(pill).toHaveAttribute('aria-pressed', 'false')
  await page.screenshot({ path: testInfo.outputPath('guide-pill.png') })
  await pill.tap()
  await expect(cover).toBeVisible()
  // Back to the game, in the guide's own bar, does the same.
  await cover.getByRole('button', { name: 'Back to the game' }).tap()
  await expect(cover).toBeHidden()
})

test('a first open is wide enough to read, Fit shows 10 point text at 9 px, plus makes it larger, and Escape closes it', async ({ page }, testInfo) => {
  desktopOnly(testInfo)
  await play(page, { walkthroughs: [PDF] })
  await openGuide(page, testInfo)
  const guide = guideOf(page)
  await expect(guide).toBeVisible()
  expect((await guide.boundingBox()).width).toBeGreaterThanOrEqual(520)
  await expect.poll(() => ink(pageCanvas(guide, 1))).toBeGreaterThan(50)
  // A Letter page is 816 px wide at 100 percent, where 10 point text is 13.3 px. Fit is the window's width.
  const width = async () => (await guide.locator('.gr-page').first().boundingBox()).width
  const fit = await width()
  expect((fit / 816) * (10 * 96) / 72, 'The 10 point text at Fit, in px').toBeGreaterThanOrEqual(9)
  await page.screenshot({ path: testInfo.outputPath('pdf-fit.png') })
  await guide.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(width, { message: 'Zoom in makes the page larger' }).toBeGreaterThan(fit * 1.2)
  await page.screenshot({ path: testInfo.outputPath('pdf-zoomed.png') })
  await guide.getByRole('button', { name: 'Fit' }).click()
  await expect.poll(width).toBeCloseTo(fit, 0)
  // Focus is in the guide after a click on its button: Escape closes it.
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()
})

test('with focus in the guide the keys scroll, turn pages, zoom and fit, and the page and zoom are kept for the file', async ({ page }, testInfo) => {
  desktopOnly(testInfo)
  await play(page, { walkthroughs: [PDF, TEXT] })
  await openGuide(page, testInfo)
  const guide = guideOf(page)
  await expect(guide.locator('[data-reader]')).toBeFocused()
  await expect.poll(() => ink(pageCanvas(guide, 1))).toBeGreaterThan(50)
  const view = guide.locator('.gr-view')
  const top = () => view.evaluate((el) => el.scrollTop)
  await page.keyboard.press('ArrowDown')
  await expect.poll(top).toBeGreaterThan(0)
  await page.keyboard.press('ArrowUp')
  await expect.poll(top).toBe(0)
  await page.keyboard.press('PageDown')
  await expect(pageNow(guide)).toHaveText('2 of 3')
  await page.keyboard.press('PageUp')
  await expect(pageNow(guide)).toHaveText('1 of 3')
  const width = async () => (await guide.locator('.gr-page').first().boundingBox()).width
  const fit = await width()
  await page.keyboard.press('+')
  await expect.poll(width).toBeGreaterThan(fit * 1.2)
  await page.keyboard.press('-')
  await expect.poll(width).toBeCloseTo(fit, 0)
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  const big = await width()
  await page.keyboard.press('0')
  await expect.poll(width).toBeCloseTo(fit, 0)
  // Page 3 at the larger zoom, kept: another file and back, closed and opened again, after a reload.
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await expect.poll(width).toBeCloseTo(big, 0)
  await page.keyboard.press('PageDown')
  await page.keyboard.press('PageDown')
  await expect(pageNow(guide)).toHaveText('3 of 3')
  await page.reload()
  await expect(page.locator('.rp-pill').first()).toBeVisible()
  await page.keyboard.press('Backslash')
  await expect(pageNow(guide)).toHaveText('3 of 3')
  await expect.poll(width).toBeCloseTo(big, 0)
  // Ctrl with the wheel zooms too.
  const box = await view.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(width).toBeGreaterThan(big * 1.1)
  // The text file is wrapped text, 15 px, on the dark plate.
  await guide.getByRole('tab', { name: 'Notes' }).click()
  const text = guide.locator('.gr-text pre')
  await expect(text).toBeVisible()
  expect(await text.evaluate((el) => getComputedStyle(el).fontSize)).toBe('15px')
  expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('text.png') })
})

test('a picture fits the width, and the same bar and keys zoom it', async ({ page }, testInfo) => {
  desktopOnly(testInfo)
  await play(page, { walkthroughs: [GUIDE] })
  await openGuide(page, testInfo)
  const guide = guideOf(page)
  const img = guide.locator('.gr-page img')
  await expect(img).toBeVisible()
  const view = await guide.locator('.gr-view').boundingBox()
  const fit = (await img.boundingBox()).width
  expect(fit).toBeLessThanOrEqual(view.width - 16 + 1)
  expect(fit).toBeGreaterThan(view.width - 60)
  // A picture has no pages: the bar has zoom and Fit.
  await expect(guide.getByRole('button', { name: 'Next page' })).toHaveCount(0)
  await guide.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(async () => (await img.boundingBox()).width).toBeGreaterThan(fit * 1.2)
  await page.screenshot({ path: testInfo.outputPath('picture.png') })
})

test('the see-through toggle is kept, and a kept 85 percent from before is on', async ({ page }, testInfo) => {
  desktopOnly(testInfo)
  // 4.10 kept one of three steps. Set once, so the reloads below keep what the toggle then wrote.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) localStorage.setItem('renplay:guide-window', JSON.stringify({ opacity: '0.85' }))
    sessionStorage.setItem('seeded', '1')
  })
  await play(page, { walkthroughs: [PDF] })
  const guide = guideOf(page)
  const toggle = guide.getByRole('button', { name: 'See-through' })
  const opacity = () => guide.evaluate((el) => getComputedStyle(el).opacity)
  await openGuide(page, testInfo)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(await opacity()).toBe('0.7')
  await page.screenshot({ path: testInfo.outputPath('see-through.png') })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(await opacity()).toBe('1')
  await page.reload()
  await expect(page.locator('.rp-pill').first()).toBeVisible()
  await openGuide(page, testInfo)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await page.reload()
  await expect(page.locator('.rp-pill').first()).toBeVisible()
  await openGuide(page, testInfo)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})

test('the controller scrolls, turns pages, switches files and toggles see-through while the guide holds the pad, and B gives it back to the game', async ({ page }, testInfo) => {
  desktopOnly(testInfo)
  const engine = await play(page, { walkthroughs: [PDF, TEXT], pad: true })
  const hold = (name, ms = 120) => page.evaluate(([n, t]) => new Promise((done) => { window.__hold(n, true); setTimeout(() => { window.__hold(n, false); setTimeout(done, 80) }, t) }), [name, ms])
  const lastPads = async () => (await engine.sent('renplay:pads')).at(-1)
  await openGuide(page, testInfo)
  const guide = guideOf(page)
  await expect(guide).toBeVisible()
  await expect(guide.locator('.gr-keys .pad-glyph').first()).toBeVisible()
  await expect.poll(() => ink(pageCanvas(guide, 1))).toBeGreaterThan(50)
  await page.screenshot({ path: testInfo.outputPath('pad-glyphs.png') })
  // The guide holds the pad: the game was told to give it up.
  await expect.poll(async () => (await lastPads())?.toGame).toBe(false)
  const view = guide.locator('.gr-view')
  await hold('down')
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await hold('up')
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBe(0)
  await hold('right')
  await expect(pageNow(guide)).toHaveText('2 of 3')
  await hold('left')
  await expect(pageNow(guide)).toHaveText('1 of 3')
  const width = async () => (await guide.locator('.gr-page').first().boundingBox()).width
  const fit = await width()
  await hold('x')
  await expect.poll(width).toBeGreaterThan(fit * 1.1)
  await hold('x')
  await hold('x')
  await expect.poll(width).toBeCloseTo(fit, 0)
  const opacity = () => guide.evaluate((el) => getComputedStyle(el).opacity)
  await hold('y')
  await expect.poll(opacity).toBe('0.7')
  await hold('y')
  await expect.poll(opacity).toBe('1')
  // LB and RB switch the file.
  await hold('rb')
  await expect(guide.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  await hold('lb')
  await expect(guide.getByRole('tab', { name: 'Walkthrough' })).toHaveAttribute('aria-selected', 'true')
  // B parks the guide: it stays over the game and the pad goes back to the game.
  await hold('b')
  await expect.poll(async () => (await lastPads())?.toGame).toBe(true)
  await expect(guide).toBeVisible()
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-guide-window]'))).toBe(false)
  const before = await view.evaluate((el) => el.scrollTop)
  await hold('down')
  expect(await view.evaluate((el) => el.scrollTop)).toBe(before)
  // The backslash closes it and opens it again, with focus in it: it holds the pad again.
  await page.keyboard.press('Backslash')
  await expect(guide).toBeHidden()
  await page.keyboard.press('Backslash')
  await expect(guide).toBeVisible()
  await expect.poll(async () => (await lastPads())?.toGame).toBe(false)
  // Held for half a second, Menu parks the guide, and the menu does not open.
  await hold('menu', 700)
  await expect.poll(async () => (await lastPads())?.toGame).toBe(true)
  await expect(guide).toBeVisible()
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  await expect(menu).toBeHidden()
  // Let go at once, Menu opens the menu.
  await page.keyboard.press('Backslash')
  await expect(guide).toBeHidden()
  await page.keyboard.press('Backslash')
  await expect(guide).toBeVisible()
  await expect.poll(async () => (await lastPads())?.toGame).toBe(false)
  await hold('menu', 100)
  await expect(menu).toBeVisible()
})

test('pop out moves the reader to a Picture-in-Picture window, Bring back and closing that window return it', async ({ page, context }, testInfo) => {
  desktopOnly(testInfo)
  await play(page, { walkthroughs: [PDF] })
  await openGuide(page, testInfo)
  const guide = guideOf(page)
  await expect(guide).toBeVisible()
  await expect.poll(() => ink(pageCanvas(guide, 1))).toBeGreaterThan(50)
  const inPage = await inkShare(pageCanvas(guide, 1))
  const [pip] = await Promise.all([context.waitForEvent('page'), guide.getByRole('button', { name: 'Pop out' }).click()])
  const small = guideOf(pip)
  await expect(small).toBeVisible()
  await expect.poll(() => ink(pageCanvas(small, 1)), { message: 'The page is drawn in the small window' }).toBeGreaterThan(50)
  // With its own fonts: the text is as dense as in the page, not boxes where the glyphs should be.
  expect(Math.abs((await inkShare(pageCanvas(small, 1))) / inPage - 1), 'The small window draws the same text').toBeLessThan(0.35)
  // The in-page window is away, and the button reads Bring back.
  await expect(guide).toHaveCount(0)
  await pip.screenshot({ path: testInfo.outputPath('popped-out.png') })
  await small.getByRole('button', { name: 'Bring back' }).click()
  await expect(guide).toBeVisible()
  // Closing the small window brings it back as well.
  const [again] = await Promise.all([context.waitForEvent('page'), guide.getByRole('button', { name: 'Pop out' }).click()])
  await expect(guide).toHaveCount(0)
  await again.close()
  await expect(guide).toBeVisible()
})

// Every control in the guide, in the window, the sheet and the whole screen, is tall enough and no text is under 13 px.
test('every control in the guide is tall enough to hit and no text is under 13 px', async ({ page }, testInfo) => {
  await play(page, { walkthroughs: [PDF, TEXT] })
  await openGuide(page, testInfo)
  const guide = guideOf(page)
  await expect(guide).toBeVisible()
  await expect.poll(() => ink(pageCanvas(guide, 1))).toBeGreaterThan(50)
  const row = testInfo.project.name === 'webkit-landscape' ? 40 : 44
  const found = await guide.evaluate((el) => {
    const small = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim()
      const e = n.parentElement
      if (text && e.getBoundingClientRect().width && !e.closest('.gr-text') && parseFloat(getComputedStyle(e).fontSize) < 13) small.push(`${text} (${getComputedStyle(e).fontSize})`)
    }
    // A control's hit area is its box, or the 44 px square its ::before gives it.
    const hit = (c) => {
      const r = c.getBoundingClientRect()
      const before = getComputedStyle(c, '::before')
      return Math.max(r.height, before.content === 'none' ? 0 : parseFloat(before.height) || 0)
    }
    const short = [...el.querySelectorAll('button, a, [role=tab]')].filter((c) => c.getBoundingClientRect().width && !c.closest('.gr-text')).map((c) => ({ name: (c.getAttribute('aria-label') || c.textContent || '').trim().slice(0, 40), h: Math.round(hit(c) * 10) / 10 }))
    return { small, short }
  })
  expect(found.small, 'Text under 13 px in the guide').toEqual([])
  expect(found.short.length).toBeGreaterThan(5)
  expect(found.short.filter((c) => c.h < row), `Controls under ${row} px in the guide`).toEqual([])
})

// The ring of every control in the guide window is whole on all four sides.
test('the focus ring of every control in the guide window is whole', async ({ page }, testInfo) => {
  desktopOnly(testInfo)
  await play(page, { walkthroughs: [PDF, TEXT] })
  await openGuide(page, testInfo)
  const guide = guideOf(page)
  await expect.poll(() => ink(pageCanvas(guide, 1))).toBeGreaterThan(50)
  await guide.getByRole('button', { name: 'Next page' }).click()
  await expect(pageNow(guide)).toHaveText('2 of 3')
  const controls = ['See-through', 'Pop out', 'Close the walkthrough', 'Previous page', 'Next page', 'Zoom out', 'Zoom in', 'Fit']
  const tabs = ['Walkthrough', 'Notes']
  // The keyboard was the last input, so a focused control shows its ring.
  await page.keyboard.press('Tab')
  for (const name of controls) {
    const control = guide.getByRole('button', { name, exact: true })
    await control.focus()
    // A pill's ring fades in, so it is read until it is whole.
    await expect.poll(async () => ringShown(page, await control.boundingBox()), { message: `The ring of ${name} is whole` }).toEqual([])
  }
  for (const name of tabs) {
    const tab = guide.getByRole('tab', { name })
    await tab.focus()
    await expect.poll(async () => ringShown(page, await tab.boundingBox()), { message: `The ring of the ${name} tab is whole` }).toEqual([])
  }
})
