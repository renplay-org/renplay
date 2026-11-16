import { test as base, expect } from '@playwright/test'
import { mock } from '../../app-mock.mjs'

export const test = base.extend({
  // A worker's browser starts together with every other worker's, on a machine of four vCPUs: the first page it draws can wait seconds
  // for its first frame, and what a test reads in that time (an entrance that has not started) is the start-up, not the page.
  // The first test begins once the browser has drawn the library and its entrance has finished.
  warm: [async ({ browser }, use, workerInfo) => {
    const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL, serviceWorkers: 'block' })
    const page = await context.newPage()
    await mock(page, [], 'warm', { titled: true })
    await page.goto('/')
    await expect(page.locator('.grid[data-row] .card').first()).toBeAttached({ timeout: 30000 })
    await expect.poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState === 'finished')), { timeout: 30000 }).toBe(true)
    await context.close()
    await use()
  }, { scope: 'worker', auto: true, timeout: 60000 }],
  // What the made-up API answers with (app-mock.mjs): the 12 titles by default, `{}` for the 130 games and 120 recipes.
  mockOptions: [{ titled: true }, { option: true }],
  page: async ({ page, context, baseURL, mockOptions }, use) => {
    const errors = []
    // Context routing also protects popups before their first page handler can be installed.
    await context.route('**/*', (route) => new URL(route.request().url()).origin === baseURL ? route.fallback() : route.abort('blockedbyclient'))
    await mock(page, errors, 'pilot', mockOptions)
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
  // The clock runs from the moment it is installed until it is paused, so a time that is asked for in the very next call may be past
  // by then on a busy machine: ask for one a little ahead, and for a later one if that has passed too.
  for (let ahead = 100; ; ahead *= 4) {
    try {
      return await page.clock.pauseAt(new Date(time.getTime() + ahead))
    } catch (error) {
      if (!/past/.test(error.message) || ahead > 10000) throw error
    }
  }
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
  const unsettled = () => page.evaluate(() => ({
    running: document.getAnimations().filter((a) => a.playState !== 'finished').map((a) => `${a.effect?.target?.className || a.effect?.target?.tagName} ${a.animationName ?? a.transitionProperty ?? ''} ${a.playState} ${Math.round(a.currentTime)}/${Math.round(a.effect?.getComputedTiming().endTime)}`),
    layers: document.querySelectorAll('.bd .l').length,
    visible: document.visibilityState,
    clock: Math.round(document.timeline.currentTime),
  }))
  let last = null
  await expect.poll(async () => {
    last = await unsettled()
    return last.running.length === 0 && last.layers <= 1
  }, { message: 'Page entrance and background have settled' }).toBe(true).catch((error) => { error.message += `\nUnsettled: ${JSON.stringify(last)}`; throw error })
}

/** A check that says what it found when it fails, and lets the test go on to its other checks. */
export const check = (ok, what) => expect.soft(ok, what).toBe(true)

/** Runs once, in the project that shows the behaviour. Said where a test does not depend on the screen or the input. */
export const only = (testInfo, project, why) => test.skip(testInfo.project.name !== project, why)

/** Runs in these projects only, and says why the others add nothing: the same engine and input, or a size that shows nothing new. */
export const where = (testInfo, projects, why) => test.skip(!projects.includes(testInfo.project.name), why)

/** Waits until `read` answers `true`, looking every 50 ms at first: for an end state the page comes to in a moment. */
export const until = (read, message) => expect.poll(read, { message, intervals: [50, 50, 100, 100, 250] }).toBe(true)
