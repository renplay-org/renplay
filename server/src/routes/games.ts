import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import express, { Router, type Request } from 'express'
import multer from 'multer'
import YAML from 'yaml'
import { viewer } from '../accounts-context.js'
import { ART_KINDS, type ArtKind } from '../art.js'
import type { Accounts } from '../auth.js'
import type { Builds } from '../builds.js'
import { installedRelease, type Catalog } from '../catalog.js'
import type { Config } from '../config.js'
import { parseJson, type Db, type GameRow, type GameSource } from '../db.js'
import type { JobManager } from '../jobs.js'
import type { Overlays } from '../mods.js'
import type { SaveStore } from '../saves/store.js'
import { playPath } from './play.js'
import { cachedSaveMeta } from './saves.js'
import { slotInfo } from '../saves/savefile.js'
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
export const RECIPE_SCHEMA_URL = 'https://catalog.renplay.org/recipe.schema.json'

export interface GameDeps {
  cfg: Config
  accounts?: Accounts
  db: Db
  jobs: JobManager
  builds: Builds
  saves: SaveStore
  overlays: Overlays
  catalog: Catalog
  version: string
}

export async function toGame(row: GameRow, deps: GameDeps) {
  if (deps.accounts) row = deps.accounts.progress(row)
  const source = parseJson<GameSource>(row.source, {})
  const job = deps.jobs.activeFor(row.id)
  let latestSave: { file: string; label: string; name: string; ctime: number; runtime: number | undefined; screenshot: string | null } | null = null
  let saves = { count: 0, latest: 0 }
  if (row.save_dir) {
    try {
      const files = (await deps.saves.list(row.save_dir)).filter((f) => f.name.endsWith('.save') && !f.name.startsWith('_') && !f.name.includes('/'))
      saves = { count: files.length, latest: files.reduce((m, f) => Math.max(m, f.mtimeMs), 0) }
      for (const f of files) {
        const meta = await cachedSaveMeta(deps.saves, row.save_dir, f)
        if (!meta) continue
        const ctime = meta.ctime ? meta.ctime * 1000 : f.mtimeMs
        if (!latestSave || ctime > latestSave.ctime) latestSave = {
          file: f.name, label: slotInfo(f.name).label, name: meta.name ?? '', ctime, runtime: meta.runtime,
          screenshot: meta.hasScreenshot ? `/api/saves/${row.id}/screenshot?user=${deps.accounts?.current().id ?? 1}&file=${encodeURIComponent(f.name)}&v=${f.mtimeMs}` : null,
        }
      }
    } catch {}
  }
  const mods = await deps.overlays.summary(row.id)
  const recipe = row.recipe_id ? deps.catalog.recipe(row.recipe_id) : null
  const release = recipe ? installedRelease(recipe, row.version, source.archive) : null
  const update = recipe ? deps.catalog.update(recipe, row.version, source.archive) : null
  const modded = row.build.includes('.m')
  // Blurred: the game shows with its title and metadata, but no picture URL leaves the server.
  const blurred = deps.catalog.content.blurs(row)
  if (blurred && latestSave) latestSave.screenshot = null
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
    // A game without a recipe can be marked adult in the library, and its tile says so too.
    nsfw: recipe?.nsfw ?? row.adult === 1,
    free: recipe?.free,
    // The five formats. Below Shown an adult game's formats are hashes and tints, no address.
    art: deps.catalog.gameArt(row),
    walkthrough: row.walkthrough || null,
    status: row.status,
    build: row.build || null,
    // The game page is an iframe, which sends no header: this device's level rides along as a query.
    playUrl: row.status === 'installed' && row.build ? (row.family !== 'renpy' && deps.accounts ? deps.accounts.assetUrl(row) : playPath(row) + (viewer()?.device ? `?adult=${viewer()!.device}` : '')) : null,
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
    update: update ? { version: update.version, date: update.date ?? null, status: update.status, archives: update.archives.map((archive) => archive.name) } : null,
    favoriteAt: row.favorite_at || null,
    finishedAt: row.finished_at || null,
    playTime: row.play_time,
    /** The person's status: playing, stalled, dropped, finished, or null when not set. */
    playStatus: row.play_status || null,
    rating: row.rating || null,
    notNowAt: row.not_now_at || null,
    /** How the game plays on a phone, curated in the recipe: great, playable or desktop. */
    phone: recipe?.phone ?? null,
    latestSave,
    createdAt: row.created_at,
    installedAt: row.installed_at || null,
    lastPlayedAt: row.last_played_at || null,
    saves,
    mods: { files: mods.files + mods.deleted, hash: mods.hash, applied: modded && row.build.endsWith(`.m${mods.hash}`) },
    job: job ? { id: job.id, type: job.type, status: job.status, stage: job.stage, progress: job.progress } : null,
  }
}

export function createGamesRouter(deps: GameDeps): Router {
  const { cfg, db, jobs, builds } = deps
  const router = Router({ caseSensitive: true, strict: true })

  const get = (req: Request): GameRow => {
    const g = db.getGame(assertSlug(req.params.id))
    if (!g || deps.catalog.content.hides(g)) throw new HttpError(404, 'Game not found')
    return g
  }

  router.get('/', async (_req, res) => {
    res.json({ games: await Promise.all(db.allGames().filter((r) => !deps.catalog.content.hides(r)).map((r) => toGame(r, deps))) })
  })

  router.get('/:id', async (req, res) => {
    res.json({ game: await toGame(get(req), deps) })
  })

  // ---- art: choices and uploads (DESIGN 0.7) ------------------------------------

  /** The game, when this person may see its pictures: below Shown an adult game's art does not exist. */
  const withArt = (req: Request): GameRow => {
    const g = get(req)
    if (deps.catalog.content.blurs(g) || !deps.catalog.art) throw new HttpError(404, 'Not found')
    return g
  }
  const kindOf = (value: unknown): ArtKind => {
    if (typeof value !== 'string' || !ART_KINDS.includes(value as ArtKind)) throw new HttpError(400, 'Choose grid, wide, hero, logo or icon')
    return value as ArtKind
  }
  /** Me: this person's own view. Everyone: the admin's default for the instance. */
  const scopeOf = (value: unknown): number => {
    const v = viewer()
    if (value === 'everyone') {
      if (v && v.user.role !== 'admin') throw new HttpError(403, 'Only an admin can choose art for everyone')
      return 0
    }
    if (value !== undefined && value !== 'me') throw new HttpError(400, 'Scope must be me or everyone')
    return v?.user.id ?? 0
  }

  router.get('/:id/art', async (req, res) => {
    const g = withArt(req)
    const subject = deps.catalog.gameSubject(g)
    const scope = scopeOf(undefined)
    if (req.query['kind'] === undefined) {
      res.json({ art: deps.catalog.art!.forSubject(subject), counts: Object.fromEntries(ART_KINDS.map((k) => [k, subject.pictures.filter((p) => p.kind === k).length])) })
      return
    }
    const kind = kindOf(req.query['kind'])
    res.json({ kind, candidates: await deps.catalog.art!.candidates(subject, kind, scope) })
  })

  router.put('/:id/art', async (req, res) => {
    const g = withArt(req)
    const kind = kindOf(req.body?.kind)
    const scope = scopeOf(req.body?.scope)
    const subject = deps.catalog.gameSubject(g)
    if (!subject.pictures.some((p) => p.kind === kind && p.id === req.body?.candidate)) throw new HttpError(404, 'That picture is not a choice for this game')
    deps.catalog.art!.choose(g.id, kind, req.body.candidate, scope)
    await deps.catalog.art!.ready(subject, scope)
    res.json({ art: deps.catalog.art!.forSubject(subject) })
  })

  router.delete('/:id/art', async (req, res) => {
    const g = withArt(req)
    const kind = kindOf(req.query['kind'])
    const scope = scopeOf(req.query['scope'])
    deps.catalog.art!.clearChoice(g.id, kind, scope)
    const subject = deps.catalog.gameSubject(g)
    await deps.catalog.art!.ready(subject, scope)
    res.json({ art: deps.catalog.art!.forSubject(subject) })
  })

  router.post('/:id/art/upload', express.raw({ type: () => true, limit: '16mb' }), async (req, res) => {
    const g = withArt(req)
    const kind = kindOf(req.query['kind'])
    const scope = scopeOf(req.query['scope'])
    const focalText = typeof req.query['focal'] === 'string' ? req.query['focal'] : ''
    const focal = /^(0(\.\d+)?|1(\.0+)?),(0(\.\d+)?|1(\.0+)?)$/.test(focalText) ? (focalText.split(',').map(Number) as [number, number]) : null
    if (focalText && !focal) throw new HttpError(400, 'The focal point is two numbers from 0 to 1, like 0.5,0.3')
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'No picture uploaded')
    const { id, warning } = await deps.catalog.art!.upload(g.id, kind, req.body, focal, scope)
    // An upload is made to be used: it becomes the choice at the scope it was uploaded for.
    deps.catalog.art!.choose(g.id, kind, id, scope)
    const subject = deps.catalog.gameSubject(g)
    await deps.catalog.art!.ready(subject, scope)
    res.json({ id, warning, art: deps.catalog.art!.forSubject(subject) })
  })

  router.put('/:id/favorite', async (req, res) => {
    const g = get(req)
    if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'On must be a boolean')
    const patch = { favorite_at: req.body.on ? (deps.accounts?.progress(g).favorite_at ?? g.favorite_at) || new Date().toISOString() : '' }
    if (deps.accounts) deps.accounts.setProgress(g.id, patch)
    else db.updateGame(g.id, patch)
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  /** Finished keeps finished_at in step with the status, which 3.x reads. */
  const setStatus = (g: GameRow, status: string) => {
    const previous = deps.accounts ? deps.accounts.progress(g).finished_at : g.finished_at
    const patch = { play_status: status, finished_at: status === 'finished' ? previous || new Date().toISOString() : '' }
    if (deps.accounts) deps.accounts.setProgress(g.id, patch)
    else db.updateGame(g.id, { finished_at: patch.finished_at })
  }

  router.put('/:id/finished', async (req, res) => {
    const g = get(req)
    if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'On must be a boolean')
    setStatus(g, req.body.on ? 'finished' : '')
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  router.put('/:id/status', async (req, res) => {
    const g = get(req)
    const status = req.body?.status ?? ''
    if (!['', 'playing', 'stalled', 'dropped', 'finished'].includes(status)) throw new HttpError(400, 'Status must be playing, stalled, dropped, finished or empty')
    setStatus(g, status)
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  router.put('/:id/rating', async (req, res) => {
    const g = get(req)
    const rating = req.body?.rating ?? 0
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new HttpError(400, 'Rating must be a whole number from 0 to 5')
    if (!deps.accounts) throw new HttpError(503, 'Ratings need accounts')
    deps.accounts.setProgress(g.id, { rating })
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  // Not now: the game leaves Up next until it is played again. DELETE undoes it.
  router.post('/:id/not-now', async (req, res) => {
    const g = get(req)
    if (!deps.accounts) throw new HttpError(503, 'Not now needs accounts')
    deps.accounts.setProgress(g.id, { not_now_at: new Date().toISOString() })
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })
  router.delete('/:id/not-now', async (req, res) => {
    const g = get(req)
    if (!deps.accounts) throw new HttpError(503, 'Not now needs accounts')
    deps.accounts.setProgress(g.id, { not_now_at: '' })
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  // The player reports visible, running time in seconds, in bounded increments.
  router.post('/:id/play-time', (req, res) => {
    const g = get(req)
    const seconds = req.body?.seconds
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new HttpError(400, 'Seconds must be an integer from 1 to 60')
    if (deps.accounts) {
      deps.accounts.setProgress(g.id, { play_time: deps.accounts.progress(g).play_time + seconds })
      deps.accounts.addPlayTime(g.id, seconds)
    } else db.raw.prepare('UPDATE games SET play_time = play_time + ? WHERE id = ?').run(seconds, g.id)
    res.json({ ok: true })
  })

  router.post('/:id/played', (req, res) => {
    const id = get(req).id, patch = { last_played_at: new Date().toISOString() }
    if (deps.accounts) deps.accounts.setProgress(id, patch)
    else db.updateGame(id, patch)
    res.json({ ok: true })
  })

  /** Uninstalls (files go, saves and mods stay); `forget=1` also removes the library entry. */
  router.delete('/:id', async (req, res) => {
    const g = get(req)
    if (jobs.activeFor(g.id)) throw new HttpError(409, 'A job is running for this game')
    await builds.remove(g.id)
    if (req.query['forget'] === '1') {
      if (g.walkthrough) await unlink(join(cfg.walkthroughsDir, g.walkthrough)).catch(() => {})
      // Its finished jobs go with it: without the game, nothing tells whether they were about an
      // adult game. Saves stay, as always.
      jobs.clearFinished((j) => j.game !== g.id && parseJson<{ game?: unknown }>(j.result, {}).game !== g.id)
      db.deleteGame(g.id)
      res.json({ ok: true, forgotten: true })
      return
    }
    db.updateGame(g.id, { status: 'not_installed', build: '', size_bytes: 0, file_count: 0 })
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  router.delete('/:id/download', async (req, res) => {
    const g = get(req)
    if (jobs.isBusy() || jobs.activeFor(g.id)) throw new HttpError(409, 'Wait for install jobs to finish before deleting a download')
    const source = parseJson<GameSource>(g.source, {})
    if (!source.archive) throw new HttpError(404, 'No download is known for this game')
    const rel = cleanRelPath(source.archive)
    await unlink(safeJoin(cfg.archivesDir, rel)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new HttpError(404, 'Download not found')
      throw error
    })
    db.deleteArchive(rel)
    res.json({ ok: true })
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
