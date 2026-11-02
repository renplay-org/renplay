import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type ErrorRequestHandler } from 'express'
import multer from 'multer'
import { Catalog } from './catalog.js'
import type { Config } from './config.js'
import { Db } from './db.js'
import { JobManager } from './jobs.js'
import { Library } from './library.js'
import { Overlays } from './mods.js'
import { cleanWorkDir, runImport } from './pipeline/import.js'
import { analyzeBuild, applyMods, optimizeBuild } from './pipeline/maintain.js'
import { SdkManager } from './pipeline/sdk.js'
import { createFilesRouter } from './routes/files.js'
import { createGamesRouter } from './routes/games.js'
import { createLibraryRouter } from './routes/library.js'
import { createPlayRouter } from './routes/play.js'
import { createSavesExportAll, createSavesRouter } from './routes/saves.js'
import { createSystemRouter } from './routes/system.js'
import { SaveStore } from './saves/store.js'
import { emptyTrash, sha256File } from './util/fsx.js'
import { HttpError, cleanRelPath, safeJoin } from './util/paths.js'

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
  library: Library
  saves: SaveStore
  catalog: Catalog
  close(): void
}

export async function createApp(cfg: Config, opts: { runtimePath?: string; startJobs?: boolean } = {}): Promise<App> {
  for (const d of [cfg.dataDir, cfg.savesDir, cfg.thumbnailsDir, cfg.walkthroughsDir, cfg.overlaysDir]) await mkdir(d, { recursive: true })
  for (const d of [cfg.internalDir, cfg.workDir, cfg.archivesDir, cfg.uploadsDir, cfg.enginesDir]) await mkdir(d, { recursive: true }).catch(() => {})

  const version = packageVersion()
  const db = Db.open(cfg.dataDir)
  const saves = new SaveStore(cfg.savesDir, cfg.saveHistoryDir, cfg.saveHistoryVersions)
  const jobs = new JobManager(db, cfg)
  const library = new Library(db, cfg)
  const overlays = new Overlays(cfg)
  const sdk = new SdkManager(cfg)
  const catalog = new Catalog(cfg, db)
  await catalog.init()

  const deps = { cfg, db, library, sdk, overlays, catalog, saves, jobs }
  jobs.register('import', (ctx) => runImport(ctx, deps))
  jobs.register('analyze', (ctx) => analyzeBuild(ctx, deps))
  jobs.register('optimize', (ctx) => optimizeBuild(ctx, deps))
  jobs.register('apply-mods', (ctx) => applyMods(ctx, deps))
  jobs.register('install-sdk', async (ctx) => ({ path: await sdk.ensure(ctx) }))
  jobs.register('hash-archive', async (ctx) => {
    const rel = cleanRelPath(ctx.params.path)
    const full = safeJoin(cfg.archivesDir, rel)
    const st = await stat(full)
    const sha256 = await sha256File(full, (n) => ctx.progress('Hashing archive', n / st.size))
    const prev = db.getArchive(rel)
    db.upsertArchive({ path: rel, size: st.size, mtime_ms: Math.floor(st.mtimeMs), sha256, info: prev?.info })
    const match = catalog.match({ name: rel, size: st.size, sha256 })
    return { sha256, recipe: match?.recipe.id ?? null, exact: match?.exact ?? false }
  })

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(express.json({ limit: '2mb' }))

  app.use(createPlayRouter(cfg, db, runtimeVersion(opts.runtimePath)))
  // Static fallbacks for development; nginx serves these paths in production.
  if (opts.runtimePath) app.get('/renplay/runtime.js', (_req, res) => res.sendFile(opts.runtimePath!))
  app.use('/engine', express.static(cfg.enginesDir, { immutable: true, maxAge: '365d' }))
  app.use('/g/:slug/:build', (req, res, next) => {
    const slug = req.params['slug'] as string
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return next()
    express.static(join(cfg.gamesDir, slug), { immutable: true, maxAge: '365d', index: false })(req, res, next)
  })
  app.use('/api', createSystemRouter(cfg, db, jobs, sdk, version))
  app.get('/api/saves-export', createSavesExportAll(saves, db))
  app.use('/api/saves', createSavesRouter(saves, db))
  app.use('/api/games', createFilesRouter(db, library, overlays, jobs))
  app.use('/api/games', createGamesRouter(deps))
  app.use('/api', createLibraryRouter(deps))

  // Development fallback for static files nginx serves in production.
  app.use('/api/thumbnails', express.static(cfg.thumbnailsDir, { maxAge: '1d', fallthrough: false }))
  app.use('/api/walkthroughs', express.static(cfg.walkthroughsDir, { maxAge: '1h', fallthrough: false }))

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

  // Startup housekeeping: cheap scan, cleanup, resume jobs.
  await cleanWorkDir(cfg)
  await emptyTrash(cfg.trashDir)
  const scan = await library.scan()
  if (scan.added.length) console.log(`library: added ${scan.added.join(', ')}`)
  if (opts.startJobs !== false) {
    jobs.start()
    for (const slug of scan.needsAnalysis) if (!jobs.activeFor(slug)) jobs.enqueue('analyze', slug, { slug })
  }

  return { app, db, jobs, library, saves, catalog, close: () => db.close() }
}
