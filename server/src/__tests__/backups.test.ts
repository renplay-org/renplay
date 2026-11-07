import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'
import { readZipEntries } from '../saves/savefile.js'

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
    await app.accounts.store(2).write('Other-1', 'auto-1-LT1.save', Buffer.from('second save'))
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
    const entries = await readZipEntries(zip, () => true, 64 << 20)
    expect([...entries.keys()].sort()).toEqual(['1-owner/Story-1/1-1-LT1.save', '2-second/Other-1/auto-1-LT1.save', 'README.txt'])
    expect(entries.get('1-owner/Story-1/1-1-LT1.save')!.toString()).toBe('owner save')
  })

  it('keeps the newest few, and never touches the saves', async () => {
    // Older backups, as earlier days left them.
    for (const day of ['2026-01-01-0300', '2026-01-02-0300']) writeFileSync(join(backupDir, `saves-${day}.zip`), 'old')
    await new Promise((r) => setTimeout(r, 1100))
    await request(app.app).post('/api/system/backups').expect(200)
    const names = readdirSync(backupDir).filter((n) => n.endsWith('.zip'))
    expect(names).toHaveLength(2)
    expect(names.some((n) => n.startsWith('saves-2026-01-0'))).toBe(false)
    expect((await app.saves.read('Story-1', '1-1-LT1.save')).toString()).toBe('owner save')
    await request(app.app).get('/api/system/backups/../../etc/passwd').expect(404)
    await request(app.app).get('/api/system/backups/saves-1999-01-01-0000.zip').expect(404)
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
