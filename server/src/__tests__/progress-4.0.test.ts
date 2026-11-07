import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'

describe('status, rating, Not now and play history', () => {
  let root = ''
  let app: App

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-progress-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    const db = Db.open(cfg.dataDir)
    db.setSetting('catalog_cache', { at: Date.now(), games: [{ id: 'story', title: 'A Story', engine: 'renpy', phone: 'great', releases: [] }, { id: 'adult', title: 'Adult', nsfw: true, engine: 'renpy', releases: [] }], vocabulary: {}, adultGames: 'shown' })
    db.insertGame({ id: 'story', title: 'story', recipe_id: 'story', status: 'installed' })
    db.insertGame({ id: 'adult', title: 'Adult', recipe_id: 'adult', adult: 1, status: 'installed' })
    db.close()
    app = await createApp(cfg, { startJobs: false })
  })
  afterAll(() => {
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  const game = async (id = 'story') => (await request(app.app).get(`/api/games/${id}`).expect(200)).body.game

  it('keeps a status, with Finished in step with finished_at for Renplay 3.x', async () => {
    expect(await game()).toMatchObject({ playStatus: null, rating: null, notNowAt: null, phone: 'great' })
    await request(app.app).put('/api/games/story/status').send({ status: 'stalled' }).expect(200)
    expect(await game()).toMatchObject({ playStatus: 'stalled', finishedAt: null })
    await request(app.app).put('/api/games/story/status').send({ status: 'finished' }).expect(200)
    const finished = await game()
    expect(finished.playStatus).toBe('finished')
    expect(finished.finishedAt).toMatch(/^\d{4}-/)
    // The 3.x switch is the same thing.
    await request(app.app).put('/api/games/story/finished').send({ on: false }).expect(200)
    expect(await game()).toMatchObject({ playStatus: null, finishedAt: null })
    await request(app.app).put('/api/games/story/finished').send({ on: true }).expect(200)
    expect((await game()).playStatus).toBe('finished')
    await request(app.app).put('/api/games/story/status').send({ status: 'bored' }).expect(400)
    await request(app.app).put('/api/games/story/status').send({ status: '' }).expect(200)
  })

  it('keeps a rating from 1 to 5, and 0 clears it', async () => {
    await request(app.app).put('/api/games/story/rating').send({ rating: 4 }).expect(200)
    expect((await game()).rating).toBe(4)
    for (const rating of [6, -1, 2.5, '3']) await request(app.app).put('/api/games/story/rating').send({ rating }).expect(400)
    await request(app.app).put('/api/games/story/rating').send({ rating: 0 }).expect(200)
    expect((await game()).rating).toBeNull()
  })

  it('takes a game out of Up next with Not now, and DELETE undoes it', async () => {
    await request(app.app).post('/api/games/story/not-now').expect(200)
    expect((await game()).notNowAt).toMatch(/^\d{4}-/)
    await request(app.app).delete('/api/games/story/not-now').expect(200)
    expect((await game()).notNowAt).toBeNull()
  })

  it('turns play time into sessions and shows them by day, per game and in totals', async () => {
    for (let i = 0; i < 3; i++) await request(app.app).post('/api/games/story/play-time').send({ seconds: 30 }).expect(200)
    await request(app.app).post('/api/games/adult/play-time').send({ seconds: 20 }).expect(200)
    // A report more than ten minutes after the last one starts a new session.
    app.db.raw.prepare("UPDATE play_sessions SET started_at = started_at - 3600000, ended_at = ended_at - 3600000 WHERE game = 'story'").run()
    await request(app.app).post('/api/games/story/play-time').send({ seconds: 10 }).expect(200)
    const history = (await request(app.app).get('/api/history').expect(200)).body
    expect(history.totals).toMatchObject({ seconds: 120, sessions: 3, games: 2 })
    expect(history.games.map((g: { id: string; seconds: number }) => [g.id, g.seconds])).toEqual([['story', 100], ['adult', 20]])
    expect(history.games[0]).toMatchObject({ title: 'A Story', sessions: 2 })
    const sessions = history.days.flatMap((d: { sessions: Array<{ game: string; seconds: number }> }) => d.sessions)
    expect(sessions.map((s: { game: string; seconds: number }) => s.seconds).sort((a: number, b: number) => a - b)).toEqual([10, 20, 90])
    // One game's history, for its game page.
    expect((await request(app.app).get('/api/history?game=story').expect(200)).body.totals).toMatchObject({ seconds: 100, sessions: 2, games: 1 })
    // Off: the adult game's sessions are not in the history, and come back with the level.
    await request(app.app).put('/api/content').send({ level: 'off' }).expect(200)
    const off = (await request(app.app).get('/api/history').expect(200)).body
    expect(off.totals).toMatchObject({ seconds: 100, games: 1 })
    expect(JSON.stringify(off)).not.toContain('adult')
    await request(app.app).put('/api/content').send({ level: 'blurred' }).expect(200)
    const blurred = (await request(app.app).get('/api/history').expect(200)).body
    expect(blurred.totals.games).toBe(2)
    expect(JSON.stringify(blurred)).not.toContain('/api/art/')
    await request(app.app).put('/api/content').send({ level: 'shown' }).expect(200)
  })

  it('moves the play history along when one person is merged into another', async () => {
    const other = (await request(app.app).post('/api/users').send({ username: 'second', name: 'Second', password: 'second-password-1' }).expect(201)).body.user
    app.db.raw.prepare("INSERT INTO play_sessions (user_id, game, started_at, ended_at, seconds) VALUES (?, 'story', 1000, 2000, 60)").run(other.id)
    app.db.raw.prepare("INSERT INTO user_games (user_id, game, rating, play_status) VALUES (?, 'story', 5, 'dropped')").run(other.id)
    await request(app.app).post(`/api/users/${other.id}/merge`).send({ target: 1 }).expect(200)
    expect((app.db.raw.prepare('SELECT COUNT(*) n FROM play_sessions WHERE user_id = ?').get(other.id) as { n: number }).n).toBe(0)
    expect((await request(app.app).get('/api/history').expect(200)).body.totals.seconds).toBe(180)
    expect(await game()).toMatchObject({ rating: 5, playStatus: 'dropped' })
  })
})

describe('names, notes and pins of saves', () => {
  let root = ''
  let app: App

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-savemeta-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    const db = Db.open(cfg.dataDir)
    db.insertGame({ id: 'story', title: 'Story', status: 'installed', save_dir: 'Story-1' })
    db.close()
    app = await createApp(cfg, { startJobs: false })
    await app.saves.write('Story-1', '1-1-LT1.save', Buffer.from('a save'))
  })
  afterAll(() => {
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  it('names, notes and pins a save for this person, and the file stays as it was', async () => {
    const before = (await app.saves.read('Story-1', '1-1-LT1.save')).toString()
    await request(app.app).put('/api/saves/story/meta?file=1-1-LT1.save').send({ title: 'Before the storm', note: 'Choose the lake next time.', pinned: true }).expect(200)
    const slot = (await request(app.app).get('/api/saves/story').expect(200)).body.slots.find((s: { file: string }) => s.file === '1-1-LT1.save')
    expect(slot).toMatchObject({ title: 'Before the storm', note: 'Choose the lake next time.' })
    expect(slot.pinnedAt).toMatch(/^\d{4}-/)
    expect((await app.saves.read('Story-1', '1-1-LT1.save')).toString()).toBe(before)
    // A pinned save keeps its history.
    expect(app.saves.pinned('Story-1', '1-1-LT1.save')).toBe(true)
    await request(app.app).put('/api/saves/story/meta?file=1-1-LT1.save').send({ pinned: false }).expect(200)
    expect(app.saves.pinned('Story-1', '1-1-LT1.save')).toBe(false)
    await request(app.app).put('/api/saves/story/meta?file=1-1-LT1.save').send({ title: 'x'.repeat(81) }).expect(400)
    await request(app.app).put('/api/saves/story/meta?file=../x.save').send({ title: 'x' }).expect(400)
    // Clearing everything removes the row.
    await request(app.app).put('/api/saves/story/meta?file=1-1-LT1.save').send({ title: '', note: '' }).expect(200)
    expect((app.db.raw.prepare('SELECT COUNT(*) n FROM save_meta').get() as { n: number }).n).toBe(0)
  })

  it('tells a device about a conflict and lists it with the saves', async () => {
    const put = (body: string, mtime: number, base?: number) => {
      const r = request(app.app).put('/api/saves/story/file?path=Story-1/3-1-LT1.save').set('content-type', 'application/octet-stream').set('x-mtime', String(mtime))
      return (base === undefined ? r : r.set('x-base', String(base))).send(Buffer.from(body)).expect(200)
    }
    const now = Date.now()
    const a = (await put('a', now - 30_000, 0)).body
    expect(a.conflict).toBeUndefined()
    await put('b', now - 20_000, a.mtime)
    expect((await put('older', now - 25_000, a.mtime)).body).toMatchObject({ conflict: 'kept' })
    expect((await app.saves.read('Story-1', '3-1-LT1.save')).toString()).toBe('b')
    // Without the header (a runtime from 3.x) the write is delivered as before.
    expect((await put('c', now - 10_000)).body.conflict).toBeUndefined()
    const listed = (await request(app.app).get('/api/saves/story').expect(200)).body.conflicts
    expect(listed).toEqual([expect.objectContaining({ file: '3-1-LT1.save' })])
  })
})
