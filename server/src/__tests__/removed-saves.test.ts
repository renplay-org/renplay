import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

interface Listed { folder: string; title: string | null; people: number; files: number; bytes: number; newest: number }
interface InTrash { entry: string; folder: string; title: string | null; people: number; files: number; bytes: number; deletedAt: number; removeAt: number; attention: string | null }
const report = async (app: App, headers: Record<string, string> = {}) => (await request(app.app).get('/api/system/storage').set(headers).expect(200)).body as { removedSaves: Listed[]; deletedSaves: InTrash[] }
const removed = async (app: App) => (await report(app)).removedSaves
const refresh = (app: App) => request(app.app).post('/api/system/storage/refresh').expect(200)

const DAY = 24 * 3600_000
const start = Date.parse('2026-12-01T10:00:00Z')
const at = (days: number) => vi.setSystemTime(start + days * DAY)
const save = (n: number) => Buffer.alloc(n, n)

describe('saves of games no longer in the library', () => {
  let root = ''
  let app: App
  const mine = () => app.services.saveStores.of(1)
  const theirs = () => app.services.saveStores.of(2)
  const trash = () => join(root, 'data', 'deleted-saves')
  const live = (user: number, sub: string, ...rest: string[]) => join(root, 'data', 'users', String(user), sub, ...rest)
  const restore = (entry: string, headers: Record<string, string> = {}) => request(app.app).post(`/api/system/storage/deleted-saves/${encodeURIComponent(entry)}/restore`).set(headers)

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
    vi.useFakeTimers({ toFake: ['Date'] })
    at(-40)
    app = await createApp(cfg, { startJobs: false })
    await app.catalog.refresh()
    await request(app.app).post('/api/users').send({ username: 'second', name: 'Second', password: 'second-password-1' }).expect(201)
    await mine().write('Gone-1', '1-1-LT1.save', save(100))
    await mine().write('Gone-1', '1-1-LT1.save', save(101))
    at(-39)
    await mine().write('Gone-1', '1-2-LT1.save', save(50))
    at(-38)
    await theirs().write('Gone-1', 'auto-1-LT1.save', save(30))
    at(0)
    await mine().write('Named-1', '1-1-LT1.save', save(10))
    for (const dir of ['Kept-1', 'Later-1', 'Owned-1', 'tokens', 'persistent']) await mine().write(dir, '1-1-LT1.save', save(5))
  })
  afterAll(() => {
    vi.useRealTimers()
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_BACKUP_DIR', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  it('lists them with a name when the catalog knows it, the people, the size and the newest save, and no folder a library game uses', async () => {
    const { removedSaves: [gone, named, ...rest], deletedSaves } = await report(app)
    expect(rest).toEqual([])
    expect(deletedSaves).toEqual([])
    expect(gone).toMatchObject({ folder: 'Gone-1', title: null, people: 2, files: 3, bytes: 181 })
    expect(gone!.newest).toBeCloseTo(start - 38 * DAY, -4)
    expect(named).toMatchObject({ folder: 'Named-1', title: 'Named Game', people: 1, files: 1, bytes: 10 })
  })

  it('refuses a game that is in the library, installed or not, and a folder with no saves', async () => {
    for (const folder of ['Kept-1', 'Later-1', 'Owned-1', 'kept-1']) {
      const res = await request(app.app).delete(`/api/system/storage/saves/${folder}`).expect(409)
      expect(res.body.error).toBe('This game is still in your library. Remove it from the library first, then delete its saves.')
    }
    await request(app.app).delete('/api/system/storage/saves/Nothing-1').expect(404)
    await request(app.app).delete('/api/system/storage/saves/tokens').expect(404)
    await request(app.app).delete('/api/system/storage/saves/Persistent').expect(404)
    await request(app.app).delete('/api/system/storage/saves/..').expect(400)
    await request(app.app).delete('/api/system/storage/saves/..%2Fusers').expect(400)
    expect((await removed(app)).map((r) => r.folder)).toEqual(['Gone-1', 'Named-1'])
    expect(readdirSync(join(root, 'data')).includes('deleted-saves')).toBe(false)
  })

  it('moves everyone’s saves and History of one game into the trash, says so in the log, and leaves the other games', async () => {
    const lines = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await request(app.app).delete('/api/system/storage/saves/Gone-1').expect(200)
    expect(res.body).toEqual({ folder: 'Gone-1', files: 3, people: 2, bytes: 181, entry: '2026-12-01T10-00-00.000Z-Gone-1' })
    expect(lines.mock.calls.map((c) => String(c[0])).find((l) => l.includes('Gone-1'))).toMatch(/ info +\[saves\] +Deleted the saves of Gone-1: 3 files of 2 people, asked by owner$/)
    lines.mockRestore()
    expect(await mine().list('Gone-1')).toEqual([])
    expect(await theirs().list('Gone-1')).toEqual([])
    expect(existsSync(live(1, 'saves', 'Gone-1'))).toBe(false)
    expect(existsSync(live(1, 'save-history', 'Gone-1'))).toBe(false)
    const entry = join(trash(), '2026-12-01T10-00-00.000Z-Gone-1')
    expect(readFileSync(join(entry, 'users/1/saves/Gone-1/1-2-LT1.save'))).toEqual(save(50))
    expect(readFileSync(join(entry, 'users/2/saves/Gone-1/auto-1-LT1.save'))).toEqual(save(30))
    expect(readdirSync(join(entry, 'users/1/save-history/Gone-1/1-1-LT1.save'))).toHaveLength(1)
    expect((await mine().list('Named-1')).length).toBe(1)
    expect((await mine().list('Kept-1')).length).toBe(1)
    await request(app.app).delete('/api/system/storage/saves/Gone-1').expect(404)
  })

  it('shows the trash with when it was deleted and when it is removed for good, counts its size, and leaves it out of the daily backup', async () => {
    await refresh(app)
    const { removedSaves, deletedSaves } = await report(app)
    expect(removedSaves.map((r) => r.folder)).toEqual(['Named-1'])
    expect(deletedSaves).toEqual([{ entry: '2026-12-01T10-00-00.000Z-Gone-1', folder: 'Gone-1', title: null, people: 2, files: 3, bytes: 181 + 100, deletedAt: start, removeAt: start + 30 * DAY, attention: null }])
    const name = await app.backups.run()
    const entries = await readZipEntries(join(root, 'backups', name), () => true, { ...SAVES_ZIP, totalBytes: 64 << 20 })
    expect([...entries.keys()].filter((n) => /Gone-1|save-history|deleted/.test(n))).toEqual([])
    expect([...entries.keys()]).toContain('1-owner/Named-1/1-1-LT1.save')
  })

  it('restores a deleted game’s saves and History when the folder is empty, and refuses when the game has saves there again', async () => {
    const entry = '2026-12-01T10-00-00.000Z-Gone-1'
    await theirs().write('Gone-1', 'new-2-LT1.save', save(9))
    const refused = await restore(entry).expect(409)
    expect(refused.body.error).toBe('Nothing was restored because the game has saves or History in that folder again. Renplay does not mix them.')
    expect(existsSync(join(trash(), entry, 'users/1/saves/Gone-1/1-2-LT1.save'))).toBe(true)
    expect(existsSync(join(trash(), entry, 'users/2/saves/Gone-1/auto-1-LT1.save'))).toBe(true)
    expect(await mine().list('Gone-1')).toEqual([])
    await theirs().remove('Gone-1', 'new-2-LT1.save')
    // A folder the game left empty would not stop a restore, but its History, which holds the deleted save, would.
    rmSync(live(2, 'save-history', 'Gone-1'), { recursive: true })
    const res = await restore(entry).expect(200)
    expect(res.body).toEqual({ folder: 'Gone-1', files: 3, people: 2, bytes: 181 })
    expect((await mine().list('Gone-1')).map((f) => f.name).sort()).toEqual(['1-1-LT1.save', '1-2-LT1.save'])
    expect(await mine().read('Gone-1', '1-2-LT1.save')).toEqual(save(50))
    expect((await theirs().list('Gone-1')).map((f) => f.name)).toEqual(['auto-1-LT1.save'])
    expect(readdirSync(live(1, 'save-history', 'Gone-1', '1-1-LT1.save'))).toHaveLength(1)
    expect(readdirSync(trash())).toEqual([])
    await restore(entry).expect(404)
  })

  it('removes a deleted game’s saves for good after 30 days, and not a day sooner', async () => {
    await refresh(app)
    await request(app.app).delete('/api/system/storage/saves/Gone-1').expect(200)
    const entry = readdirSync(trash())[0]!
    at(29)
    expect(await app.services.saveTrash.purge()).toEqual([])
    expect(readdirSync(trash())).toEqual([entry])
    at(31)
    const lines = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await app.services.saveTrash.purge()).toEqual([{ entry, folder: 'Gone-1', files: 3, bytes: 281 }])
    expect(lines.mock.calls.map((c) => String(c[0])).find((l) => l.includes('for good'))).toMatch(/ info +\[saves\] +Deleted the saves of Gone-1 for good: 3 files, 281 B freed$/)
    lines.mockRestore()
    expect(readdirSync(trash())).toEqual([])
    expect((await report(app)).deletedSaves).toEqual([])
    await restore(entry).expect(404)
    expect((await mine().list('Named-1')).length).toBe(1)
  })

  it('hides the folders of adult games from a person whose level is Off, and from a device at Off, in the list, the trash and both actions', async () => {
    const cfg = loadConfig()
    writeFileSync(join(cfg.recipesDir, 'spicy.yaml'), 'id: spicy\ntitle: Spicy\nnsfw: true\nsaveDir: Spicy-1\nreleases: []\n')
    await app.catalog.refresh()
    await mine().write('Spicy-1', '1-1-LT1.save', save(7))
    await mine().write('Mystery-1', '1-1-LT1.save', save(8))
    await refresh(app)
    const listed = async (headers: Record<string, string> = {}) => (await report(app, headers)).removedSaves.map((r) => r.folder)
    expect(await listed()).toEqual(['Named-1', 'Mystery-1', 'Spicy-1'])
    expect(await listed({ 'x-renplay-adult': 'off' })).toEqual(['Named-1'])
    await request(app.app).delete('/api/system/storage/saves/Spicy-1').set('x-renplay-adult', 'off').expect(404)
    await request(app.app).delete('/api/system/storage/saves/Mystery-1').set('x-renplay-adult', 'off').expect(404)
    await request(app.app).delete('/api/system/storage/saves/Spicy-1').expect(200)
    const trashed = (await report(app)).deletedSaves
    expect(trashed.map((t) => t.folder)).toEqual(['Spicy-1'])
    expect((await report(app, { 'x-renplay-adult': 'off' })).deletedSaves).toEqual([])
    await restore(trashed[0]!.entry, { 'x-renplay-adult': 'off' }).expect(404)
    await request(app.app).put('/api/content').send({ level: 'off' }).expect(200)
    await refresh(app)
    expect(await listed()).toEqual(['Named-1', 'Mystery-1'])
    expect((await report(app)).deletedSaves).toEqual([])
    await request(app.app).put('/api/content').send({ level: 'shown' }).expect(200)
    await restore(trashed[0]!.entry).expect(200)
    await request(app.app).delete('/api/system/storage/saves/Named-1').set('x-renplay-adult', 'off').expect(200)
  })

  it('hides a folder that differs from an adult recipe’s only in capitals like the folder itself, at an installation at Off', async () => {
    // Both would otherwise work: a live folder to delete, and an entry of the first account that restores into an empty folder.
    const variant = '2026-12-01T10-00-00.000Z-spicy-1'
    mkdirSync(join(trash(), variant, 'users/1/saves/spicy-1'), { recursive: true })
    writeFileSync(join(trash(), variant, 'users/1/saves/spicy-1/1-1-LT1.save'), 'x')
    writeFileSync(join(trash(), variant, 'users/1/account'), app.services.saveStores.identity(1)!)
    // The folder of the earlier test is gone, so this one is named in capitals as written, also on storage that ignores them.
    for (const sub of ['saves', 'save-history']) rmSync(live(1, sub, 'Spicy-1'), { recursive: true, force: true })
    await mine().write('spicy-1', '1-1-LT1.save', save(9))
    await request(app.app).put('/api/content').send({ level: 'off' }).expect(200)
    try {
      expect((await report(app)).deletedSaves.map((d) => d.folder)).not.toContain('spicy-1')
      expect((await removed(app)).map((r) => r.folder)).not.toContain('spicy-1')
      await restore(variant).expect(404)
      await request(app.app).delete('/api/system/storage/saves/spicy-1').expect(404)
    } finally {
      await request(app.app).put('/api/content').send({ level: 'shown' }).expect(200)
    }
    expect((await report(app)).deletedSaves.map((d) => d.folder)).toContain('spicy-1')
    await request(app.app).delete('/api/system/storage/saves/spicy-1').expect(200)
    await restore(variant).expect(200)
    expect(readFileSync(live(1, 'saves', 'spicy-1', '1-1-LT1.save'), 'utf8')).toBe('x')
  })
})

describe('the saves of a removed game, with sign-in on', () => {
  it('is for admins: a player is refused, and an admin’s API token works', async () => {
    const a = await signInFixture({ adminUsername: 'admin', adminPassword: 'correct password' })
    try {
      const cookie = async (username: string, password: string) => (await request(a.app).post('/api/auth/login').set(site).send({ username, password }).expect(200)).headers['set-cookie'][0].split(';')[0] as string
      const admin = await cookie('admin', 'correct password')
      await request(a.app).post('/api/users').set(site).set('Cookie', admin).send({ username: 'player', password: 'player password' }).expect(201)
      const player = await cookie('player', 'player password')
      await a.services.saveStores.of(1).write('Gone-1', '1-1-LT1.save', Buffer.from('save'))
      const { token } = (await request(a.app).post('/api/me/tokens').set(site).set('Cookie', admin).send({ name: 'Lab' }).expect(200)).body
      const bearer = { Authorization: `Bearer ${token}` }
      const entry = encodeURIComponent('2026-12-01T10-00-00.000Z-Gone-1')
      await request(a.app).get('/api/system/storage').expect(401)
      await request(a.app).delete('/api/system/storage/saves/Gone-1').expect(401)
      await request(a.app).delete('/api/system/storage/saves/Gone-1').set(site).set('Cookie', player).expect(403)
      await request(a.app).post(`/api/system/storage/deleted-saves/${entry}/restore`).set(site).set('Cookie', player).expect(403)
      const res = await request(a.app).delete('/api/system/storage/saves/Gone-1').set(bearer).expect(200)
      expect(res.body).toMatchObject({ folder: 'Gone-1', files: 1, people: 1, bytes: 4 })
      await request(a.app).post(`/api/system/storage/deleted-saves/${encodeURIComponent(res.body.entry)}/restore`).set(site).set('Cookie', player).expect(403)
      expect(await a.services.saveStores.of(1).list('Gone-1')).toEqual([])
      await request(a.app).post(`/api/system/storage/deleted-saves/${encodeURIComponent(res.body.entry)}/restore`).set(bearer).expect(200)
      expect((await a.services.saveStores.of(1).list('Gone-1')).length).toBe(1)
    } finally {
      a.cleanup()
    }
  })
})
