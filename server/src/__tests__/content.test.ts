import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { Catalog } from '../catalog.js'
import { loadConfig } from '../config.js'
import { ContentMode, sfwIndexUrl } from '../content.js'
import { Db } from '../db.js'

const ENV = ['RENPLAY_ADULT_GAMES', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL', 'DATA_DIR', 'GAMES_DIR']

function tempConfig(env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-content-'))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, { DATA_DIR: join(root, 'data'), GAMES_DIR: join(root, 'games'), RENPLAY_CATALOG_URLS: 'http://127.0.0.1:9/none', RENPLAY_ENGINES_URL: 'http://127.0.0.1:9/none', ...env })
  return { root, cfg: loadConfig() }
}

describe('content mode', () => {
  it('reads RENPLAY_ADULT_GAMES: allow and block lock the choice, unset leaves it open and blocks', () => {
    const open = tempConfig()
    const db = Db.open(open.cfg.dataDir)
    const mode = new ContentMode(open.cfg, db)
    expect(mode).toMatchObject({ locked: false, chosen: false, adultGames: 'block', blocked: true })
    mode.set('allow')
    expect(mode).toMatchObject({ locked: false, chosen: true, adultGames: 'allow', blocked: false })
    mode.set('block')
    expect(mode.adultGames).toBe('block')
    db.close()

    for (const [value, expected] of [['allow', 'allow'], ['block', 'block'], ['ALLOW', 'allow'], ['nonsense', 'block']] as const) {
      const { cfg } = tempConfig({ RENPLAY_ADULT_GAMES: value })
      const locked = new ContentMode(cfg, Db.open(cfg.dataDir))
      expect(locked).toMatchObject({ locked: true, chosen: true, adultGames: expected })
      expect(() => locked.set(expected === 'allow' ? 'block' : 'allow')).toThrow(/configuration/)
    }
    delete process.env['RENPLAY_ADULT_GAMES']
  })

  it('keeps allowing adult games in a database that existed before, and asks on a fresh one', () => {
    const { cfg } = tempConfig()
    let db = Db.open(cfg.dataDir)
    expect(new ContentMode(cfg, db).chosen).toBe(false)
    db.raw.exec("DELETE FROM settings; ALTER TABLE games DROP COLUMN adult; PRAGMA user_version = 5")
    db.close()
    db = Db.open(cfg.dataDir)
    const upgraded = new ContentMode(cfg, db)
    expect(upgraded).toMatchObject({ chosen: true, adultGames: 'allow' })
    upgraded.set('block')
    db.close()
    // The upgrade rule runs once: a later start keeps the admin's answer.
    db = Db.open(cfg.dataDir)
    expect(new ContentMode(cfg, db).adultGames).toBe('block')
    db.close()
  })

  it('derives the safe-for-work index from a catalog URL', () => {
    expect(sfwIndexUrl('https://catalog.renplay.org/index.v3.json')).toBe('https://catalog.renplay.org/index.v3.sfw.json')
    expect(sfwIndexUrl('http://host/x/catalog.json?token=1')).toBe('http://host/x/catalog.sfw.json?token=1')
    expect(sfwIndexUrl('http://host/x/index.v3.sfw.json')).toBeNull()
    expect(sfwIndexUrl('http://host/x/catalog')).toBeNull()
    expect(sfwIndexUrl('not a url')).toBeNull()
  })
})

describe('blocking adult games', () => {
  let server: Server
  let base = ''
  let requests: string[] = []
  let png: Buffer
  let hasSfw = true

  beforeAll(async () => {
    png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#357' } }).png().toBuffer()
    const vocabulary = { 'sci-fi': { label: 'Sci-fi', group: 'story' }, nudity: { label: 'Nudity', group: 'content' } }
    const safe = { id: 'safe', title: 'Safe', tags: ['Sci-fi'], tagIds: ['sci-fi'], cover: 'covers/safe.png', releases: [{ version: '1', status: 'verified', archives: [{ name: 'Safe-pc.zip' }] }] }
    const adult = {
      id: 'adult', title: 'Adult', nsfw: true, tags: ['Sci-fi', 'Nudity'], tagIds: ['sci-fi', 'nudity'], content: ['nudity'], saveDir: 'Adult-1', cover: 'covers/adult.png',
      releases: [{ version: '1', status: 'verified', archives: [{ name: 'Adult-pc.zip', size: 10 }] }],
    }
    const full = { schema: 3, vocabulary, games: [safe, { ...safe, id: 'tagged', title: 'Tagged', tagIds: ['sci-fi', 'nudity'], tags: ['Sci-fi', 'Nudity'], content: ['nudity'], cover: undefined }, adult] }
    const sfw = { schema: 3, vocabulary: { 'sci-fi': vocabulary['sci-fi'] }, games: [safe] }
    server = createServer((req, res) => {
      requests.push(req.url!)
      const json = (body: unknown) => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      if (req.url === '/c/index.v3.json' || req.url === '/c/catalog') return json(full)
      if (req.url === '/c/index.v3.sfw.json') return hasSfw ? json(sfw) : void res.writeHead(404).end()
      if (req.url === '/c/covers/safe.png' || req.url === '/c/covers/adult.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(png)
      res.writeHead(404).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/c/index.v3.json`
  })
  afterAll(() => server?.close())

  function setup(env: Record<string, string> = {}) {
    requests = []
    hasSfw = true
    const { cfg } = tempConfig({ RENPLAY_CATALOG_URLS: base, ...env })
    const db = Db.open(cfg.dataDir)
    const content = new ContentMode(cfg, db)
    return { cfg, db, content, catalog: new Catalog(cfg, db, content) }
  }

  it('reads the safe-for-work index and never fetches adult recipes or covers', async () => {
    const { catalog, cfg } = setup()
    await catalog.refresh()
    expect(requests).toContain('/c/index.v3.sfw.json')
    expect(requests).not.toContain('/c/index.v3.json')
    expect(requests).not.toContain('/c/covers/adult.png')
    expect(catalog.list().map((r) => r.id)).toEqual(['safe'])
    expect(readdirSync(cfg.coversDir)).toHaveLength(1)
    catalog.stop()
  })

  it('drops adult games and content tags after fetching the full index when there is no safe-for-work one', async () => {
    const { catalog, cfg } = setup()
    hasSfw = false
    const { errors } = await catalog.refresh()
    expect(errors.join()).toContain('index.v3.sfw.json')
    expect(catalog.list().map((r) => r.id)).toEqual(['safe', 'tagged'])
    expect(catalog.recipe('tagged')).toMatchObject({ tagIds: ['sci-fi'], tags: ['Sci-fi'], content: [] })
    expect(catalog.vocabulary).not.toHaveProperty('nudity')
    expect(requests).not.toContain('/c/covers/adult.png')
    expect(readdirSync(cfg.coversDir).every((f) => f.startsWith('safe.'))).toBe(true)
    // A URL with no sibling index is handled the same way.
    const other = setup({ RENPLAY_CATALOG_URLS: base.replace('index.v3.json', 'catalog') })
    await other.catalog.refresh()
    expect(other.catalog.list().map((r) => r.id)).toEqual(['safe', 'tagged'])
    expect(requests).toEqual(['/c/catalog', '/c/covers/safe.png'])
    catalog.stop()
    other.catalog.stop()
  })

  it('purges adult recipes and covers when switching to block, and brings them back on allow', async () => {
    const { catalog, cfg, content, db } = setup({})
    content.set('allow')
    await catalog.refresh()
    expect(catalog.list().map((r) => r.id)).toContain('adult')
    expect(readdirSync(cfg.coversDir).some((f) => f.startsWith('adult.'))).toBe(true)
    db.insertGame({ id: 'adult', title: 'Adult', status: 'installed', recipe_id: 'adult' })
    db.insertGame({ id: 'mine', title: 'Mine', status: 'installed' })

    content.set('block')
    await catalog.modeChanged()
    expect(catalog.recipe('adult')).toBeNull()
    expect(catalog.list().map((r) => r.id)).not.toContain('adult')
    expect(readdirSync(cfg.coversDir).some((f) => f.startsWith('adult.'))).toBe(false)
    expect(catalog.cover('adult')).toBeNull()
    expect(JSON.stringify(db.getSetting('catalog_cache', {}))).not.toContain('Adult')
    expect(JSON.stringify(db.getSetting('catalog_covers', {}))).not.toContain('adult')
    // The library keeps the game, flagged, and it is hidden; a game without a recipe is not.
    expect(db.getGame('adult')).toMatchObject({ adult: 1, recipe_id: 'adult' })
    expect(content.hides(db.getGame('adult'))).toBe(true)
    expect(content.hides(db.getGame('mine'))).toBe(false)

    content.set('allow')
    await catalog.modeChanged()
    expect(content.hides(db.getGame('adult'))).toBe(false)
    await catalog.refresh()
    expect(catalog.recipe('adult')).toMatchObject({ title: 'Adult', nsfw: true })
    catalog.stop()
  })

  it('recognizes adult archives while blocked, without keeping anything else', async () => {
    const { catalog, content, db } = setup()
    content.set('allow')
    await catalog.refresh()
    content.set('block')
    await catalog.modeChanged()
    const match = catalog.match({ name: 'folder/Adult-pc.zip', size: 10 })
    expect(match?.recipe).toMatchObject({ id: 'adult', nsfw: true, title: '' })
    expect(catalog.match({ name: 'Safe-pc.zip' })?.recipe.nsfw).toBeFalsy()
    expect(JSON.stringify(db.getSetting('catalog_adult_stubs', {}))).not.toMatch(/cover|tags|Nudity/)
    // A game installed earlier is linked to its stub by save folder.
    db.insertGame({ id: 'old', title: 'Old', status: 'installed', save_dir: 'Adult-1' })
    catalog.link()
    expect(db.getGame('old')).toMatchObject({ recipe_id: 'adult', adult: 1 })
    expect(catalog.isAdultId('adult')).toBe(true)
    catalog.stop()
  })
})

describe('hiding adult games in the API', () => {
  let root = ''
  let app: Awaited<ReturnType<typeof createApp>>

  beforeAll(async () => {
    const t = tempConfig()
    root = t.root
    // A library from a catalog that knew the adult game.
    const db = Db.open(t.cfg.dataDir)
    const recipe = (id: string, nsfw: boolean) => ({ id, title: id, nsfw, engine: 'renpy', saveDir: `${id}-1`, releases: [{ version: '1', status: 'verified', archives: [{ name: `${id}.zip`, size: 4 }] }] })
    db.setSetting('catalog_cache', { at: Date.now(), games: [recipe('adult', true), recipe('safe', false)], vocabulary: {}, adultGames: 'allow' })
    for (const id of ['adult', 'safe']) db.insertGame({ id, title: id, recipe_id: id, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: `${id}-1` })
    db.close()
    for (const id of ['adult', 'safe']) {
      mkdirSync(join(t.cfg.savesDir, `${id}-1`), { recursive: true })
      writeFileSync(join(t.cfg.savesDir, `${id}-1`, '1-1.save'), 'x')
    }
    mkdirSync(join(t.cfg.archivesDir), { recursive: true })
    writeFileSync(join(t.cfg.archivesDir, 'adult.zip'), '1234')
    writeFileSync(join(t.cfg.archivesDir, 'safe.zip'), '1234')
    app = await createApp(t.cfg, { startJobs: false })
  })
  afterAll(() => {
    app?.close()
    rmSync(root, { recursive: true, force: true })
  })

  const ids = async () => ((await request(app.app).get('/api/games')).body.games as Array<{ id: string }>).map((g) => g.id)

  it('asks first on a fresh install and treats it as blocked until answered', async () => {
    // This database predates nothing: no setting exists, so it is blocked and unanswered.
    expect((await request(app.app).get('/api/content')).body).toEqual({ adultGames: 'block', locked: false, chosen: false })
    expect(await ids()).toEqual(['safe'])
  })

  it('answers 404 on every route that names a hidden game, and keeps its data', async () => {
    const hidden = ['/api/games/adult', '/api/saves/adult', '/api/saves/adult/boot', '/api/saves/adult/history', '/api/saves/adult/export', '/api/games/adult/files', '/api/games/adult/recipe', '/g/adult/b1/', '/g/adult/b1/game/images/a.png', '/g/adult/b1/game.zip']
    for (const path of hidden) expect((await request(app.app).get(path)).status, path).toBe(404)
    expect((await request(app.app).post('/api/games/adult/played')).status).toBe(404)
    expect((await request(app.app).get('/api/games/safe')).status).toBe(200)
    expect((await request(app.app).get('/api/saves/safe')).status).toBe(200)
    expect((await request(app.app).get('/api/saves/safe')).body.saves ?? []).toBeDefined()
    // Hidden, not deleted.
    expect(app.db.getGame('adult')).toMatchObject({ recipe_id: 'adult', adult: 1 })
    expect(readdirSync(join(root, 'data', 'saves', 'adult-1'))).toEqual(['1-1.save'])
    const list = (await request(app.app).get('/api/catalog')).body.games as Array<{ id: string }>
    expect(list.map((g) => g.id)).toEqual(['safe'])
  })

  it('refuses an adult archive before any work', async () => {
    const adult = await request(app.app).post('/api/imports').send({ source: { kind: 'archive', path: 'adult.zip' } })
    expect(adult.status).toBe(403)
    expect(adult.body.error).toMatch(/adult game/)
    const byId = await request(app.app).post('/api/imports').send({ source: { kind: 'archive', path: 'safe.zip' }, recipeId: 'adult' })
    expect(byId.status).toBe(403)
    const listed = (await request(app.app).get('/api/archives')).body.archives as Array<{ name: string; blocked: string | null; recipe: unknown }>
    expect(listed.find((a) => a.name === 'adult.zip')).toMatchObject({ blocked: expect.stringMatching(/adult game/), recipe: null })
    expect(listed.find((a) => a.name === 'safe.zip')?.blocked).toBeNull()
    expect((await request(app.app).post('/api/imports').send({ source: { kind: 'archive', path: 'safe.zip' } })).status).toBe(200)
    expect(app.db.listJobs().filter((j) => j.type === 'import')).toHaveLength(1)
    // The accepted fixture is not a real archive. Let its job finish before afterAll closes SQLite.
    await expect.poll(() => app.jobs.isBusy()).toBe(false)
    expect(app.db.listJobs()[0]!.status).toBe('failed')
  })

  it('shows the games again when adult games are allowed, and asks for a valid answer', async () => {
    expect((await request(app.app).put('/api/content').send({ adultGames: 'maybe' })).status).toBe(400)
    expect((await request(app.app).put('/api/content').send({ adultGames: 'allow' })).body).toEqual({ adultGames: 'allow', locked: false, chosen: true })
    expect(await ids()).toEqual(['adult', 'safe'])
    expect((await request(app.app).get('/api/saves/adult')).status).toBe(200)
    expect((await request(app.app).get('/api/games/adult')).status).toBe(200)
  })
})

describe('a locked install', () => {
  it('does not let the API change the choice', async () => {
    const t = tempConfig({ RENPLAY_ADULT_GAMES: 'block' })
    const app = await createApp(t.cfg, { startJobs: false })
    try {
      expect((await request(app.app).get('/api/content')).body).toEqual({ adultGames: 'block', locked: true, chosen: true })
      expect((await request(app.app).put('/api/content').send({ adultGames: 'allow' })).status).toBe(409)
      expect((await request(app.app).get('/api/content')).body.adultGames).toBe('block')
    } finally {
      app.close()
      rmSync(t.root, { recursive: true, force: true })
      delete process.env['RENPLAY_ADULT_GAMES']
    }
  })
})
