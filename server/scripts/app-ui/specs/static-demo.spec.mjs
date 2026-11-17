import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
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
  await new Promise((done) => other.listen(0, '127.0.0.1', done))
  try {
    expect((await fetch(`http://127.0.0.1:${demo.port}/`)).headers.get('content-security-policy')).toBe(`frame-ancestors 'self' ${demo.embedderOrigin}`)
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

test('search engines may read the demo and are told to leave it out', async () => {
  const get = (path) => fetch(`http://127.0.0.1:${demo.port}${path}`, { headers: { accept: 'text/html' } })
  const robots = await get('/robots.txt')
  expect(robots.headers.get('content-type')).toContain('text/plain')
  const rules = (await robots.text()).split('\n').map((line) => line.trim().toLowerCase())
  expect(rules).toContain('allow: /')
  expect(rules.filter((line) => /^disallow:\s*\S/.test(line))).toEqual([])
  for (const path of ['/', '/robots.txt', '/sw.js', '/game/the-question']) expect((await get(path)).headers.get('x-robots-tag'), path).toBe('noindex')
  const page = await (await get('/')).text()
  expect(page).toContain('<title>Renplay demo</title>')
  expect(page).toMatch(/<meta name="description" content="[^"]+"/)
  expect(page).toContain('<meta name="robots" content="noindex" />')
})

test('a form on another site cannot change the visitor\'s progress', async ({ context, page }) => {
  await page.goto(demo.embedderOrigin)
  await expect.poll(() => ready(page), { timeout: 30000 }).toBe(2)
  const laptop = await (await page.locator('#laptop').elementHandle()).contentFrame()
  const progress = () => laptop.evaluate(() => fetch('/api/games/the-question').then((r) => r.json()).then(({ game }) => [game.notNowAt, game.lastPlayedAt, game.favoriteAt, game.rating, game.playStatus, game.playTime]))
  const unchanged = [null, null, null, null, null, 0]
  expect(await progress()).toEqual(unchanged)
  // The other site: pages that submit a form to the demo, as a top-level navigation the way a link or a button would.
  // The text/plain form is the one that sends a body the demo reads as JSON.
  const forms = {
    '/not-now': { action: '/api/games/the-question/not-now' },
    '/played': { action: '/api/games/the-question/played' },
    '/favorite': { action: '/api/games/the-question/favorite', json: '{"on":true,"x":"' },
    '/rating': { action: '/api/games/the-question/rating', json: '{"rating":5,"x":"' },
    '/status': { action: '/api/games/the-question/status', json: '{"status":"finished","x":"' },
  }
  const other = createServer((req, res) => {
    const form = forms[req.url]
    const fields = form?.json ? `<input name='${form.json}' value='"}'>` : ''
    res.writeHead(form ? 200 : 404, { 'content-type': 'text/html' }).end(form ? `<!doctype html><form method="post" action="${demo.origin}${form.action}" ${form.json ? 'enctype="text/plain"' : ''}>${fields}</form><script>document.forms[0].submit()</script>` : '')
  })
  await new Promise((done) => other.listen(0, '127.0.0.1', done))
  try {
    for (const path of Object.keys(forms)) {
      const attacker = await context.newPage()
      const answered = attacker.waitForResponse((response) => response.url().startsWith(`${demo.origin}/api/`))
      await attacker.goto(`http://127.0.0.1:${other.address().port}${path}`)
      const response = await answered
      // WebKit sends this navigation to the host and not to the worker (the host has no such file and nothing to change).
      // Where the worker has it, it refuses.
      const reachedHost = demo.requests.includes(forms[path].action)
      if (!reachedHost) expect(response.status(), path).toBe(403)
      await attacker.close()
    }
    expect(await progress()).toEqual(unchanged)
    // The demo's own pages still change what playing needs, and not the rest.
    expect(await laptop.evaluate(() => fetch('/api/games/the-question/not-now', { method: 'POST' }).then((r) => r.status))).toBe(403)
    expect(await laptop.evaluate(() => fetch('/api/games/the-question/played', { method: 'POST' }).then((r) => r.status))).toBe(200)
    expect((await progress())[1]).not.toBeNull()
  } finally {
    await new Promise((done) => other.close(done))
  }
})

test('a returning visitor whose browser still has the server demo\'s worker is answered by the stand-in from the first request', async ({ browser }) => {
  test.setTimeout(real ? 240000 : 60000)
  const file = `${demo.dir}/sw.js`
  const standIn = readFileSync(file)
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    // An earlier visit, when this address was the demo with a server: the library's own worker controls the page.
    writeFileSync(file, readFileSync(new URL('../../../../selector/public/sw.js', import.meta.url)))
    await page.goto(`${demo.origin}/demo/snapshot.json`)
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js', { scope: '/' }))
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''), { timeout: 15000 }).toContain('/sw.js')
    // The address is the static demo now, and its worker is slow to arrive.
    writeFileSync(file, standIn)
    demo.delays.set('/sw.js', 2500)
    demo.requests.length = 0
    demo.answers.length = 0
    await page.goto(demo.origin)
    await expect(page.locator('.card[data-id="the-question"]')).toBeVisible({ timeout: 30000 })
    // Every answer came from the stand-in: the old worker would have asked the host, which has no such file. The pictures
    // are the exception: the stand-in leaves them to the host, which has each as a file.
    const picture = (path) => /^\/api\/(art|avatars)\//.test(path)
    expect(demo.requests.filter((path) => path.startsWith('/api/') && !picture(path))).toEqual([])
    await expect.poll(() => demo.answers.filter((a) => picture(a.path)).length).toBe(demo.requests.filter(picture).length)
    expect(demo.answers.filter((a) => picture(a.path) && a.status !== 200)).toEqual([])
    expect(errors).toEqual([])
  } finally {
    demo.delays.clear()
    writeFileSync(file, standIn)
    await context.close()
  }
})

/** The runtime's own request to save a file, from the demo's own page. */
async function saveHere(page) {
  const bytes = [...(await renpySave('A shared scene', Math.floor(Date.now() / 1000)))]
  return page.evaluate(async (data) => {
    const { game } = await (await fetch('/api/games/the-question')).json()
    await fetch('/api/games/the-question/played', { method: 'POST' })
    return (await fetch(`/api/saves/the-question/file?path=${game.saveDir}/1-1-LT1.save`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(data) })).status
  }, bytes)
}

/** The demo as a visitor opens it on its own address, with the library loaded. */
async function visit(page, path = '/') {
  await page.goto(demo.origin + path)
  await expect(page.getByRole('link', { name: 'Catalog', exact: true }).first()).toBeVisible({ timeout: 30000 })
}

const REFUSAL = 'The demo cannot do this. Install your own Renplay to try it.'

test('a visitor can play and name a save, and the library leaves out the rest', async ({ page }) => {
  test.setTimeout(real ? 240000 : 90000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await visit(page)
  expect(await saveHere(page)).toBe(200)
  await page.reload()
  // The library: Resume stays, Not now goes.
  await expect(page.getByRole('link', { name: 'Resume', exact: true }).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0)
  // The game page: no favourite, status or rating, and no download or delete in a save's menu.
  await page.getByRole('link', { name: 'Game page' }).first().click()
  await expect(page.getByRole('heading', { name: 'Your progress' })).toBeVisible()
  await expect(page.getByRole('button', { name: /favourites/i })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Status' })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '3 of 5' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Saves' }).click()
  for (const name of ['History', 'Import', 'Export all', 'Sync code']) await expect(page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true }))).toHaveCount(0)
  await page.getByRole('button', { name: 'Save actions' }).first().click()
  await expect(page.getByRole('button', { name: 'Load', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Name', exact: true })).toBeVisible()
  for (const name of ['Pin', 'Unpin', 'Name and note', 'Download', 'Copy to another game', 'Previous versions', 'Delete']) await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0)
  // Naming a save stays.
  await page.getByRole('button', { name: 'Name', exact: true }).click()
  await expect(page.getByLabel('Note')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Name' }).fill('Before the question')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Before the question')).toBeVisible()
  // The catalog is read only: it says where to add games, and has no button to.
  await page.getByRole('link', { name: 'Catalog', exact: true }).first().click()
  await page.locator('a[href^="/catalog?game="]').first().click()
  await expect(page.getByText('to add games.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add the download' })).toHaveCount(0)
  // Account and settings keep what is this browser's own.
  await visit(page, '/account')
  await expect(page.getByRole('link', { name: 'Play history' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'This browser' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Adult games' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Your saves' })).toHaveCount(0)
  await visit(page, '/settings')
  await expect(page.getByRole('switch', { name: 'Move cards with the pointer' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Blurred', exact: true })).toHaveCount(0)
  // Pages that are not for a visitor lead back to the library.
  for (const path of ['/import-saves', '/add', '/activity', '/settings/users']) {
    await visit(page, path)
    expect(new URL(page.url()).pathname, path).toBe('/')
  }
  expect(errors).toEqual([])
})

test('a hand-made request for anything but playing is refused, and changes nothing', async ({ page }) => {
  test.setTimeout(real ? 240000 : 90000)
  await visit(page)
  expect(await saveHere(page)).toBe(200)
  const state = () => page.evaluate(async () => {
    const { game } = await (await fetch('/api/games/the-question')).json()
    const saves = await (await fetch('/api/saves/the-question')).json()
    const history = await (await fetch('/api/saves/the-question/history')).json()
    return { favoriteAt: game.favoriteAt, rating: game.rating, playStatus: game.playStatus, notNowAt: game.notNowAt, saves: saves.slots.map((x) => [x.file, x.title, x.note, x.pinnedAt]), versions: history.versions.length }
  })
  const before = await state()
  expect(before.saves.length).toBe(1)
  const file = before.saves[0][0]
  const TQ = '/api/saves/the-question', GAME = '/api/games/the-question'
  const hands = [
    ['downloads', 'GET', `${TQ}/download?file=${file}`],
    ['favourites', 'PUT', `${GAME}/favorite`, { on: true }],
    ['ratings', 'PUT', `${GAME}/rating`, { rating: 5 }],
    ['status', 'PUT', `${GAME}/status`, { status: 'finished' }],
    ['Not now', 'POST', `${GAME}/not-now`, {}],
    ['deleting a save', 'DELETE', `${TQ}/slot?file=${file}`],
    ['restoring history', 'POST', `${TQ}/history/restore`, { id: 'x' }],
    ['a note', 'PUT', `${TQ}/meta?file=${file}`, { note: 'A note' }],
    ['a pin', 'PUT', `${TQ}/meta?file=${file}`, { pinned: true }],
    ['importing', 'POST', `${TQ}/import`, {}],
    ['sync codes', 'POST', `${TQ}/sync`, {}],
    ['the account', 'PUT', '/api/me', { name: 'x' }],
    ['the adult level', 'PUT', '/api/me/adult', { level: 'shown' }],
    ['tokens', 'POST', '/api/me/tokens', { name: 'x' }],
    ['people', 'POST', '/api/users', {}],
    ['adding games', 'POST', '/api/imports', {}],
    ['backups', 'POST', '/api/system/backups', {}],
    ['defaults for everyone', 'PUT', '/api/defaults', {}],
  ]
  const answers = await page.evaluate((list) => Promise.all(list.map(async ([kind, method, path, body]) => {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    return [kind, r.status, (await r.json()).error]
  })), hands)
  expect(answers).toEqual(hands.map(([kind]) => [kind, 403, REFUSAL]))
  expect(await state()).toEqual(before)
  // Reads that would hand a file over have nothing to give.
  const reads = await page.evaluate((list) => Promise.all(list.map(async (path) => (await fetch(path)).status)), ['/api/saves-export', `${TQ}/export`, `${GAME}/files`, '/api/jobs/1/log', '/api/system/backups/x.zip'])
  expect(reads.every((status) => status === 403 || status === 404)).toBe(true)
  // What playing needs still works.
  const kept = await page.evaluate(async () => [
    (await fetch('/api/games/the-question/play-time', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"seconds":5}' })).status,
    (await fetch('/api/saves/the-question/boot')).status,
  ])
  expect(kept).toEqual([200, 200])
})
