import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'
import { SaveBackups } from '../saves/backups.js'
import { SAVES_ZIP } from '../saves/savefile.js'
import { readZipEntries } from '../util/zip.js'

describe('save backups', () => {
  let root = ''
  let app: App
  let backupDir = ''

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-backups-'))
    backupDir = join(root, 'elsewhere')
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_BACKUP_DIR'] = backupDir
    process.env['RENPLAY_BACKUP_KEEP'] = '2'
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    Db.open(cfg.dataDir).close()
    app = await createApp(cfg, { startJobs: false })
    await app.saves.write('Story-1', '1-1-LT1.save', Buffer.from('owner save'))
    await request(app.app).post('/api/users').send({ username: 'second', name: 'Second', password: 'second-password-1' }).expect(201)
    await app.services.saveStores.of(2).write('Other-1', 'auto-1-LT1.save', Buffer.from('second save'))
  })
  afterAll(() => {
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_BACKUP_DIR', 'RENPLAY_BACKUP_KEEP', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  it('is due at once, zips everyone’s saves into the folder, and says when the next one is', async () => {
    const before = (await request(app.app).get('/api/system/backups').expect(200)).body
    expect(before).toMatchObject({ dir: backupDir, keep: 2, files: [], last: null })
    expect(before.next).toBeLessThanOrEqual(Date.now())
    expect(await app.backups.runIfDue()).toMatch(/^saves-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/)
    const after = (await request(app.app).get('/api/system/backups').expect(200)).body
    expect(after.files).toHaveLength(1)
    expect(after.next).toBeGreaterThan(Date.now() + 23 * 3600_000)
    // Not due again within the day.
    expect(await app.backups.runIfDue()).toBeNull()
    const zip = (await request(app.app).get(`/api/system/backups/${after.files[0].name}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    }).expect(200)).body
    const entries = await readZipEntries(zip, () => true, { ...SAVES_ZIP, totalBytes: 64 << 20 })
    expect([...entries.keys()].sort()).toEqual(['1-owner/Story-1/1-1-LT1.save', '2-second/Other-1/auto-1-LT1.save', 'README.txt'])
    expect(entries.get('1-owner/Story-1/1-1-LT1.save')!.toString()).toBe('owner save')
    expect(after.library).toMatchObject({ path: expect.stringContaining(join(backupDir, 'library', 'library-')), size: expect.any(Number), at: expect.any(Number) })
    const library = new DatabaseSync(after.library.path, { readOnly: true })
    try {
      expect(library.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(library.prepare('SELECT username FROM users ORDER BY id').all()).toEqual([{ username: 'owner' }, { username: 'second' }])
    } finally { library.close() }
  })

  it('keeps the newest few, and never touches the saves', async () => {
    // Older backups, as earlier days left them.
    for (const day of ['2026-01-01-0300', '2026-01-02-0300']) {
      writeFileSync(join(backupDir, `saves-${day}.zip`), 'old')
      writeFileSync(join(backupDir, 'library', `library-${day}.db`), 'old')
    }
    writeFileSync(join(backupDir, 'library', 'library-before-16-to-17-2026-01-01.db'), 'Migration copy')
    await new Promise((r) => setTimeout(r, 1100))
    await request(app.app).post('/api/system/backups').expect(200)
    const names = readdirSync(backupDir).filter((n) => n.endsWith('.zip'))
    expect(names).toHaveLength(2)
    expect(names.some((n) => n.startsWith('saves-2026-01-0'))).toBe(false)
    const copies = readdirSync(join(backupDir, 'library'))
    expect(copies.filter((n) => /^library-\d/.test(n))).toHaveLength(2)
    expect(copies.some((n) => n.startsWith('library-2026-01-0'))).toBe(false)
    expect(copies).toContain('library-before-16-to-17-2026-01-01.db')
    expect((await app.saves.read('Story-1', '1-1-LT1.save')).toString()).toBe('owner save')
    await request(app.app).get('/api/system/backups/../../etc/passwd').expect(404)
    await request(app.app).get('/api/system/backups/saves-1999-01-01-0000.zip').expect(404)
  })

  it('gives Prometheus counts about the server, and a widget for the person asking', async () => {
    const text = (await request(app.app).get('/api/metrics').expect(200).expect('content-type', /text\/plain/)).text
    expect(text).toMatch(/^renplay_info\{version="[^"]+"\} 1$/m)
    expect(text).toMatch(/^renplay_people 2$/m)
    expect(text).toMatch(/^renplay_save_files 2$/m)
    expect(text).toMatch(/^renplay_jobs\{status="running"\} 0$/m)
    expect(text).toMatch(/^renplay_disk_free_bytes\{volume="data"\} \d+$/m)
    expect(text).toMatch(/# TYPE renplay_play_seconds_total counter/)
    expect((await request(app.app).get('/api/widget').expect(200)).body).toMatchObject({ games: 0, installed: 0, installing: 0, playedTodayMinutes: 0, lastPlayed: null, recent: [] })
  })

  it('shows what uses space: each game’s builds and download, engines, and folders of no game', async () => {
    const cfg = loadConfig()
    app.db.insertGame({ id: 'big', title: 'Big', status: 'installed', save_dir: 'Big-1', build: 'b2', source: JSON.stringify({ archive: 'Big-1.0-pc.zip' }) })
    mkdirSync(join(cfg.gamesDir, 'big', 'b2'), { recursive: true })
    writeFileSync(join(cfg.gamesDir, 'big', 'b2', 'assets.pack'), Buffer.alloc(3000))
    mkdirSync(join(cfg.gamesDir, 'big', 'b2.mabc'), { recursive: true })
    writeFileSync(join(cfg.gamesDir, 'big', 'b2.mabc', 'game.zip'), Buffer.alloc(500))
    mkdirSync(cfg.archivesDir, { recursive: true })
    writeFileSync(join(cfg.archivesDir, 'Big-1.0-pc.zip'), Buffer.alloc(7000))
    mkdirSync(join(cfg.gamesDir, 'stray'), { recursive: true })
    writeFileSync(join(cfg.gamesDir, 'stray', 'x'), Buffer.alloc(100))
    // A download name that cannot be a path in the downloads folder does not break the view.
    app.db.insertGame({ id: 'odd', title: 'Odd', status: 'installed', save_dir: 'Odd-1', build: 'b1', source: JSON.stringify({ archive: '../outside.zip' }) })
    await request(app.app).post('/api/system/storage/refresh').expect(200)
    const [s, again] = (await Promise.all([request(app.app).get('/api/system/storage').expect(200), request(app.app).get('/api/system/storage').expect(200)])).map((r) => r.body)
    expect(again).toEqual(s)
    expect(s.games.find((g: { id: string }) => g.id === 'odd')).toMatchObject({ download: null })
    expect(s.games[0]).toMatchObject({ id: 'big', bytes: 10500, download: { name: 'Big-1.0-pc.zip', bytes: 7000 } })
    expect(s.games[0].builds).toEqual(expect.arrayContaining([{ name: 'b2', current: true, bytes: 3000 }, { name: 'b2.mabc', current: false, bytes: 500 }]))
    expect(s.orphans).toEqual([{ name: 'stray', bytes: 100 }])
    expect(s.freeable.downloads).toBe(7000)
    expect(s.totals).toMatchObject({ builds: 3500, downloads: 7000 })
  })

  it('keeps defaults for everyone, which a person’s own choice replaces', async () => {
    expect((await request(app.app).get('/api/defaults').expect(200)).body).toEqual({ tagsExclude: [], lighterBackground: null, textSize: null, rollback: null, skip: null })
    await request(app.app).put('/api/defaults').send({ textSize: 2 }).expect(400)
    await request(app.app).put('/api/defaults').send({ rollback: 'yes' }).expect(400)
    await request(app.app).put('/api/defaults').send({ tagsExclude: ['horror', 'horror'], lighterBackground: true, textSize: 1.25, rollback: true }).expect(200)
    expect((await request(app.app).get('/api/defaults').expect(200)).body).toEqual({ tagsExclude: ['horror'], lighterBackground: true, textSize: 1.25, rollback: true, skip: null })
    expect((await request(app.app).get('/api/me/tags').expect(200)).body).toEqual({ include: [], exclude: ['horror'], source: 'admin' })
    await request(app.app).put('/api/me/tags').send({ include: [], exclude: [] }).expect(200)
    expect((await request(app.app).get('/api/me/tags').expect(200)).body).toEqual({ include: [], exclude: [], source: 'you' })
  })

  it('says where each server setting comes from, and never a secret', async () => {
    const sys = (await request(app.app).get('/api/system').expect(200)).body
    expect(sys.setBy).toMatchObject({ RENPLAY_AUTH: 'server', RENPLAY_BACKUP_DIR: 'server', RENPLAY_LOG_LEVEL: 'default' })
    expect(Object.keys(sys.setBy).some((k) => /SECRET|PASSWORD|TOKEN/.test(k))).toBe(false)
    expect(sys.keepDownloadsChosen).toBe(false)
    expect(sys.sync.chosen).toBe(false)
  })

  it('reports a backup it cannot write, without bringing the server down', async () => {
    // The part file for the next seconds cannot be created (a folder is in its place), as on a full disk.
    const pad = (n: number) => String(n).padStart(2, '0')
    const blocked: string[] = []
    for (let s = 0; s < 4; s++) {
      const d = new Date(Date.now() + s * 1000)
      const name = `.saves-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip.part`
      mkdirSync(join(backupDir, name), { recursive: true })
      blocked.push(name)
    }
    await expect(app.backups.run()).rejects.toThrow()
    expect((await app.backups.info()).error).toBeTruthy()
    await new Promise((r) => setTimeout(r, 200))
    for (const name of blocked) rmSync(join(backupDir, name), { recursive: true, force: true })
  })
})

describe('save backups on a small disk', () => {
  let root = ''
  let app: App
  let backupDir = ''
  let libraryDir = ''
  // What the fake disk says is free, and what the backup folder held when it was asked.
  let free = 10 ** 12
  const asked: string[][] = []
  let backups: SaveBackups
  // A server that has not failed before, as after a restart.
  const fresh = () => new SaveBackups(loadConfig(), app.db, app.services.saveStores, async () => ({ total: 10 ** 12, free }))

  const zips = () => readdirSync(backupDir).filter((n) => /^saves-.*\.zip$/.test(n)).sort()
  const copies = () => readdirSync(libraryDir).filter((n) => /^library-\d/.test(n)).sort()
  const age = (path: string, days: number) => {
    const t = new Date(Date.now() - days * 24 * 3600_000)
    utimesSync(path, t, t)
  }
  const dayOf = (n: number) => `2026-01-${String(n).padStart(2, '0')}`

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-backups-small-'))
    backupDir = join(root, 'elsewhere')
    libraryDir = join(backupDir, 'library')
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_BACKUP_DIR'] = backupDir
    process.env['RENPLAY_BACKUP_KEEP'] = '3'
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    Db.open(cfg.dataDir).close()
    app = await createApp(cfg, { startJobs: false })
    await app.saves.write('Story-1', '1-1-LT1.save', Buffer.from('owner save'))
    backups = new SaveBackups(cfg, app.db, app.services.saveStores, async () => {
      asked.push(zips())
      return { total: 10 ** 12, free }
    })
  })
  afterEach(() => {
    free = 10 ** 12
    asked.length = 0
    vi.restoreAllMocks()
  })
  afterAll(() => {
    backups?.stop()
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_BACKUP_DIR', 'RENPLAY_BACKUP_KEEP', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  /** Days of backups as earlier runs left them, with a migration copy that must stay. */
  const seed = (days: number[]) => {
    mkdirSync(libraryDir, { recursive: true })
    for (const d of days) {
      writeFileSync(join(backupDir, `saves-${dayOf(d)}-030000.zip`), 'x'.repeat(100))
      writeFileSync(join(libraryDir, `library-${dayOf(d)}T030000.000Z-a.db`), 'old')
    }
    writeFileSync(join(libraryDir, 'library-before-16-to-17-2026-01-01.db'), 'Migration copy')
  }

  it('removes old daily copies before it writes the new zip, so a full set needs no room for one more', async () => {
    seed([1, 2, 3])
    const name = await backups.run()
    // When the disk was asked, the folder already held one zip fewer than the number kept.
    expect(asked[0]).toEqual([`saves-${dayOf(2)}-030000.zip`, `saves-${dayOf(3)}-030000.zip`])
    expect(zips()).toEqual([`saves-${dayOf(2)}-030000.zip`, `saves-${dayOf(3)}-030000.zip`, name])
    expect(copies()).toHaveLength(3)
    expect(copies().some((n) => n.startsWith(`library-${dayOf(1)}`))).toBe(false)
    expect(readdirSync(libraryDir)).toContain('library-before-16-to-17-2026-01-01.db')
  })

  it('keeps the newest zip even when only one is kept, until the new one is written', async () => {
    rmSync(backupDir, { recursive: true, force: true })
    seed([1])
    const cfg = { ...loadConfig(), backupKeep: 1 }
    const one = new SaveBackups(cfg, app.db, app.services.saveStores, async () => ({ total: 10 ** 12, free }))
    const name = await one.run()
    expect(zips()).toEqual([name])
  })

  it('skips the run, says what to do and writes nothing when the disk has no room for another zip', async () => {
    rmSync(backupDir, { recursive: true, force: true })
    seed([1, 2])
    const before = { zips: zips(), copies: copies() }
    free = 50
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(backups.run()).rejects.toThrow(/RENPLAY_BACKUP_KEEP.*RENPLAY_BACKUP_DIR/s)
    expect(zips()).toEqual(before.zips)
    expect(copies()).toEqual(before.copies)
    expect(readdirSync(backupDir).filter((n) => n.endsWith('.part'))).toEqual([])
    expect((await backups.info()).error).toMatch(/free space/i)
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => /Not enough space/i.test(l))
    expect(line).toMatch(/ warn .*\[backup\]/)
    expect(line).toMatch(/free space/i)
  })

  it('does not retry every hour after a failure: the next try is the next day, and leaves no library copy', async () => {
    rmSync(backupDir, { recursive: true, force: true })
    seed([1])
    for (const n of zips()) age(join(backupDir, n), 3)
    const library = copies()
    free = 50
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = fresh()
    await expect(server.runIfDue()).rejects.toThrow()
    expect((await server.info()).next).toBeGreaterThan(Date.now() + 23 * 3600_000)
    // The hourly check finds nothing due, however often it runs.
    for (let i = 0; i < 3; i++) expect(await server.runIfDue()).toBeNull()
    expect(copies()).toEqual(library)
    // A person pressing Back up now once there is room still works, and clears the error.
    free = 10 ** 12
    await server.run()
    expect((await server.info()).error).toBeNull()
  })

  it('leaves no library copy behind when writing the zip fails, whichever way it fails', async () => {
    rmSync(backupDir, { recursive: true, force: true })
    seed([1])
    const library = copies()
    const pad = (n: number) => String(n).padStart(2, '0')
    const blocked: string[] = []
    for (let s = 0; s < 4; s++) {
      const d = new Date(Date.now() + s * 1000)
      const name = `.saves-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip.part`
      mkdirSync(join(backupDir, name), { recursive: true })
      blocked.push(name)
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < 2; i++) await expect(backups.run()).rejects.toThrow()
    expect(copies()).toEqual(library)
    for (const name of blocked) rmSync(join(backupDir, name), { recursive: true, force: true })
  })

  it('sweeps a part file a killed server left behind, and not one that may still be growing', async () => {
    rmSync(backupDir, { recursive: true, force: true })
    seed([1])
    const stale = join(backupDir, `.saves-${dayOf(1)}-030000.zip.part`)
    const staleLibrary = join(libraryDir, `.library-${dayOf(1)}T030000.000Z-a.db.part`)
    const fresh = join(backupDir, `.saves-${dayOf(5)}-030000.zip.part`)
    for (const f of [stale, staleLibrary, fresh]) writeFileSync(f, 'half')
    age(stale, 8)
    age(staleLibrary, 8)
    await backups.run()
    expect(() => statSync(stale)).toThrow()
    expect(() => statSync(staleLibrary)).toThrow()
    expect(statSync(fresh).size).toBe(4)
  })

  it('sweeps every part file when the server starts, since no backup can be running then', async () => {
    const fresh = join(backupDir, `.saves-${dayOf(6)}-030000.zip.part`)
    writeFileSync(fresh, 'half')
    backups.start()
    try {
      await vi.waitFor(() => expect(() => statSync(fresh)).toThrow())
    } finally {
      backups.stop()
    }
  })
})
