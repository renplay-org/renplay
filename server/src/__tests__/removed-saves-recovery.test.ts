import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'

// A kill is simulated by copying the data folder right after one rename: what a restart finds.
const fsHooks = vi.hoisted(() => ({ afterRename: null as null | ((from: string, to: string) => void) }))
vi.mock('node:fs/promises', async (orig) => {
  const m = await orig<typeof import('node:fs/promises')>()
  return {
    ...m,
    rename: async (from: Parameters<typeof m.rename>[0], to: Parameters<typeof m.rename>[1]) => {
      await m.rename(from, to)
      fsHooks.afterRename?.(String(from), String(to))
    },
  }
})

const DAY = 24 * 3600_000
const start = Date.parse('2026-12-01T10:00:00Z')
const at = (days: number) => vi.setSystemTime(start + days * DAY)
const save = (n: number) => Buffer.alloc(n, n)
/** The rename of one person's folder out of the live tree, or back into it. */
const out = (user: number, sub: string) => (from: string, to: string) => to.includes('/deleted-saves/') && from.endsWith(`/users/${user}/${sub}/F`)
const back = (user: number, sub: string) => (from: string, to: string) => from.includes('/deleted-saves/') && to.endsWith(`/users/${user}/${sub}/F`)

describe('a deletion or a restore of the saves of a removed game that a crash interrupted', () => {
  let root = ''
  let n = 0
  const apps: App[] = []
  const warnings: string[] = []
  const dirs = new Map<App, string>()
  const trash = (a: App) => join(dirs.get(a)!, 'deleted-saves')
  const entries = (a: App) => (existsSync(trash(a)) ? readdirSync(trash(a)).filter((e) => e.endsWith('Z-F')) : [])
  const del = (a: App, folder = 'F') => request(a.app).delete(`/api/system/storage/saves/${folder}`)
  const restore = (a: App, entry: string) => request(a.app).post(`/api/system/storage/deleted-saves/${encodeURIComponent(entry)}/restore`)
  const shown = async (a: App) => (await request(a.app).get('/api/system/storage').expect(200)).body.deletedSaves as Array<{ entry: string; folder: string; attention: string | null }>
  /** Starts the server on a data folder, as a restart does. */
  const boot = async (data: string) => {
    process.env['DATA_DIR'] = data
    const a = await createApp(loadConfig(), { startJobs: false })
    apps.push(a)
    dirs.set(a, data)
    return a
  }
  /** A new server with two people who each have saves of F, the first also History, then `crash` is armed at the rename that matches. */
  const fresh = async () => {
    const data = join(root, `data-${++n}`)
    mkdirSync(data, { recursive: true })
    const a = await boot(data)
    await request(a.app).post('/api/users').send({ username: 'second', password: 'second-password-1' }).expect(201)
    await a.services.saveStores.of(1).write('F', '1.save', save(1))
    await a.services.saveStores.of(1).write('F', '1.save', save(2))
    await a.services.saveStores.of(2).write('F', '1.save', save(3))
    return a
  }
  /** Copies `a`'s data folder (and a consistent database) when `match` renames, and the copy's path is what the returned function gives. */
  const crashAt = (a: App, match: (from: string, to: string) => boolean) => {
    const copy = join(root, `crashed-${++n}`)
    fsHooks.afterRename = (from, to) => {
      if (!match(from, to)) return
      fsHooks.afterRename = null
      mkdirSync(copy)
      for (const d of ['users', 'deleted-saves']) if (existsSync(join(dirs.get(a)!, d))) cpSync(join(dirs.get(a)!, d), join(copy, d), { recursive: true })
      a.db.raw.exec(`VACUUM INTO '${join(copy, 'library.db')}'`)
    }
    return copy
  }
  /** Everything back where it was, and nothing in the trash. */
  const expectLive = async (a: App) => {
    const one = a.services.saveStores.of(1)
    expect((await one.list('F')).map((f) => f.size)).toEqual([2])
    expect((await one.history('F')).map((h) => h.size)).toEqual([1])
    expect((await a.services.saveStores.of(2).list('F')).map((f) => f.size)).toEqual([3])
    expect(entries(a)).toEqual([])
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'renplay-removed-recovery-'))
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_BACKUP_DIR'] = join(root, 'backups')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    vi.spyOn(console, 'log').mockImplementation((line) => void warnings.push(String(line)))
  })
  afterEach(() => {
    fsHooks.afterRename = null
    warnings.length = 0
  })
  afterAll(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    for (const a of apps) a.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_BACKUP_DIR', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  it('rolls an interrupted deletion back between a person’s saves and History, and the admin can delete again', async () => {
    at(0)
    const a = await fresh()
    const copy = crashAt(a, out(1, 'saves'))
    await del(a).expect(200)
    const b = await boot(copy)
    await expectLive(b)
    expect(await shown(b)).toEqual([])
    at(31)
    expect(await b.services.saveTrash.purge()).toEqual([])
    await expectLive(b)
    const again = await del(b).expect(200)
    await restore(b, again.body.entry).expect(200)
    await expectLive(b)
  })

  it('finishes an interrupted restore between a person’s saves and History, and nothing is left to restore', async () => {
    at(100)
    const a = await fresh()
    const deleted = await del(a).expect(200)
    const copy = crashAt(a, back(1, 'saves'))
    await restore(a, deleted.body.entry).expect(200)
    const b = await boot(copy)
    await expectLive(b)
    await restore(b, deleted.body.entry).expect(404)
    at(131)
    expect(await b.services.saveTrash.purge()).toEqual([])
    await expectLive(b)
  })

  it.each([
    ['deletion', async (a: App) => { await del(a).expect(200) }, out(2, 'saves')],
    ['restore', async (a: App) => { await restore(a, (await del(a).expect(200)).body.entry).expect(200) }, back(1, 'saves')],
  ] as const)('is safe to interrupt again while it recovers an interrupted %s', async (_, run, interrupted) => {
    at(200)
    const a = await fresh()
    const first = crashAt(a, interrupted)
    await run(a)
    const second = join(root, `crashed-${++n}`)
    // The recovery at the start of the second server moves folders one at a time, and is itself cut off after the first.
    fsHooks.afterRename = (from, to) => {
      if (!(from.includes('/deleted-saves/') && to.includes('/users/'))) return
      fsHooks.afterRename = null
      cpSync(first, second, { recursive: true })
    }
    const b = await boot(first)
    await expectLive(b)
    expect(existsSync(second)).toBe(true)
    const c = await boot(second)
    await expectLive(c)
    expect(await shown(c)).toEqual([])
  })

  it('keeps an entry whose recovery meets a conflict, protected from the purge and listed as needing attention, while an ordinary one expires', async () => {
    at(300)
    const a = await fresh()
    await a.services.saveStores.of(1).write('G', '1.save', save(9))
    await del(a, 'G').expect(200)
    const copy = crashAt(a, out(1, 'saves'))
    await del(a).expect(200)
    // After the crash a game wrote into the folder the saves have to go back to.
    mkdirSync(join(copy, 'users/1/saves/F'), { recursive: true })
    writeFileSync(join(copy, 'users/1/saves/F/new.save'), 'newer')
    const b = await boot(copy)
    const [held] = (await shown(b)).filter((d) => d.folder === 'F')
    expect(held?.attention).toMatch(/could not finish.*Move or remove/)
    expect(warnings.some((w) => / warn /.test(w) && w.includes('saves of F') && /interrupted.*Move or remove/.test(w))).toBe(true)
    expect(readFileSync(join(copy, 'users/1/saves/F/new.save'), 'utf8')).toBe('newer')
    await restore(b, held!.entry).expect(409)
    at(331)
    expect((await b.services.saveTrash.purge()).map((p) => p.folder)).toEqual(['G'])
    at(1000)
    expect(await b.services.saveTrash.purge()).toEqual([])
    expect(readFileSync(join(copy, 'deleted-saves', held!.entry, 'users/1/saves/F/1.save'))).toEqual(save(2))
    // Once the conflict is cleared, the next start finishes what was interrupted.
    b.close()
    apps.splice(apps.indexOf(b), 1)
    rmSync(join(copy, 'users/1/saves/F/new.save'))
    const c = await boot(copy)
    expect(await shown(c)).toEqual([])
    expect((await c.services.saveStores.of(1).list('F')).map((f) => f.size)).toEqual([2])
    expect((await c.services.saveStores.of(1).history('F')).map((h) => h.size)).toEqual([1])
  })
})
