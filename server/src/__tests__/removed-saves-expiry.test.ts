import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'

const DAY = 24 * 3600_000
const save = (n: number) => Buffer.alloc(n, n)

describe('History of saves an admin deleted', () => {
  let root = ''
  let app: App
  const start = Date.parse('2026-12-01T10:00:00Z')
  const at = (days: number) => vi.setSystemTime(start + days * DAY)
  const del = (folder: string) => request(app.app).delete(`/api/system/storage/saves/${folder}`).expect(200)
  const mine = () => app.services.saveStores.of(1)
  const sweep = () => app.services.savesExpiry.sweep()
  const boot = async () => {
    app = await createApp(loadConfig(), { startJobs: false })
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-saves-expiry-'))
    mkdirSync(join(root, 'data'), { recursive: true })
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    await boot()
  })
  afterAll(() => {
    vi.useRealTimers()
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  it('stays for 30 days, then goes for good and is logged', async () => {
    at(0)
    await mine().write('Gone-1', '1-1-LT1.save', save(100))
    await mine().write('Gone-1', '1-2-LT1.save', save(50))
    await del('Gone-1')
    at(29.9)
    expect(await sweep()).toEqual([])
    expect(await mine().history('Gone-1')).toHaveLength(2)
    at(30.1)
    const lines = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await sweep()).toEqual([{ folder: 'Gone-1', files: 2, bytes: 150 }])
    expect(lines.mock.calls.map((c) => String(c[0])).find((l) => l.includes('Gone-1'))).toMatch(/ info +\[saves\] +Deleted the History of the saves of Gone-1 for good: 2 files, 150 B freed$/)
    lines.mockRestore()
    expect(await mine().history('Gone-1')).toEqual([])
    expect(await readdir(join(root, 'data', 'users', '1', 'save-history'))).not.toContain('Gone-1')
    expect(await sweep()).toEqual([])
  })

  it('stays when the game is back in the library, and no later removal counts the old days', async () => {
    at(40)
    await mine().write('Back-1', '1-1-LT1.save', save(20))
    await del('Back-1')
    app.db.insertGame({ id: 'back', title: 'Back', status: 'installed', build: 'b1', save_dir: 'Back-1' })
    at(75)
    expect(await sweep()).toEqual([])
    expect(await mine().history('Back-1')).toHaveLength(1)
    app.db.deleteGame('back')
    at(76)
    expect(await sweep()).toEqual([])
    expect(await mine().history('Back-1')).toHaveLength(1)
  })

  it('removes all History of the folder, overwrites and earlier deletes too, and leaves other folders alone', async () => {
    at(100)
    await mine().write('Mixed-1', '2-1-LT1.save', save(5))
    await mine().remove('Mixed-1', '2-1-LT1.save', 'user-delete')
    await mine().write('Mixed-1', '1-1-LT1.save', save(7))
    await mine().write('Mixed-1', '1-1-LT1.save', save(8))
    await mine().write('Mixed-1', '1-1-LT1.save', save(9))
    await mine().write('Mixed-1', '3-1-LT1.save', save(4))
    await mine().remove('Mixed-1', '3-1-LT1.save', 'game-delete')
    at(101)
    await mine().write('Other-1', '1-1-LT1.save', save(9))
    await mine().remove('Other-1', '1-1-LT1.save', 'user-delete')
    await mine().write('Other-1', '1-2-LT1.save', save(3))
    await mine().write('Other-1', '1-2-LT1.save', save(2))
    await mine().write('Game-1', '1-1-LT1.save', save(6))
    await mine().remove('Game-1', '1-1-LT1.save', 'game-delete')
    at(105)
    expect((await mine().history('Mixed-1')).map((v) => v.reason).sort()).toEqual(['game-delete', 'overwrite', 'overwrite', 'user-delete'])
    await del('Mixed-1')
    at(134.9)
    expect(await sweep()).toEqual([])
    expect(await mine().history('Mixed-1')).toHaveLength(5)
    at(135.1)
    expect(await sweep()).toEqual([{ folder: 'Mixed-1', files: 5, bytes: 5 + 7 + 8 + 4 + 9 }])
    expect(await mine().history('Mixed-1')).toEqual([])
    expect(await readdir(join(root, 'data', 'users', '1', 'save-history'))).not.toContain('Mixed-1')
    expect((await mine().history('Other-1')).map((v) => v.reason).sort()).toEqual(['overwrite', 'user-delete'])
    expect((await mine().history('Game-1')).map((v) => v.reason)).toEqual(['game-delete'])
  })

  it('counts its 30 days across a restart', async () => {
    at(200)
    await mine().write('Restart-1', '1-1-LT1.save', save(11))
    await del('Restart-1')
    at(215)
    app.close()
    await boot()
    expect(await sweep()).toEqual([])
    at(231)
    expect(await sweep()).toEqual([{ folder: 'Restart-1', files: 1, bytes: 11 }])
    expect(await mine().history('Restart-1')).toEqual([])
  })

  it('sweeps once a day', async () => {
    vi.useFakeTimers()
    try {
      const sweeping = vi.spyOn(app.services.savesExpiry, 'sweep').mockResolvedValue([])
      app.services.savesExpiry.start()
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(sweeping).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(DAY)
      expect(sweeping).toHaveBeenCalledTimes(2)
      app.services.savesExpiry.stop()
      await vi.advanceTimersByTimeAsync(3 * DAY)
      expect(sweeping).toHaveBeenCalledTimes(2)
    } finally {
      vi.useFakeTimers({ toFake: ['Date'] })
    }
  })
})
