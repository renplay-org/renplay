import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Router, type Request } from 'express'
import multer from 'multer'
import type { Config } from '../config.js'
import { parseJson, type Db, type GameRow } from '../db.js'
import type { JobManager } from '../jobs.js'
import { gameSource, type Library } from '../library.js'
import type { Overlays } from '../mods.js'
import { makeCover } from '../pipeline/optimize.js'
import { saveCover } from '../pipeline/import.js'
import { readSaveScreenshot } from '../saves/savefile.js'
import type { SaveStore } from '../saves/store.js'
import { exists, trashDir } from '../util/fsx.js'
import { HttpError, assertSlug, cleanRelPath, isSaveDirName } from '../util/paths.js'

const images = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 << 20, files: 1 } })
const pdfs = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 << 20, files: 1 } })

export interface GameDeps {
  cfg: Config
  db: Db
  jobs: JobManager
  library: Library
  saves: SaveStore
  overlays: Overlays
}

export async function toGame(row: GameRow, deps: GameDeps) {
  const source = gameSource(row)
  const job = deps.jobs.activeFor(row.slug)
  let saves = { count: 0, latest: 0 }
  if (row.save_dir) {
    try {
      const files = (await deps.saves.list(row.save_dir)).filter((f) => f.name.endsWith('.save') && !f.name.startsWith('_') && !f.name.includes('/'))
      saves = { count: files.length, latest: files.reduce((m, f) => Math.max(m, f.mtimeMs), 0) }
    } catch {}
  }
  const mods = await deps.overlays.summary(row.slug)
  return {
    slug: row.slug,
    title: row.title,
    tags: parseJson<string[]>(row.tags, []),
    thumbnail: row.thumbnail || null,
    walkthrough: row.walkthrough || null,
    status: row.status,
    layout: row.layout,
    buildId: row.build_id,
    playUrl: row.status === 'installed' && row.build_id ? `/g/${row.slug}/${row.build_id}/` : null,
    version: row.version || null,
    renpyVersion: row.renpy_version || null,
    engine: row.engine || null,
    sizeBytes: row.size_bytes,
    fileCount: row.file_count,
    screen: row.screen_w ? [row.screen_w, row.screen_h] : null,
    saveDir: row.save_dir || null,
    saveDirSource: row.save_dir_source || null,
    source: { kind: source.kind, archive: source.archive ?? null, filename: source.filename ?? null, url: source.url ?? null },
    canReinstall: !!source.archive,
    catalogId: row.catalog_id || null,
    installedAt: row.installed_at || null,
    lastPlayedAt: row.last_played_at || null,
    sortOrder: row.sort_order,
    saves,
    mods: { files: mods.files + mods.deleted, hash: mods.hash, state: row.mods_state || '' },
    job: job ? { id: job.id, type: job.type, status: job.status, stage: job.stage, progress: job.progress } : null,
  }
}

export function createGamesRouter(deps: GameDeps): Router {
  const { cfg, db, jobs, library } = deps
  const router = Router()

  const get = (req: Request): GameRow => {
    const g = db.getGame(assertSlug(req.params.slug))
    if (!g) throw new HttpError(404, 'Game not found')
    return g
  }

  router.get('/', async (_req, res) => {
    const rows = db.allGames()
    res.json({ games: await Promise.all(rows.map((r) => toGame(r, deps))) })
  })

  router.get('/:slug', async (req, res) => {
    res.json({ game: await toGame(get(req), deps) })
  })

  router.patch('/:slug', async (req, res) => {
    const g = get(req)
    const { title, tags, saveDir } = req.body ?? {}
    const updates: Partial<GameRow> = {}
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new HttpError(400, 'Title must be 1-200 characters')
      updates.title = title.trim()
    }
    if (tags !== undefined) {
      if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string' || t.length > 40) || tags.length > 30) throw new HttpError(400, 'Invalid tags')
      updates.tags = JSON.stringify([...new Set(tags.map((t: string) => t.trim()).filter(Boolean))])
    }
    if (saveDir !== undefined) {
      if (saveDir === '' || saveDir === null) {
        updates.save_dir = ''
        updates.save_dir_source = ''
      } else {
        if (!isSaveDirName(saveDir)) throw new HttpError(400, 'Invalid save folder name')
        updates.save_dir = saveDir
        updates.save_dir_source = 'manual'
      }
    }
    db.updateGame(g.slug, updates)
    res.json({ game: await toGame(db.getGame(g.slug)!, deps) })
  })

  router.post('/:slug/played', (req, res) => {
    const g = get(req)
    db.updateGame(g.slug, { last_played_at: new Date().toISOString() })
    res.json({ ok: true })
  })

  router.put('/reorder', (req, res) => {
    const slugs = req.body?.slugs
    if (!Array.isArray(slugs) || !slugs.every((s) => typeof s === 'string')) throw new HttpError(400, 'slugs must be an array')
    db.reorderGames(slugs.map((s) => assertSlug(s)))
    res.json({ ok: true })
  })

  /**
   * Removes the installed files. Saves always stay. `forget=1` also drops the
   * library entry (saves still stay on disk and reattach on reinstall).
   */
  router.delete('/:slug', async (req, res) => {
    const g = get(req)
    if (jobs.activeFor(g.slug)) throw new HttpError(409, 'A job is running for this game')
    await trashDir(library.gameDir(g.slug), cfg.trashDir)
    if (req.query['forget'] === '1') {
      db.deleteGame(g.slug)
      res.json({ ok: true, forgotten: true })
      return
    }
    db.updateGame(g.slug, { status: 'not_installed', layout: 'none', size_bytes: 0, file_count: 0 })
    res.json({ ok: true, game: await toGame(db.getGame(g.slug)!, deps) })
  })

  router.post('/:slug/reinstall', async (req, res) => {
    const g = get(req)
    const src = gameSource(g)
    if (!src.archive) throw new HttpError(409, 'No source archive is known for this game. Import an archive to install it.')
    if (!(await exists(join(cfg.archivesDir, cleanRelPath(src.archive))))) {
      throw new HttpError(409, `The source archive ${src.archive} is no longer in the archives folder`)
    }
    if (jobs.activeFor(g.slug)) throw new HttpError(409, 'A job is already running for this game')
    const opts = parseJson<{ optimizeImages?: boolean; imageQuality?: number }>(g.options, {})
    const id = jobs.enqueue('import', g.slug, {
      source: { kind: 'archive', path: src.archive },
      slug: g.slug,
      optimizeImages: req.body?.optimizeImages ?? opts.optimizeImages ?? true,
      imageQuality: req.body?.imageQuality ?? opts.imageQuality,
      reapplyMods: !!req.body?.reapplyMods,
      recipeId: g.catalog_id || undefined,
    })
    db.updateGame(g.slug, { status: g.status === 'installed' ? 'installed' : 'installing' })
    res.json({ jobId: id })
  })

  router.post('/:slug/optimize', (req, res) => {
    const g = get(req)
    if (g.status !== 'installed') throw new HttpError(409, 'Game is not installed')
    if (jobs.activeFor(g.slug)) throw new HttpError(409, 'A job is already running for this game')
    res.json({ jobId: jobs.enqueue('optimize', g.slug, { slug: g.slug, quality: req.body?.quality }) })
  })

  router.post('/:slug/analyze', (req, res) => {
    const g = get(req)
    res.json({ jobId: jobs.enqueue('analyze', g.slug, { slug: g.slug }) })
  })

  // ---- covers & walkthroughs ---------------------------------------------

  router.post('/:slug/thumbnail', images.single('thumbnail'), async (req, res) => {
    const g = get(req)
    if (!req.file) throw new HttpError(400, 'No image uploaded')
    let data: Buffer
    try {
      data = await makeCover(req.file.buffer)
    } catch {
      throw new HttpError(400, 'Unsupported image')
    }
    const name = await saveCover(cfg, g.slug, data)
    if (g.thumbnail) await unlink(join(cfg.thumbnailsDir, g.thumbnail)).catch(() => {})
    db.updateGame(g.slug, { thumbnail: name })
    res.json({ ok: true, thumbnail: name })
  })

  /** Uses a save's screenshot as the cover. */
  router.post('/:slug/thumbnail/from-save', async (req, res) => {
    const g = get(req)
    if (!g.save_dir) throw new HttpError(409, 'No saves')
    const png = await readSaveScreenshot(await deps.saves.read(g.save_dir, cleanRelPath(req.body?.file)))
    if (!png) throw new HttpError(404, 'That save has no screenshot')
    const name = await saveCover(cfg, g.slug, await makeCover(png))
    if (g.thumbnail) await unlink(join(cfg.thumbnailsDir, g.thumbnail)).catch(() => {})
    db.updateGame(g.slug, { thumbnail: name })
    res.json({ ok: true, thumbnail: name })
  })

  router.delete('/:slug/thumbnail', async (req, res) => {
    const g = get(req)
    if (g.thumbnail) await unlink(join(cfg.thumbnailsDir, g.thumbnail)).catch(() => {})
    db.updateGame(g.slug, { thumbnail: '' })
    res.json({ ok: true })
  })

  router.post('/:slug/walkthrough', pdfs.single('walkthrough'), async (req, res) => {
    const g = get(req)
    const f = req.file
    if (!f) throw new HttpError(400, 'No file uploaded')
    if (f.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Only PDF files are supported')
    await mkdir(cfg.walkthroughsDir, { recursive: true })
    const name = `${g.slug}-${Date.now().toString(36)}.pdf`
    await writeFile(join(cfg.walkthroughsDir, name), f.buffer)
    if (g.walkthrough) await unlink(join(cfg.walkthroughsDir, g.walkthrough)).catch(() => {})
    db.updateGame(g.slug, { walkthrough: name })
    res.json({ ok: true, walkthrough: name })
  })

  router.delete('/:slug/walkthrough', async (req, res) => {
    const g = get(req)
    if (g.walkthrough) await unlink(join(cfg.walkthroughsDir, g.walkthrough)).catch(() => {})
    db.updateGame(g.slug, { walkthrough: '' })
    res.json({ ok: true })
  })

  return router
}
