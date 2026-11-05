import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import express from 'express'
import sharp from 'sharp'
import { chromium, webkit, devices } from 'playwright'
import { expect, it } from 'vitest'
import { mockOidc, signInFixture, site } from './sign-in-fixture.js'

it.skipIf(!process.env.RENPLAY_UI_SHOTS)('checks SSO, avatar, provider-managed Users and search on desktop and phone', async () => {
  const provider = await mockOidc()
  provider.setClaims({ groups: ['admins', 'adults'] })
  const app = await signInFixture({ publicUrl: 'http://127.0.0.1:3991', oidcIssuer: provider.issuer, oidcClientId: 'renplay', oidcName: 'Pocket ID', oidcAdminGroup: 'admins', oidcAdultGroup: 'adults', adminUsername: 'admin', adminPassword: 'local password' })
  app.app.use(express.static(resolve('../selector/dist')))
  app.app.get(/.*/, (_req, res) => res.sendFile(resolve('../selector/dist/index.html')))
  const server = createServer(app.app)
  await new Promise<void>(r => server.listen(3991, '127.0.0.1', r))
  const out = process.env.RENPLAY_UI_SHOTS!, errors: string[] = []
  await mkdir(out, { recursive: true })
  const photo = await sharp({ create: { width: 320, height: 200, channels: 3, background: '#ab3a6c' } }).png().toBuffer()
  try {
    for (const phone of [false, true]) {
      const browser = await (phone ? webkit : chromium).launch()
      const context = await browser.newContext(phone ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 } })
      const page = await context.newPage(), prefix = phone ? 'phone' : 'desktop'
      page.on('pageerror', e => { errors.push(e.message); console.error(prefix, page.url(), e.stack) })
      // These read-only UI fixtures contain no real art or user data. Mutations use the local app.
      const game = { id: 'quiet-story', title: 'A quiet story', developer: 'The Example Team', tags: ['Romance'], tagIds: ['romance'], content: [], state: 'ongoing', summary: 'A safe test story.', cover: null, nsfw: false, walkthrough: null, status: 'installed', build: 'abc123', playUrl: '/g/quiet-story/abc123/', family: 'renpy', engineLabel: null, version: '1.0', favoriteAt: null, finishedAt: null, playTime: 120, latestSave: null, screen: [1280, 720], saveDir: 'QuietStory', source: { archive: null, size: null }, recipe: { id: 'quiet-story', links: {}, continuesFrom: [] }, saves: { count: 0, latest: 0 }, mods: { files: 0 }, job: null, createdAt: '2026-01-01', lastPlayedAt: '2026-11-01' }
      const adult = { ...game, id: 'hidden-story', title: 'A hidden picture', nsfw: true, cover: 'https://never-fetch.invalid/adult.jpg', lastPlayedAt: null }
      await page.route('**/api/games', r => r.fulfill({ json: { games: [game, adult] } }))
      await page.route('**/api/catalog', r => r.fulfill({ json: { vocabulary: { romance: { label: 'Romance', group: 'story' } }, status: { errors: [], count: 1 }, games: [{ id: 'catalog-story', title: 'Another quiet story', developer: 'Example Studio', tags: ['Romance'], tagIds: ['romance'], nsfw: false, cover: null, releases: [{ version: '1.0', status: 'playable' }], local: null, links: { itch: 'https://example.org/game' } }] } }))
      let forbiddenPictures = 0
      await page.route('https://never-fetch.invalid/**', r => { forbiddenPictures++; return r.abort() })
      await page.goto('http://127.0.0.1:3991/signin')
      await page.getByRole('link', { name: 'Continue with Pocket ID' }).waitFor()
      await page.screenshot({ path: join(out, `${prefix}-signin.png`) })
      // On the first browser, link a password owner explicitly. The second signs in with OIDC.
      if (!phone) {
        await page.getByLabel('Username', { exact: true }).fill('admin')
        await page.getByLabel('Password', { exact: true }).fill('local password')
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()
        await page.waitForURL('http://127.0.0.1:3991/')
        await page.getByRole('button', { name: 'Search', exact: true }).waitFor()
        await page.goto('http://127.0.0.1:3991/account')
        await page.getByRole('button', { name: 'Link Pocket ID' }).click()
        await page.waitForURL('**/account')
        await page.getByText('subject-1', { exact: true }).waitFor()
        await page.getByLabel('Upload picture').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: photo })
        await page.getByRole('button', { name: 'Save picture' }).click()
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
        await context.request.post('http://127.0.0.1:3991/api/users', { headers: site, data: { username: 'reader', name: 'Sam Reader', password: 'reader password' } })
      } else {
        await page.getByRole('link', { name: 'Continue with Pocket ID' }).click()
        await page.waitForURL('http://127.0.0.1:3991/')
        await page.getByRole('button', { name: 'Search', exact: true }).waitFor()
        await page.goto('http://127.0.0.1:3991/account')
      }
      await page.getByRole('heading', { name: 'Linked sign-ins' }).waitFor()
      await page.waitForTimeout(350)
      await page.screenshot({ path: join(out, `${prefix}-account.png`), fullPage: true })
      await page.goto('http://127.0.0.1:3991/settings/users')
      await page.getByText('Role and adult access set by the sign-in provider.').waitFor()
      await page.screenshot({ path: join(out, `${prefix}-users.png`), fullPage: true })
      await page.getByRole('button', { name: 'Actions for admin' }).click()
      await page.getByRole('button', { name: 'Edit role and access' }).click()
      expect(await page.getByLabel('Role', { exact: true }).isDisabled()).toBe(true)
      expect(await page.getByLabel('Allow adult games', { exact: true }).isDisabled()).toBe(true)
      await page.keyboard.press('Escape')
      if (phone) await page.getByRole('button', { name: 'Search', exact: true }).click()
      else await page.keyboard.press(await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform)) ? 'Meta+k' : 'Control+k')
      const search = page.getByRole('combobox')
      await search.fill('quiet')
      await page.getByRole('option', { name: /Another quiet story/ }).waitFor()
      await page.waitForTimeout(350)
      await page.screenshot({ path: join(out, `${prefix}-search.png`) })
      await search.fill('Settings')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await page.waitForURL('**/settings')
      expect(forbiddenPictures).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      if (phone) {
        await page.setViewportSize({ width: 844, height: 390 })
        await page.getByRole('button', { name: 'Search', exact: true }).click()
        await page.waitForTimeout(350)
        await page.screenshot({ path: join(out, 'phone-landscape-search.png') })
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      }
      await browser.close()
    }
    expect(errors).toEqual([])
  } finally { await new Promise<void>(r => server.close(() => r())); app.cleanup(); await provider.close() }
}, 120000)
