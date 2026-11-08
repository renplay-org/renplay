import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ArtStore } from '../art.js'
import { Catalog, installedRelease, normalizeRecipe } from '../catalog.js'
import { loadConfig, type Config } from '../config.js'
import { ContentMode } from '../content.js'
import { Db } from '../db.js'

/** A catalog with its content mode and art cache, as the server makes it (services.ts). */
function catalogOf(cfg: Config, db: Db): Catalog {
  const content = new ContentMode(cfg, db)
  return new Catalog(cfg, db, content, new ArtStore(cfg, db, content))
}

describe('catalog', () => {
  let server: Server
  let base = ''
  let cover: Buffer
  let coverRequests = 0
  let index: any = null

  beforeAll(async () => {
    // Official art is often a PNG wider than a thumbnail needs.
    cover = await sharp({ create: { width: 1260, height: 1000, channels: 3, background: '#a35' } }).png().toBuffer()
    const sha = createHash('sha256').update(cover).digest('hex')
    index = {
      schema: 2,
      vocabulary: { 'sci-fi': { label: 'Sci-fi', group: 'story' } },
      games: [
        {
          id: 'ripples',
          title: 'Ripples',
          developer: 'Jestur',
          tags: ['sci-fi'],
          tagIds: ['sci-fi'],
          content: ['violence'],
          state: 'ongoing',
          summary: 'A journey through time.',
          cover: { url: 'https://example.invalid/ignored', sha256: sha, width: 1260, height: 1000 },
          releases: [
            { version: '0.9.24', status: 'verified', archives: [] },
            { version: '0.9.23', status: 'verified', archives: [] },
          ],
        },
        { id: 'by-save', title: 'By Save', saveDir: 'BySave-1', cover: { url: 'covers/other.png', sha256: '0'.repeat(64) }, releases: [] },
        { id: 'by-pattern', title: 'By Pattern', match: ['Pattern-*-pc.zip'], cover: 'covers/missing.webp', releases: [] },
      ],
    }
    server = createServer((req, res) => {
      if (req.url === '/catalog/second.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ schema: 3, vocabulary: { 'sci-fi': { label: 'Overridden', group: 'art' }, adventure: { label: 'Adventure', group: 'play' } }, games: [] }))
      if (req.url === '/catalog/index.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(index))
      if (req.url === '/catalog/covers/ripples.png') {
        coverRequests++
        if (req.headers['if-none-match'] === '"v1"') return void res.writeHead(304).end()
        return void res.writeHead(200, { 'content-type': 'image/png', etag: '"v1"' }).end(cover)
      }
      if (req.url === '/catalog/covers/other.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(cover)
      res.writeHead(404).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address() as { port: number }
    base = `http://127.0.0.1:${addr.port}/catalog/index.json`
    index.games[0]!.cover = { url: `http://127.0.0.1:${addr.port}/catalog/covers/ripples.png`, sha256: sha, width: 1260, height: 1000 }
  })
  afterAll(() => server?.close())

  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'renplay-catalog-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_CATALOG_URLS'] = base
    process.env['RENPLAY_ADULT_GAMES'] = 'allow'
    const cfg = loadConfig()
    const db = Db.open(cfg.dataDir)
    return { cfg, db, catalog: catalogOf(cfg, db) }
  }

  it('links installed games to their recipe and makes their art from a schema 3 cover', async () => {
    const { cfg, db, catalog } = setup()
    db.insertGame({ id: 'ripples', title: 'ripples', status: 'installed', version: '0.9.23' })
    db.insertGame({ id: 'some-save', title: 'Some', status: 'installed', save_dir: 'BySave-1' })
    db.insertGame({ id: 'some-archive', title: 'Other', status: 'installed', source: JSON.stringify({ archive: 'Pattern-2.0-pc.zip' }) })
    db.insertGame({ id: 'unknown', title: 'Unknown', status: 'installed' })
    // Renplay 3.x covers are forgotten: 4.0 makes its pictures in the art cache.
    mkdirSync(cfg.coversDir, { recursive: true })
    writeFileSync(join(cfg.coversDir, 'ripples.0123456789ab.webp'), 'old')
    db.setSetting('catalog_covers', { ripples: { url: 'x', sha256: '', file: 'ripples.0123456789ab.webp', etag: '' } })
    await catalog.init()
    catalog.stop()
    expect(existsSync(cfg.coversDir)).toBe(false)
    expect(db.getSetting('catalog_covers', null)).toBeNull()

    const res = await catalog.refresh()
    expect(res.games).toBe(3)
    expect(db.getGame('ripples')!.recipe_id).toBe('ripples')
    expect(db.getGame('some-save')!.recipe_id).toBe('by-save')
    expect(db.getGame('some-archive')!.recipe_id).toBe('by-pattern')
    expect(db.getGame('unknown')!.recipe_id).toBe('')

    // The 1260x1000 cover is a grid source: whole on its glow, with its credit.
    expect(catalog.recipe('ripples')!.art).toEqual([expect.objectContaining({ kind: 'grid', source: 'developer', width: 1260, height: 1000 })])
    const art = catalog.gameArt(db.getGame('ripples')!) as Record<string, { url1x: string | null; width: number; made: string | null }>
    expect(art['grid']).toMatchObject({ width: 600, made: 'whole' })
    const file = join(cfg.dataDir, 'art', art['grid']!.url1x!.split('/').pop()!)
    expect((await sharp(readFileSync(file)).metadata()).format).toBe('webp')
    // A picture that does not match the catalog's checksum is refused, a failed download reported.
    expect(res.errors.some((e) => e.includes('by-save') && e.includes('changed'))).toBe(true)
    expect(res.errors.some((e) => e.includes('by-pattern'))).toBe(true)
    expect((catalog.gameArt(db.getGame('some-save')!) as Record<string, { url1x: string | null }>)['grid']?.url1x ?? null).toBeNull()

    // Pictures already made are not downloaded again.
    const before = coverRequests
    await catalog.refresh()
    expect(coverRequests).toBe(before)
    expect(existsSync(file)).toBe(true)
    db.close()
  })

  it('offers the newest working release as an update', async () => {
    const { db, catalog } = setup()
    await catalog.refresh()
    const recipe = catalog.recipe('ripples')!
    expect(catalog.update(recipe, '0.9.23')?.version).toBe('0.9.24')
    expect(catalog.update(recipe, '0.9.24')).toBeNull()
    // A version the catalog does not list (newer, matched by pattern) gets no offer.
    expect(catalog.update(recipe, '0.9.30')).toBeNull()
    db.close()
  })

  it('reads Your recipes: one takes the catalog recipe’s place, files are hashed, problems are named', async () => {
    const { cfg, db, catalog } = setup()
    const dir = cfg.recipesDir
    mkdirSync(join(dir, 'art', 'ripples'), { recursive: true })
    mkdirSync(join(dir, 'patches', 'ripples'), { recursive: true })
    const grid = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#357' } }).png().toBuffer()
    writeFileSync(join(dir, 'art', 'ripples', 'grid.png'), grid)
    writeFileSync(join(dir, 'patches', 'ripples', 'zz_fix.rpy'), 'init python:\n    pass\n')
    writeFileSync(join(dir, 'ripples.yaml'), [
      'id: ripples', 'title: Ripples, fixed here', 'nsfw: false', 'tags: [sci-fi, not-a-tag]', 'releases: []',
      'art:', '  - kind: grid', '    file: art/ripples/grid.png', '  - kind: wide', '    file: art/ripples/missing.png', '  - kind: hero', '    file: art/ripples/link.png',
      'build:', '  patches:', '    - path: game/zz_fix.rpy', '      file: zz_fix.rpy',
    ].join('\n'))
    writeFileSync(join(dir, 'mine.yaml'), 'id: mine\ntitle: Mine\nreleases: []\n')
    writeFileSync(join(dir, 'wrong.yaml'), 'id: other\ntitle: Other\nreleases: []\n')
    writeFileSync(join(dir, 'broken.yaml'), 'id: [\n')
    writeFileSync(join(dir, '_template.yaml'), 'id: template\n')
    // A link that leads out of the folder is refused.
    writeFileSync(join(cfg.dataDir, 'outside.png'), grid)
    symlinkSync(join(cfg.dataDir, 'outside.png'), join(dir, 'art', 'ripples', 'link.png'))
    // A catalog's recipe cannot name files in Your recipes.
    index.games.push({ id: 'sneaky', title: 'Sneaky', releases: [], art: [{ kind: 'grid', url: 'local:art/ripples/grid.png' }], build: { patches: [{ path: 'game/zz_fix.rpy', url: 'local:patches/ripples/zz_fix.rpy' }] } })
    await catalog.refresh()
    index.games.pop()
    expect(catalog.recipe('sneaky')).toMatchObject({ art: [], build: { patches: [] } })
    const ripples = catalog.recipe('ripples')!
    expect(ripples).toMatchObject({ title: 'Ripples, fixed here', _origin: 'local', tagIds: ['sci-fi'], tags: ['sci-fi'] })
    expect(ripples.art).toEqual([expect.objectContaining({ kind: 'grid', url: 'local:art/ripples/grid.png', sha256: createHash('sha256').update(grid).digest('hex'), width: 600, height: 900 })])
    // Without its nsfw line a recipe counts as an adult game.
    expect(catalog.recipe('mine')).toMatchObject({ engine: 'renpy', _origin: 'local', nsfw: true })
    expect(ripples.nsfw).toBe(false)
    expect(catalog.recipe('other')).toBeNull()
    const errors = catalog.status().errors.join('\n')
    for (const bit of ['wrong.yaml: the id must be wrong', 'broken.yaml: not valid YAML', 'ripples.yaml: unknown tags left out: not-a-tag', 'missing.png left out', 'link.png left out: it is outside the folder', 'mine.yaml: it has no nsfw line']) expect(errors).toContain(bit)
    expect(errors).not.toContain('_template')
    const patches = await catalog.patches(ripples, { signal: new AbortController().signal, log: () => {} } as never)
    expect(patches.get('zz_fix.rpy')?.toString()).toContain('init python')
    expect(catalog.sources()).toEqual([
      expect.objectContaining({ kind: 'catalog', location: base, recipes: 3 }),
      expect.objectContaining({ kind: 'folder', location: dir, recipes: 2, pictures: 1 }),
    ])
    expect(catalog.sources()[1]!.problems.length).toBe(6)
    catalog.stop()
    db.close()
  })

  it('merges vocabulary first-wins and restores metadata on an offline start', async () => {
    const { cfg, db, catalog } = setup()
    cfg.catalogUrls.push(base.replace('index.json', 'second.json'))
    await catalog.refresh()
    expect(catalog.vocabulary).toEqual({ 'sci-fi': { label: 'Sci-fi', group: 'story' }, adventure: { label: 'Adventure', group: 'play' } })
    expect(catalog.recipe('ripples')).toMatchObject({ tagIds: ['sci-fi'], content: ['violence'], state: 'ongoing', summary: 'A journey through time.' })
    const restarted = catalogOf({ ...cfg, catalogUrls: ['http://127.0.0.1:9/offline'] }, db)
    await restarted.init()
    expect(restarted.vocabulary).toEqual(catalog.vocabulary)
    expect(restarted.recipe('ripples')).toEqual(catalog.recipe('ripples'))
    restarted.stop()
    db.close()
  })

  it('reads older caches without vocabulary and preserves label-only tags', async () => {
    const { cfg, db } = setup()
    db.setSetting('catalog_cache', { at: Date.now(), games: [{ id: 'old', title: 'Old', tags: ['romance'], releases: [] }] })
    const catalog = catalogOf(cfg, db)
    await catalog.init()
    expect(catalog.vocabulary).toEqual({})
    expect(catalog.recipe('old')?.tags).toEqual(['romance'])
    expect(catalog.recipe('old')?.tagIds).toBeUndefined()
    catalog.stop()
    db.close()
  })

  it('matches installed archive names before internal versions for status and updates', () => {
    const { db, catalog } = setup()
    const recipe = normalizeRecipe({ id: 'example', title: 'Example', engine: 'renpy', releases: [
      { version: '0.9.24', status: 'playable', archives: [] },
      { version: '0.9.23', status: 'verified', archives: [{ name: 'Example-Ch4Up7Public-pc.zip' }] },
      { version: '0.9.22', status: 'broken', archives: [{ name: 'Example-.510b-pc.zip' }] },
    ] })
    expect(installedRelease(recipe, 'Ch4Up7Public', 'folder/Example-Ch4Up7Public-pc.zip')).toMatchObject({ version: '0.9.23', status: 'verified' })
    expect(installedRelease(recipe, '0.9.24', 'Example-.510b-pc.zip')?.version).toBe('0.9.22')
    expect(catalog.update(recipe, 'Ch4Up7Public', 'Example-Ch4Up7Public-pc.zip')?.version).toBe('0.9.24')
    expect(installedRelease(recipe, '0.9.23', 'unknown.zip')?.version).toBe('0.9.23')
    expect(installedRelease(recipe, 'v0.20_Pre-Alpha', 'unknown.zip')).toBeNull()
    db.close()
  })

  it('reads recipes of catalog schema 2 and 3 alike', () => {
    const v2 = normalizeRecipe({ id: 'a', title: 'A', engine: '8.5.3', releases: [{ version: '1', status: 'verified', archives: [], renpy: '7.3.2', engine: '8.4.0' }] })
    const v3 = normalizeRecipe({ id: 'a', title: 'A', engine: 'renpy', runtime: '8.5.3', releases: [{ version: '1', status: 'verified', archives: [], madeWith: '7.3.2', runtime: '8.4.0' }] })
    expect(v2).toEqual(v3)
    expect(v3).toMatchObject({ engine: 'renpy', runtime: '8.5.3', releases: [{ madeWith: '7.3.2', runtime: '8.4.0' }] })
    expect(v3.releases[0]).not.toHaveProperty('renpy')
    expect(normalizeRecipe({ id: 'b', title: 'B', releases: [] })).toMatchObject({ engine: 'renpy', runtime: undefined })
    expect(normalizeRecipe({ id: 'c', title: 'C', engine: 'godot', releases: [{ version: '0.17.0', status: 'untested', archives: [], madeWith: '4.6.2' }] })).toMatchObject({ engine: 'godot', releases: [{ madeWith: '4.6.2' }] })
  })
})
