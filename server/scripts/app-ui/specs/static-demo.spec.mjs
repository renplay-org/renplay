import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { renpySave, staticDemo } from '../static-demo-fixture.mjs'

/*
 * The static demo (demo/static/): the files of its output on a plain static server, answered by the stand-in service
 * worker in the browser, framed by a page like the website's with a laptop and a phone.
 *
 * Without STATIC_DEMO_DIR the demo is built here from a demo server with a stand-in engine, and "making a save" is a
 * button. With it (demo.yml, on the real demo's output) the real game is played and saved with its Q.Save button.
 * Service workers need a secure context: localhost is one.
 */
test.use({ serviceWorkers: 'allow' })

const ENGINES = 'https://engines.renplay.org'
const real = !!process.env.STATIC_DEMO_DIR

let demo
test.beforeAll(async () => {
  test.setTimeout(real ? 240000 : 120000)
  if (!real) execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.'])
  demo = await staticDemo({ dir: process.env.STATIC_DEMO_DIR })
})
test.afterAll(async () => { await demo?.close() })

const ready = (page) => page.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:ready').length)
const frames = (page) => ({ laptop: page.frameLocator('#laptop'), phone: page.frameLocator('#phone') })
const slots = async (page, frame) => (await (await page.locator(frame).elementHandle()).contentFrame()).evaluate(() => fetch('/api/saves/the-question').then((r) => r.json()).then((j) => j.slots.length))

/** Opens the game in the laptop frame and makes a save in it, as a visitor would. */
async function playAndSave(page) {
  const { laptop } = frames(page)
  await laptop.locator('.card[data-id="the-question"]').click()
  await laptop.getByRole('link', { name: 'Play', exact: true }).first().click()
  const game = laptop.frameLocator('iframe')
  if (!real) {
    await game.getByRole('button', { name: 'Make a save' }).click()
    await expect.poll(() => game.locator('body').evaluate(() => window.lastSaveStatus)).toBe(200)
    return
  }
  // The real game: from the main menu through the first lines, then the quick menu's Q.Save.
  const canvas = game.locator('canvas#canvas')
  await canvas.waitFor({ timeout: 90000 })
  await page.waitForTimeout(30000)
  const box = await canvas.boundingBox()
  const click = async (fx, fy) => { await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await page.waitForTimeout(900) }
  await click(0.058, 0.39)
  for (let i = 0; i < 6; i++) await click(0.6, 0.6)
  for (let attempt = 0; attempt < 4 && !(await slots(page, '#laptop')); attempt++) {
    await click(0.56, 0.986)
    await page.waitForTimeout(3000)
  }
}

/** The runtime's own request to save a file, for a phone size where the game cannot be driven by taps. */
async function runtimeSaves(page) {
  const save = [...(await renpySave('A shared scene', Math.floor(Date.now() / 1000)))]
  const frame = await (await page.locator('#phone').elementHandle()).contentFrame()
  const status = await frame.evaluate(async (bytes) => {
    const { game } = await (await fetch('/api/games/the-question')).json()
    return (await fetch(`/api/saves/the-question/file?path=${game.saveDir}/1-1-LT1.save`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes) })).status
  }, save)
  expect(status).toBe(200)
}

const touch = (testInfo) => !!testInfo.project.use.hasTouch

test('a save made in one frame appears in the other, survives a reload and stays in this browser', async ({ page, browser }, testInfo) => {
  test.setTimeout(real ? 240000 : 60000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message + ' ' + (error.stack ?? '').slice(0, 600)))
  await page.goto(demo.embedderOrigin)
  const { phone } = frames(page)
  await expect.poll(() => ready(page), { timeout: 30000 }).toBe(2)
  await expect(phone.getByRole('link', { name: 'Play', exact: true }).first()).toBeVisible()
  // What needs a server is left out, not shown and refused.
  await expect(phone.getByRole('heading', { name: 'Offline', exact: true })).toHaveCount(0)
  if (touch(testInfo)) await runtimeSaves(page)
  else await playAndSave(page)
  // The website's relay of `saved` as `refresh` is all that tells the phone.
  await expect(phone.getByRole('link', { name: 'Resume', exact: true }).first()).toBeVisible({ timeout: 15000 })
  expect(await slots(page, '#phone')).toBe(1)
  await page.reload()
  await expect.poll(() => ready(page), { timeout: 30000 }).toBe(2)
  await expect(frames(page).phone.getByRole('link', { name: 'Resume', exact: true }).first()).toBeVisible()
  // Another browser has its own saves: nothing here is on a server.
  const other = await browser.newContext({ serviceWorkers: 'allow', viewport: testInfo.project.use.viewport, hasTouch: testInfo.project.use.hasTouch, isMobile: testInfo.project.use.isMobile })
  const second = await other.newPage()
  await second.goto(demo.embedderOrigin)
  await expect.poll(() => ready(second), { timeout: 30000 }).toBe(2)
  await expect(frames(second).phone.getByRole('link', { name: 'Play', exact: true }).first()).toBeVisible()
  expect(await slots(second, '#phone')).toBe(0)
  await other.close()
  expect(errors).toEqual([])
})

test('every request goes to the static server or the engine host, and none fail', async ({ context, page }, testInfo) => {
  test.setTimeout(real ? 240000 : 60000)
  const seen = [], failed = []
  let reloading = false
  context.on('request', (request) => seen.push(request.url()))
  context.on('requestfailed', (request) => { if (!reloading) failed.push(`${request.url()} ${request.failure()?.errorText}`) })
  context.on('response', (response) => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`) })
  await page.goto(demo.embedderOrigin)
  await expect.poll(() => ready(page), { timeout: 30000 }).toBe(2)
  const { laptop, phone } = frames(page)
  // The catalog, read from what the build captured, then back to the library to play.
  await laptop.getByRole('link', { name: 'Catalog', exact: true }).first().click()
  await expect(laptop.getByRole('heading', { name: 'Catalog', exact: true }).first()).toBeVisible()
  await laptop.getByRole('link', { name: 'Library', exact: true }).first().click()
  if (touch(testInfo)) await runtimeSaves(page)
  else await playAndSave(page)
  await expect(phone.getByRole('link', { name: 'Resume', exact: true }).first()).toBeVisible({ timeout: 15000 })
  // A reload abandons the requests still in flight (beacons at unload): those are not failures.
  reloading = true
  await page.reload()
  await expect.poll(() => ready(page), { timeout: 30000 }).toBe(2)
  await page.waitForTimeout(500)
  reloading = false
  // The stand-in answered the demo's own calls, so they were made.
  expect(seen.some((url) => url === `${demo.origin}/api/me`)).toBe(true)
  const origins = new Set(seen.map((url) => new URL(url).origin))
  const allowed = new Set([demo.origin, demo.embedderOrigin, ENGINES])
  expect([...origins].filter((origin) => !allowed.has(origin))).toEqual([])
  expect(failed).toEqual([])
})

test('only the allowed website may frame the demo', async ({ page }) => {
  const violations = []
  page.on('console', (message) => { if (/frame-ancestors|Refused to frame|ancestor violates/i.test(message.text())) violations.push(message.text()) })
  const other = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body></body></html>'))
  await new Promise((done) => other.listen(0, 'localhost', done))
  try {
    expect((await fetch(`${demo.origin}/`)).headers.get('content-security-policy')).toBe(`frame-ancestors 'self' ${demo.embedderOrigin}`)
    await page.goto(`http://localhost:${other.address().port}`)
    await page.evaluate((url) => {
      document.body.innerHTML = '<iframe title="Refused demo"></iframe>'
      document.querySelector('iframe').src = url
    }, `${demo.origin}/?embed=laptop`)
    await expect.poll(() => violations.length).toBeGreaterThan(0)
    await expect(page.frameLocator('iframe').getByRole('link', { name: 'Catalog', exact: true })).toHaveCount(0)
  } finally {
    await new Promise((done) => other.close(done))
  }
})
