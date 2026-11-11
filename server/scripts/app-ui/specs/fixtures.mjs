import { test as base, expect } from '@playwright/test'
import { mock } from '../../app-mock.mjs'

export const test = base.extend({
  page: async ({ page, context, baseURL }, use) => {
    const errors = []
    // Context routing also protects popups before their first page handler can be installed.
    await context.route('**/*', (route) => new URL(route.request().url()).origin === baseURL ? route.fallback() : route.abort('blockedbyclient'))
    await mock(page, errors, 'pilot', { titled: true })
    // Registered last, so this guards the mock routes as well as the built library.
    await page.route('**/*', (route) => new URL(route.request().url()).origin === baseURL ? route.fallback() : route.abort('blockedbyclient'))
    await use(page)
    expect(errors, 'No page errors in the mock library').toEqual([])
  },
})
export { expect }

export async function freeze(page) {
  const time = new Date('2026-11-11T12:00:00Z')
  await page.clock.install({ time })
  await page.clock.pauseAt(time)
}

export async function open(page, path = '/') {
  await page.goto(path)
  await expect(page.locator('.grid[data-row] .card').first()).toBeAttached()
}

/** Deliver query notifications during setup, before measuring any timer boundary. */
export async function openClocked(page, path = '/') {
  await page.goto(path)
  await expect.poll(async () => {
    await page.clock.runFor(100)
    return page.locator('.grid[data-row] .card').count()
  }, { message: 'Mock query results have rendered under the paused clock' }).toBeGreaterThan(0)
}

export async function settled(page) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState === 'finished') && document.querySelectorAll('.bd .l').length <= 1), { message: 'Page entrance and background have settled' }).toBe(true)
}
