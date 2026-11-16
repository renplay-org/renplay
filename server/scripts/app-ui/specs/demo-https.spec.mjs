import { test, expect, chromium, firefox } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { demoHttpsServer, hostRules, hostNames } from '../demo-https-server.mjs'

// The demo over real HTTPS, in a real browser: a guest from a direct visit and the guest of the
// website's visitor key must not be mixed up. Chromium only: the host names need its resolver rules.
test.skip(({ browserName }) => browserName !== 'chromium', 'The made-up host names need Chromium\'s resolver rules')

test.beforeAll(() => { execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.']) })

const meOf = (frame) => frame.evaluate(async () => (await (await fetch('/api/me')).json()).user?.id)
const frameOf = async (page, selector) => (await (await page.locator(selector).elementHandle()).contentFrame())
const keyGuest = (demo) => demo.app.db.raw.prepare('SELECT user_id FROM demo_guests WHERE key_hash IS NOT NULL').all().map((row) => row.user_id)

/** What the browser does when a visitor opens the demo, then the website, and goes back and forth. */
async function visit(embedder, { blockThirdParty = false, engine = 'chromium' } = {}) {
  const demo = await demoHttpsServer({ embedder })
  let context, cleanup
  if (engine === 'firefox') {
    // Firefox partitions every third-party cookie by default (Total Cookie Protection).
    const browser = await firefox.launch({ firefoxUserPrefs: { 'network.dns.localDomains': hostNames.join(',') } })
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    cleanup = () => browser.close()
  } else {
    // Chromium's own setting for blocking third-party cookies is in the profile: the way to turn it on is its Preferences file.
    const profile = mkdtempSync(join(tmpdir(), 'renplay-profile-'))
    mkdirSync(join(profile, 'Default'))
    if (blockThirdParty) writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify({ profile: { cookie_controls_mode: 1 } }))
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', ignoreHTTPSErrors: true, args: [
      `--host-resolver-rules=${hostRules}`,
      // Playwright turns storage partitioning off, which every Chrome has on: a frame of another site then cannot use its
      // storage once cookies are blocked. A later --disable-features replaces Playwright's list.
      '--disable-features=Translate', '--enable-features=ThirdPartyStoragePartitioning',
    ] })
    cleanup = async () => { await context.close(); rmSync(profile, { recursive: true, force: true }) }
  }
  const errors = []
  const openDirect = async () => {
    const page = await context.newPage()
    await page.goto(`${demo.demoUrl}/signin`)
    await page.getByRole('button', { name: 'Try the demo' }).click()
    await page.waitForURL(`${demo.demoUrl}/`)
    return page
  }
  const openFrames = async () => {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(demo.embedderUrl)
    for (const selector of ['#laptop', '#phone']) await expect((await frameOf(page, selector)).getByRole('link', { name: 'Catalog', exact: true }).first()).toBeVisible()
    return page
  }
  const framesGuest = async (page) => {
    const [laptop, phone] = await Promise.all(['#laptop', '#phone'].map(async (selector) => meOf(await frameOf(page, selector))))
    expect(laptop).toBe(phone)
    return laptop
  }
  return { demo, context, errors, openDirect, openFrames, framesGuest, close: async () => { await cleanup(); await demo.close() } }
}

for (const engine of ['chromium', 'firefox']) {
  const chromiumOnly = engine === 'chromium'
  test(`${engine}: a direct visit first, then the frames: the key's guest, and the whole browser follows it on the same site`, async () => {
    const v = await visit('same-site', { engine })
    try {
      const direct = await v.openDirect()
      const mine = await meOf(direct)
      const frames = await v.openFrames()
      const key = await keyGuest(v.demo)
      expect(key).toHaveLength(1)
      // Not the guest of the direct visit, which the plain cookie would have said.
      expect(key[0]).not.toBe(mine)
      expect(await v.framesGuest(frames)).toBe(key[0])
      // The browser keeps both forms of the cookie. The partitioned one belongs to the site, so the direct page sees it too and is that guest now.
      if (chromiumOnly) expect((await v.context.cookies()).map((cookie) => cookie.name).sort()).toEqual(['renplay_session', 'renplay_session_framed'])
      await direct.reload()
      expect(await meOf(direct)).toBe(key[0])
      // Reloading the frames is the same guest, without making another.
      await frames.reload()
      expect(await v.framesGuest(frames)).toBe(key[0])
      expect(await keyGuest(v.demo)).toEqual(key)
      expect(v.errors).toEqual([])
    } finally { await v.close() }
  })

  test(`${engine}: the frames first, then a direct visit: the same guest all round`, async () => {
    const v = await visit('same-site', { engine })
    try {
      const frames = await v.openFrames()
      const key = await keyGuest(v.demo)
      expect(await v.framesGuest(frames)).toBe(key[0])
      const direct = await v.openDirect()
      expect(await meOf(direct)).toBe(key[0])
      await frames.reload()
      expect(await v.framesGuest(frames)).toBe(key[0])
      expect(await keyGuest(v.demo)).toEqual(key)
    } finally { await v.close() }
  })

  // Chromium's block setting still allows a partitioned cookie. Firefox partitions every third-party cookie by default, which is
  // what its Enhanced Tracking Protection does, and its stricter block-all setting refuses these cookies too.
  test(`${engine}: a website on another site, with third-party cookies blocked or partitioned: the partitioned session carries both frames`, async () => {
    const v = await visit('cross-site', { engine, blockThirdParty: chromiumOnly })
    try {
      const direct = await v.openDirect()
      const mine = await meOf(direct)
      const frames = await v.openFrames()
      const key = await keyGuest(v.demo)
      expect(key).toHaveLength(1)
      expect(await v.framesGuest(frames)).toBe(key[0])
      expect(key[0]).not.toBe(mine)
      expect(await meOf(direct)).toBe(mine)
      if (chromiumOnly) {
        // The browser really blocks what a frame of another site sets without CHIPS.
        expect(await (await frameOf(frames, '#laptop')).evaluate(() => { document.cookie = 'probe=1; SameSite=None; Secure'; return document.cookie })).toBe('')
        const framed = (await v.context.cookies()).find((cookie) => cookie.name === 'renplay_session_framed')
        expect(framed).toMatchObject({ secure: true, httpOnly: true, sameSite: 'None' })
        expect(framed.partitionKey).toBeTruthy()
      }
      await frames.reload()
      expect(await v.framesGuest(frames)).toBe(key[0])
      expect(await keyGuest(v.demo)).toEqual(key)
      expect(v.errors).toEqual([])
    } finally { await v.close() }
  })
}
