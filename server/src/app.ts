import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type ErrorRequestHandler } from 'express'
import multer from 'multer'
import { playerRoute, type Accounts } from './auth.js'
import { viewer } from './accounts-context.js'
import type { SaveBackups } from './saves/backups.js'
import type { Builds } from './builds.js'
import type { Catalog } from './catalog.js'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { EngineStore } from './engines.js'
import type { JobManager } from './jobs/manager.js'
import { createJobsRouter } from './jobs/routes.js'
import { createFilesRouter } from './routes/files.js'
import { createGamesRouter } from './routes/games.js'
import { createProgressRouter } from './progress/routes.js'
import { createContentRouter } from './routes/content.js'
import { createLibraryRouter } from './routes/library.js'
import { createPlayRouter } from './routes/play.js'
import { createSavesRouter } from './saves/routes.js'
import { createMetricsRouter } from './routes/metrics.js'
import { createSystemRouter } from './routes/system.js'
import type { SaveStore } from './saves/store.js'
import { createServices, packageVersion, type Services } from './services.js'
import { HttpError } from './util/paths.js'
import type { Purger } from './util/purge.js'
import { log } from './util/log.js'

export { packageVersion }

/** Version string for the injected runtime script, so browsers refetch it after upgrades. */
function runtimeVersion(path: string | undefined): string {
  try {
    if (path) return createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 10)
  } catch {}
  return packageVersion()
}

export interface App {
  app: express.Express
  services: Services
  db: Db
  jobs: JobManager
  builds: Builds
  engines: EngineStore
  saves: SaveStore
  accounts: Accounts
  catalog: Catalog
  purger: Purger
  backups: SaveBackups
  summary(): string[]
  close(): void
}

/** A build's presplash, at its top level: /g/<game>/<build>/web-presplash.jpg. */
const PRESPLASH = /\/web-presplash\.(?:png|jpe?g|webp)$/i

export async function createApp(cfg: Config, opts: { runtimePath?: string; startJobs?: boolean } = {}): Promise<App> {
  const services = await createServices(cfg)
  const { db, content, accounts, art, catalog, jobs, builds, engines, purger, backups, version } = services

  const app = express()
  app.disable('x-powered-by')
  app.set('case sensitive routing', true)
  app.set('strict routing', true)
  app.set('trust proxy', cfg.trustedHops)
  app.use((req, _res, next) => {
    // Reject ambiguous spellings before auth, mounts and decoded route parameters diverge.
    const path = req.path
    // Only the filename tail of a canonical packed-asset route may contain encoded #, ? or %.
    // Route components retain the stricter rules; separators and double-encoded octets never pass.
    const asset = path.match(/^\/g\/[a-z0-9][a-z0-9._-]*\/[a-z0-9]+(?:\.m[a-z0-9]+)?\/(?:s\/[a-zA-Z0-9_.-]+\/)?game\/(.+)$/)
    const structure = asset ? path.slice(0, -asset[1]!.length) : path
    if (/^\/(?:api|g)(?:\/|%|$)/i.test(path) && (
      !/^\/(?:api|g)\//.test(path) || path.includes('//') || /%(?:2f|5c|00|25[0-9a-f]{2})/i.test(path) || /%(?:25|3f|23)/i.test(structure) || path.includes('\\') ||
      (path.startsWith('/api/') && path.endsWith('/'))
    )) return next(new HttpError(400, 'Use a canonical resource path'))
    next()
  })
  app.use(accounts.middleware)
  app.use(express.json({ limit: '2mb' }))
  app.use('/api', accounts.router())
  const checkStatic = (path: string) => {
    const game = path.match(/^\/g\/([^/]+)\//)?.[1]
    if (game && (!db.getGame(game) || content.hides(db.getGame(game)))) throw new HttpError(404, 'Game not found')
    // The presplash is a picture of the game, not part of playing it: withheld below Shown.
    if (game && PRESPLASH.test(path) && content.blurs(db.getGame(game))) throw new HttpError(404, 'Not found')
    const picture = path.match(/^\/api\/art\/([^/]+)$/)?.[1]
    if (picture && !art.canRead(picture)) throw new HttpError(404, 'Not found')
    const walkthrough = path.match(/^\/api\/walkthroughs\/([^/]+)$/)?.[1]
    if (walkthrough) {
      const owner = db.raw.prepare('SELECT game FROM walkthroughs WHERE file = ?').get(walkthrough) as { game: string } | undefined
      const g = owner ? db.getGame(owner.game) : null
      if (!g || content.hides(g)) throw new HttpError(404, 'Walkthrough not found')
    }
    return !!(game || picture || walkthrough)
  }
  app.get('/api/auth/check', (req, res) => {
    let path: string
    try {
      // nginx passes $uri: already percent-decoded and dot/slash-normalized. Never decode twice.
      path = req.get('x-original-uri') ?? ''
      if (!path.startsWith('/') || /[%?#]/.test(path) || path.includes('\\') || path.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) throw new Error('Invalid path')
    } catch { throw new HttpError(403, 'Invalid static path') }
    if (!/^\/g\/[a-z0-9][a-z0-9._-]*\/[a-z0-9]+(?:\.m[a-z0-9]+)?\/.+$/.test(path) && !/^\/api\/(?:art|walkthroughs)\/[^/]+$/.test(path)) throw new HttpError(403, 'Not a static game file')
    if (viewer()?.user.role !== 'admin' && !playerRoute('GET', path)) throw new HttpError(403, 'Only an admin can do this')
    // auth_request accepts only 2xx, 401 or 403; a hidden file must not become a 500.
    try { if (!checkStatic(path)) throw new HttpError(403, 'Not a recognized static resource') } catch (error) {
      if (error instanceof HttpError && error.status === 404) throw new HttpError(403, 'File not available')
      throw error
    }
    res.sendStatus(204)
  })
  app.use((req, _res, next) => { try { checkStatic(req.path); next() } catch (e) { next(e) } })

  // The HTML games' runtime lives next to Ren'Py's (runtime/ in the repository and the image).
  const htmlRuntimePath = resolve(dirname(opts.runtimePath ?? fileURLToPath(new URL('../../runtime/renplay-runtime.js', import.meta.url))), 'renplay-html.js')
  let htmlRuntime: Promise<string> | null = null
  // An in-memory IndexedDB goes first; the runtime installs it in place of the browser's.
  const readHtmlRuntime = () =>
    (htmlRuntime ??= Promise.all([readFile(join(dirname(htmlRuntimePath), 'vendor', 'fake-indexeddb.js'), 'utf-8'), readFile(htmlRuntimePath, 'utf-8')])
      .then((parts) => parts.join('\n;\n').replace(/<\/script/gi, '<\\/script'))
      .catch((e) => ((htmlRuntime = null), Promise.reject(e))))
  app.use(createPlayRouter(services, { html: readHtmlRuntime, version: runtimeVersion(opts.runtimePath) }))
  // Static fallbacks for development; nginx serves these paths in production.
  // resolve(): sendFile refuses paths with "..", like the $PWD/../runtime one in AGENTS.md.
  if (opts.runtimePath) app.get('/renplay/runtime.js', (_req, res) => res.sendFile(resolve(opts.runtimePath!)))
  app.use('/engine', express.static(cfg.enginesDir, { immutable: true, maxAge: '365d', setHeaders: gzipHeaders }))
  // game.zip, caches and presplash of a build (mod builds fall back to their base).
  app.get(/^\/g\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9]+)(?:\.m([a-z0-9]+))?\/(.+)$/, (req, res, next) => {
    const [game, base, mod, asset] = [req.params[0], req.params[1], req.params[2], req.params[3]] as string[]
    if (asset.includes('..')) return next()
    if (content.hides(db.getGame(game))) return next(new HttpError(404, 'Game not found'))
    if (PRESPLASH.test(`/${asset}`) && content.blurs(db.getGame(game))) return next(new HttpError(404, 'Not found'))
    const candidates = mod ? [join(cfg.gamesDir, game, `${base}.m${mod}`, asset), join(cfg.gamesDir, game, base, asset)] : [join(cfg.gamesDir, game, base, asset)]
    const tryNext = (i: number): void => {
      if (i >= candidates.length) return next()
      res.sendFile(candidates[i]!, { cacheControl: false }, (err) => (err ? tryNext(i + 1) : undefined))
    }
    tryNext(0)
  })
  if (opts.startJobs !== false) backups.start()
  app.use('/api', createSystemRouter(services))
  app.use('/api', createJobsRouter(services))
  app.use('/api', createMetricsRouter(services))
  app.use('/api/content', createContentRouter(services))
  app.use('/api', createSavesRouter(services))
  app.use('/api/games', createFilesRouter(services))
  app.use('/api/games', createGamesRouter(services))
  app.use('/api', createProgressRouter(services))
  app.use('/api', createLibraryRouter(services))
  // Made pictures are named by their content, so they never change: browsers keep them.
  app.get('/api/art/:file', (req, res, next) => {
    if (!art.canRead(req.params.file)) return next(new HttpError(404, 'Not found'))
    res.sendFile(art.file(req.params.file), { headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff' } }, (err) => err && next(new HttpError(404, 'Not found')))
  })
  // Text walkthroughs are served as plain text, never sniffed as anything else.
  app.use('/api/walkthroughs', express.static(cfg.walkthroughsDir, { cacheControl: false, fallthrough: false, setHeaders: (res, path) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (path.endsWith('.txt')) res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  } }))
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
  if (check.missing.length) log('library', `Builds missing for ${check.missing.join(', ')}`, 'warn')
  if (check.orphans.length) log('library', `Folders in ${cfg.gamesDir} that belong to no game: ${check.orphans.join(', ')}`, 'warn')
  if (opts.startJobs !== false) jobs.start()

  /** What this server is, in a few lines for the start of the log. */
  const summary = (): string[] => {
    const games = db.allGames()
    const methods = [cfg.authLocal && 'passwords', cfg.oidcIssuer && `OpenID Connect at ${cfg.oidcIssuer.replace(/^https?:\/\//, '')}`, cfg.ldapUrl && 'LDAP'].filter(Boolean)
    const signIn = accounts.enabled ? `on, with ${methods.join(', ')}` : 'off, everyone plays as the owner'
    const people = (db.raw.prepare('SELECT COUNT(*) n FROM users WHERE disabled = 0').get() as { n: number }).n
    return [
      `Renplay ${version}`,
      `Library: ${games.length} games, ${games.filter((g) => g.status === 'installed').length} installed, ${people} ${people === 1 ? 'person' : 'people'}`,
      `Sign-in: ${signIn}`,
      `Adult games: ${content.level} for this installation`,
      `Catalog: ${cfg.catalogUrls.join(', ')}`,
      `Save backups: ${backups.dir ? `daily to ${backups.dir}, the newest ${cfg.backupKeep} kept` : 'off'}`,
      `Folders: games ${cfg.gamesDir}, downloads ${cfg.archivesDir}, data ${cfg.dataDir}`,
    ]
  }

  return { app, services, db, jobs, builds, engines, saves: services.saveStores.of(1), accounts, catalog, purger, backups, summary, close: () => (catalog.stop(), backups.stop(), db.close()) }
}

/** Development server: serve *.gz engine files with their encoding, like nginx does. */
function gzipHeaders(res: express.Response, path: string) {
  if (path.endsWith('.wasm.gz')) res.setHeader('Content-Type', 'application/gzip')
}
