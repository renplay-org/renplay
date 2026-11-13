import { test, expect } from './fixtures.mjs'
import { GAME, PDF, play } from './player-fixture.mjs'

// Where the browser has no Picture-in-Picture window to give (Safari, Firefox), Pop out opens a popup window on a
// small page that holds only the reader. WebKit on a computer: the one project that is not a phone is Chromium's,
// so this file asks for WebKit itself.
test.use({ browserName: 'webkit', viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false })

const guideOf = (page) => page.getByRole('dialog', { name: /^Walkthrough/ })
const ink = (canvas) =>
  canvas.evaluate((c) => {
    if (!c.width) return 0
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < data.length; i += 28) if (data[i] < 100) n++
    return n
  })

test('pop out opens a popup window with only the reader, and closing it brings the guide back', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Once, in WebKit on a computer')
  await play(page, { walkthroughs: [PDF] })
  await page.keyboard.press('Backslash')
  const guide = guideOf(page)
  await expect(guide).toBeVisible()
  const [popup] = await Promise.all([page.waitForEvent('popup'), guide.getByRole('button', { name: 'Pop out' }).click()])
  await popup.waitForLoadState()
  expect(new URL(popup.url()).pathname).toBe(`/guide/${GAME}/guide.pdf`)
  const reader = popup.locator('.gw-popup')
  await expect.poll(() => ink(reader.locator('canvas[aria-label="Page 1"]')), { message: 'The popup draws the page' }).toBeGreaterThan(50)
  await expect(popup.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  await expect(guide).toHaveCount(0)
  await popup.close()
  await expect(guide).toBeVisible()
  expect(context.pages().length).toBe(1)
})
