import { test, expect, freeze, openClocked } from './fixtures.mjs'

for (const [name, path, label] of [['Library', '/', 'Search your games'], ['Catalog', '/catalog', 'Search the catalog']]) {
  test(`${name}: address at 200 ms once, screen reader count at 600 ms after the last key`, async ({ page }) => {
    await freeze(page)
    await page.addInitScript(() => {
      window.__writes = []
      const replace = history.replaceState.bind(history)
      history.replaceState = (...args) => {
        window.__writes.push({ url: String(args[2]), at: performance.now() })
        return replace(...args)
      }
    })
    await openClocked(page, path)
    await page.clock.runFor(1000)
    const input = page.getByRole('textbox', { name: label })
    const status = page.locator('.search-field [role="status"]')
    await expect(status).toHaveText('12 games')
    await page.evaluate(() => {
      window.__writes = []
      window.__spoken = []
      new MutationObserver(() => window.__spoken.push(document.querySelector('.search-field [role="status"]').textContent.trim())).observe(document.querySelector('.search-field [role="status"]'), { subtree: true, characterData: true, childList: true })
    })
    const historyLength = await page.evaluate(() => history.length)
    await input.focus()
    await input.pressSequentially('r')
    await page.clock.runFor(199)
    expect(new URL(page.url()).searchParams.has('q'), 'No address write at 199 ms after the first key').toBe(false)
    await input.pressSequentially('o')
    await page.clock.runFor(1)
    expect(await page.evaluate(() => window.__writes), 'The second key cancels the first key deadline').toEqual([])
    await page.clock.runFor(198)
    expect(await page.evaluate(() => window.__writes), 'No address write at 199 ms after the last key').toEqual([])
    await expect(status).toHaveText('12 games')
    await expect(page.locator('.grid[data-row] .card')).toHaveCount(3)
    await page.clock.runFor(1)
    expect(new URL(page.url()).searchParams.get('q'), 'Address is written at exactly 200 ms after the last key').toBe('ro')
    expect(await page.evaluate(() => window.__writes.length), 'Exactly one address write').toBe(1)
    expect(await page.evaluate(() => history.length), 'Typing adds no history entries').toBe(historyLength)
    await page.clock.runFor(399)
    await expect(status).toHaveText('12 games')
    expect(await page.evaluate(() => window.__spoken), 'No screen reader announcement before the 600 ms pause').toEqual([])
    await page.clock.runFor(1)
    await expect(status).toHaveText('3 of 12 games')
    expect(await page.evaluate(() => window.__spoken), 'One announcement after the pause, not one per key').toEqual(['3 of 12 games'])
    expect(await page.evaluate(() => window.__writes.length), 'No repeated address write while paused').toBe(1)
  })
}
