import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'

const release = (version: string) => ({ version, status: 'verified', archives: [{ name: `story-${version}-pc.zip` }] })
const catalogWith = (...versions: string[]) => ({ at: Date.now(), games: [{ id: 'story', title: 'A Story', engine: 'renpy', releases: versions.map(release) }], vocabulary: {}, adultGames: 'shown' })

describe('Not now on the update card', () => {
  let root = ''
  let app: App

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-update-dismissal-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    const db = Db.open(cfg.dataDir)
    db.setSetting('catalog_cache', catalogWith('1.8.0', '1.7.4'))
    db.insertGame({ id: 'story', title: 'story', recipe_id: 'story', version: '1.7.4', status: 'installed' })
    db.close()
    app = await createApp(cfg, { startJobs: false })
  })
  afterAll(() => {
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  const game = async (device = '') => (await request(app.app).get('/api/games/story').set(device ? { 'x-renplay-adult': device } : {}).expect(200)).body.game

  it('silences the version it was pressed for, for this person, on every device', async () => {
    expect(await game()).toMatchObject({ update: { version: '1.8.0' }, updateDismissed: null })
    const answer = (await request(app.app).post('/api/games/story/update-not-now').expect(200)).body
    expect(answer.game).toMatchObject({ updateDismissed: '1.8.0' })
    // Another device of the same person asks: the notice stays away there too.
    expect(await game('blurred')).toMatchObject({ update: { version: '1.8.0' }, updateDismissed: '1.8.0' })
    // Another person's own notice is not touched.
    const rows = app.db.raw.prepare("SELECT user_id, update_dismissed FROM user_games WHERE game = 'story'").all() as Array<{ user_id: number; update_dismissed: string | null }>
    expect(rows).toHaveLength(1)
    expect(app.services.progress.of(rows[0]!.user_id + 1, app.db.getGame('story')!).update_dismissed).toBeNull()
    expect(app.services.progress.of(rows[0]!.user_id, app.db.getGame('story')!).update_dismissed).toBe('1.8.0')
  })

  it('comes back by itself for a newer version, and DELETE undoes it', async () => {
    app.db.setSetting('catalog_cache', catalogWith('1.9.0', '1.8.0', '1.7.4'))
    app.catalog.stop()
    await app.catalog.init()
    expect(await game()).toMatchObject({ update: { version: '1.9.0' }, updateDismissed: null })
    await request(app.app).post('/api/games/story/update-not-now').expect(200)
    expect((await game()).updateDismissed).toBe('1.9.0')
    await request(app.app).delete('/api/games/story/update-not-now').expect(200)
    expect((await game()).updateDismissed).toBeNull()
  })

  it('has nothing to silence when the game is up to date', async () => {
    app.db.setSetting('catalog_cache', catalogWith('1.7.4'))
    app.catalog.stop()
    await app.catalog.init()
    await request(app.app).post('/api/games/story/update-not-now').expect(409)
  })
})
