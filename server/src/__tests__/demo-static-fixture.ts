import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import yazl from 'yazl'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'

const DEMO = new URL('../../../demo/', import.meta.url).pathname

/** A Ren'Py save as the game writes it: a zip with a log, a json and a picture. */
export function renpySave(name: string, ctime: number): Promise<Buffer> {
  return new Promise(async (resolve) => {
    const z = new yazl.ZipFile()
    z.addBuffer(Buffer.from(JSON.stringify({ _save_name: name, _ctime: ctime, _renpy_version: [8, 5, 3], _version: '7.0', _game_runtime: 12.5 })), 'json')
    z.addBuffer(Buffer.from('log'), 'log')
    z.addBuffer(await sharp({ create: { width: 384, height: 216, channels: 3, background: '#c42' } }).png().toBuffer(), 'screenshot.png')
    z.end()
    const chunks: Buffer[] = []
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

/**
 * The public demo's library in miniature: Renplay in demo mode with the demo's own recipe and art for The Question
 * installed, and two more catalog games (safe for work, since adult games are off), listening on a local port.
 * (The real seed, demo/seed.mjs, needs a built game and the network.)
 */
export async function demoServer() {
  const root = mkdtempSync(join(tmpdir(), 'renplay-static-demo-'))
  const cfg = {
    ...loadConfig(), demo: true, demoEmbedder: 'https://renplay.org', auth: 'on' as const, adultGames: 'off' as const,
    dataDir: join(root, 'data'), gamesDir: join(root, 'games'), internalDir: join(root, 'internal'), workDir: join(root, 'work'), purgeDir: join(root, 'purge'),
    uploadsDir: join(root, 'uploads'), enginesDir: join(root, 'engines'), archivesDir: join(root, 'archives'), recipesDir: join(root, 'recipes'),
    walkthroughsDir: join(root, 'walkthroughs'), overlaysDir: join(root, 'overlays'), catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', backupDir: null, telemetry: 'off' as const,
  }
  cpSync(join(DEMO, 'recipes'), cfg.recipesDir, { recursive: true })
  mkdirSync(join(cfg.dataDir, 'art', 'src'), { recursive: true })
  const recipes = []
  for (const [id, colour] of [['first-other', '#a33'], ['second-other', '#3a3']] as const) {
    const art = []
    for (const [kind, width, height] of [['grid', 600, 900], ['wide', 920, 430], ['hero', 1920, 620], ['icon', 512, 512]] as const) {
      const data = await sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer()
      const sha256 = createHash('sha256').update(data).digest('hex')
      writeFileSync(join(cfg.dataDir, 'art', 'src', sha256), data)
      art.push({ kind, url: `https://art.example/${id}-${kind}.png`, source: 'itch', sha256, width, height, thumbhash: '1QcSHQRnh493V4dIh4eXh1h4kJUI', tint: colour })
    }
    recipes.push({ id, title: id, nsfw: false, engine: 'renpy', art, releases: [{ version: '1', status: 'verified', archives: [{ name: `${id}.zip`, size: 4 }] }] })
  }
  const app: App = await createApp(cfg, { startJobs: false })
  app.db.setSetting('catalog_cache', { at: Date.now(), games: recipes, vocabulary: {}, adultGames: 'off' })
  await app.catalog.init()
  app.catalog.stop()
  await app.catalog.syncArt()
  app.db.insertGame({ id: 'the-question', title: 'The Question', recipe_id: 'the-question', adult: 0, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: 'the_question-7', source: JSON.stringify({ archive: 'the_question-7.0-pc.zip' }) })
  app.engines.template = async () => '<!doctype html><html><head><title>Game</title></head><body><script src="renpy-pre.js"></script></body></html>'
  const server = app.app.listen(0, '127.0.0.1')
  await new Promise((done) => server.once('listening', done))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return {
    app, base,
    close: async () => { await new Promise((done) => server.close(done)); app.close(); rmSync(root, { recursive: true, force: true }) },
  }
}
