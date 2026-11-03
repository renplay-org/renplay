import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { renderPage } from '../routes/play.js'
import { cleanRelPath, safeJoin } from '../util/paths.js'

function zipBuffer(entries: Record<string, Buffer | string>): Promise<Buffer> {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile()
    for (const [k, v] of Object.entries(entries)) z.addBuffer(Buffer.from(v), k)
    z.end()
    const chunks: Buffer[] = []
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

/** The relevant parts of Ren'Py 8.5's web index.html. */
const TEMPLATE = `<!doctype html><html><head><title>Ren'Py Web Game</title><meta name="viewport" content="width=device-width">
<link rel="manifest" href="manifest.json" crossorigin="use-credentials" />
<link rel="icon" href="icons/icon-72x72.png" sizes="72x72" type="image/png" />
</head><body><img id="presplash" src="web-presplash.jpg">
<script>
  window.gameZipURL = 'game.zip';
  if (navigator.serviceWorker) { navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'all' }); }
</script>
<script src="renpy-pre.js"></script>
<script async type="text/javascript" src="renpy.js"></script>
</body></html>`

describe('HTTP API', () => {
  let app: App
  let root: string
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-api-'))
    // An installed engine pack and one installed build.
    const engine = join(root, 'games', '_renplay', 'engines', '8.5.3')
    mkdirSync(engine, { recursive: true })
    writeFileSync(join(engine, 'index.html'), TEMPLATE)
    writeFileSync(join(engine, '.ready'), '{}')
    const build = join(root, 'games', 'fixture-game', 'b1')
    mkdirSync(build, { recursive: true })
    writeFileSync(join(build, 'game.zip'), await zipBuffer({ 'game/script.rpyc': 'x', 'game/renpyweb_remote_files.txt': 'images/a b.png\nimage 1920,1080\n' }))
    writeFileSync(join(build, 'assets.pack'), 'xxpng0123456789')
    writeFileSync(join(build, 'assets.json'), JSON.stringify({ 'images/a b.png': [2, 3], 'movies/m.webm': [5, 10] }))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    // A leftover database of renplay 2.0 is dropped.
    mkdirSync(join(root, 'data'), { recursive: true })
    writeFileSync(join(root, 'data', 'renplay.db'), 'old')
    app = await createApp(loadConfig(), { startJobs: false })
    app.db.insertGame({ id: 'fixture-game', title: 'Fixture Game', status: 'installed', engine: '8.5.3', build: 'b1', save_dir: 'MyGame-1234567890', screen_w: 1920, screen_h: 1080 })
  })
  afterAll(() => app?.close())

  it('replaced the old database', () => {
    expect(() => readFileSync(join(root, 'data', 'renplay.db'))).toThrow()
    expect(readFileSync(join(root, 'data', 'library.db')).length).toBeGreaterThan(0)
  })

  it('lists games by id with their play URL', async () => {
    const res = await request(app.app).get('/api/games').expect(200)
    expect(res.body.games[0]).toMatchObject({ id: 'fixture-game', title: 'Fixture Game', status: 'installed', engine: '8.5.3', playUrl: '/g/fixture-game/b1/', screen: [1920, 1080] })
  })

  it('offers a reinstall only while the archive is in the archives folder', async () => {
    mkdirSync(join(root, 'games', '_archives'), { recursive: true })
    writeFileSync(join(root, 'games', '_archives', 'Fixture-1.0-pc.zip'), 'zip')
    app.db.updateGame('fixture-game', { source: JSON.stringify({ archive: 'Fixture-1.0-pc.zip', size: 3 }) })
    const canReinstall = async () => (await request(app.app).get('/api/games').expect(200)).body.games[0].canReinstall
    expect(await canReinstall()).toBe(true)
    await request(app.app).delete('/api/archives?path=Fixture-1.0-pc.zip').expect(200)
    expect(await canReinstall()).toBe(false)
  })

  it('serves an HTML game’s page with the runtime and its stored localStorage first', async () => {
    const page = '<!doctype html><html><head><title>Story</title><script>window.gameScript = 1</script></head><body></body></html>'
    const other = '<p>credits</p>'
    const build = join(root, 'games', 'twine-story', 'h1')
    mkdirSync(build, { recursive: true })
    writeFileSync(join(build, 'assets.pack'), page + other)
    writeFileSync(join(build, 'assets.json'), JSON.stringify({ 'Story Page.html': [0, page.length], 'credits.html': [page.length, other.length] }))
    app.db.insertGame({ id: 'twine-story', title: 'Story', status: 'installed', build: 'h1', family: 'html', engine_label: 'SugarCube 2.36.1 (Twine)', entry: 'Story Page.html', save_dir: 'story' })
    await app.saves.write('story', 'localStorage.json', Buffer.from(JSON.stringify({ 'story.saves': '{"slots":[1]}' })))

    const g = (await request(app.app).get('/api/games/twine-story').expect(200)).body.game
    expect(g).toMatchObject({ family: 'html', engineLabel: 'SugarCube 2.36.1 (Twine)', playUrl: '/g/twine-story/h1/game/Story%20Page.html' })
    expect((await request(app.app).get('/g/twine-story/h1/').expect(302)).headers.location).toBe('/g/twine-story/h1/game/Story%20Page.html')

    const res = await request(app.app).get('/g/twine-story/h1/game/Story%20Page.html').expect(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['access-control-allow-origin']).toBe('*')
    const at = (s: string) => res.text.indexOf(s)
    expect(at('window.__renplay=')).toBeGreaterThan(at('<head>'))
    expect(at('window.__renplay=')).toBeLessThan(at('window.gameScript'))
    expect(at("renplay:' + type")).toBeGreaterThan(at('window.__renplay='))
    expect(res.text).toContain('"story.saves":"{\\"slots\\":[1]}"')
    // Other pages of the game are plain files.
    const plain = await request(app.app).get('/g/twine-story/h1/game/credits.html').expect(200)
    expect(plain.text).toBe(other)
    expect(plain.headers['content-type']).toBe('text/html; charset=utf-8')
    await app.saves.remove('story', 'localStorage.json', 'test')
  })

  it('renders the game page from the engine template', async () => {
    const res = await request(app.app).get('/g/fixture-game/b1/').expect(200)
    expect(res.text).toContain('<title>Fixture Game</title>')
    expect(res.text).toContain('window.__renplay=')
    expect(res.text).toContain('src="/engine/8.5.3/renpy-pre.js"')
    expect(res.text).toContain('src="/engine/8.5.3/web-presplash.jpg"')
    expect(res.text).not.toMatch(/src="[^"]*renpy\.js"/)
    expect(res.text).not.toContain('manifest.json')
    expect(res.text).not.toMatch(/navigator\.serviceWorker\.register\(/)
    expect(res.text.indexOf('__renplayLate')).toBeGreaterThan(res.text.indexOf('renpy-pre.js'))
    await request(app.app).get('/g/fixture-game/old/').expect(302)
  })

  it('serves mod builds with fallback to the base build', async () => {
    const mod = join(root, 'games', 'fixture-game', 'b1.mabc')
    mkdirSync(mod, { recursive: true })
    writeFileSync(join(mod, 'game.zip'), 'modded')
    app.db.updateGame('fixture-game', { build: 'b1.mabc' })
    try {
      expect((await request(app.app).get('/g/fixture-game/b1.mabc/game.zip').responseType('blob').expect(200)).body.toString()).toBe('modded')
      expect((await request(app.app).get('/g/fixture-game/b1.mabc/game/images/a%20b.png').responseType('blob').expect(200)).body.toString()).toBe('png')
    } finally {
      app.db.updateGame('fixture-game', { build: 'b1' })
    }
  })

  it('serves streamed files from the pack, with byte ranges', async () => {
    const r = await request(app.app).get('/g/fixture-game/b1/game/images/a%20b.png').responseType('blob').expect(200)
    expect(r.body.toString()).toBe('png')
    expect(r.headers['content-type']).toBe('image/png')
    expect(r.headers['cache-control']).toContain('immutable')
    const part = await request(app.app).get('/g/fixture-game/b1/game/movies/m.webm').set('Range', 'bytes=2-4').responseType('blob').expect(206)
    expect(part.body.toString()).toBe('234')
    expect(part.headers['content-range']).toBe('bytes 2-4/10')
    await request(app.app).get('/g/fixture-game/b1/game/movies/m.webm').set('Range', 'bytes=20-').expect(416)
    await request(app.app).get('/g/fixture-game/b1/game/missing.png').expect(404)
    await request(app.app).get('/g/fixture-game/b1/game/..%2F..%2Fsecret').expect(404)
  })

  it('stores bytecode caches for the current build only', async () => {
    const put = (name: string, build = 'b1') => request(app.app).put(`/api/games/fixture-game/cache?build=${build}&name=${encodeURIComponent(name)}`).set('content-type', 'application/octet-stream').send(Buffer.alloc(64, 1))
    await put('bytecode-312.rpyb').expect(200)
    await put('rpyc/chapters/week1.rpyc').expect(200)
    await put('bytecode-312.rpyb', 'old').expect(409)
    await put('evil.py').expect(400)
    await put('rpyc/../../b1/game.zip').expect(400)
    const page = await request(app.app).get('/g/fixture-game/b1/').expect(200)
    const caches = JSON.parse(page.text.match(/"caches":(\[[^\]]*\])/)![1]!).map((c: { name: string }) => c.name).sort()
    expect(caches).toEqual(['bytecode-312.rpyb', 'rpyc/chapters/week1.rpyc'])
  })

  it('stores saves written by the game and serves them back at boot', async () => {
    const save = await zipBuffer({ log: 'x', json: '{"_save_name":"From test"}', 'screenshot.png': 'png' })
    await request(app.app).put('/api/saves/fixture-game/file?path=MyGame-1234567890/1-1-LT1.save').set('content-type', 'application/octet-stream').set('x-mtime', '1700000000000').send(save).expect(200)
    await request(app.app).put('/api/saves/fixture-game/file?path=tokens/security_keys.txt').set('content-type', 'application/octet-stream').send(Buffer.from('signing-key A B\n')).expect(200)
    // Another game's folder is part of the shared tree but only listed at boot.
    await request(app.app).put('/api/saves/fixture-game/file?path=Season1-1/9-9-LT1.save').set('content-type', 'application/octet-stream').send(Buffer.from('s1')).expect(200)

    const boot = (await request(app.app).get('/api/saves/fixture-game/boot').expect(200)).body
    expect(boot.saveDir).toBe('MyGame-1234567890')
    expect(boot.files.map((f: any) => f.path).sort()).toEqual(['MyGame-1234567890/1-1-LT1.save', 'tokens/security_keys.txt'])
    expect(boot.lazy).toEqual([expect.objectContaining({ path: 'Season1-1/9-9-LT1.save', size: 2 })])

    const slots = (await request(app.app).get('/api/saves/fixture-game').expect(200)).body
    expect(slots.slots).toEqual([expect.objectContaining({ file: '1-1-LT1.save', name: 'From test', kind: 'manual' })])
  })

  it('learns the screen size and save folder from the running game', async () => {
    app.db.updateGame('fixture-game', { screen_w: 0, screen_h: 0 })
    await request(app.app).post('/api/saves/fixture-game/save-dir').send({ saveDir: 'MyGame-1234567890', screen: [1280, 720] }).expect(200)
    expect((await request(app.app).get('/api/games/fixture-game')).body.game.screen).toEqual([1280, 720])
  })

  it('exports a recipe', async () => {
    const res = await request(app.app).get('/api/games/fixture-game/recipe').expect(200)
    expect(res.body.yaml).toMatch(/^# yaml-language-server: \$schema=https:\/\/renplay-web\.github\.io\/catalog\/recipe\.schema\.json\nid: fixture-game\n/)
    expect(res.body.yaml).toContain('saveDir: MyGame-1234567890')
    expect(res.body.yaml).toContain('engine: renpy')
    expect(res.body.yaml).toContain('runtime: 8.5.3')
  })

  it('refuses unsafe paths', async () => {
    await request(app.app).put('/api/saves/fixture-game/file?path=../../etc/passwd').send(Buffer.from('x')).expect(400)
    await request(app.app).get('/api/saves/..%2F..%2Fx/boot').expect(400)
    await request(app.app).get('/g/fixture-game/b1/..%2F..%2F_renplay/engines/8.5.3/.ready').expect(404)
  })

  it('creates uploads at /api/uploads without a trailing slash', async () => {
    const r = await request(app.app).post('/api/uploads').send({ name: 'Game-1.0-pc.zip', size: 10 }).expect(200)
    expect(r.body.id).toMatch(/^u/)
  })

  it('keeps saves when a game is uninstalled', async () => {
    await request(app.app).delete('/api/games/fixture-game').expect(200)
    const g = (await request(app.app).get('/api/games/fixture-game')).body.game
    expect(g).toMatchObject({ status: 'not_installed', playUrl: null })
    expect(g.saves.count).toBe(1)
  })
})

describe('paths', () => {
  it('rejects traversal', () => {
    for (const bad of ['../a', 'a/../../b', '/etc/passwd', 'C:/x', 'a\0b', '']) expect(() => cleanRelPath(bad)).toThrow()
    expect(cleanRelPath('./game//images/a.png')).toBe('game/images/a.png')
    expect(() => safeJoin('/base', '../x')).toThrow()
  })
})

describe('renderPage', () => {
  it('uses the build presplash and lists caches', () => {
    const html = renderPage(TEMPLATE, { id: 's', build: 'b', title: 'T <x>', engine: '8.5.3', saveDir: null, screen: null, caches: [{ name: 'bytecode-312.rpyb', v: '1' }], presplash: 'web-presplash.webp', runtimeVersion: 'v' })
    expect(html).toContain('<title>T &lt;x&gt;</title>')
    expect(html).toContain('src="web-presplash.webp"')
    expect(html).toContain('"caches":[{"name":"bytecode-312.rpyb","v":"1"}]')
    expect(html).toContain('viewport-fit=cover')
  })
})
