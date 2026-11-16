import { test, expect } from './fixtures.mjs'

/** The tab's underline as drawn: its colour, and how much of it is drawn (1 whole, 0 none): the lamp under the chosen one and nothing under the others. */
const underline = (tab) =>
  tab.locator('.u').evaluate((u) => {
    const line = getComputedStyle(u, '::before')
    return { colour: line.backgroundColor, drawn: new DOMMatrix(line.transform).a }
  })

test("the game page's sections are real tabs, drawn as words with a lamp underline on the chosen one", async ({ page }) => {
  await page.goto('/game/game-000')
  const list = page.getByRole('tablist', { name: 'Game page sections' })
  await expect(list).toBeVisible()
  const tabs = list.getByRole('tab')
  expect(await tabs.allTextContents()).toEqual(['Play', 'Saves', 'Walkthroughs', 'Mods and files', 'Details', 'Manage'])
  const [play, saves] = [tabs.nth(0), tabs.nth(1)]
  await expect(play).toHaveAttribute('aria-selected', 'true')
  await expect(saves).toHaveAttribute('aria-selected', 'false')
  // The panel under the tabs is named by the chosen one.
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Play')
  // Words, not a strip: no fill behind the row or a tab, and every tab is a whole target.
  const lamp = await page.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--lamp)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c })
  expect(await underline(play), 'The chosen tab is underlined in the lamp colour').toEqual({ colour: lamp, drawn: 1 })
  expect((await underline(saves)).drawn, 'The others are not').toBe(0)
  expect(await list.evaluate((el) => getComputedStyle(el).backgroundColor), 'The row has no fill').toBe('rgba(0, 0, 0, 0)')
  for (const tab of await tabs.all()) {
    expect(await tab.evaluate((el) => getComputedStyle(el).backgroundColor), 'A tab has no fill').toBe('rgba(0, 0, 0, 0)')
    expect((await tab.boundingBox()).height).toBeGreaterThanOrEqual(44)
    expect(await tab.getAttribute('tabindex'), 'Every tab stays in the tab order, so a controller reaches it').toBeNull()
  }
})

test('the arrow keys move between the tabs, Home and End go to the ends, and Enter or Space opens the one with focus', async ({ page }) => {
  await page.goto('/game/game-000')
  const tabs = page.getByRole('tablist', { name: 'Game page sections' }).getByRole('tab')
  await tabs.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1), 'Right moves focus').toBeFocused()
  await expect(tabs.first(), 'and does not open it').toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Saves')
  await page.keyboard.press('End')
  await expect(tabs.last()).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tabs.nth(4)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(tabs.first()).toBeFocused()
  await page.keyboard.press('Space')
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Play')
})

test("a line of facts breaks between its parts: the mark before a part is gone where that part starts a line", async ({ page }, testInfo) => {
  await page.goto('/game/game-000')
  const line = page.locator('.stage .sepline').first()
  await expect(line).toBeVisible()
  const { box, parts } = await line.evaluate((el) => {
    const children = [...el.children]
    return {
      box: el.getBoundingClientRect().left,
      parts: children.map((part, i) => {
        const r = part.getBoundingClientRect()
        const mark = r.left - parseFloat(getComputedStyle(part).paddingRight) / 2
        return { text: part.textContent, top: Math.round(r.top), startsLine: i === 0 || Math.abs(r.top - children[i - 1].getBoundingClientRect().top) > 2, mark }
      }),
    }
  })
  expect(parts.length, 'The line has its parts').toBeGreaterThan(2)
  // A phone held upright is where By, the state, the version and Free no longer fit one line.
  if (testInfo.project.name === 'webkit-portrait') expect(new Set(parts.map((p) => p.top)).size, 'The line wraps on a phone').toBeGreaterThan(1)
  for (const part of parts) {
    if (part.startsLine) expect(part.mark, `The mark before "${part.text}" lies outside the line's box, where it is clipped`).toBeLessThan(box - 3)
    else expect(part.mark, `The mark before "${part.text}" lies inside the line`).toBeGreaterThan(box)
  }
})

/** Every underlined word under `root`: the width of its line, of its text, and of the control that holds it. */
const lines = (root) =>
  root.evaluate((el) =>
    [...el.querySelectorAll('.u')].map((u) => {
      const range = document.createRange()
      range.selectNodeContents(u)
      const holder = u.closest('button, a')
      return {
        text: u.textContent.trim(),
        line: parseFloat(getComputedStyle(u, '::before').width),
        hover: parseFloat(getComputedStyle(u, '::after').width),
        written: range.getBoundingClientRect().width,
        hit: parseFloat(getComputedStyle(holder, '::before').width),
        left: u.getBoundingClientRect().left - range.getBoundingClientRect().left,
      }
    }),
  )

test('the line under a tab, a choice and a header link is exactly as wide as its text, never the hit area that makes the control 44 px', async ({ page }) => {
  await page.goto('/game/game-000')
  const tabs = page.getByRole('tablist', { name: 'Game page sections' })
  await expect(tabs).toBeVisible()
  const found = await lines(tabs)
  expect(found.map((l) => l.text)).toEqual(['Play', 'Saves', 'Walkthroughs', 'Mods and files', 'Details', 'Manage'])
  for (const l of found) {
    expect(Math.abs(l.line - l.written), `The line under ${l.text} is as wide as the word (${l.line} and ${l.written})`).toBeLessThan(1)
    expect(Math.abs(l.hover - l.written), `So is the one drawn on hover`).toBeLessThan(1)
    expect(Math.abs(l.left), `It starts where the word starts`).toBeLessThan(1)
  }
  // A short word is still a whole target: its hit area is 44 px wide, and the line is not.
  const play = found[0]
  expect(play.hit, 'The hit area of Play is 44 px wide').toBeGreaterThanOrEqual(44)
  expect(play.hit - play.line, 'And the line is shorter than it').toBeGreaterThan(8)
  // A choice (Seg) and the header's links, where the screen shows them.
  await tabs.getByRole('tab', { name: 'Saves' }).click()
  await expect(page.locator('.toolbar .seg').first()).toBeVisible()
  const choice = await lines(page.locator('.toolbar .seg'))
  expect(choice.length).toBeGreaterThan(1)
  for (const l of choice) expect(Math.abs(l.line - l.written), `The choice ${l.text}`).toBeLessThan(1)
  if (await page.locator('.nav').isVisible()) for (const l of await lines(page.locator('.nav'))) expect(Math.abs(l.line - l.written), `The header link ${l.text}`).toBeLessThan(1)
})

test('the line grows in on the chosen tab and on hover, and goes out on the one that is left, and under reduced motion it simply appears', async ({ page }, testInfo) => {
  await page.goto('/game/game-000')
  const tabs = page.getByRole('tablist', { name: 'Game page sections' }).getByRole('tab')
  const drawn = (tab, which) => tab.locator('.u').evaluate((u, w) => new DOMMatrix(getComputedStyle(u, w).transform).a, which)
  // It is not there from one frame to the next: a tab just chosen is still on its way.
  await tabs.nth(1).click()
  const sample = await drawn(tabs.nth(1), '::before')
  await expect.poll(() => drawn(tabs.nth(1), '::before'), { message: 'The chosen tab draws its line in' }).toBe(1)
  await expect.poll(() => drawn(tabs.nth(0), '::before'), { message: 'The tab that was left draws its line back' }).toBe(0)
  expect(sample, 'The line of the tab just chosen was on its way').toBeLessThan(1)
  if (!testInfo.project.use.hasTouch) {
    await tabs.nth(3).hover()
    await expect.poll(() => drawn(tabs.nth(3), '::after'), { message: 'A hovered tab draws the line of its word' }).toBe(1)
    await page.mouse.move(720, 400)
    await expect.poll(() => drawn(tabs.nth(3), '::after'), { message: 'And draws it back when the mouse leaves' }).toBe(0)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await tabs.nth(2).locator('.u').evaluate((u) => getComputedStyle(u, '::before').transitionDuration), 'Under reduced motion it has no time to grow').toBe('0s')
  await tabs.nth(2).click()
  expect(await drawn(tabs.nth(2), '::before'), 'It simply appears').toBe(1)
})
