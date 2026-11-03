import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Catalog } from '../catalog.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'

describe('catalog', () => {
  let server: Server
  let base = ''
  let cover: Buffer
  let coverRequests = 0

  beforeAll(async () => {
    cover = await sharp({ create: { width: 64, height: 36, channels: 3, background: '#a35' } }).webp().toBuffer()
    const index = {
      schema: 2,
      games: [
        {
          id: 'ripples',
          title: 'Ripples',
          developer: 'Jestur',
          tags: ['sci-fi'],
          cover: 'covers/ripples.webp',
          releases: [
            { version: '0.9.24', status: 'verified', archives: [] },
            { version: '0.9.23', status: 'verified', archives: [] },
          ],
        },
        { id: 'by-save', title: 'By Save', saveDir: 'BySave-1', releases: [] },
        { id: 'by-pattern', title: 'By Pattern', match: ['Pattern-*-pc.zip'], cover: 'covers/missing.webp', releases: [] },
      ],
    }
    server = createServer((req, res) => {
      if (req.url === '/catalog/index.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(index))
      if (req.url === '/catalog/covers/ripples.webp') {
        coverRequests++
        if (req.headers['if-none-match'] === '"v1"') return void res.writeHead(304).end()
        return void res.writeHead(200, { 'content-type': 'image/webp', etag: '"v1"' }).end(cover)
      }
      res.writeHead(404).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address() as { port: number }
    base = `http://127.0.0.1:${addr.port}/catalog/index.json`
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
})
