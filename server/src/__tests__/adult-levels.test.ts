import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import yazl from 'yazl'
import { createApp, type App } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { groupCeiling, parseAdultGroups, parseAdultLevel } from '../content.js'
import { Db } from '../db.js'
import { readZipEntries } from '../saves/savefile.js'
import { groupCns } from '../sign-in-providers.js'
import { mockOidc, signInFixture, site } from './sign-in-fixture.js'

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

const TEMPLATE = `<!doctype html><html><head><title>Ren'Py Web Game</title><meta name="viewport" content="width=device-width">
</head><body><img id="presplash" src="web-presplash.jpg">
<script src="renpy-pre.js"></script>
<script async type="text/javascript" src="renpy.js"></script>
</body></html>`

describe('adult level configuration', () => {
  const ENV = ['RENPLAY_ADULT_DEFAULT', 'RENPLAY_OIDC_ADULT_GROUPS', 'RENPLAY_OIDC_ADULT_GROUP', 'RENPLAY_LDAP_ADULT_GROUPS', 'RENPLAY_LDAP_ADULT_FILTER', 'RENPLAY_ADULT_GAMES', 'DATA_DIR', 'GAMES_DIR']
  function config(env: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'renplay-levels-cfg-'))
    for (const k of ENV) delete process.env[k]
    Object.assign(process.env, { DATA_DIR: join(root, 'data'), GAMES_DIR: join(root, 'games'), ...env })
    const cfg = loadConfig()
    for (const k of ENV) delete process.env[k]
    rmSync(root, { recursive: true, force: true })
    return cfg
  }

  it('parses group=level mappings and takes the highest matching level', () => {
    expect(parseAdultGroups('adults=shown,mods=blurred', 'RENPLAY_OIDC_ADULT_GROUPS')).toEqual({ adults: 'shown', mods: 'blurred' })
    expect(parseAdultGroups('', 'RENPLAY_OIDC_ADULT_GROUPS')).toBeNull()
    expect(parseAdultGroups('adults', 'RENPLAY_OIDC_ADULT_GROUPS')).toBeNull()
    expect(parseAdultGroups('adults=many,mods=blurred', 'RENPLAY_OIDC_ADULT_GROUPS')).toEqual({ mods: 'blurred' })
    expect(parseAdultGroups('kids=off', 'RENPLAY_OIDC_ADULT_GROUPS')).toEqual({ kids: 'off' })
    expect(groupCeiling({ adults: 'shown', mods: 'blurred' }, ['mods'])).toBe('blurred')
    expect(groupCeiling({ adults: 'shown', mods: 'blurred' }, ['mods', 'adults'])).toBe('shown')
    expect(groupCeiling({ adults: 'shown', kids: 'off' }, ['kids', 'adults'])).toBe('shown')
    expect(groupCeiling({ adults: 'shown' }, ['other'])).toBe('off')
    expect(groupCeiling({ adults: 'shown' }, [])).toBe('off')
    // OIDC matches the groups claim exactly.
    expect(groupCeiling({ Adults: 'shown' }, ['adults'])).toBe('off')
  })

  it('reads RENPLAY_ADULT_DEFAULT as a level, with the 3.x aliases, defaulting to off', () => {
    expect(config({}).adultDefault).toBe('off')
    expect(config({ RENPLAY_ADULT_DEFAULT: 'blurred' }).adultDefault).toBe('blurred')
    expect(config({ RENPLAY_ADULT_DEFAULT: 'allow' }).adultDefault).toBe('shown')
    expect(config({ RENPLAY_ADULT_DEFAULT: 'block' }).adultDefault).toBe('off')
    expect(config({ RENPLAY_ADULT_DEFAULT: 'nonsense' }).adultDefault).toBe('off')
  })

  it('reads the sign-in group variables and their 3.x aliases', () => {
    expect(config({}).oidcAdultGroups).toBeNull()
    expect(config({ RENPLAY_OIDC_ADULT_GROUPS: 'adults=shown,mods=blurred' }).oidcAdultGroups).toEqual({ adults: 'shown', mods: 'blurred' })
    expect(config({ RENPLAY_OIDC_ADULT_GROUPS: 'adults=shown' }).oidcAdultGroupsVariable).toBe('RENPLAY_OIDC_ADULT_GROUPS')
    const alias = config({ RENPLAY_OIDC_ADULT_GROUP: 'adults' })
    expect(alias.oidcAdultGroups).toEqual({ adults: 'shown' })
    expect(alias.oidcAdultGroupsVariable).toBe('RENPLAY_OIDC_ADULT_GROUP')
    // The new variable wins over the alias.
    expect(config({ RENPLAY_OIDC_ADULT_GROUPS: 'mods=blurred', RENPLAY_OIDC_ADULT_GROUP: 'adults' }).oidcAdultGroups).toEqual({ mods: 'blurred' })
    expect(config({ RENPLAY_LDAP_ADULT_GROUPS: 'renplay-adults=shown' }).ldapAdultGroups).toEqual({ 'renplay-adults': 'shown' })
    expect(config({}).ldapAdultGroups).toBeNull()
  })

  it('extracts group cns from memberOf DNs, unescaped', () => {
    expect(groupCns('cn=renplay-adults,ou=groups,dc=example,dc=org')).toEqual(['renplay-adults'])
    expect(groupCns(['cn=Adults,ou=groups,dc=x', 'cn=mods,ou=groups,dc=x'])).toEqual(['Adults', 'mods'])
    expect(groupCns(['CN=upper,dc=x', 'ou=not-a-group,dc=x', 'uid=person,dc=x'])).toEqual(['upper'])
    expect(groupCns('cn=with\\, comma,dc=x')).toEqual(['with, comma'])
    expect(groupCns(undefined)).toEqual([])
    expect(groupCns(42)).toEqual([])
    // LDAP matching is case-insensitive on both sides (sign-in-providers lowercases both).
    expect(groupCeiling({ 'renplay-adults': 'shown' }, ['RENPLAY-Adults'.toLowerCase()])).toBe('shown')
  })
})

describe('OIDC sign-in groups set the ceiling', () => {
  let provider: Awaited<ReturnType<typeof mockOidc>>, app: Awaited<ReturnType<typeof signInFixture>>
  afterEach(async () => { app?.cleanup(); await provider?.close(); vi.restoreAllMocks() })
  async function start(patch: Partial<Config> = {}) {
    provider = await mockOidc()
    app = await signInFixture({ oidcIssuer: provider.issuer, oidcClientId: 'renplay', publicUrl: 'http://localhost:8080', ...patch })
    return request.agent(app.app)
  }
  async function callback(agent: ReturnType<typeof request.agent>) {
    const start = await agent.get('/api/auth/oidc/start').expect(302)
    const result = await fetch(start.headers.location, { redirect: 'manual' })
    const url = new URL(result.headers.get('location')!)
    return agent.get(url.pathname + url.search)
  }

  it('recomputes the ceiling from the groups claim at every sign-in, off when nothing matches', async () => {
    const agent = await start({ oidcAdultGroups: { adults: 'shown', mods: 'blurred' }, oidcAdultGroupsVariable: 'RENPLAY_OIDC_ADULT_GROUPS' })
    provider.setClaims({ groups: ['mods', 'adults'] })
    await callback(agent)
    expect((await agent.get('/api/me')).body.user).toMatchObject({ adult_ceiling: 'shown', adult_choice: 'shown' })
    provider.setClaims({ groups: ['mods'] })
    await callback(agent)
    // The choice stays; the ceiling is recomputed and caps it.
    expect((await agent.get('/api/me')).body.user).toMatchObject({ adult_ceiling: 'blurred', adult_choice: 'shown' })
    provider.setClaims({ groups: [] })
    await callback(agent)
    expect((await agent.get('/api/me')).body.user).toMatchObject({ adult_ceiling: 'off', adult_choice: 'shown' })
  })

  it('replaces the hand setting and locks it in Users while the mapping is configured', async () => {
    const owner = await start({ oidcAdultGroups: { adults: 'shown' }, oidcAdultGroupsVariable: 'RENPLAY_OIDC_ADULT_GROUPS', adminUsername: 'admin', adminPassword: 'local password' })
    await owner.post('/api/auth/login').set(site).send({ username: 'admin', password: 'local password' }).expect(200)
    await owner.post('/api/users').set(site).send({ username: 'player', password: 'player password', adultCeiling: 'shown' }).expect(201)
    const player = request.agent(app.app)
    await player.post('/api/auth/login').set(site).send({ username: 'player', password: 'player password' }).expect(200)
    expect((await player.get('/api/me')).body.user).toMatchObject({ adult_ceiling: 'shown' })
    // Linking the sign-in replaces the hand-set ceiling with the group's level.
    const linked = await player.post('/api/me/identities/oidc').set(site).send({}).expect(200)
    const auth = await fetch(linked.body.url, { redirect: 'manual' })
    const url = new URL(auth.headers.get('location')!)
    provider.setClaims({ groups: [] })
    await player.get(url.pathname + url.search).expect(302)
    expect((await player.get('/api/me')).body.user).toMatchObject({ adult_ceiling: 'off' })
    expect((await owner.get('/api/users')).body.users.find((u: { username: string }) => u.username === 'player')).toMatchObject({ adultManaged: true })
    await owner.put('/api/users/2').set(site).send({ adultCeiling: 'shown' }).expect(409)
  })
})

describe('migration from 3.x, and back', () => {
  it('turns 3.x access into ceilings and choices, and keeps the 3.x columns readable', () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-levels-mig-'))
    const path = join(root, 'library.db')
    // A 3.2 database: users with and without adult access, the install question answered.
    let db = new Db(path)
    db.raw.exec(`ALTER TABLE users DROP COLUMN adult_ceiling; ALTER TABLE users DROP COLUMN adult_choice; PRAGMA user_version = 10`)
    db.raw.prepare("INSERT INTO users (username, name, role, adult_access, created_at) VALUES ('yes', 'Yes', 'player', 1, '2026-01-01'), ('no', 'No', 'player', 0, '2026-01-01')").run()
    db.raw.prepare('UPDATE users SET adult_access = 1 WHERE id = 1').run()
    db.setSetting('adult_games', 'block')
    db.close()
    db = new Db(path)
    const user = (username: string) => db.raw.prepare('SELECT * FROM users WHERE username = ?').get(username) as { adult_ceiling: string; adult_choice: string }
    expect(user('owner')).toMatchObject({ adult_ceiling: 'shown', adult_choice: 'shown' })
    expect(user('yes')).toMatchObject({ adult_ceiling: 'shown', adult_choice: 'shown' })
    expect(user('no')).toMatchObject({ adult_ceiling: 'off', adult_choice: 'off' })
    expect((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(11)
    // Downgrading to 3.2 reads the columns 4.0 keeps in step: access, the picture
    // preference and the allow/block install setting (covered by legacyMirror in content.test).
    const cols = db.raw.prepare('PRAGMA table_info(users)').all().map((c) => c.name)
    expect(cols).toContain('adult_access')
    expect(cols).toContain('prefs')
    expect(db.getSetting('adult_games', '')).toBe('block')
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
})

/**
 * Every route addressed to a game, at every level. The count canary walks the
 * app's registered routes: a route added later fails the canary until it is
 * classified here.
 */
describe('the levels on every route', () => {
  let root = ''
  let app: App
  let zip = Buffer.alloc(0)

  beforeAll(async () => {
    zip = await zipBuffer({ 'game/script.rpyc': 'x', 'game/renpyweb_remote_files.txt': 'images/a.png\nimage 16,16\n' })
    root = mkdtempSync(join(tmpdir(), 'renplay-levels-routes-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    // An installed engine, three builds, saves, archives, covers and walkthroughs.
    const engine = join(cfg.enginesDir, '8.5.3')
    mkdirSync(engine, { recursive: true })
    writeFileSync(join(engine, 'index.html'), TEMPLATE)
    writeFileSync(join(engine, '.ready'), '{}')
    for (const id of ['adult', 'safe', 'adult-two']) {
      const build = join(cfg.gamesDir, id, 'b1')
      mkdirSync(build, { recursive: true })
      writeFileSync(join(build, 'game.zip'), zip)
      writeFileSync(join(build, 'assets.pack'), 'xxpng0123456789')
      writeFileSync(join(build, 'assets.json'), JSON.stringify({ 'images/a.png': [2, 3] }))
      mkdirSync(join(cfg.savesDir, `${id}-1`), { recursive: true })
      writeFileSync(join(cfg.savesDir, `${id}-1`, '1-1.save'), 'x')
    }
    mkdirSync(cfg.coversDir, { recursive: true })
    for (const id of ['adult', 'safe']) writeFileSync(join(cfg.coversDir, `${id}.webp`), 'cover')
    mkdirSync(cfg.walkthroughsDir, { recursive: true })
    for (const id of ['adult', 'safe']) writeFileSync(join(cfg.walkthroughsDir, `${id}.pdf`), '%PDF-1.4 fixture')
    mkdirSync(cfg.archivesDir, { recursive: true })
    for (const name of ['adult.zip', 'safe.zip', 'adult2.zip']) writeFileSync(join(cfg.archivesDir, name), '1234')
    const db = Db.open(cfg.dataDir)
    const recipe = (id: string, nsfw: boolean) => ({ id, title: id, nsfw, engine: 'renpy', saveDir: `${id}-1`, cover: `covers/${id}.png`, releases: [{ version: '1', status: 'verified', archives: [{ name: `${id}.zip`, size: 4 }] }] })
    db.setSetting('catalog_cache', { at: Date.now(), games: [recipe('adult', true), recipe('safe', false)], vocabulary: {}, adultGames: 'shown' })
    db.setSetting('catalog_covers', { adult: { url: 'covers/adult.png', sha256: '', file: 'adult.webp', etag: '' }, safe: { url: 'covers/safe.png', sha256: '', file: 'safe.webp', etag: '' } })
    db.insertGame({ id: 'adult', title: 'Adult', recipe_id: 'adult', adult: 1, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: 'adult-1', walkthrough: 'adult.pdf' })
    db.insertGame({ id: 'safe', title: 'Safe', recipe_id: 'safe', status: 'installed', build: 'b1', engine: '8.5.3', save_dir: 'safe-1', walkthrough: 'safe.pdf' })
    db.insertGame({ id: 'adult-two', title: 'Adult Two', recipe_id: '', adult: 1, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: 'adult-two-1', source: JSON.stringify({ archive: 'adult2.zip' }) })
    db.insertJob({ id: 'j-adult-failed', type: 'import', game: 'adult', params: '{}' })
    db.insertJob({ id: 'j-adult-queued', type: 'import', game: 'adult', params: '{}' })
    db.insertJob({ id: 'j-safe', type: 'import', game: 'safe', params: '{}' })
    db.updateJob('j-adult-failed', { status: 'failed' })
    db.close()
    app = await createApp(cfg, { startJobs: false })
  })
  afterAll(async () => {
    while (app.jobs.isBusy()) await new Promise((resolve) => setTimeout(resolve, 50))
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  const exportedNames = async () => {
    const response = await request(app.app).get('/api/saves-export').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    }).expect(200)
    return [...(await readZipEntries(response.body, () => true, 128 << 20)).keys()]
  }

  const setLevel = async (level: string) => {
    expect((await request(app.app).put('/api/content').send({ level })).body.installation.level).toBe(level)
  }

  it('registers exactly the routes this matrix classifies', () => {
    const visit = (stack: any[]): number => (stack ?? []).reduce((n: number, layer: any) => n + (layer.route ? 1 : layer.handle?.stack ? visit(layer.handle.stack) : 0), 0)
    // Update this number and the matrix below together when a route is added or removed.
    expect(visit((app.app as any).router.stack)).toBe(86)
  })

  it('at blurred adult games are there with titles, but no picture route returns a byte of their art', async () => {
    await setLevel('blurred')
    // Lists contain them, without any picture URL.
    const games = (await request(app.app).get('/api/games')).body.games
    expect(games.map((g: { id: string }) => g.id)).toEqual(['adult', 'adult-two', 'safe'])
    const adult = games.find((g: { id: string }) => g.id === 'adult')
    expect(adult).toMatchObject({ title: 'adult', cover: null, art: 'hidden' })
    expect(JSON.stringify(games)).not.toContain('/api/covers/adult')
    const catalogGames = (await request(app.app).get('/api/catalog')).body.games
    expect(catalogGames.map((g: { id: string }) => g.id)).toContain('adult')
    expect(catalogGames.find((g: { id: string }) => g.id === 'adult').cover).toBeNull()
    expect((await request(app.app).get('/api/archives')).body.archives.map((a: { name: string }) => a.name)).toContain('adult.zip')
    expect((await request(app.app).get('/api/jobs')).body.jobs.map((j: { id: string }) => j.id)).toContain('j-adult-failed')
    const sys = (await request(app.app).get('/api/system')).body
    expect(sys.library).toMatchObject({ games: 3, installed: 3 })
    expect(sys.engines.installed[0].usedBy).toContain('Adult')
    expect(await exportedNames()).toContain('adult-1/1-1.save')
    expect(await exportedNames()).toContain('adult-two-1/1-1.save')

    // The art routes refuse, with the same 404 as an unknown file.
    for (const path of ['/api/covers/adult.webp', '/api/saves/adult/screenshot?file=1-1.save']) {
      await request(app.app).get(path).expect(404)
    }
    await request(app.app).get('/api/auth/check').set('X-Original-URI', '/api/covers/adult.webp').expect(403)
    // Saves list without picture URLs.
    const saves = (await request(app.app).get('/api/saves/adult').expect(200)).body
    expect(JSON.stringify(saves)).not.toContain('screenshot?')

    // The game itself still plays: the page renders with the engine's presplash, and its files stream.
    const page = await request(app.app).get('/g/adult/b1/').expect(200)
    expect(page.text).toContain('/engine/8.5.3/web-presplash.jpg')
    await request(app.app).get('/g/adult/b1/game.zip').expect(200)
    await request(app.app).get('/g/adult/b1/game/images/a.png').expect(200)
    await request(app.app).get('/api/auth/check').set('X-Original-URI', '/g/adult/b1/game.zip').expect(204)
    await request(app.app).get('/api/walkthroughs/adult.pdf').expect(200)

    // Management routes see the game like any other.
    const reads: string[] = [
      '/api/games/adult', '/api/games/adult/recipe', '/api/games/adult/files',
      '/api/games/adult/files/raw?path=game/script.rpyc',
      '/api/saves/adult/boot', '/api/saves/adult/raw?path=adult-1/1-1.save', '/api/saves/adult/download?file=1-1.save',
      '/api/saves/adult/export', '/api/saves/adult/history', '/api/jobs/j-adult-failed/log',
    ]
    for (const path of reads) await request(app.app).get(path).expect(200)
    const writes: Array<[method: string, path: string, body?: unknown, raw?: 'raw']> = [
      ['put', '/api/games/adult/favorite', { on: true }], ['put', '/api/games/adult/finished', { on: true }],
      ['post', '/api/games/adult/played'], ['post', '/api/games/adult/play-time', { seconds: 5 }],
      ['put', '/api/games/adult/cache?name=bytecode-8.rpyb&build=b1', undefined, 'raw'],
      ['post', '/api/saves/adult/save-dir', { saveDir: 'adult-1' }],
      ['post', '/api/saves/adult/copy', { target: 'safe', file: '1-1.save' }],
      ['put', '/api/saves/adult/file?path=adult-1/x.save', undefined, 'raw'],
      ['delete', '/api/saves/adult/slot?file=x.save'],
      ['put', '/api/saves/adult/file?path=adult-1/x.save', undefined, 'raw'],
      ['delete', '/api/saves/adult/file?path=adult-1/x.save'],
      ['put', '/api/games/adult/files/raw?path=game/mod.txt', undefined, 'raw'],
      ['delete', '/api/games/adult/files/raw?path=game/mod.txt'],
      ['post', '/api/games/adult/files/revert', { path: 'game/script.rpyc' }],
      ['post', '/api/jobs/j-adult-queued/cancel'], ['post', '/api/jobs/j-adult-failed/retry'],
    ]
    for (const [method, path, body, raw] of writes) {
      const call = (request(app.app) as any)[method](path)
      const response = await (raw ? call.set('content-type', 'application/octet-stream').send(Buffer.from('mod content!!')) : call.send(body))
      expect(response.status, `${method} ${path}`).not.toBe(404)
    }
    // Destructive verbs on the second adult game.
    await request(app.app).delete('/api/games/adult-two/download').expect(200)
    await request(app.app).delete('/api/games/adult-two').expect(200)
    expect(app.db.getGame('adult-two')).toMatchObject({ status: 'not_installed' })
    await expect.poll(() => app.jobs.isBusy()).toBe(false)
  })

  it('at shown every picture route answers again', async () => {
    await setLevel('shown')
    await request(app.app).get('/api/covers/adult.webp').expect(200)
    await request(app.app).get('/api/auth/check').set('X-Original-URI', '/api/covers/adult.webp').expect(204)
    const adult = (await request(app.app).get('/api/games/adult')).body.game
    expect(adult.cover).toBe('/api/covers/adult.webp')
    expect(adult.art).toBeUndefined()
  })

  it('at off hides adult games from lists and refuses every route addressed to one with 404', async () => {
    await setLevel('off')
    // Lists leave adult games out.
    expect((await request(app.app).get('/api/games')).body.games.map((g: { id: string }) => g.id)).toEqual(['safe'])
    expect((await request(app.app).get('/api/catalog')).body.games.map((g: { id: string }) => g.id)).toEqual(['safe'])
    expect((await request(app.app).get('/api/archives')).body.archives.map((a: { name: string }) => a.name)).toEqual(['safe.zip'])
    expect((await request(app.app).get('/api/jobs')).body.jobs.map((j: { id: string }) => j.id)).toEqual(['j-safe'])
    const sys = (await request(app.app).get('/api/system')).body
    expect(sys.library).toMatchObject({ games: 1, installed: 1 })
    expect(sys.engines.installed[0].usedBy).toEqual(['Safe'])
    const names = await exportedNames()
    expect(names.some((n) => n.startsWith('adult'))).toBe(false)
    expect(names.some((n) => n.startsWith('safe-1/'))).toBe(true)

    // Every route addressed to an adult game gets the 404 an unknown game gets.
    const gone: Array<[string, string, unknown?]> = [
      ['get', '/api/games/adult'], ['get', '/api/games/adult/recipe'],
      ['put', '/api/games/adult/favorite', { on: true }], ['put', '/api/games/adult/finished', { on: true }],
      ['post', '/api/games/adult/played'], ['post', '/api/games/adult/play-time', { seconds: 5 }],
      ['put', '/api/games/adult/cache?name=bytecode-8.rpyb&build=b1'], ['delete', '/api/games/adult'],
      ['delete', '/api/games/adult/download'], ['post', '/api/games/adult/reinstall'],
      ['post', '/api/games/adult/walkthrough'], ['delete', '/api/games/adult/walkthrough'],
      ['get', '/api/games/adult/files'], ['get', '/api/games/adult/files/raw?path=game/script.rpyc'],
      ['put', '/api/games/adult/files/raw?path=game/mod.txt'], ['delete', '/api/games/adult/files/raw?path=game/mod.txt'],
      ['post', '/api/games/adult/files/revert', { path: 'game/script.rpyc' }], ['post', '/api/games/adult/files/upload'],
      ['post', '/api/games/adult/files/apply'], ['post', '/api/games/adult/files/reset'],
      ['get', '/api/saves/adult'], ['get', '/api/saves/adult/boot'], ['get', '/api/saves/adult/raw?path=adult-1/1-1.save'],
      ['put', '/api/saves/adult/file?path=adult-1/x.save'], ['delete', '/api/saves/adult/file?path=adult-1/x.save'],
      ['post', '/api/saves/adult/save-dir', { saveDir: 'adult-1' }],
      ['get', '/api/saves/adult/screenshot?file=1-1.save'], ['get', '/api/saves/adult/download?file=1-1.save'],
      ['delete', '/api/saves/adult/slot?file=1-1.save'], ['get', '/api/saves/adult/export'],
      ['post', '/api/saves/adult/import'], ['post', '/api/saves/adult/copy', { target: 'safe', file: '1-1.save' }],
      ['get', '/api/saves/adult/history'], ['post', '/api/saves/adult/history/restore', { id: 'none' }],
      ['get', '/g/adult/b1/'], ['get', '/g/adult/b1/index.html'], ['get', '/g/adult/b1/game.zip'], ['get', '/g/adult/b1/game/images/a.png'],
      ['get', '/api/covers/adult.webp'], ['get', '/api/walkthroughs/adult.pdf'],
      ['get', '/api/jobs/j-adult-failed/log'], ['post', '/api/jobs/j-adult-failed/retry'], ['post', '/api/jobs/j-adult-queued/cancel'],
      ['post', '/api/imports', { source: { kind: 'archive', path: 'adult.zip' } }],
      ['post', '/api/imports', { source: { kind: 'archive', path: 'safe.zip' }, recipeId: 'adult' }],
      ['post', '/api/archives/inspect', { path: 'adult.zip' }], ['post', '/api/archives/hash', { path: 'adult.zip' }],
      // The recipe-less adult game and the nginx subrequest too.
      ['get', '/api/games/adult-two'], ['get', '/g/adult-two/b1/game.zip'],
    ]
    for (const [method, path, body] of gone) {
      const response = await (request(app.app) as any)[method](path).send(body)
      expect(response.status, `${method} ${path}`).toBe(404)
    }
    for (const uri of ['/g/adult/b1/game.zip', '/g/adult/b1/game/images/a.png', '/api/covers/adult.webp', '/api/walkthroughs/adult.pdf']) {
      await request(app.app).get('/api/auth/check').set('X-Original-URI', uri).expect(403)
    }
    // Safe games are never affected at any level.
    await request(app.app).get('/api/games/safe').expect(200)
    await request(app.app).get('/api/covers/safe.webp').expect(200)
    await request(app.app).get('/g/safe/b1/').expect(200)
    // Installed games stay installed, saves untouched.
    expect(app.db.getGame('adult')).toMatchObject({ status: 'installed', adult: 1 })
  })
})
