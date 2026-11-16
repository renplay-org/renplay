import { test, expect } from './fixtures.mjs'

/** The tab's underline and its colour, as drawn: the lamp under the chosen one and nothing under the others. */
const underline = (tab) => tab.evaluate((el) => getComputedStyle(el, '::after').backgroundColor)

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
  expect(await underline(play), 'The chosen tab is underlined in the lamp colour').toBe(lamp)
  expect(await underline(saves), 'The others are not').toBe('rgba(0, 0, 0, 0)')
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
