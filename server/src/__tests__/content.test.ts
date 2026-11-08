import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { ArtStore } from '../art.js'
import { Catalog } from '../catalog/catalog.js'
import { loadConfig } from '../config.js'
import { ContentMode, lowestLevel, parseAdultLevel, sfwIndexUrl } from '../content.js'
import { Db } from '../db.js'

const ENV = ['RENPLAY_ADULT_GAMES', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL', 'DATA_DIR', 'GAMES_DIR']

function tempConfig(env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-content-'))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, { DATA_DIR: join(root, 'data'), GAMES_DIR: join(root, 'games'), RENPLAY_CATALOG_URLS: 'http://127.0.0.1:9/none', RENPLAY_ENGINES_URL: 'http://127.0.0.1:9/none', ...env })
  return { root, cfg: loadConfig() }
}

const TEMPLATE = `<!doctype html><html><head><title>Ren'Py Web Game</title><meta name="viewport" content="width=device-width">
</head><body><img id="presplash" src="web-presplash.jpg">
<script src="renpy-pre.js"></script>
<script async type="text/javascript" src="renpy.js"></script>
</body></html>`

describe('the three levels', () => {
  it('parses levels and their allow and block spellings, and orders them', () => {
    expect(parseAdultLevel('off')).toBe('off')
    expect(parseAdultLevel(' Blurred ')).toBe('blurred')
    expect(parseAdultLevel('SHOWN')).toBe('shown')
    expect(parseAdultLevel('allow')).toBeNull()
    expect(parseAdultLevel('allow', true)).toBe('shown')
    expect(parseAdultLevel('block', true)).toBe('off')
    expect(parseAdultLevel('nonsense')).toBeNull()
    expect(parseAdultLevel(undefined)).toBeNull()
    expect(lowestLevel('shown', 'blurred', 'shown')).toBe('blurred')
    expect(lowestLevel('shown', 'shown', 'shown')).toBe('shown')
    expect(lowestLevel('blurred', 'shown', 'off')).toBe('off')
  })

  it('reads RENPLAY_ADULT_GAMES: a level fixes the installation, unset leaves it open at shown', () => {
    const open = tempConfig()
    const db = Db.open(open.cfg.dataDir)
    const mode = new ContentMode(open.cfg, db)
    expect(mode).toMatchObject({ locked: false, chosen: false, level: 'shown' })
    mode.set('blurred')
    expect(mode).toMatchObject({ locked: false, chosen: true, level: 'blurred' })
    expect(db.getSetting('adult_level', '')).toBe('blurred')
    mode.set('off')
    expect(mode.level).toBe('off')
    db.close()

    for (const [value, expected] of [['off', 'off'], ['blurred', 'blurred'], ['shown', 'shown'], ['allow', 'shown'], ['block', 'off'], ['SHOWN', 'shown'], ['nonsense', 'off']] as const) {
      const { cfg } = tempConfig({ RENPLAY_ADULT_GAMES: value })
      const locked = new ContentMode(cfg, Db.open(cfg.dataDir))
      expect(locked).toMatchObject({ locked: true, chosen: true, level: expected })
      expect(() => locked.set('shown')).toThrow(/configuration/)
    }
    delete process.env['RENPLAY_ADULT_GAMES']
  })

  it('moves an installation level kept under the 3.x setting to the current one, and leaves a never-asked install unset', () => {
    const { cfg } = tempConfig()
    let db = Db.open(cfg.dataDir)
    expect(new ContentMode(cfg, db)).toMatchObject({ chosen: false, level: 'shown' })
    db.close()
    for (const [old, level] of [['allow', 'shown'], ['block', 'off']] as const) {
      db = Db.open(cfg.dataDir)
      db.raw.exec("DELETE FROM settings WHERE key = 'adult_level'")
      db.setSetting('adult_games', old)
      db.raw.exec('PRAGMA user_version = 18')
      db.close()
      db = Db.open(cfg.dataDir)
      expect(new ContentMode(cfg, db)).toMatchObject({ chosen: true, level })
      expect(db.getSetting('adult_games', null)).toBeNull()
      db.close()
    }
  })

  it('derives the safe-for-work index from a catalog URL', () => {
    expect(sfwIndexUrl('https://catalog.renplay.org/index.v3.json')).toBe('https://catalog.renplay.org/index.v3.sfw.json')
    expect(sfwIndexUrl('http://host/x/catalog.json?token=1')).toBe('http://host/x/catalog.sfw.json?token=1')
    expect(sfwIndexUrl('http://host/x/index.v3.sfw.json')).toBeNull()
    expect(sfwIndexUrl('http://host/x/catalog')).toBeNull()
    expect(sfwIndexUrl('not a url')).toBeNull()
  })
})

describe('adult games in the catalog', () => {
  let server: Server
  let base = ''
  let requests: string[] = []
  let png: Buffer
  let adultPng: Buffer
  let hasSfw = true

  beforeAll(async () => {
    png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#357' } }).png().toBuffer()
    adultPng = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#a35' } }).png().toBuffer()
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
      if (req.url === '/c/covers/safe.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(png)
      if (req.url === '/c/covers/adult.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(adultPng)
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
    const content: ContentMode = new ContentMode(cfg, db, () => catalog.adultSaveDirs())
    const catalog = new Catalog(cfg, db, content, new ArtStore(cfg, db, content))
    // The originals the art cache downloaded, one file per picture.
    const originals = () => readdirSync(join(cfg.dataDir, 'art', 'src'), { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name)
    return { cfg, db, content, catalog, originals }
  }

  it('at off reads the safe-for-work index and never fetches adult recipes or pictures', async () => {
    const { catalog, content, originals } = setup()
    content.set('off')
    await catalog.refresh()
    expect(requests).toContain('/c/index.v3.sfw.json')
    expect(requests).not.toContain('/c/index.v3.json')
    expect(requests).not.toContain('/c/covers/adult.png')
    expect(catalog.list().map((r) => r.id)).toEqual(['safe'])
    expect(originals()).toHaveLength(1)
    catalog.stop()
  })

  it('at off drops adult games and content tags after fetching the full index when there is no safe-for-work one', async () => {
    const { catalog, content, originals } = setup()
    content.set('off')
    hasSfw = false
    const { errors } = await catalog.refresh()
    expect(errors.join()).toContain('index.v3.sfw.json')
    expect(catalog.list().map((r) => r.id)).toEqual(['safe', 'tagged'])
    expect(catalog.recipe('tagged')).toMatchObject({ tagIds: ['sci-fi'], tags: ['Sci-fi'], content: [] })
    expect(catalog.vocabulary).not.toHaveProperty('nudity')
    expect(requests).not.toContain('/c/covers/adult.png')
    expect(originals()).toHaveLength(1)
    // A URL with no sibling index is handled the same way.
    const other = setup({ RENPLAY_CATALOG_URLS: base.replace('index.v3.json', 'catalog') })
    other.content.set('off')
    await other.catalog.refresh()
    expect(other.catalog.list().map((r) => r.id)).toEqual(['safe', 'tagged'])
    expect(requests).toEqual(['/c/catalog', '/c/covers/safe.png'])
    catalog.stop()
    other.catalog.stop()
  })

  it('at blurred reads the full index but never downloads adult art, keeping the pictures it has', async () => {
    const { catalog, content, originals } = setup()
    await catalog.refresh()
    expect(catalog.list().map((r) => r.id)).toContain('adult')
    expect(originals()).toHaveLength(2)
    const shown = catalog.recipeArt(catalog.recipe('adult')!) as Record<string, { url1x?: string }>
    expect(shown['grid']?.url1x).toMatch(/^\/api\/art\//)

    content.set('blurred')
    await catalog.modeChanged()
    await catalog.refresh()
    expect(catalog.list().map((r) => r.id)).toContain('adult')
    // The pictures stay in the cache, unserved, and are never downloaded again.
    expect(originals()).toHaveLength(2)
    expect(requests.filter((u) => u === '/c/covers/adult.png')).toHaveLength(1)
    const blurred = catalog.recipeArt(catalog.recipe('adult')!) as Record<string, { url1x?: string }>
    expect(blurred['grid']).toBeDefined()
    expect(blurred['grid']!.url1x).toBeUndefined()
    expect(catalog.art!.canRead(shown['grid']!.url1x!.split('/').pop()!)).toBe(false)

    content.set('shown')
    await catalog.modeChanged()
    await catalog.refresh()
    expect((catalog.recipeArt(catalog.recipe('adult')!) as Record<string, { url1x?: string }>)['grid']?.url1x).toBe(shown['grid']!.url1x)
    expect(requests.filter((u) => u === '/c/covers/adult.png')).toHaveLength(1)
    catalog.stop()
  })

  it('moving to off keeps stubs, forgets adult pictures, and shown brings everything back', async () => {
    const { catalog, content, db, originals } = setup()
    await catalog.refresh()
    expect(catalog.list().map((r) => r.id)).toContain('adult')
    expect(originals()).toHaveLength(2)
    db.insertGame({ id: 'adult', title: 'Adult', status: 'installed', recipe_id: 'adult' })
    db.insertGame({ id: 'mine', title: 'Mine', status: 'installed' })

    content.set('off')
    await catalog.modeChanged()
    expect(catalog.recipe('adult')).toBeNull()
    expect(catalog.list().map((r) => r.id)).not.toContain('adult')
    expect(JSON.stringify(db.getSetting('catalog_cache', {}))).not.toContain('Adult')
    // At Off the art cache forgets adult pictures: they come back with the level.
    await new Promise((r) => setTimeout(r, 20))
    await catalog.refresh()
    expect(originals()).toHaveLength(1)
    // The library keeps the game, flagged, and it is hidden; a game without a recipe is not.
    expect(db.getGame('adult')).toMatchObject({ adult: 1, recipe_id: 'adult' })
    expect(content.hides(db.getGame('adult'))).toBe(true)
    expect(content.hides(db.getGame('mine'))).toBe(false)

    content.set('shown')
    await catalog.modeChanged()
    expect(content.hides(db.getGame('adult'))).toBe(false)
    await catalog.refresh()
    expect(catalog.recipe('adult')).toMatchObject({ title: 'Adult', nsfw: true })
    catalog.stop()
  })

  it('recognizes adult archives while off, without keeping anything else', async () => {
    const { catalog, content, db } = setup()
    await catalog.refresh()
    content.set('off')
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

describe('the levels in the API', () => {
  let root = ''
  let app: Awaited<ReturnType<typeof createApp>>

  beforeAll(async () => {
    const t = tempConfig()
    root = t.root
    // An installed engine pack and the adult game's build, so the play page renders.
    const engine = join(t.cfg.enginesDir, '8.5.3')
    mkdirSync(engine, { recursive: true })
    writeFileSync(join(engine, 'index.html'), TEMPLATE)
    writeFileSync(join(engine, '.ready'), '{}')
    const build = join(t.cfg.gamesDir, 'adult', 'b1')
    mkdirSync(build, { recursive: true })
    writeFileSync(join(build, 'game.zip'), 'zip')
    // A library from a catalog that knew the adult game.
    const db = Db.open(t.cfg.dataDir)
    const recipe = (id: string, nsfw: boolean) => ({ id, title: id, nsfw, engine: 'renpy', saveDir: `${id}-1`, releases: [{ version: '1', status: 'verified', archives: [{ name: `${id}.zip`, size: 4 }] }] })
    db.setSetting('catalog_cache', { at: Date.now(), games: [recipe('adult', true), recipe('safe', false)], vocabulary: {}, adultGames: 'shown' })
    for (const id of ['adult', 'safe']) db.insertGame({ id, title: id, recipe_id: id, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: `${id}-1` })
    db.close()
    for (const id of ['adult', 'safe']) {
      mkdirSync(join(t.cfg.dataDir, 'users', '1', 'saves', `${id}-1`), { recursive: true })
      writeFileSync(join(t.cfg.dataDir, 'users', '1', 'saves', `${id}-1`, '1-1.save'), 'x')
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

  it('shows everything until the first-run question is answered', async () => {
    expect((await request(app.app).get('/api/content')).body).toEqual({
      installation: { level: 'shown', fixed: false, chosen: false, variable: 'RENPLAY_ADULT_GAMES' },
      starting: { level: 'off', variable: 'RENPLAY_ADULT_DEFAULT' },
      groups: { oidc: null, ldap: null },
    })
    expect(await ids()).toEqual(['adult', 'safe'])
  })

  it('at off answers 404 on every route that names an adult game, and keeps its data', async () => {
    expect((await request(app.app).put('/api/content').send({ level: 'off' })).body.installation).toMatchObject({ level: 'off', chosen: true })
    expect(await ids()).toEqual(['safe'])
    const hidden = ['/api/games/adult', '/api/saves/adult', '/api/saves/adult/boot', '/api/saves/adult/history', '/api/saves/adult/export', '/api/games/adult/files', '/api/games/adult/recipe', '/g/adult/b1/', '/g/adult/b1/game/images/a.png', '/g/adult/b1/game.zip']
    for (const path of hidden) expect((await request(app.app).get(path)).status, path).toBe(404)
    expect((await request(app.app).post('/api/games/adult/played')).status).toBe(404)
    expect((await request(app.app).get('/api/games/safe')).status).toBe(200)
    expect((await request(app.app).get('/api/saves/safe')).status).toBe(200)
    // Hidden, not deleted.
    expect(app.db.getGame('adult')).toMatchObject({ recipe_id: 'adult', adult: 1 })
    expect(readdirSync(join(root, 'data', 'users', '1', 'saves', 'adult-1'))).toEqual(['1-1.save'])
    const list = (await request(app.app).get('/api/catalog')).body.games as Array<{ id: string }>
    expect(list.map((g) => g.id)).toEqual(['safe'])
  })

  it('at off leaves adult downloads out of Add games and refuses to install them', async () => {
    const adult = await request(app.app).post('/api/imports').send({ source: { kind: 'archive', path: 'adult.zip' } })
    expect(adult.status).toBe(404)
    const byId = await request(app.app).post('/api/imports').send({ source: { kind: 'archive', path: 'safe.zip' }, recipeId: 'adult' })
    expect(byId.status).toBe(404)
    const listed = (await request(app.app).get('/api/archives')).body.archives as Array<{ name: string }>
    expect(listed.map((a) => a.name)).toEqual(['safe.zip'])
    expect((await request(app.app).post('/api/imports').send({ source: { kind: 'archive', path: 'safe.zip' } })).status).toBe(200)
    expect(app.db.listJobs().filter((j) => j.type === 'import')).toHaveLength(1)
    // The accepted fixture is not a real archive. Let its job finish before later tests.
    await expect.poll(() => app.jobs.isBusy()).toBe(false)
    expect(app.db.listJobs()[0]!.status).toBe('failed')
  })

  it('at blurred shows adult games without one byte of their art, and they still play', async () => {
    expect((await request(app.app).put('/api/content').send({ level: 'blurred' })).body.installation.level).toBe('blurred')
    expect(await ids()).toEqual(['adult', 'safe'])
    const game = (await request(app.app).get('/api/games/adult').expect(200)).body.game
    expect(game).toMatchObject({ id: 'adult', title: 'adult' })
    expect(JSON.stringify(game)).not.toContain('/api/art/')
    expect(JSON.stringify(game)).not.toContain('screenshot')
    // The play page and the saves work; picture routes refuse.
    expect((await request(app.app).get('/g/adult/b1/')).status).toBe(200)
    expect((await request(app.app).get('/g/adult/b1/game.zip')).status).toBe(200)
    expect((await request(app.app).get('/api/saves/adult')).status).toBe(200)
    expect((await request(app.app).get('/api/saves/adult/screenshot?file=1-1.save')).status).toBe(404)
    const saves = (await request(app.app).get('/api/saves/adult')).body
    expect(JSON.stringify(saves)).not.toContain('screenshot?')
    // Adult downloads can be installed at blurred.
    const listed = (await request(app.app).get('/api/archives')).body.archives as Array<{ name: string; recipe: unknown }>
    expect(listed.map((a) => a.name)).toContain('adult.zip')
  })

  it('at shown everything is back, and the answer must be a level', async () => {
    expect((await request(app.app).put('/api/content').send({ level: 'maybe' })).status).toBe(400)
    expect((await request(app.app).put('/api/content').send({ level: 'shown' })).body.installation).toMatchObject({ level: 'shown', chosen: true })
    expect(await ids()).toEqual(['adult', 'safe'])
    const game = (await request(app.app).get('/api/games/adult').expect(200)).body.game
    // This recipe has no art: no format at all, at any level.
    expect(game.art).toEqual({})
    expect((await request(app.app).get('/api/saves/adult')).status).toBe(200)
  })
})

describe('a fixed install', () => {
  it('does not let the API change the level', async () => {
    const t = tempConfig({ RENPLAY_ADULT_GAMES: 'blurred' })
    const app = await createApp(t.cfg, { startJobs: false })
    try {
      expect((await request(app.app).get('/api/content')).body.installation).toEqual({ level: 'blurred', fixed: true, chosen: true, variable: 'RENPLAY_ADULT_GAMES' })
      expect((await request(app.app).put('/api/content').send({ level: 'shown' })).status).toBe(409)
      expect((await request(app.app).get('/api/content')).body.installation.level).toBe('blurred')
    } finally {
      app.close()
      rmSync(t.root, { recursive: true, force: true })
      delete process.env['RENPLAY_ADULT_GAMES']
    }
  })
})
