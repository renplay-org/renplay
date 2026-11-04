import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import express, { Router, type Request } from 'express'
import multer from 'multer'
import YAML from 'yaml'
import type { Builds } from '../builds.js'
import { installedRelease, type Catalog } from '../catalog.js'
import type { Config } from '../config.js'
import { parseJson, type Db, type GameRow, type GameSource } from '../db.js'
import type { JobManager } from '../jobs.js'
import type { Overlays } from '../mods.js'
import type { SaveStore } from '../saves/store.js'
import { playPath } from './play.js'
import { exists, writeFileAtomic } from '../util/fsx.js'
import { HttpError, assertSlug, cleanRelPath, safeJoin } from '../util/paths.js'

const pdfs = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 << 20, files: 1 } })
const CACHE_RE = /^(bytecode-\d+|py3analysis|screens)\.rpyb$/

/**
 * Cache files a game may store: Python bytecode and analysis caches, and
 * scripts Ren'Py recompiled (rpyc/<path relative to game/>). Games made with
 * an older Ren'Py are recompiled by the newer engine on every start
 * otherwise, which takes seconds to tens of seconds.
 */
function cacheName(raw: unknown): string {
  const name = cleanRelPath(raw)
  if (CACHE_RE.test(name)) return name
  if (name.startsWith('rpyc/') && /\.rpyc$/i.test(name)) return name
  throw new HttpError(400, 'Not a cache file')
}

/** The catalog's recipe schema, for editors that validate YAML (yaml-language-server). */
export const RECIPE_SCHEMA_URL = 'https://renplay-web.github.io/catalog/recipe.schema.json'

export interface GameDeps {
  cfg: Config
  db: Db
  jobs: JobManager
  builds: Builds
  saves: SaveStore
  overlays: Overlays
  catalog: Catalog
  version: string
}

export async function toGame(row: GameRow, deps: GameDeps) {
  const source = parseJson<GameSource>(row.source, {})
  const job = deps.jobs.activeFor(row.id)
  let saves = { count: 0, latest: 0 }
  if (row.save_dir) {
    try {
      const files = (await deps.saves.list(row.save_dir)).filter((f) => f.name.endsWith('.save') && !f.name.startsWith('_') && !f.name.includes('/'))
      saves = { count: files.length, latest: files.reduce((m, f) => Math.max(m, f.mtimeMs), 0) }
    } catch {}
  }
  const mods = await deps.overlays.summary(row.id)
  const recipe = row.recipe_id ? deps.catalog.recipe(row.recipe_id) : null
  const release = recipe ? installedRelease(recipe, row.version, source.archive) : null
  const update = recipe ? deps.catalog.update(recipe, row.version, source.archive) : null
  const modded = row.build.includes('.m')
  return {
    id: row.id,
    // Title, developer, tags and cover come from the catalog; a game without a
    // recipe shows the name it declares itself.
    title: recipe?.title ?? row.title,
    developer: recipe?.developer ?? null,
    tags: recipe?.tags ?? [],
    tagIds: recipe?.tagIds ?? [],
    content: recipe?.content ?? [],
    state: recipe?.state ?? null,
    summary: recipe?.summary ?? null,
    nsfw: recipe?.nsfw ?? false,
    cover: recipe ? deps.catalog.cover(recipe.id) : null,
    walkthrough: row.walkthrough || null,
    status: row.status,
    build: row.build || null,
    playUrl: row.status === 'installed' && row.build ? playPath(row) : null,
    family: row.family || 'renpy',
    /** What made the game, for other engines ("HTML (SugarCube 2.36.1)"). */
    engineLabel: row.engine_label || null,
    version: release?.version || row.version || null,
    detectedVersion: row.version || null,
    renpyVersion: row.renpy_version || null,
    engine: row.engine || null,
    sizeBytes: row.size_bytes,
    fileCount: row.file_count,
    screen: row.screen_w ? ([row.screen_w, row.screen_h] as [number, number]) : null,
    saveDir: row.save_dir || null,
    source: { archive: source.archive ?? null, size: source.size ?? null },
    canReinstall: !!source.archive && (await exists(join(deps.cfg.archivesDir, cleanRelPath(source.archive)))),
    recipe: recipe
      ? {
          id: recipe.id,
          links: recipe.links ?? {},
          continuesFrom: recipe.continuesFrom ?? [],
          status: release?.status ?? null,
        }
      : row.recipe_id
        ? { id: row.recipe_id, links: {}, continuesFrom: [], status: null }
        : null,
    update: update ? { version: update.version, date: update.date ?? null, status: update.status } : null,
    favoriteAt: row.favorite_at || null,
    installedAt: row.installed_at || null,
    lastPlayedAt: row.last_played_at || null,
    saves,
    mods: { files: mods.files + mods.deleted, hash: mods.hash, applied: modded && row.build.endsWith(`.m${mods.hash}`) },
    job: job ? { id: job.id, type: job.type, status: job.status, stage: job.stage, progress: job.progress } : null,
  }
}

export function createGamesRouter(deps: GameDeps): Router {
  const { cfg, db, jobs, builds } = deps
  const router = Router()

  const get = (req: Request): GameRow => {
    const g = db.getGame(assertSlug(req.params.id))
    if (!g) throw new HttpError(404, 'Game not found')
    return g
  }

  router.get('/', async (_req, res) => {
    res.json({ games: await Promise.all(db.allGames().map((r) => toGame(r, deps))) })
  })

  router.get('/:id', async (req, res) => {
    res.json({ game: await toGame(get(req), deps) })
  })

  router.put('/:id/favorite', async (req, res) => {
    const g = get(req)
    if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'On must be a boolean')
    db.updateGame(g.id, { favorite_at: req.body.on ? g.favorite_at || new Date().toISOString() : '' })
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  router.post('/:id/played', (req, res) => {
    db.updateGame(get(req).id, { last_played_at: new Date().toISOString() })
    res.json({ ok: true })
  })

  /** Uninstalls (files go, saves and mods stay); `forget=1` also removes the library entry. */
  router.delete('/:id', async (req, res) => {
    const g = get(req)
    if (jobs.activeFor(g.id)) throw new HttpError(409, 'A job is running for this game')
    await builds.remove(g.id)
    if (req.query['forget'] === '1') {
      if (g.walkthrough) await unlink(join(cfg.walkthroughsDir, g.walkthrough)).catch(() => {})
      db.deleteGame(g.id)
      res.json({ ok: true, forgotten: true })
      return
    }
    db.updateGame(g.id, { status: 'not_installed', build: '', size_bytes: 0, file_count: 0 })
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  router.post('/:id/reinstall', async (req, res) => {
    const g = get(req)
    const src = parseJson<GameSource>(g.source, {})
    if (!src.archive) throw new HttpError(409, 'No source archive is known for this game. Add its archive to install it.')
    if (!(await exists(join(cfg.archivesDir, cleanRelPath(src.archive))))) throw new HttpError(409, `The source archive ${src.archive} is no longer in the archives folder`)
    if (jobs.activeFor(g.id)) throw new HttpError(409, 'A job is already running for this game')
    const id = jobs.enqueue('import', g.id, {
      source: { kind: 'archive', path: src.archive },
      game: g.id,
      recipeId: g.recipe_id || undefined,
      engine: typeof req.body?.engine === 'string' ? req.body.engine : undefined,
      reapplyMods: !!req.body?.reapplyMods,
    })
    if (g.status !== 'installed') db.updateGame(g.id, { status: 'installing' })
    res.json({ jobId: id })
  })

  /**
   * Python bytecode caches compiled by the browser on a game's first start.
   * Stored with the current build, they spare later starts the compile.
   */
  router.put('/:id/cache', express.raw({ type: () => true, limit: '64mb' }), async (req, res) => {
    const g = get(req)
    const name = cacheName(req.query['name'])
    if (req.query['build'] !== g.build || !g.build) throw new HttpError(409, 'Build changed')
    if (!Buffer.isBuffer(req.body) || req.body.length < 16) throw new HttpError(400, 'Empty cache')
    const path = safeJoin(join(builds.dir(g.id, g.build), 'cache'), name)
    await mkdir(dirname(path), { recursive: true })
    await writeFileAtomic(path, req.body)
    res.json({ ok: true })
  })

  /** A recipe for this game, filled in from the installed build, to contribute to the catalog. */
  router.get('/:id/recipe', async (req, res) => {
    const g = get(req)
    const src = parseJson<GameSource>(g.source, {})
    let sha256 = src.sha256 ?? ''
    if (!sha256 && src.archive) sha256 = db.getArchive(src.archive)?.sha256 ?? ''
    let hashJob: string | null = null
    if (!sha256 && src.archive && (await exists(join(cfg.archivesDir, src.archive)))) {
      const running = db.listJobs(100).find((j) => j.type === 'hash-archive' && (j.status === 'queued' || j.status === 'running') && j.params.includes(src.archive!))
      hashJob = running?.id ?? jobs.enqueue('hash-archive', '', { path: src.archive })
    }
    const existing = g.recipe_id ? deps.catalog.recipe(g.recipe_id) : null
    const recipe = {
      id: g.recipe_id || g.id,
      title: existing?.title ?? g.title,
      developer: existing?.developer ?? '',
      tags: existing?.tags ?? [],
      nsfw: existing?.nsfw ?? false,
      links: existing?.links ?? { website: '' },
      saveDir: g.save_dir || undefined,
      continuesFrom: existing?.continuesFrom,
      match: existing?.match,
      engine: existing?.engine ?? ((g.family || 'renpy') as 'renpy'),
      runtime: existing?.runtime,
      build: existing?.build,
      releases: [
        {
          version: g.version || 'unknown',
          madeWith: g.renpy_version || undefined,
          runtime: g.engine || undefined,
          status: 'untested',
          archives: src.archive ? [{ name: src.archive.split('/').pop(), size: src.size, sha256: sha256 || 'pending' }] : [],
          verified: { date: new Date().toISOString().slice(0, 10), renplay: deps.version, browsers: [], notes: '' },
        },
        ...(existing?.releases.filter((r) => r.version !== g.version) ?? []),
      ],
    }
    const yaml = `# yaml-language-server: $schema=${RECIPE_SCHEMA_URL}\n${YAML.stringify(JSON.parse(JSON.stringify(recipe)), { lineWidth: 0 })}`
    res.json({ yaml, sha256Pending: !sha256, hashJob })
  })

  // ---- walkthroughs --------------------------------------------------------

  router.post('/:id/walkthrough', pdfs.single('walkthrough'), async (req, res) => {
    const g = get(req)
    const f = req.file
    if (!f) throw new HttpError(400, 'No file uploaded')
    if (f.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Only PDF files are supported')
    await mkdir(cfg.walkthroughsDir, { recursive: true })
    const name = `${g.id}-${Date.now().toString(36)}.pdf`
    await writeFile(join(cfg.walkthroughsDir, name), f.buffer)
    if (g.walkthrough) await unlink(join(cfg.walkthroughsDir, g.walkthrough)).catch(() => {})
    db.updateGame(g.id, { walkthrough: name })
    res.json({ ok: true, walkthrough: name })
  })

  router.delete('/:id/walkthrough', async (req, res) => {
    const g = get(req)
    if (g.walkthrough) await unlink(join(cfg.walkthroughsDir, g.walkthrough)).catch(() => {})
    db.updateGame(g.id, { walkthrough: '' })
    res.json({ ok: true })
  })

  return router
}
