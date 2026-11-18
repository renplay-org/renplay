import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { SaveStore } from '../saves/store.js'

// Where a test needs a file operation to fail or to wait: used only by the tests that set them.
const fsHooks = vi.hoisted(() => ({ failUnlink: null as null | ((path: string) => boolean), beforeHistoryRename: null as null | (() => Promise<void>) }))
vi.mock('node:fs/promises', async (orig) => {
  const m = await orig<typeof import('node:fs/promises')>()
  return {
    ...m,
    unlink: async (path: Parameters<typeof m.unlink>[0]) => {
      if (fsHooks.failUnlink?.(String(path))) throw Object.assign(new Error('EIO: input/output error'), { code: 'EIO' })
      return m.unlink(path)
    },
    rename: async (from: Parameters<typeof m.rename>[0], to: Parameters<typeof m.rename>[1]) => {
      if (String(to).includes('save-history')) await fsHooks.beforeHistoryRename?.()
      return m.rename(from, to)
    },
  }
})

const DAY = 24 * 3600_000
const start = Date.parse('2026-12-01T10:00:00Z')
const at = (days: number) => vi.setSystemTime(start + days * DAY)
const save = (n: number) => Buffer.alloc(n, n)
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('deleting the saves of removed games safely', () => {
  let root = ''
  let app: App
  const mine = () => app.services.saveStores.of(1)
  const theirs = () => app.services.saveStores.of(2)
  const del = (folder: string) => request(app.app).delete(`/api/system/storage/saves/${folder}`)
  const sweep = () => app.services.savesExpiry.sweep()
  const userDir = (n: number, sub: string) => join(root, 'data', 'users', String(n), sub)
  const boot = async () => {
    app = await createApp(loadConfig(), { startJobs: false })
    await app.catalog.refresh()
  }
  const library = (id: string, folder: string) => app.db.insertGame({ id, title: id, status: 'installed', build: 'b1', save_dir: folder })
  /** A game in the library whose folder holds a save and the History of an overwrite. */
  const owned = async (folder: string) => {
    library(`game-${folder}`, folder)
    await mine().write(folder, '1-1-LT1.save', save(10))
    await mine().write(folder, '1-1-LT1.save', save(11))
  }
  /** The first call to the library's folders answers as it was, and a game claims `folder` right after. */
  const claimAfterFirstCheck = (folder: string) => {
    const real = app.catalog.librarySaveDirs.bind(app.catalog)
    let calls = 0
    vi.spyOn(app.catalog, 'librarySaveDirs').mockImplementation(() => {
      const dirs = real()
      if (++calls === 1) library('late', folder)
      return dirs
    })
  }
  /** Holds the first History purge until `release` is called, and says when it is held. */
  const holdFirstPurge = () => {
    const real = SaveStore.prototype.purgeHistory
    let release = () => {}
    let held = false
    const gate = new Promise<void>((resolve) => (release = resolve))
    const entered = new Promise<void>((resolve) => {
      vi.spyOn(SaveStore.prototype, 'purgeHistory').mockImplementation(async function (this: SaveStore, ...args) {
        if (!held) {
          held = true
          resolve()
          await gate
        }
        return real.apply(this, args)
      })
    })
    return { entered, release }
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-removed-safety-'))
    mkdirSync(join(root, 'data'), { recursive: true })
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_BACKUP_DIR'] = join(root, 'backups')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    mkdirSync(cfg.recipesDir, { recursive: true })
    writeFileSync(join(cfg.recipesDir, 'named.yaml'), 'id: named\ntitle: Named Game\nnsfw: false\nsaveDir: Named-1\nreleases: []\n')
    writeFileSync(join(cfg.recipesDir, 'spicy.yaml'), 'id: spicy\ntitle: Spicy\nnsfw: true\nsaveDir: Spicy-1\nreleases: []\n')
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    await boot()
    await request(app.app).post('/api/users').send({ username: 'second', name: 'Second', password: 'second-password-1' }).expect(201)
    await mine().write('tokens', 'security_keys.txt', Buffer.from('verifying-key abc\n'))
    await mine().write('persistent', 'persistent', save(3))
  })
  afterEach(() => {
    for (const id of ['late', 'upper']) app.db.deleteGame(id)
    vi.restoreAllMocks()
    fsHooks.failUnlink = null
    fsHooks.beforeHistoryRename = null
  })
  afterAll(() => {
    vi.useRealTimers()
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_BACKUP_DIR', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  describe('a game added while a deletion runs', () => {
    it('keeps the saves of a folder a game claims after the deletion began', async () => {
      at(0)
      await mine().write('Late-1', '1-1-LT1.save', save(20))
      await mine().write('Late-1', '1-2-LT1.save', save(21))
      claimAfterFirstCheck('Late-1')
      await del('Late-1').expect(409)
      expect((await mine().list('Late-1')).map((f) => f.name)).toEqual(expect.arrayContaining(['1-1-LT1.save', '1-2-LT1.save']))
    })

    it('keeps the History of a folder a game claims after the sweep began', async () => {
      at(0)
      await mine().write('Late-2', '1-1-LT1.save', save(22))
      await theirs().write('Late-2', '1-1-LT1.save', save(23))
      await del('Late-2').expect(200)
      at(31)
      claimAfterFirstCheck('Late-2')
      expect(await sweep()).toEqual([])
      expect(await mine().history('Late-2')).toHaveLength(1)
      expect(await theirs().history('Late-2')).toHaveLength(1)
    })
  })

  describe('aliases of other folders', () => {
    it('refuses a save folder that is a link to a game’s folder', async () => {
      await owned('Kept-A')
      symlinkSync('Kept-A', userDir(1, 'saves/Alias-1'))
      const before = await mine().list('Kept-A')
      await del('Alias-1').expect(404)
      expect(await mine().list('Kept-A')).toEqual(before)
      expect(await mine().history('Kept-A')).toHaveLength(1)
    })

    it('does not follow a link in the History it deletes for good', async () => {
      at(0)
      await owned('Kept-B')
      await mine().write('Gone-2', '1-1-LT1.save', save(30))
      await del('Gone-2').expect(200)
      const child = userDir(1, 'save-history/Gone-2/1-1-LT1.save')
      await rm(child, { recursive: true })
      symlinkSync(userDir(1, 'save-history/Kept-B/1-1-LT1.save'), child)
      at(31)
      await sweep()
      expect(await mine().history('Kept-B')).toHaveLength(1)
    })

    it('treats a name that differs only by capitals as the folder of the game, and never touches the shared folders', async () => {
      await owned('Kept-C')
      await mine().write('kept-c', '2-1-LT1.save', save(40))
      await mine().write('tokens', 'security_keys.txt', Buffer.from('verifying-key abc\n'))
      await mine().write('persistent', 'persistent', save(3))
      await mine().write('Tokens', '1-1-LT1.save', save(41))
      await mine().write('Persistent', '1-1-LT1.save', save(42))
      const names = async () => (await Promise.all(['Kept-C', 'kept-c', 'tokens', 'Tokens', 'persistent', 'Persistent'].map(async (d) => (await mine().list(d)).map((f) => `${d}/${f.name}`)))).flat()
      const before = await names()
      await del('kept-c').expect(409)
      await del('Tokens').expect(404)
      await del('Persistent').expect(404)
      expect(await names()).toEqual(before)
    })

    it('keeps the History of a folder that a game uses under another case', async () => {
      at(40)
      await mine().write('lower-1', '1-1-LT1.save', save(43))
      await del('lower-1').expect(200)
      library('upper', 'Lower-1')
      at(71)
      expect(await sweep()).toEqual([])
      expect(await mine().history('lower-1')).toHaveLength(1)
    })
  })

  describe('the 30 days', () => {
    it('are not shortened by a sweep that was already running when another folder was deleted', async () => {
      at(100)
      await mine().write('Race-A', '1-1-LT1.save', save(50))
      await del('Race-A').expect(200)
      at(131)
      const held = holdFirstPurge()
      const sweeping = sweep()
      await held.entered
      await mine().write('Race-B', '1-1-LT1.save', save(51))
      await del('Race-B').expect(200)
      held.release()
      expect(await sweeping).toEqual([{ folder: 'Race-A', files: 1, bytes: 50 }])
      app.close()
      await boot()
      at(160)
      expect(await sweep()).toEqual([])
      at(162)
      expect(await sweep()).toEqual([{ folder: 'Race-B', files: 1, bytes: 51 }])
    })

    it('start again when the same folder is deleted again while a sweep was about to purge it', async () => {
      at(200)
      await mine().write('Race-C', '1-1-LT1.save', save(52))
      await del('Race-C').expect(200)
      at(231)
      const held = holdFirstPurge()
      const sweeping = sweep()
      await held.entered
      await mine().write('Race-C', '1-1-LT1.save', save(53))
      await del('Race-C').expect(200)
      held.release()
      expect(await sweeping).toEqual([])
      expect(await mine().history('Race-C')).toHaveLength(2)
      at(262)
      expect(await sweep()).toEqual([{ folder: 'Race-C', files: 2, bytes: 52 + 53 }])
    })

    it('are not shortened by restoring an older database over the files of a second deletion', async () => {
      at(300)
      await mine().write('Twice-1', '1-1-LT1.save', save(60))
      await del('Twice-1').expect(200)
      app.db.raw.exec(`VACUUM INTO '${join(root, 'library-day-0.db')}'`)
      at(320)
      await mine().write('Twice-1', '1-1-LT1.save', save(61))
      await del('Twice-1').expect(200)
      at(331)
      app.close()
      for (const suffix of ['', '-wal', '-shm']) await rm(join(root, 'data', `library.db${suffix}`), { force: true })
      copyFileSync(join(root, 'library-day-0.db'), join(root, 'data', 'library.db'))
      await boot()
      expect(await sweep()).toEqual([])
      expect(await mine().history('Twice-1')).toHaveLength(2)
      at(351)
      expect(await sweep()).toEqual([{ folder: 'Twice-1', files: 2, bytes: 60 + 61 }])
    })

    it('are not cut short under a save that is being written', async () => {
      at(400)
      await mine().write('Busy-1', '1-1-LT1.save', save(70))
      await del('Busy-1').expect(200)
      at(431)
      await mine().write('Busy-1', '1-1-LT1.save', save(71))
      let release = () => {}
      let held = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      const entered = new Promise<void>((resolve) => (held = resolve))
      fsHooks.beforeHistoryRename = async () => {
        fsHooks.beforeHistoryRename = null
        held()
        await gate
      }
      const writing = mine().write('Busy-1', '1-1-LT1.save', save(72))
      await entered
      const sweeping = sweep()
      await pause(200)
      release()
      expect((await writing).outcome).toBe('replaced')
      await sweeping
      expect((await mine().read('Busy-1', '1-1-LT1.save')).length).toBe(72)
      expect(await mine().history('Busy-1')).toHaveLength(2)
    })

    it('are tried again when the History could not be deleted completely', async () => {
      at(500)
      await mine().write('Stuck-1', '1-1-LT1.save', save(80))
      await mine().write('Stuck-1', '1-2-LT1.save', save(81))
      await del('Stuck-1').expect(200)
      at(531)
      fsHooks.failUnlink = (path) => path.includes('Stuck-1') && path.includes('save-history')
      const lines = vi.spyOn(console, 'log').mockImplementation(() => {})
      const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(await sweep()).toEqual([])
      const logged = [...lines.mock.calls, ...warnings.mock.calls].map((c) => String(c[0]))
      expect(logged.some((l) => l.includes('Stuck-1') && / warn /.test(l))).toBe(true)
      expect(logged.some((l) => l.includes('for good'))).toBe(false)
      vi.restoreAllMocks()
      expect(await mine().history('Stuck-1')).toHaveLength(2)
      fsHooks.failUnlink = null
      app.close()
      await boot()
      expect(await sweep()).toEqual([{ folder: 'Stuck-1', files: 2, bytes: 161 }])
      expect(await mine().history('Stuck-1')).toEqual([])
    })
  })
})
