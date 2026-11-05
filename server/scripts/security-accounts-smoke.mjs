// Local disposable fixtures only. Exercises the rendered production nginx config and real browsers.
import assert from 'node:assert/strict'
import { execFileSync, execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
const execFile = promisify(execFileCallback)
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, webkit } from 'playwright'
import { createApp } from '../dist/app.js'
import { loadConfig } from '../dist/config.js'
import { Db } from '../dist/db.js'

const root = await mkdtemp(join(tmpdir(), 'renplay-security-'))
await chmod(root, 0o755)
const dataDir = join(root, 'data'), gamesDir = join(root, 'games'), internalDir = join(gamesDir, '_renplay')
const cfg = { ...loadConfig(), dataDir, gamesDir, internalDir, savesDir: join(dataDir, 'saves'), saveHistoryDir: join(dataDir, 'save-history'), coversDir: join(dataDir, 'covers'), walkthroughsDir: join(dataDir, 'walkthroughs'), overlaysDir: join(dataDir, 'overlays'), workDir: join(internalDir, 'work'), purgeDir: join(internalDir, 'purge'), archivesDir: join(gamesDir, '_archives'), uploadsDir: join(internalDir, 'uploads'), enginesDir: join(internalDir, 'engines'), catalogUrls: ['http://127.0.0.1:9/none'], auth: 'on', authLocal: true, authUser: 1, adultGames: 'allow', adminUsername: 'admin', adminPassword: 'correct password', publicUrl: '', adultDefault: false }
const db = Db.open(dataDir)
db.setSetting('catalog_cache', { at: Date.now(), games: [{ id: 'safe', title: 'Safe', releases: [] }, { id: 'adult', title: 'Adult', nsfw: true, releases: [] }] })
db.setSetting('catalog_covers', { safe: { file: 'safe.webp' }, adult: { file: 'adult.webp' } }); db.close()
const a = await createApp(cfg, { startJobs: false, runtimePath: resolve('../runtime/renplay-runtime.js') })
const server = a.app.listen(3994, '0.0.0.0')
const container = `renplay-security-${process.pid}`, base = 'http://127.0.0.1:8094'
const shots = process.argv[2] || join(root, 'shots')
// Optional packs copied read-only from real games, containing only original HTML/JS/CSS, never saves/art.
const realHtmlFixtures = process.argv[3]
const browsers = [], pageErrors = [], round2Failures = []
async function round2(label, check) {
  try { await check(); console.log(`PASS ${label}`) }
  catch (error) { round2Failures.push(`${label}: ${error.message}`); console.error(`FAIL ${label}: ${error.message}`) }
}
async function pendingSnapshot(tab, kind) {
  return tab.evaluate((kind) => new Promise((resolve, reject) => {
    const open = indexedDB.open('renplay-html-queue', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('files', 'readonly'), request = tx.objectStore('files').getAll()
      tx.oncomplete = () => { db.close(); resolve(request.result.find((entry) => entry.userId === 1 && entry.path.endsWith(kind === 'idb' ? '/indexedDB.json' : '/localStorage.json'))?.data) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  }), kind)
}
const headers = { 'Sec-Fetch-Site': 'same-origin' }
async function login(context, username = 'admin', password = 'correct password') {
  const response = await context.request.post(`${base}/api/auth/login`, { headers, data: { username, password } })
  assert.equal(response.status(), 200, await response.text())
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)) }
  throw new Error('Timed out waiting for fixture assertion')
}
const page = (label) => `<!doctype html><html><head><title>Security fixture</title></head><body style="background:#182538;color:white;font:20px sans-serif;padding-top:52px"><h1>${label}</h1><button id="popup" style="min-height:44px;margin-right:12px" onclick="if (!window.open(location.href + '?popup=1')) this.textContent = 'Popup unavailable'">Open popup</button><a id="secondary" href="secondary.html">Secondary page</a><script>
window.probe = async function () {
  var isolated = false; try { void window.top.document.cookie } catch (e) { isolated = true }
  var status = 0; try { status = (await fetch('/api/me/tokens', {method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Hostile fixture'})})).status } catch (e) {}
  return {isolated: isolated, origin: window.origin, status:status};
};
</script></body></html>`
try {
  await mkdir(shots, { recursive: true })
  for (const id of ['safe', 'adult', 'html']) {
    a.db.insertGame({ id, title: id === 'html' ? 'Security fixture' : id, recipe_id: id === 'html' ? 'safe' : id, adult: id === 'adult' ? 1 : 0, status: 'installed', build: 'b1', save_dir: id, family: id === 'html' ? 'html' : 'renpy', entry: id === 'html' ? 'index.html' : '', walkthrough: `${id}.pdf` })
    const dir = join(gamesDir, id, 'b1'); await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'game.zip'), 'Static fixture')
    await writeFile(join(cfg.coversDir, `${id}.webp`), 'cover')
    await writeFile(join(cfg.walkthroughsDir, `${id}.pdf`), 'pdf')
  }
  const primary = page('Hostile HTML fixture'), secondary = page('Secondary HTML fixture')
  const htmlDir = join(gamesDir, 'html', 'b1')
  const assets = { 'index.html': primary, 'secondary.html': secondary, 'attack.htm': secondary,
    'attack.html.gz': secondary, 'attack.html.br': secondary, 'attack.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'attack.svg.br': '<svg xmlns="http://www.w3.org/2000/svg"/>', 'attack.xml': '<root/>',
    'attack.xml.gz': '<root/>', 'attack.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body>Fixture</body></html>', 'attack.html.gz.br': secondary, unknown: secondary,
    'image #1.png': 'image hash', '100%.png': 'image percent', 'what?.png': 'image question' }
  let offset = 0
  const index = Object.fromEntries(Object.entries(assets).map(([name, data]) => { const entry = [offset, Buffer.byteLength(data)]; offset += entry[1]; return [name, entry] }))
  await writeFile(join(htmlDir, 'assets.pack'), Object.values(assets).join(''))
  await writeFile(join(htmlDir, 'assets.json'), JSON.stringify(index))
  if (realHtmlFixtures) for (const id of ['college-daze', 'risky-stream']) {
    const dir = join(gamesDir, id, 'b1'); await mkdir(dir, { recursive: true })
    const entry = await readFile(join(realHtmlFixtures, id, 'entry.txt'), 'utf-8')
    a.db.insertGame({ id, title: id, recipe_id: 'safe', status: 'installed', build: 'b1', save_dir: id, family: 'html', entry })
    for (const file of ['assets.pack', 'assets.json']) await writeFile(join(dir, file), await readFile(join(realHtmlFixtures, id, file)))
  }
  const template = await readFile('../deploy/nginx.conf.template', 'utf-8')
  const rendered = template.replaceAll('${GAMES_DIR}', '/fixture/games').replaceAll('${DATA_DIR}', '/fixture/data').replaceAll('${RENPLAY_DIR}', '/fixture/games/_renplay').replaceAll('127.0.0.1:3000', 'host.docker.internal:3994')
  await writeFile(join(root, 'nginx.conf'), rendered)
  execFileSync('docker', ['run', '--rm', '-d', '--name', container, '-p', '127.0.0.1:8094:8080', '-v', `${root}:/fixture`, '-v', `${root}/nginx.conf:/etc/nginx/nginx.conf:ro`, '-v', `${resolve('../selector/dist')}:/app/web:ro`, '-v', `${resolve('../runtime')}:/app/runtime:ro`, 'nginx:alpine', 'sh', '-c', 'mkdir -p /tmp/nginx/client_body /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi /tmp/nginx/auth && chmod -R 777 /tmp/nginx && nginx -g "daemon off;"'])
  await until(async () => { try { return (await fetch(`${base}/api/health`)).ok } catch { return false } })
  execFileSync('docker', ['exec', container, 'nginx', '-t'])
  for (const [name, engine, viewport] of [['desktop', chromium, { width: 1440, height: 900 }], ['phone', webkit, { width: 390, height: 844 }]]) {
    const browser = await engine.launch(); browsers.push(browser)
    const context = await browser.newContext({ viewport, ...(name === 'phone' ? { isMobile: true, hasTouch: true } : {}) })
    if (realHtmlFixtures) await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '{}' }))
    const tab = await context.newPage(), cancelledPuts = new Set()
    tab.on('pageerror', (error) => {
      // WebKit also reports the deliberately cancelled, held PUT on page destruction.
      if (name === 'phone' && cancelledPuts.delete(error.message)) return
      // WebKit emits these expected failed hostile fetches as pageerror even though JS catches them.
      if (name === 'phone' && /\/api\/me(?:\/tokens)? due to access control checks\.$/.test(error.message)) return
      pageErrors.push(`${name}: ${error.message}`)
    })
    await login(context)
    if (name === 'desktop') {
      const added = await context.request.post(`${base}/api/users`, { headers, data: { username: 'player', password: 'player password' } })
      assert.equal(added.status(), 201)
      const restricted = await browser.newContext(); await login(restricted, 'player', 'player password')
      for (const path of ['/g//adult/b1/game.zip', '/g/adult//b1/game.zip', '/api/covers//adult.webp', '/api/walkthroughs//adult.pdf', '/g/%61dult/b1/game.zip', '/g/safe/b1/../../adult/b1/game.zip']) {
        // curl --path-as-is avoids the client's own normalization.
        const cookie = (await restricted.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
        const { stdout: status } = await execFile('curl', ['--path-as-is', '-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', `Cookie: ${cookie}`, `${base}${path}`], { encoding: 'utf-8' })
        assert.equal(status, '403', path)
      }
      assert.equal((await restricted.request.get(`${base}/g/safe/b1/game.zip`)).status(), 200)
      assert.equal((await restricted.request.get(`${base}/api/covers/safe.webp`)).status(), 200)
      await restricted.close()
    }
    const game = (await (await context.request.get(`${base}/api/games/html`)).json()).game
    const url = `${base}${game.playUrl}`
    for (const asset of ['attack.html.gz', 'attack.html.br']) await round2(`${name} ${asset} token theft`, async () => {
      const target = url.replace('index.html', asset)
      const response = await tab.goto(target)
      const result = await tab.evaluate(() => window.probe())
      const tokens = a.db.raw.prepare('SELECT COUNT(*) n FROM tokens').get().n
      console.log(`${name} ${asset}: type=${response.headers()['content-type']}, CSP=${response.headers()['content-security-policy']}, origin=${result.origin}, token status=${result.status}, tokens=${tokens}`)
      // Disposable hostile tokens must not affect subsequent fixtures when reproducing the old code.
      a.db.raw.prepare('DELETE FROM tokens').run()
      assert.equal(tokens, 0)
      assert.equal(result.origin, 'null')
      assert.match(response.headers()['content-security-policy'], /^sandbox /)
    })
    for (const asset of Object.keys(assets)) await round2(`${name} pack headers/encoded filename ${asset}`, async () => {
      const response = await context.request.get(url.replace('index.html', encodeURIComponent(asset)))
      assert.equal(response.status(), 200)
      assert.match(response.headers()['content-security-policy'], /^sandbox /)
      assert.equal(response.headers()['x-content-type-options'], 'nosniff')
    })
    for (const asset of ['index.html', 'secondary.html', 'attack.htm', 'attack.xhtml', 'attack.svg', 'attack.xml', 'attack.html.gz', 'attack.html.br', 'attack.svg.br', 'attack.xml.gz']) {
      await tab.goto(url.replace('index.html', asset))
      const result = await tab.evaluate(async () => {
        let status = 0
        // A normal same-origin fetch must not act as the signed-in owner from this document.
        try { status = (await fetch('/api/me')).status } catch {}
        return { origin: self.origin, status }
      })
      assert.equal(result.origin, 'null', `${name} ${asset} opaque document origin`)
      assert([0, 401, 403].includes(result.status), `${name} ${asset}: /api/me status ${result.status}`)
    }
    for (const asset of [url, url.replace('index.html', 'secondary.html')]) {
      const response = await context.request.get(asset)
      assert.match(response.headers()['content-security-policy'], /^sandbox /)
      assert(!response.headers()['content-security-policy'].includes('allow-same-origin'))
      await tab.goto(asset)
      const result = await tab.evaluate(() => window.probe())
      assert.equal(result.origin, 'null', `${name} direct/secondary origin`)
    }
    assert.equal((await context.request.get(`${base}/g/html/b1/game/index.html?/s/forged`)).status(), 403)
    await tab.goto(`${base}/play/html`)
    await tab.frameLocator('iframe').locator('#popup').waitFor()
    if (name === 'phone') await tab.getByRole('button', { name: 'Play upright anyway' }).click()
    const iframe = tab.frames().find((f) => f.url().includes('/game/index.html'))
    assert.equal((await iframe.evaluate(() => window.probe())).isolated, true)
    const popupWait = context.waitForEvent('page', { timeout: 3000 }).catch(() => null)
    await tab.frameLocator('iframe').locator('#popup').click()
    const popup = await popupWait
    if (popup) {
      await popup.waitForLoadState()
      assert.equal((await popup.evaluate(() => window.probe())).origin, 'null')
      await popup.close()
    } else {
      assert.equal(await tab.frameLocator('iframe').locator('#popup').textContent(), 'Popup unavailable')
      console.log(`${name}: browser refused the popup; fixture degraded gracefully`)
    }
    await tab.frameLocator('iframe').locator('#secondary').click()
    await tab.frameLocator('iframe').getByRole('heading', { name: 'Secondary HTML fixture' }).waitFor()
    assert.equal((await tab.frames().find((f) => f.url().includes('secondary.html')).evaluate(() => window.probe())).origin, 'null')
    assert.equal(a.db.raw.prepare('SELECT COUNT(*) n FROM tokens').get().n, 0)
    await tab.screenshot({ path: join(shots, `${name}-sandbox.png`) })
    await tab.frames().find((f) => f.url().includes('secondary.html')).evaluate(() => parent.postMessage({ type: 'renplay:legacy-saves', userId: 1 }, '*'))
    const notice = tab.getByRole('status').filter({ hasText: 'Unowned browser saves' })
    await notice.waitFor()
    await tab.screenshot({ path: join(shots, `${name}-legacy-notice.png`) })
    if (name === 'phone') {
      await tab.setViewportSize({ width: 844, height: 390 })
      await tab.screenshot({ path: join(shots, 'phone-landscape-legacy-notice.png') })
      const bounds = await notice.boundingBox()
      assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.y + bounds.height <= 390)
      await tab.setViewportSize(viewport)
    }
    await notice.getByRole('button', { name: 'Dismiss' }).click()
    if (name === 'desktop') {
      // Durable HTML recovery across actual page destruction and account switches.
      await tab.goto(`${base}/play/html`)
      await tab.frameLocator('iframe').locator('#popup').waitFor()
      await context.route('**/api/saves/**', (route) => route.abort())
      await tab.frameLocator('iframe').locator('body').evaluate(() => localStorage.setItem('offline', 'A'))
      await tab.getByRole('dialog', { name: 'You were signed out' }).waitFor()
      await tab.screenshot({ path: join(shots, 'desktop-offline-queue.png') })
      await tab.goto(`${base}/`)
      await context.unroute('**/api/saves/**')
      await context.request.post(`${base}/api/auth/logout`, { headers })
      await login(context, 'player', 'player password')
      await tab.goto(`${base}/play/html`)
      await tab.frameLocator('iframe').locator('#popup').waitFor()
      assert.equal(await tab.frameLocator('iframe').locator('body').evaluate(() => localStorage.getItem('offline')), null)
      await tab.frameLocator('iframe').locator('body').evaluate(() => localStorage.setItem('online', 'B'))
      await until(async () => (await readFile(join(dataDir, 'users', '2', 'saves', 'html', 'localStorage.json'), 'utf-8').catch(() => '')).includes('B'))
      await tab.goto(`${base}/`)
      await context.request.post(`${base}/api/auth/logout`, { headers }); await login(context)
      await tab.goto(`${base}/play/html`)
      await tab.frameLocator('iframe').locator('#popup').waitFor()
      assert.equal(await tab.frameLocator('iframe').locator('body').evaluate(() => localStorage.getItem('offline')), 'A')
      assert.match(await readFile(join(dataDir, 'users', '1', 'saves', 'html', 'localStorage.json'), 'utf-8'), /"offline":"A"/)
    }
    // Hold the first network PUT indefinitely. Later snapshots must reach durable parent storage
    // (and be acknowledged) before that PUT finishes, for both supported storage APIs.
    for (const kind of ['local', 'idb']) await round2(`${name} stalled PUT ${kind}: second snapshot survives reload`, async () => {
      await tab.goto(`${base}/play/html`)
      await tab.frameLocator('iframe').locator('#popup').waitFor()
      let held = false, release
      const stall = new Promise((resolve) => { release = resolve })
      const routePattern = '**/api/saves/**'
      await context.route(routePattern, async (route) => {
        if (route.request().method() === 'PUT' && !held) {
          held = true
          cancelledPuts.add(`${route.request().url().replace(/^https?:\//, '')} due to access control checks.`)
          await stall
          await route.fulfill({ status: 503, body: '{}' }).catch(() => {})
        } else await route.continue()
      })
      const write = (value) => tab.frameLocator('iframe').locator('body').evaluate(async (_body, { kind, value }) => {
        if (kind === 'local') { localStorage.setItem('progress', value); return }
        await new Promise((resolve, reject) => {
          const open = indexedDB.open('progress', 1)
          open.onupgradeneeded = () => open.result.createObjectStore('saves')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result, tx = db.transaction('saves', 'readwrite')
            tx.objectStore('saves').put(value, 'progress')
            tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error)
          }
        })
      }, { kind, value })
      let snapshot
      try {
        await write(`first-${name}-${kind}`); await until(() => held)
        await write(`second-${name}-${kind}`); await tab.waitForTimeout(3200)
        snapshot = await pendingSnapshot(tab, kind)
        console.log(`${name} ${kind} durable queue while PUT held: ${snapshot}`)
        // Destroy the game without starting another library boot that the next navigation aborts.
        await tab.goto('about:blank')
      } finally { await context.unroute(routePattern); release() }
      await tab.goto(`${base}/play/html`)
      await tab.frameLocator('iframe').locator('#popup').waitFor()
      const file = kind === 'idb' ? 'indexedDB.json' : 'localStorage.json'
      const restored = await readFile(join(dataDir, 'users', '1', 'saves', 'html', file), 'utf-8')
      assert.match(snapshot ?? '', /second/, 'Second snapshot must be durable while first upload is stalled')
      assert.match(restored, /second/, 'Reload must replay the second snapshot to the server')
    })
    if (realHtmlFixtures) for (const id of ['college-daze', 'risky-stream']) {
      await tab.goto(`${base}/play/${id}`)
      if (name === 'phone') await tab.getByRole('button', { name: 'Play upright anyway' }).click()
      await tab.frameLocator('iframe').locator(id === 'college-daze' ? '#story' : '#root').waitFor()
      let frame = tab.frames().find((f) => f.url().includes(`/g/${id}/`))
      await until(() => frame.evaluate((game) => game === 'college-daze' ? !!window.SugarCube : !!document.querySelector('#root')?.textContent, id))
      assert.equal(await frame.evaluate(() => window.origin), 'null')
      if (id === 'college-daze') {
        // Its bundled FileSaver uses downloads in modern browsers, with a popup fallback on older ones.
        const download = tab.waitForEvent('download', { timeout: 10000 })
        await frame.evaluate(() => {
          const button = document.createElement('button'); button.id = 'renplay-test-export'; button.textContent = 'Export save'
          button.style.cssText = 'position:fixed;bottom:100px;right:20px;z-index:2147483647;min-height:44px'
          button.onclick = () => SugarCube.Save.export('renplay-security-fixture')
          document.body.append(button)
        })
        await tab.frameLocator('iframe').locator('#renplay-test-export').click()
        const exported = await download
        assert.match(exported.suggestedFilename(), /renplay-security-fixture/)
      }
      // These are disposable local copies: exercise storage, never touch the installed game's saves.
      if (id === 'college-daze') assert.equal(await frame.evaluate(() => SugarCube.Save.slots.save(0, 'Local security fixture')), true)
      if (id === 'risky-stream') {
        // Use its bundled persistence library and normal IndexedDB driver, not a substitute.
        assert.equal(await frame.evaluate(async () => {
          await localforage.setItem('renplay-security-idb', { progress: 'durable IndexedDB fixture' })
          return localforage.driver()
        }), 'asyncStorage')
        await until(async () => (await readFile(join(dataDir, 'users', '1', 'saves', id, 'indexedDB.json'), 'utf-8').catch(() => '')).includes('durable IndexedDB fixture'))
      }
      await frame.evaluate(() => localStorage.setItem('renplay-security-save', 'durable fixture'))
      const localSave = join(dataDir, 'users', '1', 'saves', id, 'localStorage.json')
      await until(async () => (await readFile(localSave, 'utf-8').catch(() => '')).includes('durable fixture'))
      await tab.reload()
      if (name === 'phone') await tab.getByRole('button', { name: 'Play upright anyway' }).click()
      await tab.frameLocator('iframe').locator(id === 'college-daze' ? '#story' : '#root').waitFor()
      frame = tab.frames().find((f) => f.url().includes(`/g/${id}/`))
      assert.equal(await frame.evaluate(() => localStorage.getItem('renplay-security-save')), 'durable fixture')
      if (id === 'college-daze') {
        await until(() => frame.evaluate(() => !!window.SugarCube))
        assert.equal(await frame.evaluate(() => SugarCube.Save.slots.has(0)), true)
      } else {
        assert.deepEqual(await frame.evaluate(() => localforage.getItem('renplay-security-idb')), { progress: 'durable IndexedDB fixture' })
      }
      console.log(`${name}: ${id} localStorage and ${id === 'college-daze' ? 'SugarCube slot' : 'localForage IndexedDB'} saves survived reload`)
      // Exercise the game environment's native popup behavior without following any external website.
      await frame.evaluate(() => {
        const button = document.createElement('button'); button.id = 'renplay-test-popup'; button.textContent = 'Test popup'
        button.style.cssText = 'position:fixed;bottom:40px;right:20px;z-index:2147483647;min-height:44px'
        button.onclick = () => { if (!window.open('about:blank')) button.textContent = 'Popup unavailable' }
        document.body.append(button)
      })
      const opened = context.waitForEvent('page', { timeout: 3000 }).catch(() => null)
      await tab.frameLocator('iframe').locator('#renplay-test-popup').click()
      const popup = await opened
      if (popup) {
        const isolation = await popup.evaluate(() => {
          let parentBlocked = false
          try { void window.opener.top.document.cookie } catch { parentBlocked = true }
          try { document.cookie = 'sandbox_escape_probe=forbidden; path=/' } catch {}
          return { origin: window.origin, parentBlocked }
        })
        assert.equal(isolation.origin, 'null')
        assert.equal(isolation.parentBlocked, true)
        assert(!(await context.cookies()).some((cookie) => cookie.name === 'sandbox_escape_probe'))
        await popup.close()
      } else assert.equal(await tab.frameLocator('iframe').locator('#renplay-test-popup').textContent(), 'Popup unavailable')
      console.log(`${name}: ${id} original HTML/code loaded with opaque origin; popup stayed sandboxed`)
    }
    await context.route('https://evil.example/**', (route) => route.fulfill({ body: 'Blocked external redirect fixture' }))
    await tab.goto(`${base}/signin?return=${encodeURIComponent('/\n/evil.example')}`)
    await tab.getByLabel('Username', { exact: true }).fill('admin')
    await tab.getByLabel('Password', { exact: true }).fill('correct password')
    await tab.getByRole('button', { name: 'Sign in', exact: true }).click()
    await until(() => !tab.url().includes('/signin'))
    assert.equal(tab.url(), `${base}/`, 'Sign-in return must stay on the canonical same origin')
    assert(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await context.close()
    console.log(`${name}: direct navigation, secondary page, popup, forged query and opaque origin passed`)
  }
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(round2Failures, [])
  console.log('Rendered nginx: normalized static authorization passed; HTML A → offline write → B → A reached A’s real server folder. No unexpected page errors (WebKit reports the deliberately blocked hostile fetches).')
  console.log(`Screenshots: ${shots}`)
} finally {
  for (const browser of browsers) await browser.close()
  try {
    if (process.env.DEBUG_NGINX) console.log(execFileSync('docker', ['logs', container], { encoding: 'utf-8' }))
    execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
  } catch {}
  await new Promise((resolve) => server.close(resolve)); a.close()
  await rm(root, { recursive: true, force: true })
}
