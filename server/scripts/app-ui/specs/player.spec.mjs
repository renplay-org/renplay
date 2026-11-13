import { readFileSync } from 'node:fs'
import { mock } from '../../app-mock.mjs'
import { test, expect } from './fixtures.mjs'
import { ringShown } from '../focus-ring.mjs'

// The in-game view with a made-up game page: the real shared runtime part (runtime/renplay-player.js, which
// catches the keys) and a small stand-in for the engine that answers the player's messages. What it was sent
// is kept in window.__frameMsgs of the player page.
const sharedRuntime = readFileSync(new URL('../../../../runtime/renplay-player.js', import.meta.url), 'utf8')
const GAME = 'game-000'
const gamePage = `<!doctype html><html><body tabindex="0" style="margin:0;background:#222"><script>
;(function () {
  window.__renplay = { id: '${GAME}', userId: 1 }
  ${sharedRuntime}
  var log = (parent.__frameMsgs = parent.__frameMsgs || [])
  window.addEventListener('message', function (e) {
    var d = e.data
    if (!d || typeof d.type !== 'string') return
    log.push(d)
    if (d.type === 'renplay:save-now') window.__saved().then(function () { post('saved-now', { id: d.id, saved: true, ok: true }) })
    if (d.type === 'renplay:save-and-load') post('loaded', { id: d.id, ok: true, saved: true })
    if (d.type === 'renplay:options') post('options', { ok: true, patches: {}, fontSize: 1, patchesFrom: 'default', sizeFrom: 'default' })
  })
  // The runtime tells the player when the server cannot be reached.
  window.addEventListener('offline', function () { post('sync', { pending: 1, online: false, lastSync: 0 }) })
  post('ready')
})()
</script></body></html>`

const slot = (n, minutes) => ({ file: `quick-${n}-LT1.save`, size: 1, mtime: 0, kind: 'quick', label: `Quick ${n}`, name: 'Diya', ctime: Date.parse('2026-11-11T12:00:00Z') - minutes * 60_000, screenshot: null, valid: true, title: null, note: null, pinnedAt: null })

/** Opens the game with its saves, and what the made-up engine saw. */
async function play(page, { slots = [slot(2, 30), slot(3, 60)], iphone = false } = {}) {
  // Safari on an iPhone: no Fullscreen API, so the menu has the home screen row and the first game shows the tip.
  if (iphone)
    await page.addInitScript(() => {
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => false })
      Object.defineProperty(Navigator.prototype, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
    })
  await page.addInitScript(() => {
    // Chromium's Keyboard Lock and layout map, which the test browser does not grant.
    Object.defineProperty(Navigator.prototype, 'keyboard', { configurable: true, get: () => ({ lock: async () => {}, unlock() {}, getLayoutMap: async () => new Map([['Backquote', '`'], ['Backslash', '\\']]) }) })
  })
  // The game has a guide, so the Guide row and the backslash key are there. Asked again, the mock answers with the patch.
  await mock(page, [], 'player', { titled: true, patch: { [GAME]: { walkthroughs: [{ file: 'guide.png', title: 'Guide', kind: 'image', size: 1, addedAt: '2026-11-01T00:00:00Z', url: '/api/walkthroughs/guide.png' }] } } })
  const list = [...slots]
  await page.exposeFunction('__saved', () => { list.unshift(slot(1, 0)) })
  await page.route(`**/api/saves/${GAME}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saveDir: 'save-0', slots: list, other: [], conflicts: [], sync: false }) }))
  await page.route(`**/g/${GAME}/b1/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: gamePage }))
  await page.goto(`/play/${GAME}`)
  // A phone held upright is asked to turn: it plays upright anyway.
  const { width, height } = page.viewportSize()
  if (height > width) await page.getByRole('button', { name: 'Play upright anyway' }).click()
  await expect(page.locator('.rp-pill').first()).toBeVisible()
  return { sent: (type) => page.evaluate((t) => (window.__frameMsgs ?? []).filter((m) => m.type === t), type) }
}

const touch = (testInfo) => !!testInfo.project.use.hasTouch

test('the backquote key opens and closes the menu, Escape goes back and then closes, and Tab never reaches the door', async ({ page }) => {
  await play(page)
  // The door's buttons are inert once the game is ready.
  await expect(page.locator('.door')).toHaveAttribute('inert', '')
  // With focus in the game frame the key still reaches Renplay, not the game.
  await page.locator('iframe').evaluate((f) => f.contentWindow.focus())
  await page.keyboard.press('Backslash')
  const guide = page.getByRole('region', { name: /^Walkthrough/ })
  await expect(guide).toBeVisible()
  await page.keyboard.press('Backslash')
  await expect(guide).toBeHidden()
  await page.locator('iframe').evaluate((f) => f.contentWindow.focus())
  await page.keyboard.press('Backquote')
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  await expect(menu).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to the game' })).toBeFocused()
  await page.keyboard.press('Backquote')
  await expect(menu).toBeHidden()
  // Tab from wherever focus is: eight presses never land in the door.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.door'))).toBe(false)
  }
  // Escape: Options back to the list, then the list closes.
  await page.locator('.rp-pill').first().click()
  await menu.getByRole('button', { name: /^Options/ }).click()
  await expect(menu.getByRole('button', { name: 'Back', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu.getByRole('button', { name: 'Back to the game' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('a tap on a save saves where you are first and loads it, and Save now puts the new quick save on top', async ({ page }, testInfo) => {
  const engine = await play(page)
  await page.locator('.rp-pill').first().click()
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  // The key line is for computers. A touch screen has no keys.
  await expect(menu.getByText('opens this menu')).toHaveCount(touch(testInfo) ? 0 : 1)
  await menu.getByRole('button', { name: 'Save now' }).click()
  await expect(menu.getByText('Saved as Quick 1')).toBeVisible()
  await menu.getByRole('button', { name: /^Saves/ }).click()
  const rows = menu.locator('.pm-save')
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText('Quick 1')
  await rows.nth(1).click()
  await expect(page.getByText('Loaded. Where you were is saved too.')).toBeVisible()
  const sent = await engine.sent('renplay:save-and-load')
  expect(sent).toHaveLength(1)
  expect(sent[0].slot).toBe('quick-2')
  // The old Load message is gone: the game never loads without saving first.
  expect(await engine.sent('renplay:load')).toHaveLength(0)
})

test('going offline with the game ready keeps the game and shows the cloud', async ({ page, context }) => {
  await play(page)
  await expect(page.locator('iframe')).toHaveCount(1)
  await context.setOffline(true)
  await expect(page.locator('.rp-cloud')).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(1)
  await expect(page.getByText(/You are offline/)).toHaveCount(0)
  // The cloud has no words. The menu has its one line.
  await expect(page.locator('.rp-cloud')).toHaveText('')
  await page.locator('.rp-pill').first().click()
  await expect(page.getByText('Some saves have not reached the server yet. They go up when it is back.')).toBeVisible()
  await context.setOffline(false)
})

// What is at the top centre of the page in the middle of the game: words, from anything over the game.
const topCentreWords = (page) =>
  page.evaluate(() => {
    const x = innerWidth / 2
    return [30, 60, 90].flatMap((y) => document.elementsFromPoint(x, y)).filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() && getComputedStyle(el).opacity !== '0')).map((el) => el.textContent.trim())
  })

test('in full screen nothing is at the top centre, and the menu says Hold Esc to leave', async ({ page }, testInfo) => {
  await play(page)
  await page.locator('.rp-pill').first().click()
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  // Only a computer's browser can lock Esc: a phone has no Esc to hold, and so no line.
  if (testInfo.project.name !== 'chromium-desktop') {
    await expect(menu.getByText('Hold Esc to leave')).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await topCentreWords(page)).toEqual([])
    return
  }
  await menu.getByRole('switch', { name: 'Full screen' }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await expect(menu.getByText('Hold Esc to leave')).toBeVisible()
  await expect(menu.getByText(/Hold Esc to leave fullscreen/)).toHaveCount(0)
  await page.keyboard.press('Backquote')
  await expect(menu).toBeHidden()
  // The old hint stayed for four seconds, as a line of words at the top centre: nothing is there now.
  await page.waitForTimeout(1000)
  expect(await topCentreWords(page)).toEqual([])
  await page.evaluate(() => document.exitFullscreen())
})

// Every control and every line of text in the menu, Saves and Options, measured as a person sees it.
const MENU_VIEWS = [['the list', null], ['Saves', /^Saves/], ['Options', /^Options/]]
test('every control in the menu, Saves and Options is tall enough and no text is under 13 px', async ({ page, context }, testInfo) => {
  await play(page, { slots: [slot(1, 5), slot(2, 30), { ...slot(3, 60), pinnedAt: '2026-11-10T10:00:00Z', title: 'Meeting Diya', note: 'Before the first lunch scene' }] })
  const landscape = testInfo.project.name === 'webkit-landscape'
  const row = landscape ? 40 : 44
  const press = (locator) => (touch(testInfo) ? locator.tap() : locator.click())
  await press(page.locator('.rp-pill').first())
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  for (const [name, open] of MENU_VIEWS) {
    if (open) {
      const back = menu.getByRole('button', { name: 'Back', exact: true })
      if (await back.count()) await press(back)
      await press(menu.getByRole('button', { name: open }))
      await expect(menu.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
    }
    if (name === 'Options') await expect(menu.getByText('Text size')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`menu-${name}.png`) })
    const found = await menu.evaluate((el) => {
      const small = []
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent.trim()
        const e = n.parentElement
        if (text && e.getBoundingClientRect().width && parseFloat(getComputedStyle(e).fontSize) < 13) small.push(`${text} (${getComputedStyle(e).fontSize})`)
      }
      const short = [...el.querySelectorAll('button, a, [role=switch]')].filter((c) => c.getBoundingClientRect().width).map((c) => ({ name: (c.getAttribute('aria-label') || c.textContent || '').trim().slice(0, 40), h: Math.round(c.getBoundingClientRect().height * 10) / 10 }))
      return { small, short }
    })
    expect(found.small, `Text under 13 px in ${name}`).toEqual([])
    expect(found.short.filter((c) => c.h < row), `Controls under ${row} px in ${name}`).toEqual([])
  }
  // Nothing scrolls on the list at 844 x 390, also with the line about saves that wait, which is two lines there.
  if (landscape) {
    await press(menu.getByRole('button', { name: 'Back', exact: true }))
    await context.setOffline(true)
    await expect(menu.getByText('Some saves have not reached the server yet.')).toBeVisible()
    expect(await menu.locator('.pm-body').evaluate((b) => b.scrollHeight - b.clientHeight)).toBeLessThanOrEqual(0)
    expect(await menu.evaluate((m) => m.getBoundingClientRect().bottom)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: testInfo.outputPath(`menu-the-list-waiting.png`) })
    await context.setOffline(false)
  }
})

// The ring of every control in the menu, list, Saves and Options, is whole on all four sides, with the list scrolled
// where it has to be: a row in a list that scrolls must not have its ring cut off by the list.
test('the focus ring of every control in the menu is whole', async ({ page }) => {
  // A screenshot for every control in three views: about a minute on a slow browser.
  test.slow()
  await play(page, { slots: [slot(1, 5), slot(2, 30), slot(3, 60)] })
  // By keyboard, as the ring is for the keyboard: a pointer opening the menu shows none.
  const keyboard = async (locator) => {
    await locator.focus()
    await page.keyboard.press('Enter')
  }
  await keyboard(page.locator('.rp-pill').first())
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  for (const open of [null, /^Saves/, /^Options/]) {
    if (open) {
      // From a view back to the list, then into the next one.
      const back = menu.getByRole('button', { name: 'Back', exact: true })
      if (await back.count()) await keyboard(back)
      await keyboard(menu.getByRole('button', { name: open }))
      await expect(menu.getByRole('button', { name: 'Back', exact: true })).toBeFocused()
    }
    const count = await menu.locator('button, a, [role=switch]').count()
    for (let i = 0; i < count; i++) {
      const focused = () =>
        page.evaluate(() => {
          const el = document.activeElement
          if (!el || !el.closest('[role=dialog]')) return null
          el.scrollIntoView({ block: 'nearest' })
          const r = el.getBoundingClientRect()
          return { name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), x: r.x, y: r.y, width: r.width, height: r.height }
        })
      expect(await focused(), 'Focus stays in the menu').not.toBeNull()
      // The box is read again on every try: the menu slides in, so it has not settled at first.
      await expect.poll(async () => ringShown(page, await focused()), { message: `The ring of ${(await focused()).name} is whole` }).toEqual([])
      await page.keyboard.press('Tab')
    }
  }
})

test('the keys are drawn as keycaps with the layout characters, and the pill has no key in it', async ({ page }, testInfo) => {
  test.skip(touch(testInfo), 'A touch screen shows no keys')
  await play(page)
  // The pill says Menu and nothing else: no tiny tick in an empty box.
  await expect(page.locator('.rp-pill').first().locator('.keycap, kbd')).toHaveCount(0)
  await page.locator('.rp-pill').first().click()
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  const foot = menu.locator('.pm-foot')
  // A keycap shows what Shift types over the character, as the key does: ~ over a backquote, | over a backslash.
  await expect(foot.locator('.keycap').nth(0)).toHaveText('~`')
  await expect(foot.locator('.keycap').nth(1)).toHaveText('|\\')
  // The rows the keys belong to show them too.
  await expect(menu.getByRole('button', { name: 'Back to the game' }).locator('.keycap')).toHaveText('~`')
  await expect(menu.getByRole('button', { name: 'Guide' }).locator('.keycap')).toHaveText('|\\')
  // Each cap is a key-sized box, not a tick.
  const box = await foot.locator('.keycap').first().boundingBox()
  expect(box.height).toBeGreaterThanOrEqual(30)
  expect(box.width).toBeGreaterThanOrEqual(30)
})

// The guide from the menu. Beside the sheet where there is room, inside it on a phone held upright.
const press = (testInfo, locator) => (touch(testInfo) ? locator.tap() : locator.click())
const sheetBox = (menu) => menu.evaluate((el) => ({ right: el.offsetLeft + el.offsetWidth }))

test('the guide opens beside the menu, which stays open, and Back to the game leaves the guide over the game', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit-portrait', 'Upright, the guide opens inside the menu')
  await play(page)
  await press(testInfo, page.locator('.rp-pill').first())
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  const guide = page.getByRole('region', { name: /^Walkthrough/ })
  await press(testInfo, menu.getByRole('button', { name: 'Guide' }))
  await expect(guide).toBeVisible()
  await expect(menu).toBeVisible()
  // To the right of the sheet's edge, never under it, and the focus is in the guide.
  const edge = (await sheetBox(menu)).right
  const place = async () => (await guide.boundingBox())
  await expect.poll(async () => (await place()).x).toBeGreaterThanOrEqual(edge)
  expect((await place()).x + (await place()).width).toBeLessThanOrEqual(page.viewportSize().width)
  await expect(guide.getByRole('button', { name: 'Close the walkthrough' })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('guide-beside-the-menu.png') })
  // A tap in the guide does not close the menu.
  await press(testInfo, guide.locator('.gw-bar'))
  await expect(menu).toBeVisible()
  // Escape closes the guide and gives the focus back to the Guide row.
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Guide' })).toBeFocused()
  // The backslash with the menu open opens the guide and closes it, and the menu stays.
  await page.keyboard.press('Backslash')
  await expect(guide).toBeVisible()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Backslash')
  await expect(guide).toBeHidden()
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Guide' })).toBeFocused()
  // Back to the game closes the menu and leaves the guide where it was.
  await press(testInfo, menu.getByRole('button', { name: 'Guide' }))
  await expect(guide).toBeVisible()
  const where = await place()
  await press(testInfo, menu.getByRole('button', { name: 'Back to the game' }))
  await expect(menu).toBeHidden()
  await expect(guide).toBeVisible()
  expect(await place()).toEqual(where)
  await page.screenshot({ path: testInfo.outputPath('guide-left-over-the-game.png') })
  // The key and the scrim close the menu the same way.
  await page.keyboard.press('Backquote')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Backquote')
  await expect(menu).toBeHidden()
  await expect(guide).toBeVisible()
  await page.keyboard.press('Backslash')
  await expect(guide).toBeHidden()
})

test('on a phone held upright the guide opens inside the menu, and Back returns to the list', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-portrait', 'Beside the menu where there is room')
  await play(page)
  await press(testInfo, page.locator('.rp-pill').first())
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  await press(testInfo, menu.getByRole('button', { name: 'Guide' }))
  // The menu stays, with the guide in it and Back at the top. Nothing else is over the game.
  await expect(menu).toBeVisible()
  await expect(menu.locator('.gw-img')).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Back', exact: true })).toBeFocused()
  await expect(menu.getByRole('button', { name: 'Back to the game' })).toBeHidden()
  await expect(page.getByRole('region', { name: /^Walkthrough/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('guide-inside-the-menu.png') })
  await press(testInfo, menu.getByRole('button', { name: 'Back', exact: true }))
  await expect(menu.getByRole('button', { name: 'Back to the game' })).toBeVisible()
  await expect(menu.locator('.gw-img')).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'Guide' })).toBeFocused()
  // The backslash with the menu open opens the guide in it and closes it again.
  await page.keyboard.press('Backslash')
  await expect(menu.locator('.gw-img')).toBeVisible()
  await page.keyboard.press('Backslash')
  await expect(menu.locator('.gw-img')).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'Back to the game' })).toBeVisible()
  // Closing the menu from the guide leaves the guide over the game, as a guide opened with the backslash is.
  await press(testInfo, menu.getByRole('button', { name: 'Guide' }))
  await expect(menu.locator('.gw-img')).toBeVisible()
  await page.keyboard.press('Backquote')
  await expect(menu).toBeHidden()
  await expect(page.getByRole('region', { name: /^Walkthrough/ })).toBeVisible()
})

test('the home screen tip goes the moment the menu opens, so it never lies over a row', async ({ page }, testInfo) => {
  await play(page, { iphone: true })
  const tip = page.locator('.toast', { hasText: 'add Renplay to your home screen' })
  // On a phone upright it sits where the menu's lower rows are: it is there before the menu opens, and gone with it.
  await expect(tip).toBeVisible()
  await press(testInfo, page.locator('.rp-pill').first())
  const menu = page.getByRole('dialog', { name: /the player menu/ })
  await expect(menu).toBeVisible()
  await expect(tip).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('menu-without-the-tip.png') })
  // It is shown once: not again after the menu closes, and the menu keeps its own row about the home screen.
  await expect(menu.getByRole('button', { name: /^Full screen/ })).toBeVisible()
  await page.keyboard.press('Backquote')
  await expect(menu).toBeHidden()
  await page.keyboard.press('Backquote')
  await expect(menu).toBeVisible()
  await expect(tip).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('renplay:home-screen-tip'))).toBe('1')
})
