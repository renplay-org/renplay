import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { VERSION } from '../util/version.js'

const COLLECTOR = 'http://127.0.0.1:39999/v1/report'
const OFFICIAL = 'https://catalog.renplay.org/index.v4.json'
const recipe = (id: string, origin: string, title = id) => ({
  id, title, engine: 'renpy', _origin: origin, _base: origin,
  releases: [{ version: '1.5.5', status: 'verified', archives: [{ name: `${id}-1.5.5-pc.zip` }] }],
})

/** Every request the server made while a test ran: Renplay must never reach a real host from a test. */
let requests: Array<{ url: string; init: RequestInit }>
const reports = () => requests.filter((r) => r.url === COLLECTOR).map((r) => JSON.parse(String(r.init.body)))

let root: string
let app: App | null = null

async function start(settings: { telemetry?: '' | 'on' | 'off'; catalogUrls?: string[] } = {}): Promise<App> {
  root = mkdtempSync(join(tmpdir(), 'renplay-telemetry-'))
  process.env['DATA_DIR'] = join(root, 'data')
  process.env['GAMES_DIR'] = join(root, 'games')
  const cfg = { ...loadConfig(), telemetry: settings.telemetry ?? 'on', telemetryUrl: COLLECTOR, catalogUrls: settings.catalogUrls ?? [OFFICIAL], enginesUrl: 'http://127.0.0.1:9/none' }
  app = await createApp(cfg, { startJobs: false })
  app.catalog.stop()
  return app
}

beforeEach(() => {
  requests = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    requests.push({ url: String(url), init })
    if (String(url).startsWith('https://catalog.renplay.org/')) return Response.json({ schema: 4, games: [recipe('charm-studies', OFFICIAL)] })
    return new Response(null, { status: 204 })
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  app?.close()
  app = null
  if (root) rmSync(root, { recursive: true, force: true })
})

/** A library with a catalog game, a game from a private catalog, one from Your recipes and a local game. */
async function library(a: App): Promise<void> {
  a.db.setSetting('catalog_cache', {
    at: Date.now(),
    vocabulary: {},
    games: [recipe('charm-studies', OFFICIAL, 'Charm Studies'), recipe('private-game', 'https://catalogs.example.org/index.json', 'Private Game'), recipe('my-recipe-game', 'local', 'My Recipe Game')],
  })
  await a.catalog.init()
  a.catalog.stop()
  const source = JSON.stringify({ archive: 'charm-studies-1.5.5-pc.zip' })
  a.db.insertGame({ id: 'charm-studies', title: 'Charm Studies', recipe_id: 'charm-studies', status: 'installed', family: 'renpy', version: '1.5.5', source, build: 'b1', size_bytes: 3e9 })
  a.db.insertGame({ id: 'private-game', title: 'Private Game', recipe_id: 'private-game', status: 'installed', family: 'renpy', build: 'b1' })
  a.db.insertGame({ id: 'my-recipe-game', title: 'My Recipe Game', recipe_id: 'my-recipe-game', status: 'installed', family: 'renpy', build: 'b1' })
  a.db.insertGame({ id: 'secret-local-game', title: 'Secret Local Title', status: 'installed', family: 'html', build: 'h1', save_dir: 'SecretSaves-1' })
  a.db.raw.prepare("INSERT INTO users (username, name, role, created_at) VALUES ('alice-secret', 'Alice Secret', 'player', '')").run()
  a.db.raw.prepare("INSERT INTO save_meta (user_id, save_dir, file, title, note) VALUES (1, 'SecretSaves-1', '1-1.save', 'My Secret Save', 'a private note')").run()
}

describe('telemetry report', () => {
  it('has the shape of the contract for a library with a catalog game, a local game, a failed install, a play and a client report', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-10T09:00:00Z')
    const a = await start()
    await library(a)

    // A play session of the catalog game and one of the local game, through the routes the player calls.
    await request(a.app).post('/api/games/charm-studies/play-time').send({ seconds: 60 }).expect(200)
    await request(a.app).post('/api/games/secret-local-game/play-time').send({ seconds: 30 }).expect(200)
    // An install that worked and one that failed, as the job manager runs them.
    await a.services.telemetry.install({ params: { recipeId: 'charm-studies', source: { path: 'a.zip' } }, signal: new AbortController().signal }, async () => {
      vi.setSystemTime(Date.now() + 48_000)
      return { recipe: 'charm-studies', engine: '8.5.3' }
    })
    const failed = a.jobs.enqueue('import', '', { source: { kind: 'archive', path: 'alice/Charm.zip' }, recipeId: 'charm-studies' })
    await vi.waitFor(() => expect(a.db.getJob(failed)?.status).toBe('failed'))
    // What the player says about its session, with a runtime error of the catalog game and one of the local game.
    await request(a.app).post('/api/telemetry/client').send({ game: 'charm-studies', device: 'phone', browser: 'webkit', homeScreen: true, offline: false, controller: false, fullscreen: true, loadSeconds: 4.2, fps: 58, error: 'AttributeError: module \'renpy.store\' has no attribute \'foo\'' }).expect(204)
    await request(a.app).post('/api/telemetry/client').send({ game: 'secret-local-game', device: 'desktop', browser: 'blink', loadSeconds: 11, fps: 20, error: 'Something broke' }).expect(204)
    // A feature of the day.
    await request(a.app).post('/api/catalog/refresh').expect(200)

    vi.setSystemTime('2026-11-11T03:00:00Z')
    await a.services.telemetry.send()

    const [report] = reports()
    expect(reports()).toHaveLength(1)
    expect(Object.keys(report).sort()).toEqual(['catalog', 'day', 'errors', 'features', 'instance', 'play', 'scale', 'schema', 'setup', 'version'])
    expect(report).toMatchObject({ schema: 1, version: VERSION, day: '2026-11-10' })
    expect(report.instance).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(report.instance).toBe(a.db.getSetting('telemetry_instance', ''))
    expect(Object.keys(report.setup).sort()).toEqual(['adultInstall', 'arch', 'auth', 'dataGB', 'gamesGB', 'install', 'uptimeDays'])
    expect(report.setup).toMatchObject({ install: 'source', auth: 'off', adultInstall: 'shown', gamesGB: '1-10', dataGB: '<1' })
    expect(['arm64', 'x64']).toContain(report.setup.arch)
    expect(report.scale).toEqual({ users: 2, devices: 0, games: 4, renpyGames: 3, htmlGames: 1, catalogGames: 1, localGames: 3, saves: 0, mods: 0 })
    expect(report.play).toEqual({
      sessions: 2, minutes: 2,
      devices: { phone: 1, tablet: 0, desktop: 1 }, browsers: { webkit: 1, blink: 1, gecko: 0 },
      homeScreen: 1, offline: 0, controller: 0, fullscreen: 1,
      loadSeconds: { p50: 11, p90: 11 }, fps: { under30: 1, '30to50': 0, '50up': 1 },
    })
    expect(report.features).toEqual({ walkthroughs: 0, syncCodes: 0, saveImports: 0, artChoices: 0, keptOffline: 0, modBuilds: 0, catalogRefresh: 1, adultLevelsChanged: 0 })
    // Only the game of the official catalog is named.
    expect(report.catalog).toEqual([{
      game: 'charm-studies', release: '1.5.5', installed: 1,
      installs: { ok: 1, failed: 1, seconds: 48, engine: '8.5.3' }, plays: { sessions: 1, minutes: 1 }, errors: 2,
    }])
    expect(report.errors).toEqual(expect.arrayContaining([
      { game: 'charm-studies', kind: 'runtime', message: 'AttributeError: module <x> has no attribute <x>', count: 1 },
      { game: 'charm-studies', kind: 'install', message: 'Archive not found: <x>', count: 1 },
    ]))
    expect(report.errors).toHaveLength(2)

    // The request itself, as the contract says.
    const sent = requests.find((r) => r.url === COLLECTOR)!
    expect(sent.init.method).toBe('POST')
    const headers = new Headers(sent.init.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('user-agent')).toBe(`Renplay/${VERSION} (+https://renplay.org)`)
    expect(Buffer.byteLength(String(sent.init.body))).toBeLessThan(64 * 1024)
  })

  it('never carries a local game’s title, a person, a path in an error or a save’s name', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-10T09:00:00Z')
    const a = await start()
    await library(a)
    await request(a.app).post('/api/games/secret-local-game/play-time').send({ seconds: 30 }).expect(200)
    await request(a.app).post('/api/games/private-game/play-time').send({ seconds: 30 }).expect(200)
    await request(a.app).post('/api/games/my-recipe-game/play-time').send({ seconds: 30 }).expect(200)
    const failed = a.jobs.enqueue('import', '', { source: { kind: 'archive', path: 'alice-secret/Secret Local Title.zip' }, recipeId: 'charm-studies' })
    await vi.waitFor(() => expect(a.db.getJob(failed)?.status).toBe('failed'))
    for (const error of [
      'ENOENT: no such file or directory, open \'/data/users/alice-secret/saves/SecretSaves-1/1-1.save\'',
      'Could not read C:\\Users\\alice-secret\\Games\\Secret Local Title\\script.rpy at https://alice.example.org/play for alice@example.org',
      'Failed with "My Secret Save" and token abcdefghijklmnopqrstuvwxyz012345 and 1234567890123\nsecond line /home/alice-secret',
    ]) await request(a.app).post('/api/telemetry/client').send({ game: 'charm-studies', error }).expect(204)
    // Errors of games outside the official catalog are not named, and not counted anywhere.
    for (const game of ['secret-local-game', 'private-game', 'my-recipe-game']) await request(a.app).post('/api/telemetry/client').send({ game, error: 'Broke in /home/alice-secret' }).expect(204)
    vi.setSystemTime('2026-11-11T03:00:00Z')
    await a.services.telemetry.send()

    const json = JSON.stringify(reports()[0])
    for (const secret of ['Secret Local Title', 'secret-local-game', 'alice', 'Alice', 'My Secret Save', 'a private note', 'SecretSaves', '/home', '/data', 'C:', 'example.org', 'abcdefghijklmnopqrstuvwxyz', '1234567890123', 'private-game', 'Private Game', 'my-recipe-game', 'My Recipe Game', 'second line']) {
      expect(json).not.toContain(secret)
    }
    expect(JSON.parse(json).errors.map((e: { message: string }) => e.message).sort()).toEqual([
      'Archive not found: <x>',
      'Could not read <x> at <x> for <x>',
      'ENOENT: no such file or directory, open <x>',
      'Failed with <x> and token <x> and <x>',
    ])
  })
})

describe('telemetry counts', () => {
  it('counts a feature each time the route that does it works, and not when it fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-10T09:00:00Z')
    const a = await start()
    await library(a)
    const day = () => a.db.getSetting<Record<string, { features: Record<string, number> }>>('telemetry_days', {})['2026-11-10']?.features ?? {}
    await request(a.app).post('/api/games/charm-studies/walkthroughs').attach('file', Buffer.from('Go left, then right.'), 'guide.txt').expect(200)
    await request(a.app).post('/api/games/charm-studies/walkthroughs').expect(400)
    await request(a.app).put('/api/content').send({ level: 'blurred' }).expect(200)
    await request(a.app).put('/api/content').send({ level: 'nonsense' }).expect(400)
    await request(a.app).put('/api/users/2').send({ adultCeiling: 'off' }).expect(200)
    await request(a.app).post('/api/catalog/refresh').expect(200)
    expect(day()).toEqual({ walkthroughs: 1, adultLevelsChanged: 2, catalogRefresh: 1 })
  })
})

describe('telemetry switch', () => {
  it('makes no request at all when RENPLAY_TELEMETRY is off, and counts nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const a = await start({ telemetry: 'off' })
    await library(a)
    requests = []
    a.services.telemetry.start()
    a.services.telemetry.feature('walkthroughs')
    a.services.telemetry.client({ device: 'phone' }, null)
    await vi.advanceTimersByTimeAsync(3 * 24 * 3600_000)
    await a.services.telemetry.send()
    expect(requests).toEqual([])
    expect(a.db.getSetting('telemetry_days', null)).toBeNull()
    expect(a.db.getSetting('telemetry_instance', '')).toBe('')
    expect(a.services.telemetry.status()).toEqual({ on: false, locked: true, chosen: false })
  })

  it('makes no request at all when an admin turns it off, and forgets what was counted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const a = await start({ telemetry: '' })
    await library(a)
    expect((await request(a.app).get('/api/system')).body.telemetry).toEqual({ on: true, locked: false, chosen: false })
    requests = []
    a.services.telemetry.feature('walkthroughs')
    expect(a.db.getSetting<object>('telemetry_days', {})).not.toEqual({})
    const answer = await request(a.app).put('/api/system/telemetry').send({ on: false }).expect(200)
    expect(answer.body).toEqual({ on: false, locked: false, chosen: true })
    expect(a.db.getSetting('telemetry_days', {})).toEqual({})
    a.services.telemetry.start()
    a.services.telemetry.feature('walkthroughs')
    await request(a.app).post('/api/telemetry/client').send({ device: 'phone' }).expect(204)
    await vi.advanceTimersByTimeAsync(3 * 24 * 3600_000)
    expect(requests).toEqual([])
    expect(a.db.getSetting('telemetry_days', {})).toEqual({})
    await request(a.app).put('/api/system/telemetry').send({ on: 'yes' }).expect(400)
  })

  it('lets the variable win over the switch, in both directions', async () => {
    const on = await start({ telemetry: 'on' })
    on.db.setSetting('telemetry', false)
    expect(on.services.telemetry.enabled()).toBe(true)
    on.close()
    const off = await start({ telemetry: 'off' })
    off.db.setSetting('telemetry', true)
    expect(off.services.telemetry.enabled()).toBe(false)
  })

  it('is on by default for a new library, and only an admin can change the switch', async () => {
    const a = await start({ telemetry: '' })
    expect(a.services.telemetry.enabled()).toBe(true)
    // The player's own report is open to every signed-in person, the switch is not.
    const { playerRoute } = await import('../accounts/access.js')
    expect(playerRoute('POST', '/api/telemetry/client')).toBe(true)
    expect(playerRoute('PUT', '/api/system/telemetry')).toBe(false)
  })
})

describe('telemetry schedule', () => {
  const sends = () => reports().length

  it('sends the first report 10 to 60 minutes after the start, then about once a day', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime('2026-11-10T12:00:00Z')
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const a = await start()
    a.services.telemetry.start()
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1000)
    expect(sends()).toBe(0)
    await vi.advanceTimersByTimeAsync(1500)
    await vi.waitFor(() => expect(sends()).toBe(1))
    expect(reports()[0].day).toBe('2026-11-09')
    // The next one is a day later (the least of it, and the most).
    await vi.advanceTimersByTimeAsync(24 * 3600_000 - 1000)
    expect(sends()).toBe(1)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => expect(sends()).toBe(2))
    expect(reports()[1].day).toBe('2026-11-10')
    random.mockReturnValue(0.999)
    await vi.advanceTimersByTimeAsync(24 * 3600_000 + 59 * 60_000)
    expect(sends()).toBe(2)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await vi.waitFor(() => expect(sends()).toBe(3))
    // The same instance each time.
    expect(new Set(reports().map((r) => r.instance)).size).toBe(1)
  })

  it('waits at most an hour for the first report', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const a = await start()
    a.services.telemetry.start()
    await vi.advanceTimersByTimeAsync(59 * 60_000)
    expect(sends()).toBe(0)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await vi.waitFor(() => expect(sends()).toBe(1))
  })

  it('drops a failed send, asks once a day at most, and does not send the same day twice', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-10T12:00:00Z')
    const a = await start()
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init })
      throw new Error('connection refused')
    }))
    await a.services.telemetry.send()
    expect(sends()).toBe(1)
    // The failed day is not tried again.
    await a.services.telemetry.send()
    expect(sends()).toBe(1)
    vi.setSystemTime('2026-11-11T12:00:00Z')
    await a.services.telemetry.send()
    expect(sends()).toBe(2)
  })
})

describe('the User-Agent of requests to renplay.org', () => {
  it('names Renplay and its version on a catalog fetch, and only there', async () => {
    const a = await start()
    await a.catalog.refresh()
    const fetched = requests.find((r) => r.url === OFFICIAL)!
    expect(new Headers(fetched.init.headers).get('user-agent')).toBe(`Renplay/${VERSION} (+https://renplay.org)`)
    expect(new Headers(fetched.init.headers).get('accept')).toBe('application/json')
    a.close()

    requests = []
    const mine = await start({ catalogUrls: ['https://catalog.example.org/index.json'] })
    await mine.catalog.refresh()
    const own = requests.find((r) => r.url === 'https://catalog.example.org/index.json')!
    expect(new Headers(own.init.headers).get('user-agent')).toBeNull()
  })

  it('names Renplay on the engine index, and the report itself', async () => {
    const a = await start()
    a.services.cfg.enginesUrl = 'https://engines.renplay.org/index.json'
    await a.engines.available(true).catch(() => {})
    const index = requests.find((r) => r.url === 'https://engines.renplay.org/index.json')!
    expect(new Headers(index.init.headers).get('user-agent')).toBe(`Renplay/${VERSION} (+https://renplay.org)`)
  })
})
