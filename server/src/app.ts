import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import express, { type ErrorRequestHandler } from 'express'
import multer from 'multer'
import type { Accounts } from './accounts/accounts.js'
import { playerRoute } from './accounts/access.js'
import { OWNER_ID, viewer } from './accounts/context.js'
import type { SaveBackups } from './saves/backups.js'
import type { Builds } from './games/builds.js'
import type { Catalog } from './catalog/catalog.js'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { EngineStore } from './engines.js'
import type { JobManager } from './jobs/manager.js'
import { createArtRouter } from './art/routes.js'
import { createCatalogRouter } from './catalog/routes.js'
import { createDefaultsRouter } from './defaults/routes.js'
import { createJobsRouter } from './jobs/routes.js'
import { createFilesRouter } from './games/files.js'
import { createGamesRouter } from './games/routes.js'
import { createPeopleRouter } from './people/routes.js'
import { createProgressRouter } from './progress/routes.js'
import { createContentRouter } from './content/routes.js'
import { createLibraryRouter } from './library/routes.js'
import { isPresplash } from './pipeline/project.js'
import { parseGamePath } from './play/path.js'
import { createPlayRouter } from './play/routes.js'
import { createSavesRouter } from './saves/routes.js'
import { createMetricsRouter } from './system/metrics.js'
import { createSystemRouter } from './system/routes.js'
import { createTelemetryRouter } from './telemetry/routes.js'
import type { SaveStore } from './saves/store.js'
import { createServices, type Services } from './services.js'
import { HttpError } from './util/paths.js'
import type { Purger } from './util/purge.js'
import { log } from './util/log.js'

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

export async function createApp(cfg: Config, opts: { startJobs?: boolean } = {}): Promise<App> {
  const services = await createServices(cfg)
  const { db, content, accounts, art, catalog, jobs, builds, engines, purger, backups, telemetry, version } = services

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
    const rest = parseGamePath(path)?.rest
    const tail = rest?.startsWith('game/') ? rest.slice(5) : ''
    const structure = tail ? path.slice(0, -tail.length) : path
    if (/^\/(?:api|g)(?:\/|%|$)/i.test(path) && (
      !/^\/(?:api|g)\//.test(path) || path.includes('//') || /%(?:2f|5c|00|25[0-9a-f]{2})/i.test(path) || /%(?:25|3f|23)/i.test(structure) || path.includes('\\') ||
      (path.startsWith('/api/') && path.endsWith('/'))
    )) return next(new HttpError(400, 'Use a canonical resource path'))
    next()
  })
  app.use(accounts.middleware)
  app.use(express.json({ limit: '2mb' }))
  app.use('/api', accounts.router())
  app.use('/api', createPeopleRouter(services))
  const checkStatic = (path: string) => {
    const game = path.match(/^\/g\/([^/]+)\//)?.[1]
    if (game && (!db.getGame(game) || content.hides(db.getGame(game)))) throw new HttpError(404, 'Game not found')
    // The presplash is a picture of the game, not part of playing it: withheld below Shown.
    if (game && isPresplash(path) && content.blurs(db.getGame(game))) throw new HttpError(404, 'Not found')
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
    if (!parseGamePath(path)?.rest && !/^\/api\/(?:art|walkthroughs)\/[^/]+$/.test(path)) throw new HttpError(403, 'Not a static game file')
    if (viewer()?.user.role !== 'admin' && !playerRoute('GET', path)) throw new HttpError(403, 'Only an admin can do this')
    // auth_request accepts only 2xx, 401 or 403; a hidden file must not become a 500.
    try { if (!checkStatic(path)) throw new HttpError(403, 'Not a recognized static resource') } catch (error) {
      if (error instanceof HttpError && error.status === 404) throw new HttpError(403, 'File not available')
      throw error
    }
    res.sendStatus(204)
  })
  app.use((req, _res, next) => { try { checkStatic(req.path); next() } catch (e) { next(e) } })
  app.use(createPlayRouter(services))

  if (opts.startJobs !== false) backups.start()
  if (opts.startJobs !== false) telemetry.start()
  app.use('/api', createSystemRouter(services))
  app.use('/api', createDefaultsRouter(services))
  app.use('/api', createJobsRouter(services))
  app.use('/api', createMetricsRouter(services))
  app.use('/api', createTelemetryRouter(services))
  app.use('/api', createContentRouter(services))
  app.use('/api', createSavesRouter(services))
  app.use('/api', createFilesRouter(services))
  app.use('/api', createGamesRouter(services))
  app.use('/api', createProgressRouter(services))
  app.use('/api', createLibraryRouter(services))
  app.use('/api', createCatalogRouter(services))
  app.use('/api', createArtRouter(services))
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
  if (check.back.length) log('library', `Builds back for ${check.back.join(', ')}`)
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

  return { app, services, db, jobs, builds, engines, saves: services.saveStores.of(OWNER_ID), accounts, catalog, purger, backups, summary, close: () => (catalog.stop(), backups.stop(), telemetry.stop(), db.close()) }
}
