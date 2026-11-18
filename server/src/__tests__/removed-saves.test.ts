import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'
import { SAVES_ZIP } from '../saves/savefile.js'
import { readZipEntries } from '../util/zip.js'
import { signInFixture, site } from './sign-in-fixture.js'

const removed = async (app: App) => (await request(app.app).get('/api/system/storage').expect(200)).body.removedSaves as Array<{ folder: string; title: string | null; people: number; files: number; bytes: number; newest: number }>
const refresh = (app: App) => request(app.app).post('/api/system/storage/refresh').expect(200)

describe('saves of games no longer in the library', () => {
  let root = ''
  let app: App
  const DAY = 24 * 3600_000
  const old = Date.now() - 40 * DAY

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-removed-saves-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_BACKUP_DIR'] = join(root, 'backups')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    mkdirSync(cfg.recipesDir, { recursive: true })
    writeFileSync(join(cfg.recipesDir, 'named.yaml'), 'id: named\ntitle: Named Game\nnsfw: false\nsaveDir: Named-1\nreleases: []\n')
    writeFileSync(join(cfg.recipesDir, 'owned.yaml'), 'id: owned\ntitle: Owned Game\nnsfw: false\nsaveDir: Owned-1\nreleases: []\n')
    const db = Db.open(cfg.dataDir)
    db.insertGame({ id: 'kept', title: 'Kept', status: 'installed', build: 'b1', save_dir: 'Kept-1' })
    db.insertGame({ id: 'later', title: 'Later', status: 'not_installed', save_dir: 'Later-1' })
    // Installed, its save folder not learned yet: its recipe names the folder its saves went to.
    db.insertGame({ id: 'owned', title: 'Owned', recipe_id: 'owned', status: 'installed', build: 'b1', save_dir: '' })
    db.close()
    app = await createApp(cfg, { startJobs: false })
    await app.catalog.refresh()
    await request(app.app).post('/api/users').send({ username: 'second', name: 'Second', password: 'second-password-1' }).expect(201)
    const mine = app.services.saveStores.of(1), theirs = app.services.saveStores.of(2)
    await mine.write('Gone-1', '1-1-LT1.save', Buffer.alloc(100, 1), { mtimeMs: old })
    await mine.write('Gone-1', '1-2-LT1.save', Buffer.alloc(50, 2), { mtimeMs: old + DAY })
    await theirs.write('Gone-1', 'auto-1-LT1.save', Buffer.alloc(30, 3), { mtimeMs: old + 2 * DAY })
    await mine.write('Named-1', '1-1-LT1.save', Buffer.alloc(10, 4))
    for (const dir of ['Kept-1', 'Later-1', 'Owned-1', 'tokens', 'persistent']) await mine.write(dir, '1-1-LT1.save', Buffer.alloc(5, 5))
  })
  afterAll(() => {
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_BACKUP_DIR', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  it('lists them with a name when the catalog knows it, the people, the size and the newest save, and no folder a library game uses', async () => {
    const [gone, named, ...rest] = await removed(app)
    expect(rest).toEqual([])
    expect(gone).toMatchObject({ folder: 'Gone-1', title: null, people: 2, files: 3, bytes: 180 })
    expect(gone!.newest).toBeCloseTo(old + 2 * DAY, -4)
    expect(named).toMatchObject({ folder: 'Named-1', title: 'Named Game', people: 1, files: 1, bytes: 10 })
  })

  it('refuses a game that is in the library, installed or not, and a folder with no saves', async () => {
    for (const folder of ['Kept-1', 'Later-1', 'Owned-1']) {
      const res = await request(app.app).delete(`/api/system/storage/saves/${folder}`).expect(409)
      expect(res.body.error).toBe('This game is still in your library. Remove it from the library first, then delete its saves.')
    }
    await request(app.app).delete('/api/system/storage/saves/Nothing-1').expect(404)
    await request(app.app).delete('/api/system/storage/saves/tokens').expect(404)
    await request(app.app).delete('/api/system/storage/saves/..').expect(400)
    expect((await removed(app)).map((r) => r.folder)).toEqual(['Gone-1', 'Named-1'])
  })

  it('deletes everyone’s saves of one game into History, says so in the log, and leaves the other games', async () => {
    const lines = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await request(app.app).delete('/api/system/storage/saves/Gone-1').expect(200)
    expect(res.body).toEqual({ folder: 'Gone-1', files: 3, people: 2, bytes: 180 })
    expect(lines.mock.calls.map((c) => String(c[0])).find((l) => l.includes('Gone-1'))).toMatch(/ info +\[saves\] +Deleted the saves of Gone-1: 3 files of 2 people, asked by owner$/)
    lines.mockRestore()
    const mine = app.services.saveStores.of(1), theirs = app.services.saveStores.of(2)
    expect(await mine.list('Gone-1')).toEqual([])
    expect(await theirs.list('Gone-1')).toEqual([])
    expect((await mine.history('Gone-1')).map((v) => [v.name, v.reason]).sort()).toEqual([['1-1-LT1.save', 'user-delete'], ['1-2-LT1.save', 'user-delete']])
    expect((await theirs.history('Gone-1')).map((v) => v.reason)).toEqual(['user-delete'])
    expect((await mine.list('Named-1')).length).toBe(1)
    await refresh(app)
    expect((await removed(app)).map((r) => r.folder)).toEqual(['Named-1'])
    await request(app.app).delete('/api/system/storage/saves/Gone-1').expect(404)
  })

  it('keeps the deleted saves out of the daily backup, and they come back when the game is added again', async () => {
    const name = await app.backups.run()
    const zip = await readZipEntries(join(root, 'backups', name), () => true, { ...SAVES_ZIP, totalBytes: 64 << 20 })
    expect([...zip.keys()].filter((n) => /Gone-1|save-history/.test(n))).toEqual([])
    expect([...zip.keys()]).toContain('1-owner/Named-1/1-1-LT1.save')
    app.db.insertGame({ id: 'gone', title: 'Gone', status: 'installed', build: 'b1', save_dir: 'Gone-1' })
    const versions = (await request(app.app).get('/api/saves/gone/history').expect(200)).body.versions as Array<{ id: string; name: string }>
    await request(app.app).post('/api/saves/gone/history/restore').send({ id: versions.find((v) => v.name === '1-2-LT1.save')!.id }).expect(200)
    expect((await app.services.saveStores.of(1).read('Gone-1', '1-2-LT1.save')).length).toBe(50)
  })

  it('hides the folders of adult games from a person whose level is Off', async () => {
    const cfg = loadConfig()
    writeFileSync(join(cfg.recipesDir, 'spicy.yaml'), 'id: spicy\ntitle: Spicy\nnsfw: true\nsaveDir: Spicy-1\nreleases: []\n')
    await app.catalog.refresh()
    await app.services.saveStores.of(1).write('Spicy-1', '1-1-LT1.save', Buffer.alloc(7, 6))
    await refresh(app)
    expect((await removed(app)).map((r) => r.folder)).toEqual(['Named-1', 'Spicy-1'])
    await request(app.app).put('/api/content').send({ level: 'off' }).expect(200)
    await refresh(app)
    expect((await removed(app)).map((r) => r.folder)).toEqual(['Named-1'])
    await request(app.app).delete('/api/system/storage/saves/Spicy-1').expect(404)
    await request(app.app).put('/api/content').send({ level: 'shown' }).expect(200)
  })

  it('with Off for this device, still lists and deletes the saves of a game a safe recipe names, and hides adult and unknown folders', async () => {
    await app.services.saveStores.of(1).write('Mystery-1', '1-1-LT1.save', Buffer.alloc(8, 7))
    await refresh(app)
    const listed = async (device: string) => ((await request(app.app).get('/api/system/storage').set('x-renplay-adult', device).expect(200)).body.removedSaves as Array<{ folder: string }>).map((r) => r.folder)
    expect(await listed('shown')).toEqual(['Named-1', 'Mystery-1', 'Spicy-1'])
    expect(await listed('off')).toEqual(['Named-1'])
    await request(app.app).delete('/api/system/storage/saves/Spicy-1').set('x-renplay-adult', 'off').expect(404)
    await request(app.app).delete('/api/system/storage/saves/Mystery-1').set('x-renplay-adult', 'off').expect(404)
    await request(app.app).delete('/api/system/storage/saves/Named-1').set('x-renplay-adult', 'off').expect(200)
  })
})

describe('deleting the saves of a removed game, with sign-in on', () => {
  it('is for admins: a player is refused, and an admin’s API token works', async () => {
    const a = await signInFixture({ adminUsername: 'admin', adminPassword: 'correct password' })
    try {
      const cookie = async (username: string, password: string) => (await request(a.app).post('/api/auth/login').set(site).send({ username, password }).expect(200)).headers['set-cookie'][0].split(';')[0] as string
      const admin = await cookie('admin', 'correct password')
      await request(a.app).post('/api/users').set(site).set('Cookie', admin).send({ username: 'player', password: 'player password' }).expect(201)
      const player = await cookie('player', 'player password')
      await a.services.saveStores.of(1).write('Gone-1', '1-1-LT1.save', Buffer.from('save'))
      await request(a.app).delete('/api/system/storage/saves/Gone-1').set(site).set('Cookie', player).expect(403)
      const { token } = (await request(a.app).post('/api/me/tokens').set(site).set('Cookie', admin).send({ name: 'Lab' }).expect(200)).body
      const res = await request(a.app).delete('/api/system/storage/saves/Gone-1').set('Authorization', `Bearer ${token}`).expect(200)
      expect(res.body).toEqual({ folder: 'Gone-1', files: 1, people: 1, bytes: 4 })
    } finally {
      a.cleanup()
    }
  })
})
