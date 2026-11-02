import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { renderIndex } from '../routes/play.js'
import { cleanRelPath, safeJoin } from '../util/paths.js'

const fx = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures.json'), 'utf-8')) as Record<string, string>

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

const INDEX = `<!doctype html><html><head><title>Fixture Game</title><meta name="viewport" content="width=device-width"></head><body>
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
    const game = join(root, 'games', 'fixture-game')
    mkdirSync(game, { recursive: true })
    writeFileSync(join(game, 'index.html'), INDEX)
    writeFileSync(
      join(game, 'game.zip'),
      await zipBuffer({ 'game/options.rpyc': Buffer.from(fx['rpyc_define']!, 'base64'), 'game/renpyweb_remote_files.txt': 'images/a.png\nimage 1920,1080\n' }),
    )
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    app = await createApp(loadConfig(), { startJobs: true })
    // Wait for the analysis job queued by the startup scan.
    for (let i = 0; i < 50 && app.jobs.isBusy(); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 300))
  })
  afterAll(() => app?.close())

  it('adopts an existing web build and detects its save folder', async () => {
    const res = await request(app.app).get('/api/games').expect(200)
    const g = res.body.games[0]
    expect(g).toMatchObject({ slug: 'fixture-game', title: 'Fixture Game', status: 'installed', layout: 'legacy', saveDir: 'MyGame-1234567890', screen: [1920, 1080] })
    expect(g.playUrl).toMatch(/^\/g\/fixture-game\/l[0-9a-f]+\/$/)
  })

  it('serves the game page with the runtime wired in', async () => {
    const g = (await request(app.app).get('/api/games/fixture-game')).body.game
    const res = await request(app.app).get(g.playUrl).expect(200)
    expect(res.text).toContain('window.__renplay=')
    expect(res.text).toContain('/renplay/runtime.js')
    expect(res.text).toContain("window.gameZipURL = 'game.zip?r=0'")
    expect(res.text).not.toMatch(/navigator\.serviceWorker\.register\(/)
    expect(res.text.indexOf('__renplayLate')).toBeGreaterThan(res.text.indexOf('renpy-pre.js'))
    await request(app.app).get('/g/fixture-game/stale/').expect(302)
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
    const raw = await request(app.app).get('/api/saves/fixture-game/raw?path=Season1-1/9-9-LT1.save').expect(200)
    expect(Buffer.from(raw.body).toString()).toBe('s1')

    const slots = (await request(app.app).get('/api/saves/fixture-game').expect(200)).body
    expect(slots.slots).toEqual([expect.objectContaining({ file: '1-1-LT1.save', name: 'From test', kind: 'manual' })])
    await request(app.app).get(slots.slots[0].screenshot).expect(200)
  })

  it('answers keepalive requests with headers right away', async () => {
    const res = await request(app.app).get('/api/keepalive?hold=0').expect(200)
    expect(res.text).toMatch(/idle|busy/)
  })

  it('refuses unsafe save paths', async () => {
    await request(app.app).put('/api/saves/fixture-game/file?path=../../etc/passwd').send(Buffer.from('x')).expect(400)
    await request(app.app).put('/api/saves/fixture-game/file?path=persistent').send(Buffer.from('x')).expect(400)
    await request(app.app).get('/api/saves/..%2F..%2Fx/boot').expect(400)
  })

  it('keeps saves when a game is uninstalled', async () => {
    await request(app.app).delete('/api/games/fixture-game').expect(200)
    const g = (await request(app.app).get('/api/games/fixture-game')).body.game
    expect(g.status).toBe('not_installed')
    expect(g.playUrl).toBeNull()
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

describe('renderIndex', () => {
  it('points engine files at the shared store', () => {
    const html = renderIndex(INDEX, { slug: 's', build: 'b', zipRev: 3, engine: 'abc', saveDir: null, screen: null, title: 'T', runtimeVersion: 'v' })
    expect(html).toContain('src="/engine/abc/renpy-pre.js"')
    expect(html).toContain('src="/engine/abc/renpy.js"')
    expect(html).toContain("'game.zip?r=3'")
    expect(html).toContain('viewport-fit=cover')
  })
})
