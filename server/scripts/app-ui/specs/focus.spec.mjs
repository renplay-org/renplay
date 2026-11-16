import { test, expect, open, settled, where } from './fixtures.mjs'
import sharp from 'sharp'

/** The places along the bottom of a box (in CSS pixels) where the 2 px line under a focused field is not the lamp's colour. */
async function underlineAt(page, box) {
  const clip = { x: box.x, y: box.y + box.height - 4, width: box.width, height: 4 }
  const { data, info } = await sharp(await page.screenshot({ clip, scale: 'css' })).raw().toBuffer({ resolveWithObject: true })
  const lamp = [255, 197, 138]
  const lit = (x, y) => {
    const i = (Math.floor(y) * info.width + Math.floor(x)) * info.channels
    return lamp.every((c, k) => Math.abs(data[i + k] - c) <= 24)
  }
  // The line is the box's last two pixels: read at both, at five places along it.
  return [0.05, 0.25, 0.5, 0.75, 0.95].filter((f) => !lit(box.width * f, 2.5) && !lit(box.width * f, 3.5)).map((f) => `${f * 100}%`)
}

for (const [name, path, label] of [['Library', '/', 'Search your games'], ['Catalog', '/catalog', 'Search the catalog']]) {
  test(`${name}: shortcuts focus the field with its whole lamp line, Escape clears then leaves (a phone's closes it, keeping the search as a word)`, async ({ page }, testInfo) => {
    // The Library's and the Catalog's search is one toolbar and one field. WebKit takes a picture of the line at a high price: once.
    where(testInfo, name === 'Library' ? ['chromium-desktop', 'webkit-portrait'] : ['chromium-desktop'], "The line is the one search field of the toolbar both pages share, and landscape is as wide as a tablet")
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
        const box = await page.locator('.search-box').boundingBox()
        const floor = await page.evaluate(() => {
          const bar = document.querySelector('.tabbar')
          return bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight
        })
        if (!box || box.y < 8 || box.y + box.height + 8 > floor) return ['not fully in view']
        return underlineAt(page, box)
      }, { message: `${name}: the field's line is the lamp's colour along its whole width after ${how}` }).toEqual([])
      await input.pressSequentially('a/b')
      await expect(input, '/ inside the field remains text').toHaveValue('a/b')
      await page.keyboard.press('Escape')
      if (page.viewportSize().width < 720) {
        // An icon on a phone: Escape closes the field, the search stays in the line as a word, and the word clears it.
        await expect(input, 'Escape closes the phone field').not.toBeFocused()
        await expect(input, 'and the search stays').toHaveValue('a/b')
        const kept = page.locator('.search-kept')
        await expect(kept, 'as a word in the line').toContainText('a/b')
        // The page is still scrolling to the line as it was typed, so the word moves: it is pressed, not waited for.
        await kept.dispatchEvent('click')
        await expect(input, 'the word clears the search').toHaveValue('')
        await expect(kept).toHaveCount(0)
        continue
      }
      await expect(input, 'First Escape clears the search').toHaveValue('')
      await expect(input, 'First Escape keeps focus').toBeFocused()
      await page.keyboard.press('Escape')
      await expect(input, 'Second Escape leaves the empty search').not.toBeFocused()
    }
  })
}
