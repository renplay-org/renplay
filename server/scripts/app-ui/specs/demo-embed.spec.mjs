import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { demoEmbedServer } from '../demo-embed-server.mjs'

let demo
test.beforeAll(async () => {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.'])
  demo = await demoEmbedServer()
})
test.afterAll(async () => { await demo?.close() })

test('demo embed shares a Lax guest session, reports saves, refreshes and nudges across two frames', async ({ page, context }, testInfo) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(demo.url)
  const laptop = page.frameLocator('#laptop'), phone = page.frameLocator('#phone')
  await expect.poll(() => page.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:ready').length)).toBe(2)
  await expect(laptop.getByRole('note')).toHaveCount(0)
  await expect(phone.getByRole('note')).toHaveCount(0)
  await expect(laptop.getByRole('link', { name: 'You', exact: true })).toHaveCount(0)
  const play = phone.getByRole('link', { name: 'Play', exact: true }).first()
  await expect(play).toBeVisible()
  if (testInfo.project.use.hasTouch) await expect(play).toHaveAttribute('target', '_top')
  else await expect(play).not.toHaveAttribute('target', '_top')
  const cookies = await context.cookies(demo.demoUrl)
  expect(cookies.find((cookie) => cookie.name === 'renplay_session')).toMatchObject({ sameSite: 'Lax', httpOnly: true })
  const ids = await Promise.all(['#laptop', '#phone'].map(async (selector) => (await (await page.locator(selector).elementHandle()).contentFrame()).evaluate(async () => (await (await fetch('/api/me')).json()).user.id)))
  expect(ids[0]).toBe(ids[1])
  // The website's key reached both frames, and neither keeps it in its address.
  const key = await page.evaluate(() => visitor)
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
  for (const frame of [laptop, phone]) expect(await frame.locator('body').evaluate(() => location.hash)).toBe('')
  const command = async (type, frame = '#phone') => page.evaluate(({ type, frame, origin }) => document.querySelector(frame).contentWindow.postMessage({ type: `renplay-embed:${type}` }, origin), { type, frame, origin: demo.demoUrl })
  await command('nudge')
  await expect.poll(() => play.evaluate((el) => el.getAnimations().length)).toBe(1)
  // Wrong-origin messages, even naming the parent window, cannot start an animation or refresh data.
  await phone.locator('body').evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish()
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: parent, data: { type: 'renplay-embed:nudge' } }))
  })
  expect(await play.evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0)
  await phone.getByRole('link', { name: 'Library', exact: true }).first().click()
  await expect.poll(() => phone.locator('body').evaluate(() => location.search)).toContain('embed=phone')
  await expect.poll(() => page.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:engaged').length)).toBe(1)
  await laptop.locator('.card[data-id="the-question"]').click()
  await expect.poll(() => laptop.locator('body').evaluate(() => location.search)).toContain('embed=laptop')
  await command('nudge', '#laptop')
  await expect.poll(() => laptop.getByRole('link', { name: 'Play', exact: true }).first().evaluate((el) => el.getAnimations().length)).toBe(1)
  // Open the real player inside the laptop, also on touch for this bridge test. A separate
  // test below checks that a visitor's touch on Play actually leaves the website.
  await page.locator('#laptop').evaluate((frame, origin) => { frame.src = `${origin}/play/the-question?embed=laptop` }, demo.demoUrl)
  const engine = laptop.frameLocator('iframe')
  await expect.poll(() => page.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:ready').length)).toBe(3)
  await engine.getByRole('button', { name: 'Make a save' }).click()
  await expect.poll(() => engine.locator('body').evaluate(() => window.lastSaveStatus)).toBe(200)
  await expect.poll(() => page.evaluate(() => messages.find((m) => m.type === 'renplay-embed:saved' && m.frame === 'laptop'))).toMatchObject({ gameId: 'the-question', label: 'Page 1 · Slot 1', time: demo.time })
  await command('refresh')
  await expect(phone.getByRole('link', { name: 'Resume', exact: true }).first()).toBeVisible()
  await phone.locator('.card[data-id="the-question"]').click()
  await phone.getByRole('button', { name: 'All saves', exact: true }).click()
  await expect(phone.getByText('A shared scene').first()).toBeVisible()
  await expect.poll(() => phone.locator('body').evaluate(() => document.getAnimations().every((a) => a.playState === 'finished'))).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('demo-two-frames.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('demo embed Play leaves the website on touch and stays framed on desktop', async ({ page, context }, testInfo) => {
  await page.goto(demo.url)
  const phone = page.frameLocator('#phone')
  await expect.poll(() => page.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:ready').length)).toBe(2)
  const guest = await guestOf(phone)
  // Touch leaves the frame, and a top window has its own cookies: only the key can say who this is.
  if (testInfo.project.use.hasTouch) await context.clearCookies()
  await phone.getByRole('link', { name: /^(Play|Resume)$/ }).first().click()
  if (testInfo.project.use.hasTouch) {
    await expect(page).toHaveURL(new RegExp(`^${demo.demoUrl}/play/the-question`))
    await expect(page.locator('iframe')).toBeVisible()
    // Out of the frame, the visitor is still their guest, and the key is not left in the address.
    expect(await page.evaluate(async () => (await (await fetch('/api/me')).json()).user.id)).toBe(guest)
    expect(await page.evaluate(() => location.hash)).toBe('')
  } else {
    await expect(page).toHaveURL(`${demo.url}/`)
    await expect.poll(() => phone.locator('body').evaluate(() => location.pathname + location.search)).toContain('/play/the-question?')
    await expect.poll(() => phone.locator('body').evaluate(() => location.search)).toContain('embed=phone')
  }
})

test('demo embed refuses an unapproved parent origin', async ({ page }) => {
  const violations = []
  page.on('console', (message) => { if (/frame-ancestors|Refused to frame|ancestor violates/i.test(message.text())) violations.push(message.text()) })
  await page.goto(demo.wrongUrl)
  await page.evaluate((url) => {
    document.body.innerHTML = '<iframe title="Refused demo"></iframe>'
    document.querySelector('iframe').src = url
  }, `${demo.demoUrl}/?embed=laptop`)
  await expect.poll(() => violations.length).toBeGreaterThan(0)
  await expect(page.frameLocator('iframe').getByRole('link', { name: 'Catalog', exact: true })).toHaveCount(0)
})

const guestOf = (frame) => frame.locator('body').evaluate(async () => (await (await fetch('/api/me')).json()).user.id)
const saveFrom = (frame) => frame.locator('body').evaluate(async () => (await fetch('/api/saves/the-question/file?path=the-question/1-1-LT1.save', { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array([1, 2, 3]) })).status)
const savesOf = (frame) => frame.locator('body').evaluate(async () => JSON.stringify(await (await fetch('/api/saves/the-question')).json()))

test('demo embed gives each visitor a guest of their own', async ({ page, browser }, testInfo) => {
  await page.goto(demo.url)
  await expect.poll(() => page.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:ready').length)).toBe(2)
  const mine = await guestOf(page.frameLocator('#laptop'))
  expect(await saveFrom(page.frameLocator('#laptop'))).toBe(200)
  expect(await savesOf(page.frameLocator('#phone'))).toContain('1-1-LT1.save')
  // Another visitor: another browser, so another key. Nothing of the first one's is theirs.
  const visitor = await browser.newContext({ hasTouch: testInfo.project.use.hasTouch })
  try {
    const other = await visitor.newPage()
    await other.goto(demo.url)
    await expect.poll(() => other.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:ready').length)).toBe(2)
    expect(await other.evaluate(() => visitor)).not.toBe(await page.evaluate(() => visitor))
    expect(await guestOf(other.frameLocator('#laptop'))).not.toBe(mine)
    expect(await guestOf(other.frameLocator('#phone'))).not.toBe(mine)
    expect(await savesOf(other.frameLocator('#laptop'))).not.toContain('1-1-LT1.save')
    await expect(other.frameLocator('#phone').getByRole('link', { name: 'Resume', exact: true })).toHaveCount(0)
  } finally { await visitor.close() }
})

test('demo embed finds the visitor again from the key alone, with no cookie', async ({ page, context }) => {
  await page.goto(demo.url)
  await expect.poll(() => page.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:ready').length)).toBe(2)
  const mine = await guestOf(page.frameLocator('#laptop'))
  expect(await saveFrom(page.frameLocator('#laptop'))).toBe(200)
  await context.clearCookies()
  expect((await context.cookies(demo.demoUrl)).filter((cookie) => cookie.name === 'renplay_session')).toEqual([])
  // Each frame reloads with no session, and the key it kept for the tab makes it the same guest again.
  for (const selector of ['#laptop', '#phone']) await (await (await page.locator(selector).elementHandle()).contentFrame()).evaluate(() => location.reload())
  await expect.poll(() => page.evaluate(() => messages.filter((m) => m.type === 'renplay-embed:ready').length)).toBe(4)
  expect(await guestOf(page.frameLocator('#laptop'))).toBe(mine)
  expect(await guestOf(page.frameLocator('#phone'))).toBe(mine)
  expect(await savesOf(page.frameLocator('#phone'))).toContain('1-1-LT1.save')
})
