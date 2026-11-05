// Destructive only to the task's disposable /tmp/rp30 fixture, never a real library.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright'
import yazl from 'yazl'

const base = process.argv[2] || 'http://127.0.0.1:8093'
const shots = process.argv[3]
assert(shots, 'Pass a screenshot output folder')
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local fixtures only')
const root = '/tmp/rp30'
const code = (await readFile(join(root, 'server.log'), 'utf-8')).match(/Setup code: (\S+)/)?.[1]
assert(code, 'Start a fresh server with its log at /tmp/rp30/server.log')
await mkdir(shots, { recursive: true })
const browsers = [], contexts = [], errors = []
const headers = { 'Sec-Fetch-Site': 'same-origin' }
async function json(response, status = 200) {
  assert.equal(response.status(), status, await response.text())
  return response.json()
}
async function signIn(page, username, password) {
  await page.goto(`${base}/signin`)
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(`${base}/`)
}
try {
  for (const [label, engine, viewport] of [['phone', webkit, { width: 390, height: 844 }], ['desktop', chromium, { width: 1440, height: 900 }]]) {
    const browser = await engine.launch({ headless: true }); browsers.push(browser)
    const context = await browser.newContext({ viewport, ...(label === 'phone' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
    contexts.push(context)
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
    await page.goto(`${base}/`)
    await page.getByRole('heading', { name: 'Prove you run this server' }).waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: join(shots, `${label}-setup.png`), fullPage: true })
    await page.goto(`${base}/signin`)
    await page.getByRole('heading', { name: 'Sign in to Renplay' }).waitFor()
    await page.screenshot({ path: join(shots, `${label}-signin.png`), fullPage: true })
    await page.goto(`${base}/setup`)
    await page.getByLabel('Setup code').fill(code)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('heading', { name: 'Your owner account' }).waitFor()
    await page.screenshot({ path: join(shots, `${label}-setup-account.png`), fullPage: true })
    if (label === 'phone') { await page.close(); continue }
    await page.getByLabel('Name', { exact: true }).fill('Owner')
    await page.getByLabel('Username', { exact: true }).fill('owner')
    await page.getByLabel('Password', { exact: true }).fill('owner password')
    await page.getByRole('button', { name: 'Create owner account' }).click()
    await page.getByRole('heading', { name: 'Which games should this Renplay show?' }).waitFor()
    await page.getByRole('button', { name: 'Safe-for-work games only', exact: false }).click()
    await page.getByRole('heading', { name: 'Your library is empty.' }).waitFor()
    await json(await context.request.post(`${base}/api/users`, { headers, data: { username: 'player', name: 'Player', password: 'player password' } }), 201)
    // Install over HTTP: a host SQLite connection must not share WAL with Docker's VM.
    const html = '<!doctype html><html><head><title>Tiny fixture</title></head><body style="background:#182538;color:white;font:24px sans-serif"><h1 class="fixture-ready">Tiny fixture</h1><script>if (!localStorage.getItem("fixture")) localStorage.setItem("fixture", "ready")</script></body></html>'
    const archive = await new Promise((resolve) => {
      const zip = new yazl.ZipFile(), chunks = []
      zip.addBuffer(Buffer.from(html), 'index.html')
      zip.outputStream.on('data', (data) => chunks.push(data))
      zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
      zip.end()
    })
    const upload = await json(await context.request.post(`${base}/api/uploads`, { headers, data: { name: 'tiny.zip', size: archive.length } }))
    await json(await context.request.put(`${base}/api/uploads/${upload.id}?offset=0`, { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: archive }))
    const source = await json(await context.request.post(`${base}/api/uploads/${upload.id}/complete`, { headers }))
    await json(await context.request.post(`${base}/api/imports`, { headers, data: { source: { kind: 'archive', path: source.path } } }))
    let game
    for (let attempt = 0; attempt < 100; attempt++) {
      const { games } = await json(await context.request.get(`${base}/api/games`))
      game = games.find((entry) => entry.status === 'installed')
      if (game) break
      await page.waitForTimeout(100)
    }
    assert(game, 'Fixture install completed')
    await writeFile(join(root, 'games', game.id, game.build, 'game.zip'), 'Static protection fixture')
    await json(await context.request.post(`${base}/api/games/${game.id}/safe`, { headers, data: { safe: true } }))
    const stored = (id) => join(root, 'data', 'users', String(id), 'saves', game.saveDir, 'localStorage.json')
    const staticUrl = `${base}/g/${game.id}/${game.build}/game.zip`
    await page.goto(`${base}/play/${game.id}`)
    await page.frameLocator('iframe').locator('.fixture-ready').waitFor()
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await readFile(stored(1), 'utf-8').catch(() => '')).includes('ready')) break
      await page.waitForTimeout(100)
    }
    assert.match(await readFile(stored(1), 'utf-8'), /ready/)
    assert.equal((await context.request.get(staticUrl)).status(), 200)
    const anonymous = await browser.newContext()
    assert.equal((await anonymous.request.get(staticUrl)).status(), 401)
    assert.equal((await anonymous.request.get(`${base}/api/health`)).status(), 200)
    await anonymous.close()
    // A live 401 preserves the scene and storage. Signing in to the original account resumes it.
    await json(await context.request.post(`${base}/api/auth/logout`, { headers }))
    await page.frameLocator('iframe').locator('body').evaluate(() => localStorage.setItem('fixture', 'unsent'))
    await page.getByRole('dialog', { name: 'You were signed out' }).waitFor()
    await page.screenshot({ path: join(shots, 'desktop-player-signed-out.png'), fullPage: true })
    const loginPage = await context.newPage()
    await signIn(loginPage, 'owner', 'owner password')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('dialog', { name: 'You were signed out' }).waitFor({ state: 'hidden' })
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await readFile(stored(1), 'utf-8')).includes('unsent')) break
      await page.waitForTimeout(100)
    }
    assert.match(await readFile(stored(1), 'utf-8'), /unsent/)
    await loginPage.close()
    await json(await context.request.post(`${base}/api/auth/logout`, { headers }))
    await signIn(page, 'player', 'player password')
    await page.getByRole('heading', { name: /^All games/ }).waitFor()
    assert.equal(await page.getByRole('link', { name: 'Add games', exact: true }).count(), 0)
    assert.equal((await context.request.get(`${base}/api/system`)).status(), 403)
    assert.equal((await context.request.get(`${base}/api/jobs`)).status(), 403)
    // nginx must return 403, not auth_request's unexpected-status 500, for a hidden file.
    const manager = await browser.newContext(); contexts.push(manager)
    await json(await manager.request.post(`${base}/api/auth/login`, { headers, data: { username: 'owner', password: 'owner password' } }))
    await json(await manager.request.post(`${base}/api/games/${game.id}/safe`, { headers, data: { safe: false } }))
    assert.equal((await context.request.get(`${staticUrl}?restricted`)).status(), 403)
    await json(await manager.request.post(`${base}/api/games/${game.id}/safe`, { headers, data: { safe: true } }))
    await json(await context.request.put(`${base}/api/saves/${game.id}/file?path=${game.saveDir}/persistent`, { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: Buffer.from('player') }))
    await page.goto(`${base}/play/${game.id}`)
    await page.frameLocator('iframe').locator('.fixture-ready').waitFor()
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await readFile(stored(2), 'utf-8').catch(() => '')).includes('ready')) break
      await page.waitForTimeout(100)
    }
    assert.match(await readFile(stored(2), 'utf-8'), /ready/)
    assert.match(await readFile(stored(1), 'utf-8'), /unsent/)
    await page.goto(`${base}/`)
    await page.locator('header button[aria-expanded]').click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('heading', { name: 'Sign in to Renplay' }).waitFor()
    const phone = await contexts[0].newPage()
    phone.on('pageerror', (error) => errors.push(`phone: ${error.message}`))
    await signIn(phone, 'player', 'player password')
    await phone.getByRole('heading', { name: /^All games/ }).waitFor()
    await phone.screenshot({ path: join(shots, 'phone-player-library.png'), fullPage: true })
    await phone.locator('nav button[aria-expanded]').click()
    await phone.getByRole('dialog', { name: 'Your account' }).waitFor()
    await phone.waitForTimeout(300)
    await phone.screenshot({ path: join(shots, 'phone-account-menu.png') })
    await phone.getByRole('link', { name: 'This browser', exact: true }).click()
    await phone.getByRole('heading', { name: 'This browser' }).waitFor()
    await phone.screenshot({ path: join(shots, 'phone-browser-settings.png'), fullPage: true })
    await phone.setViewportSize({ width: 844, height: 390 })
    assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await phone.screenshot({ path: join(shots, 'phone-land-browser-settings.png'), fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('Accounts smoke passed: setup, upload/install, sign-in, protected static files, live 401 and resume, second user, isolated HTML storage and sign-out. No page errors.')
} finally {
  for (const context of contexts) await context.close()
  for (const browser of browsers) await browser.close()
}
