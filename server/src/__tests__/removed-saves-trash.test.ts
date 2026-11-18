import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'

// Where a test needs a file operation to fail or to wait: used only by the tests that set them.
const fsHooks = vi.hoisted(() => ({ failRm: null as null | ((path: string) => boolean), beforeSavesRename: null as null | (() => Promise<void>) }))
vi.mock('node:fs/promises', async (orig) => {
  const m = await orig<typeof import('node:fs/promises')>()
  return {
    ...m,
    rm: async (path: Parameters<typeof m.rm>[0], opts?: Parameters<typeof m.rm>[1]) => {
      if (fsHooks.failRm?.(String(path))) throw Object.assign(new Error('EIO: input/output error'), { code: 'EIO' })
      return m.rm(path, opts)
    },
    rename: async (from: Parameters<typeof m.rename>[0], to: Parameters<typeof m.rename>[1]) => {
      if (String(to).includes('deleted-saves') && String(from).includes('/saves/')) await fsHooks.beforeSavesRename?.()
      return m.rename(from, to)
    },
  }
})

const DAY = 24 * 3600_000
const start = Date.parse('2026-12-01T10:00:00Z')
const at = (days: number) => vi.setSystemTime(start + days * DAY)
const save = (n: number) => Buffer.alloc(n, n)

describe('deleting the saves of removed games safely', () => {
  let root = ''
  let app: App
  const mine = () => app.services.saveStores.of(1)
  const theirs = () => app.services.saveStores.of(2)
  const del = (folder: string) => request(app.app).delete(`/api/system/storage/saves/${folder}`)
  const purge = () => app.services.saveTrash.purge()
  const trash = () => join(root, 'data', 'deleted-saves')
  const live = (user: number, sub: string, ...rest: string[]) => join(root, 'data', 'users', String(user), sub, ...rest)
  const entryOf = (folder: string) => readdirSync(trash()).filter((n) => n.endsWith(`Z-${folder}`))
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
  /** The `nth` call to the library's folders answers as it was, and a game claims `folder` right after. */
  const claimAfterCall = (nth: number, folder: string) => {
    const real = app.catalog.librarySaveDirs.bind(app.catalog)
    let calls = 0
    vi.spyOn(app.catalog, 'librarySaveDirs').mockImplementation(() => {
      const dirs = real()
      if (++calls === nth) library('late', folder)
      return dirs
    })
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-removed-trash-'))
    mkdirSync(join(root, 'data'), { recursive: true })
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_BACKUP_DIR'] = join(root, 'backups')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    await boot()
    await request(app.app).post('/api/users').send({ username: 'second', name: 'Second', password: 'second-password-1' }).expect(201)
  })
  afterEach(() => {
    app.db.deleteGame('late')
    vi.restoreAllMocks()
    fsHooks.failRm = null
    fsHooks.beforeSavesRename = null
  })
  afterAll(() => {
    vi.useRealTimers()
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_BACKUP_DIR', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  describe('a game added or a save written while a deletion runs', () => {
    it('moves nothing when a game claims the folder after the lookup, because the library is asked again under the lock', async () => {
      at(0)
      await mine().write('Late-1', '1-1-LT1.save', save(20))
      claimAfterCall(1, 'Late-1')
      await del('Late-1').expect(409)
      expect((await mine().list('Late-1')).map((f) => f.name)).toEqual(['1-1-LT1.save'])
      expect(entryOf('Late-1')).toEqual([])
    })

    it('stops at the next person when a game claims the folder meanwhile, and what moved is in the trash, restorable', async () => {
      at(0)
      await mine().write('Late-2', '1-1-LT1.save', save(21))
      await theirs().write('Late-2', '1-1-LT1.save', save(22))
      claimAfterCall(2, 'Late-2')
      const res = await del('Late-2').expect(409)
      expect(res.body.error).toBe('This game is still in your library. Remove it from the library first, then delete its saves.')
      expect(await mine().list('Late-2')).toEqual([])
      expect((await theirs().list('Late-2')).length).toBe(1)
      const [entry] = entryOf('Late-2')
      expect(readFileSync(join(trash(), entry!, 'users/1/saves/Late-2/1-1-LT1.save'))).toEqual(save(21))
      await request(app.app).post(`/api/system/storage/deleted-saves/${encodeURIComponent(entry!)}/restore`).expect(200)
      expect(await mine().read('Late-2', '1-1-LT1.save')).toEqual(save(21))
    })

    it('lets a save written during the move land in a new live folder, and never in the trash', async () => {
      at(0)
      await mine().write('Busy-1', '1-1-LT1.save', save(30))
      let release = () => {}
      let held = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      const entered = new Promise<void>((resolve) => (held = resolve))
      fsHooks.beforeSavesRename = async () => {
        fsHooks.beforeSavesRename = null
        held()
        await gate
      }
      const deleting = del('Busy-1').then((r) => r)
      await entered
      const writing = mine().write('Busy-1', '1-2-LT1.save', save(31))
      // Without the lock the write would be done within this time, into the folder that is being moved.
      await new Promise((resolve) => setTimeout(resolve, 100))
      release()
      expect((await deleting).status).toBe(200)
      expect((await writing).outcome).toBe('added')
      expect((await mine().list('Busy-1')).map((f) => f.name)).toEqual(['1-2-LT1.save'])
      const [entry] = entryOf('Busy-1')
      expect(readdirSync(join(trash(), entry!, 'users/1/saves/Busy-1'))).toEqual(['1-1-LT1.save'])
    })

    it('starts a game that claims the folder afterwards from an empty folder, and the trash is untouched', async () => {
      at(0)
      await mine().write('Back-1', '1-1-LT1.save', save(40))
      await del('Back-1').expect(200)
      const [entry] = entryOf('Back-1')
      library('late', 'Back-1')
      expect(await mine().list('Back-1')).toEqual([])
      await mine().write('Back-1', '2-1-LT1.save', save(41))
      at(31)
      await purge()
      expect(entryOf('Back-1')).toEqual([])
      expect(entry).toBeDefined()
      expect(await mine().read('Back-1', '2-1-LT1.save')).toEqual(save(41))
    })
  })

  describe('links', () => {
    it('does not follow a link at the folder: a link to a game’s folder is not deleted, and its target is untouched', async () => {
      at(0)
      await owned('Kept-A')
      symlinkSync('Kept-A', live(1, 'saves', 'Alias-1'))
      await theirs().write('Alias-1', '1-1-LT1.save', save(50))
      await del('Alias-1').expect(200)
      expect(entryOf('Alias-1')).toHaveLength(1)
      expect(existsSync(join(trash(), entryOf('Alias-1')[0]!, 'users/1'))).toBe(false)
      expect((await mine().list('Kept-A')).map((f) => f.name)).toEqual(['1-1-LT1.save'])
      expect(await mine().history('Kept-A')).toHaveLength(1)
      expect(existsSync(live(1, 'saves', 'Alias-1'))).toBe(true)
    })

    it('does not follow a link inside the History it moves, and removing it for good removes the link only', async () => {
      at(0)
      await owned('Kept-B')
      await mine().write('Gone-2', '1-1-LT1.save', save(60))
      await mine().write('Gone-2', '1-1-LT1.save', save(61))
      const child = live(1, 'save-history', 'Gone-2', '1-1-LT1.save')
      await rm(child, { recursive: true })
      symlinkSync(live(1, 'save-history', 'Kept-B', '1-1-LT1.save'), child)
      await del('Gone-2').expect(200)
      expect(await mine().history('Kept-B')).toHaveLength(1)
      at(31)
      await purge()
      expect(entryOf('Gone-2')).toEqual([])
      expect(await mine().history('Kept-B')).toHaveLength(1)
      expect((await mine().list('Kept-B')).length).toBe(1)
    })

    it('moves a link that is the History folder as a link, and its target stays', async () => {
      at(0)
      await owned('Kept-C')
      await mine().write('Gone-3', '1-1-LT1.save', save(62))
      symlinkSync(live(1, 'save-history', 'Kept-C'), live(1, 'save-history', 'Gone-3'))
      await del('Gone-3').expect(200)
      expect(existsSync(live(1, 'save-history', 'Gone-3'))).toBe(false)
      expect(await mine().history('Kept-C')).toHaveLength(1)
      at(31)
      await purge()
      expect(await mine().history('Kept-C')).toHaveLength(1)
    })

    it('refuses a snapshot through a link in History, for an ordinary save too', async () => {
      at(0)
      await owned('Kept-D')
      await mine().write('Other-1', '1-1-LT1.save', save(70))
      mkdirSync(live(1, 'save-history', 'Other-1'), { recursive: true })
      symlinkSync(live(1, 'save-history', 'Kept-D', '1-1-LT1.save'), live(1, 'save-history', 'Other-1', '1-1-LT1.save'))
      await expect(mine().write('Other-1', '1-1-LT1.save', save(71))).rejects.toThrow(/link/)
      expect(await mine().read('Other-1', '1-1-LT1.save')).toEqual(save(70))
      expect(await mine().history('Kept-D')).toHaveLength(1)
    })
  })

  it('moves the History of a person who has no saves in the folder, and removes it with the rest', async () => {
    at(0)
    await mine().write('Only-1', '1-1-LT1.save', save(80))
    await theirs().write('Only-1', '1-1-LT1.save', save(81))
    expect(await theirs().remove('Only-1', '1-1-LT1.save')).toBe(true)
    await del('Only-1').expect(200)
    const [entry] = entryOf('Only-1')
    expect(existsSync(live(2, 'save-history', 'Only-1'))).toBe(false)
    expect(readdirSync(join(trash(), entry!, 'users/2/save-history/Only-1/1-1-LT1.save'))).toHaveLength(1)
    at(31)
    await purge()
    expect(existsSync(join(trash(), entry!))).toBe(false)
  })

  it('does not let a restored older database move the clock, which is the folder’s name', async () => {
    at(300)
    await mine().write('Twice-1', '1-1-LT1.save', save(90))
    await del('Twice-1').expect(200)
    app.db.raw.exec(`VACUUM INTO '${join(root, 'library-day-0.db')}'`)
    at(320)
    await mine().write('Twice-1', '1-1-LT1.save', save(91))
    await del('Twice-1').expect(200)
    at(331)
    app.close()
    for (const suffix of ['', '-wal', '-shm']) await rm(join(root, 'data', `library.db${suffix}`), { force: true })
    copyFileSync(join(root, 'library-day-0.db'), join(root, 'data', 'library.db'))
    await boot()
    expect(await purge()).toEqual([expect.objectContaining({ folder: 'Twice-1', files: 1, bytes: 90 })])
    expect(entryOf('Twice-1')).toHaveLength(1)
    at(351)
    expect(await purge()).toEqual([expect.objectContaining({ folder: 'Twice-1', files: 1, bytes: 91 })])
  })

  describe('the purge', () => {
    it('logs and retries a deletion that failed, and goes on with the others', async () => {
      at(400)
      await mine().write('Stuck-1', '1-1-LT1.save', save(100))
      await mine().write('Fine-1', '1-1-LT1.save', save(101))
      await del('Stuck-1').expect(200)
      await del('Fine-1').expect(200)
      at(431)
      fsHooks.failRm = (path) => path.includes('Stuck-1')
      const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const lines = vi.spyOn(console, 'log').mockImplementation(() => {})
      expect(await purge()).toEqual([expect.objectContaining({ folder: 'Fine-1' })])
      const logged = [...lines.mock.calls, ...warnings.mock.calls].map((c) => String(c[0]))
      expect(logged.some((l) => l.includes('Stuck-1') && / warn /.test(l))).toBe(true)
      vi.restoreAllMocks()
      expect(entryOf('Stuck-1')).toHaveLength(1)
      expect(entryOf('Fine-1')).toEqual([])
      fsHooks.failRm = null
      expect(await purge()).toEqual([expect.objectContaining({ folder: 'Stuck-1', files: 1, bytes: 100 })])
      expect(entryOf('Stuck-1')).toEqual([])
    })

    it('never touches users/, a link or a file in the trash folder', async () => {
      at(500)
      await mine().write('Live-1', '1-1-LT1.save', save(110))
      await mine().write('Live-1', '1-1-LT1.save', save(111))
      mkdirSync(trash(), { recursive: true })
      const old = '2026-01-01T00-00-00.000Z'
      symlinkSync(live(1, 'saves'), join(trash(), `${old}-Evil`))
      writeFileSync(join(trash(), `${old}-File`), 'not a folder')
      mkdirSync(join(trash(), 'users'))
      writeFileSync(join(trash(), 'users', 'keep.txt'), 'x')
      expect(await purge()).toEqual([])
      expect((await mine().list('Live-1')).length).toBe(1)
      expect(await mine().history('Live-1')).toHaveLength(1)
      expect(readdirSync(trash()).sort()).toEqual([`${old}-Evil`, `${old}-File`, 'users'])
      expect(existsSync(join(trash(), 'users', 'keep.txt'))).toBe(true)
    })
  })

  describe('names from a request', () => {
    it('are looked up among the folders and entries on disk, so a path in one reaches nothing', async () => {
      at(600)
      await mine().write('Name-1', '1-1-LT1.save', save(120))
      for (const folder of ['..', '..%2F..%2Fusers%2F1%2Fsaves%2FName-1', '%2E%2E', 'Name-1%00']) await del(folder).expect((r) => expect([400, 404]).toContain(r.status))
      await del('Name-1').expect(200)
      const entry = 'deleted-saves'
      for (const name of ['..', '..%2Fusers', `${encodeURIComponent('2026-12-02T10-00-00.000Z-Name-1')}`, '%2E%2E%2Fsaves', entry]) {
        await request(app.app).post(`/api/system/storage/deleted-saves/${name}/restore`).expect((r) => expect([400, 404]).toContain(r.status))
      }
      expect(entryOf('Name-1')).toHaveLength(1)
      expect(await mine().list('Name-1')).toEqual([])
    })
  })
})
