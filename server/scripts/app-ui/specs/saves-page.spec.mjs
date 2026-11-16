import { test, expect, where } from './fixtures.mjs'
import { play, slot } from './player-fixture.mjs'

const touch = (testInfo) => !!testInfo.project.use.hasTouch
const press = (testInfo, locator) => (touch(testInfo) ? locator.tap() : locator.click())

/**
 * Every line of text inside `root` that is cut: wider than its own box, or past the screen's edge. Each label's text
 * is measured as drawn, a range around its text, against the box that holds it.
 */
const cut = (root) =>
  root.evaluate((el) => {
    const found = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim()
      const e = n.parentElement
      if (!text || !e.getBoundingClientRect().width) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      const t = range.getBoundingClientRect()
      // The box that clips: the nearest ancestor that scrolls or hides overflow, else the label's own.
      let box = e
      for (let p = e; p && p !== el.parentElement; p = p.parentElement) {
        const o = getComputedStyle(p)
        if (o.overflowX !== 'visible') { box = p; break }
      }
      const b = box.getBoundingClientRect()
      const clipped = box.scrollWidth > box.clientWidth + 1 && getComputedStyle(box).textOverflow !== 'ellipsis'
      if (clipped || t.right > b.right + 1 || t.left < b.left - 1 || t.right > innerWidth + 1 || t.left < -1) found.push(`${text} (${Math.round(t.left)}..${Math.round(t.right)} of ${Math.round(b.left)}..${Math.round(b.right)})`)
    }
    return found
  })

/** Whether any two of the items share a line: each label is on its own. */
const sharing = (items) =>
  items.evaluateAll((els) => {
    const boxes = els.map((e) => ({ text: e.textContent.trim(), r: e.getBoundingClientRect() }))
    return boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => Math.abs(a.r.top - b.r.top) < a.r.height / 2).map((b) => `${a.text} and ${b.text}`))
  })

test('the game page\'s Saves tab, its action sheet and its history sheet have no cut label, one label to a line, and the history is titled with the save\'s name', async ({ page }, testInfo) => {
  await play(page, {
    path: '/game/game-000#saves',
    slots: [{ ...slot(1, 5), title: 'Meeting Diya', note: 'Before the first lunch scene', pinnedAt: '2026-11-10T10:00:00Z' }, slot(2, 30), slot(3, 60)],
  })
  const tabs = page.getByRole('tablist', { name: 'Game page sections' })
  await expect(tabs).toBeVisible()
  await expect(page.getByText('Meeting Diya').first()).toBeVisible()
  // A strip that does not fit scrolls sideways: each tab is whole inside it once it is brought into view.
  for (const tab of await tabs.getByRole('tab').all()) {
    await tab.scrollIntoViewIfNeeded()
    const [row, box] = [await tabs.boundingBox(), await tab.boundingBox()]
    expect(box.x >= row.x - 1 && box.x + box.width <= row.x + row.width + 1, `The ${await tab.textContent()} tab is inside the strip`).toBe(true)
    expect(await cut(tab), `The ${await tab.textContent()} tab`).toEqual([])
  }
  const toolbar = page.locator('.toolbar')
  expect(await cut(toolbar), 'The toolbar').toEqual([])
  expect(await toolbar.evaluate((el) => el.scrollWidth - el.clientWidth), 'The toolbar does not scroll').toBeLessThanOrEqual(1)
  // Every button of both is a whole target.
  for (const button of await page.locator('.toolbar button, .toolbar a').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(40)
  // The action sheet on a phone, the menu on a computer.
  await press(testInfo, page.getByRole('button', { name: 'Save actions' }).first())
  const actions = page.locator('.menu')
  const items = actions.getByRole('button')
  await expect(items).toHaveCount(7)
  expect(await cut(actions), 'The actions').toEqual([])
  expect(await sharing(items), 'Labels that share a line').toEqual([])
  expect(await items.allTextContents()).toEqual(['Load', 'Unpin', 'Name and note', 'Download', 'Copy to another game', 'Previous versions', 'Delete'])
  for (const item of await items.all()) expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44)
  // The history of this save: titled with its name, and why each version is there in plain words.
  await press(testInfo, items.filter({ hasText: 'Previous versions' }))
  const history = page.getByRole('dialog', { name: 'Previous versions of Meeting Diya' })
  await expect(history).toBeVisible()
  await expect(history.getByText('Saved over in the game')).toBeVisible()
  await expect(history.getByText('The older of two copies')).toBeVisible()
  expect(await history.getByText(/\.save|overwrite|conflict|game-delete|user-delete/).count(), 'No file names or code words').toBe(0)
  expect(await cut(history), 'The history').toEqual([])
  await press(testInfo, history.getByRole('button', { name: 'Close' }))
  // And the history of every save: each version by its save's name, and the reasons in words.
  await press(testInfo, page.getByRole('button', { name: 'History' }))
  const all = page.getByRole('dialog', { name: 'Save history' })
  await expect(all.getByText('Meeting Diya').first()).toBeVisible()
  await expect(all.getByText(/^Deleted here · /)).toBeVisible()
  // A save that is not in the list any more goes by its slot.
  await expect(all.getByText('Page 2 · Slot 3', { exact: true })).toBeVisible()
  await expect(all.getByText(/^Replaced by a Sync code · /)).toBeVisible()
  expect(await cut(all), 'The whole history').toEqual([])
})

/** The opacity of the surface a sheet or menu is drawn on, as computed: what shows through when nothing is blurred. */
const opacity = (locator) =>
  locator.evaluate((el) => {
    const surface = el.closest('.sheet, .pop') ?? el
    const color = getComputedStyle(surface).backgroundColor
    const alpha = color.match(/^rgba\(.*,\s*([\d.]+)\)$/)
    return { surface: surface.className, alpha: alpha ? Number(alpha[1]) : 1 }
  })

test('every sheet and menu reads with no blur: what is behind it does not show through', async ({ page }, testInfo) => {
  where(testInfo, ['chromium-desktop', 'webkit-portrait'], "A blur is the engine's: landscape is the same engine as portrait")
  await play(page, {
    path: '/game/game-000#saves',
    slots: [{ ...slot(1, 5), title: 'Meeting Diya', note: 'Before the first lunch scene' }, slot(2, 30), slot(3, 60)],
  })
  // No blur at all, as in the test browser and on a phone with reduced transparency.
  await page.addStyleTag({ content: '*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important }' })
  const solid = async (locator, what) => {
    const { surface, alpha } = await opacity(locator)
    expect(alpha, `${what} (${surface})`).toBeGreaterThanOrEqual(0.95)
  }
  await press(testInfo, page.getByRole('button', { name: 'Save actions' }).first())
  const actions = page.locator('.menu')
  await expect(actions).toBeVisible()
  await solid(actions, 'The actions')
  // The picture is of the sheet at rest, not while it rises in.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))))
  await press(testInfo, actions.getByRole('button', { name: 'Name and note' }))
  const naming = page.getByRole('dialog', { name: 'Name and note' })
  await expect(naming).toBeVisible()
  await solid(naming, 'Name and note')
  await press(testInfo, naming.getByRole('button', { name: 'Close' }))
  await press(testInfo, page.getByRole('button', { name: 'Save actions' }).first())
  await press(testInfo, page.locator('.menu').getByRole('button', { name: 'Previous versions' }))
  const history = page.getByRole('dialog', { name: /^Previous versions of / })
  await expect(history).toBeVisible()
  await solid(history, 'The history of a save')
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))))
  await press(testInfo, history.getByRole('button', { name: 'Close' }))
  await press(testInfo, page.getByRole('button', { name: 'History' }))
  const all = page.getByRole('dialog', { name: 'Save history' })
  await expect(all).toBeVisible()
  await solid(all, 'The history of every save')
  await press(testInfo, all.getByRole('button', { name: 'Close' }))
  // Lantern's Sheet and menu in general, whatever opens them: the style they are drawn with.
  for (const classes of ['sheet', 'sheet wide', 'sheet xwide', 'sheet full-ph', 'pop', 'pop menu-pop']) {
    const probe = await page.evaluateHandle((c) => document.body.appendChild(Object.assign(document.createElement('div'), { className: c })), classes)
    await solid(probe.asElement(), `.${classes.replace(/ /g, '.')}`)
    await probe.evaluate((el) => el.remove())
  }
})

test('Start from the main menu sits under Resume and opens the game without a save', async ({ page }, testInfo) => {
  where(testInfo, ['chromium-desktop', 'webkit-portrait'], 'What the page offers: landscape adds no other layout')
  await play(page, { path: '/game/game-000' })
  const resume = page.getByRole('link', { name: 'Resume' }).first()
  const link = page.getByRole('link', { name: 'Start from the main menu' })
  await expect(link).toBeVisible()
  // Under Resume, quiet.
  expect((await link.boundingBox()).y).toBeGreaterThan((await resume.boundingBox()).y + (await resume.boundingBox()).height - 1)
  await press(testInfo, link)
  await expect(page).toHaveURL(/\/play\/game-000$/)
})

test('Resume loads the newest save, which is what Start from the main menu is not', async ({ page }, testInfo) => {
  where(testInfo, ['chromium-desktop', 'webkit-portrait'], 'What the page offers: landscape adds no other layout')
  await play(page, { path: '/game/game-000' })
  await press(testInfo, page.getByRole('link', { name: 'Resume' }).first())
  await expect(page).toHaveURL(/\/play\/game-000\?resume=quick-2$/)
})

test('a game with no saves has no Start from the main menu', async ({ page }, testInfo) => {
  where(testInfo, ['chromium-desktop', 'webkit-portrait'], 'What the page offers: landscape adds no other layout')
  await play(page, { path: '/game/game-000', slots: [] })
  await expect(page.getByRole('link', { name: 'Play' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start from the main menu' })).toHaveCount(0)
})
