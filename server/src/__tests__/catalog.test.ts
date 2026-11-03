import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Catalog, normalizeRecipe } from '../catalog.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'

describe('catalog', () => {
  let server: Server
  let base = ''
  let cover: Buffer
  let coverRequests = 0

  beforeAll(async () => {
    // Official art is often a PNG wider than a thumbnail needs.
    cover = await sharp({ create: { width: 1260, height: 1000, channels: 3, background: '#a35' } }).png().toBuffer()
    const sha = createHash('sha256').update(cover).digest('hex')
    const index = {
      schema: 2,
      games: [
        {
          id: 'ripples',
          title: 'Ripples',
          developer: 'Jestur',
          tags: ['sci-fi'],
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
    const cfg = loadConfig()
    const db = Db.open(cfg.dataDir)
    return { cfg, db, catalog: new Catalog(cfg, db) }
  }

  it('links installed games to their recipe and downloads covers', async () => {
    const { cfg, db, catalog } = setup()
    db.insertGame({ id: 'ripples', title: 'ripples', status: 'installed', version: '0.9.23' })
    db.insertGame({ id: 'some-save', title: 'Some', status: 'installed', save_dir: 'BySave-1' })
    db.insertGame({ id: 'some-archive', title: 'Other', status: 'installed', source: JSON.stringify({ archive: 'Pattern-2.0-pc.zip' }) })
    db.insertGame({ id: 'unknown', title: 'Unknown', status: 'installed' })
    // Covers of renplay 2.1 (picked from the game files) are removed.
    mkdirSync(cfg.coversDir, { recursive: true })
    writeFileSync(join(cfg.coversDir, 'ripples-old.webp'), 'old')

    const res = await catalog.refresh()
    expect(res.games).toBe(3)
    expect(db.getGame('ripples')!.recipe_id).toBe('ripples')
    expect(db.getGame('some-save')!.recipe_id).toBe('by-save')
    expect(db.getGame('some-archive')!.recipe_id).toBe('by-pattern')
    expect(db.getGame('unknown')!.recipe_id).toBe('')

    const url = catalog.cover('ripples')!
    expect(url).toMatch(/^\/api\/covers\/ripples\.[0-9a-f]{12}\.webp$/)
    expect(readdirSync(cfg.coversDir)).toEqual([url.split('/').pop()])
    // Stored as a WebP thumbnail, scaled down to 960 pixels wide.
    const thumb = await sharp(readFileSync(join(cfg.coversDir, url.split('/').pop()!))).metadata()
    expect([thumb.format, thumb.width, thumb.height]).toEqual(['webp', 960, 762])
    // An image that does not match the catalog's checksum is refused.
    expect(catalog.cover('by-save')).toBeNull()
    expect(res.errors.some((e) => e.includes('by-save') && e.includes('changed'))).toBe(true)
    // A cover that fails to download is reported, not fatal.
    expect(catalog.cover('by-pattern')).toBeNull()
    expect(res.errors.some((e) => e.includes('by-pattern'))).toBe(true)

    // Unchanged covers are not downloaded again.
    const before = coverRequests
    await catalog.refresh()
    expect(coverRequests).toBe(before + 1)
    expect(catalog.cover('ripples')).toBe(url)
    expect(existsSync(join(cfg.coversDir, url.split('/').pop()!))).toBe(true)
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

  it('drops the hand-edited columns of a 2.1 database', () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-db-'))
    let db = Db.open(root)
    db.raw.exec("ALTER TABLE games ADD COLUMN save_dir_locked INTEGER NOT NULL DEFAULT 0; ALTER TABLE games ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'; ALTER TABLE games ADD COLUMN cover TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 1")
    db.insertGame({ id: 'kept', title: 'Kept', status: 'installed' })
    db.close()
    db = Db.open(root)
    const cols = (db.raw.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols).not.toContain('tags')
    expect(cols).not.toContain('cover')
    expect(cols).not.toContain('save_dir_locked')
    expect(db.getGame('kept')?.title).toBe('Kept')
    expect((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
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
