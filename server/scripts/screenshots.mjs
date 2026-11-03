// Screenshots of a running Renplay, on a phone (WebKit, iPhone 15 Pro) and a desktop (Chromium).
// Read-only: requests that would change anything on the server are answered locally.
//
//   node scripts/screenshots.mjs <base URL> <output dir> [game id]
//
// Needs the browsers once: npx playwright install chromium webkit
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices, webkit } from 'playwright'

const [base = 'http://localhost:5199', out = 'screenshots', gameArg] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const errors = []

async function open(browser, options, label) {
  const ctx = await browser.newContext(options)
  const page = await ctx.newPage()
  await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })))
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  return { ctx, page }
}

async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(out, `${name}.png`), fullPage })
  console.log(name)
}

const games = await (await fetch(`${base}/api/games`)).json()
const game = gameArg ?? games.games.find((g) => g.status === 'installed')?.id

const desktop = await chromium.launch()
{
  const { ctx, page } = await open(desktop, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, 'desktop')
  await page.goto(base + '/')
  await shot(page, 'desktop-library')
  if (game) {
    await page.goto(`${base}/game/${game}`)
    await shot(page, 'desktop-game')
    await page.getByRole('button', { name: 'Details' }).first().click()
    await shot(page, 'desktop-details', true)
  }
  await page.goto(base + '/add')
  await page.getByRole('button', { name: 'Catalog' }).first().click()
  await shot(page, 'desktop-catalog')
  await page.goto(base + '/settings')
  await shot(page, 'desktop-settings', true)
  await ctx.close()
}
await desktop.close()

const phone = devices['iPhone 15 Pro']
const mobile = await webkit.launch()
{
  const { ctx, page } = await open(mobile, { ...phone }, 'phone')
  await page.goto(base + '/')
  await shot(page, 'phone-library')
  if (game) {
    await page.goto(`${base}/game/${game}`)
    await shot(page, 'phone-game')
  }
  await ctx.close()
}
if (game) {
  const { ctx, page } = await open(mobile, { ...phone, viewport: { width: phone.viewport.height, height: phone.viewport.width } }, 'player')
  await page.goto(`${base}/play/${game}`)
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument && !document.querySelector('iframe').contentDocument.getElementById('presplash'), null, { timeout: 180_000 })
  await page.waitForTimeout(8000)
  await shot(page, 'phone-player')
  await ctx.close()
}
await mobile.close()

console.log(errors.length ? `Page errors:\n${errors.join('\n')}` : 'No page errors')
process.exitCode = errors.length ? 1 : 0
