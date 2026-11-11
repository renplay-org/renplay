import { test, expect, open, settled } from './fixtures.mjs'
import { ringAt } from '../focus-ring.mjs'

for (const [name, path, label] of [['Library', '/', 'Search your games'], ['Catalog', '/catalog', 'Search the catalog']]) {
  test(`${name}: shortcuts focus a whole ring, Escape clears then leaves`, async ({ page }, testInfo) => {
    for (const how of ['shortcut', '/', 'pointer']) {
      await open(page, path)
      await settled(page)
      const input = page.getByRole('textbox', { name: label })
      await page.evaluate(() => document.activeElement?.blur())
      if (how === 'shortcut') {
        const apple = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
        await page.keyboard.press(`${apple ? 'Meta' : 'Control'}+k`)
      } else if (how === '/') await page.keyboard.press('/')
      else if (testInfo.project.use.hasTouch) await input.tap()
      else await input.click()
      await expect(input, `${how} focuses the search`).toBeFocused()
      await expect.poll(async () => {
        const box = await page.locator('.search-field').boundingBox()
        const floor = await page.evaluate(() => {
          const bar = document.querySelector('.tabbar')
          return bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight
        })
        if (!box || box.y < 8 || box.y + box.height + 8 > floor) return ['not fully in view']
        return ringAt(page, box)
      }, { message: `${name}: the white focus ring is whole on all four sides after ${how}` }).toEqual([])
      await input.pressSequentially('a/b')
      await expect(input, '/ inside the field remains text').toHaveValue('a/b')
      await page.keyboard.press('Escape')
      await expect(input, 'First Escape clears the search').toHaveValue('')
      await expect(input, 'First Escape keeps focus').toBeFocused()
      await page.keyboard.press('Escape')
      await expect(input, 'Second Escape leaves the empty search').not.toBeFocused()
    }
  })
}
