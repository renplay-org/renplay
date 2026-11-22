import { test, expect, where } from './fixtures.mjs'

// Admin Settings splits server options, This browser and About into tabs. Each section must show
// only while its own tab is active, without another section bleeding through underneath.

const SYSTEM = {
  version: '4.14.0',
  sync: { on: false, server: 'https://sync.renpy.org', chosen: false },
  telemetry: { on: true, locked: false, chosen: false },
  setBy: {},
  keepDownloadsChosen: false,
  engines: {
    installed: [],
    available: [{ version: '8.5.3', renpy: '8.5.3', bytes: 10_000_000 }],
    index: 'https://engines.renplay.org/index.json',
  },
  disk: { games: { total: 100e9, free: 80e9 }, data: { total: 50e9, free: 40e9 } },
  library: { games: 12, installed: 12, bytes: 1.2e9 },
  orphans: [],
  purging: 0,
  paths: { games: '/games', archives: '/games/_archives', data: '/data' },
  keepDownloads: true,
  keepDownloadsLocked: false,
  busy: false,
}

const BACKUPS = {
  dir: '/data/backups/saves',
  keep: 14,
  files: [],
  library: null,
  last: null,
  next: null,
  running: false,
  error: null,
}

async function mockAdminSystem(page) {
  await page.route('**/api/system', (r) => r.fulfill({ json: SYSTEM }))
  await page.route('**/api/system/backups', (r) => r.fulfill({ json: BACKUPS }))
}

test('Settings: only the active section is visible on General, This browser and About', async ({ page }, testInfo) => {
  where(testInfo, ['chromium-desktop', 'webkit-portrait'], 'Settings tabs share the same markup and CSS rules across other sizes and engines')
  await mockAdminSystem(page)
  await page.goto('/settings')

  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  const general = page.getByRole('heading', { name: 'Adult games' })
  const browser = page.getByRole('heading', { name: 'This browser' })
  const about = page.getByRole('heading', { name: 'About Renplay' })

  await expect(general, 'General shows when Settings opens').toBeVisible()
  await expect(browser, 'This browser stays hidden on General').toBeHidden()
  await expect(about, 'About stays hidden on General').toBeHidden()

  await nav.getByRole('button', { name: 'This browser' }).click()
  await expect(browser, 'This browser shows on its own tab').toBeVisible()
  await expect(page.getByRole('switch', { name: 'Move cards with the pointer' })).toBeVisible()
  await expect(general, 'General hides on This browser').toBeHidden()
  await expect(about, 'About stays hidden on This browser').toBeHidden()

  await nav.getByRole('button', { name: 'About' }).click()
  await expect(about, 'About shows on its own tab').toBeVisible()
  await expect(browser, 'This browser stays hidden on About').toBeHidden()
  await expect(general, 'General stays hidden on About').toBeHidden()

  await nav.getByRole('button', { name: 'General' }).click()
  await expect(general, 'General shows again when selected').toBeVisible()
  await expect(browser, 'This browser stays hidden after switching back to General').toBeHidden()
  await expect(about, 'About hides after switching back to General').toBeHidden()
})
