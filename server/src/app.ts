import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type ErrorRequestHandler } from 'express'
import multer from 'multer'
import { Builds } from './builds.js'
import { Catalog } from './catalog.js'
import type { Config } from './config.js'
import { Db } from './db.js'
import { EngineStore } from './engines.js'
import { JobManager } from './jobs.js'
import { Overlays } from './mods.js'
import { applyMods } from './pipeline/applymods.js'
import { runImport } from './pipeline/import.js'
import { createFilesRouter } from './routes/files.js'
import { createGamesRouter } from './routes/games.js'
import { createLibraryRouter } from './routes/library.js'
import { createPlayRouter } from './routes/play.js'
import { createSavesExportAll, createSavesRouter } from './routes/saves.js'
import { createSystemRouter } from './routes/system.js'
import { SaveStore } from './saves/store.js'
import { sha256File } from './util/fsx.js'
import { HttpError, cleanRelPath, safeJoin } from './util/paths.js'
import { Purger } from './util/purge.js'

const here = dirname(fileURLToPath(import.meta.url))

export function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')).version
  } catch {
    return '0.0.0'
  }
}

/** Version string for the injected runtime script, so browsers refetch it after upgrades. */
function runtimeVersion(path: string | undefined): string {
  try {
    if (path) return createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 10)
  } catch {}
  return packageVersion()
}

export interface App {
  app: express.Express
  db: Db
  jobs: JobManager
  builds: Builds
  engines: EngineStore
  saves: SaveStore
  catalog: Catalog
  purger: Purger
  close(): void
}

export async function createApp(cfg: Config, opts: { runtimePath?: string; startJobs?: boolean } = {}): Promise<App> {
  for (const d of [cfg.dataDir, cfg.savesDir, cfg.coversDir, cfg.walkthroughsDir, cfg.overlaysDir]) await mkdir(d, { recursive: true })
  for (const d of [cfg.internalDir, cfg.workDir, cfg.archivesDir, cfg.uploadsDir, cfg.enginesDir, cfg.purgeDir]) await mkdir(d, { recursive: true })

  const version = packageVersion()
  const db = Db.open(cfg.dataDir)
  const purger = new Purger(cfg.purgeDir)
  const saves = new SaveStore(cfg.savesDir, cfg.saveHistoryDir, cfg.saveHistoryVersions)
  const jobs = new JobManager(db, cfg)
  const builds = new Builds(cfg, db, purger)
  const engines = new EngineStore(cfg, db, purger)
  const overlays = new Overlays(cfg)
  const catalog = new Catalog(cfg, db)
  await catalog.init()

  const deps = { cfg, db, builds, engines, overlays, catalog, saves, jobs, version }
  jobs.register('import', (ctx) => runImport(ctx, deps))
  jobs.register('apply-mods', (ctx) => applyMods(ctx, deps))
  jobs.register('hash-archive', async (ctx) => {
    const rel = cleanRelPath(ctx.params.path)
    const full = safeJoin(cfg.archivesDir, rel)
    const st = await stat(full)
    const sha256 = await sha256File(full, (n) => ctx.progress('Computing checksum', n / st.size))
    const prev = db.getArchive(rel)
    db.upsertArchive({ path: rel, size: st.size, mtime_ms: Math.floor(st.mtimeMs), sha256, info: prev?.info })
    for (const g of db.allGames()) {
      const src = JSON.parse(g.source || '{}')
      if (src.archive === rel && src.size === st.size && !src.sha256) db.updateGame(g.id, { source: JSON.stringify({ ...src, sha256 }) })
    }
    const match = catalog.match({ name: rel, size: st.size, sha256 })
    return { sha256, recipe: match?.recipe.id ?? null, exact: match?.exact ?? false }
  })

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(express.json({ limit: '2mb' }))

  app.use(createPlayRouter(db, builds, engines, runtimeVersion(opts.runtimePath)))
  // Static fallbacks for development; nginx serves these paths in production.
  if (opts.runtimePath) app.get('/renplay/runtime.js', (_req, res) => res.sendFile(opts.runtimePath!))
  app.use('/engine', express.static(cfg.enginesDir, { immutable: true, maxAge: '365d', setHeaders: gzipHeaders }))
  app.get(/^\/g\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9]+)(?:\.m([a-z0-9]+))?\/(.+)$/, (req, res, next) => {
    const [game, base, mod, asset] = [req.params[0], req.params[1], req.params[2], req.params[3]] as string[]
    const candidates = mod ? [join(cfg.gamesDir, game, `${base}.m${mod}`, asset), join(cfg.gamesDir, game, base, asset)] : [join(cfg.gamesDir, game, base, asset)]
    const tryNext = (i: number): void => {
      if (i >= candidates.length) return next()
      res.sendFile(candidates[i]!, { immutable: true, maxAge: '365d' }, (err) => (err ? tryNext(i + 1) : undefined))
    }
    if (asset.includes('..')) return next()
    tryNext(0)
  })
  app.use('/api', createSystemRouter(cfg, db, jobs, engines, builds, purger, version))
  app.get('/api/saves-export', createSavesExportAll(saves, db))
  app.use('/api/saves', createSavesRouter(saves, db))
  app.use('/api/games', createFilesRouter(db, builds, overlays, jobs))
  app.use('/api/games', createGamesRouter(deps))
  app.use('/api', createLibraryRouter(deps))
  app.use('/api/covers', express.static(cfg.coversDir, { maxAge: '365d', immutable: true, fallthrough: false }))
  app.use('/api/walkthroughs', express.static(cfg.walkthroughsDir, { maxAge: '1d', fallthrough: false }))
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')))

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    if (err instanceof HttpError) res.status(err.status).json({ error: err.message })
    else if (err instanceof multer.MulterError) res.status(400).json({ error: err.message })
    else if (err?.type === 'entity.too.large') res.status(413).json({ error: 'Request too large' })
    else if (err?.status && err.status < 500) res.status(err.status).json({ error: err.message })
    else {
      console.error(err)
      res.status(500).json({ error: 'Internal error' })
    }
  }
  app.use(onError)

  // Startup housekeeping: interrupted work is deleted in the background.
  try {
    for (const n of await readdir(cfg.workDir)) await purger.purge(join(cfg.workDir, n))
  } catch {}
  await purger.resume()
  const check = await builds.verify()
  if (check.missing.length) console.log(`builds missing for: ${check.missing.join(', ')}`)
  if (check.orphans.length) console.log(`folders in ${cfg.gamesDir} that belong to no game: ${check.orphans.join(', ')}`)
  if (opts.startJobs !== false) jobs.start()

  return { app, db, jobs, builds, engines, saves, catalog, purger, close: () => db.close() }
}

/** Development server: serve *.gz engine files with their encoding, like nginx does. */
function gzipHeaders(res: express.Response, path: string) {
  if (path.endsWith('.wasm.gz')) res.setHeader('Content-Type', 'application/gzip')
}
