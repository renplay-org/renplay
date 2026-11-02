import express, { Router, type Request } from 'express'
import multer from 'multer'
import type { Db, GameRow } from '../db.js'
import { readSaveMeta, readSaveScreenshot, slotInfo } from '../saves/savefile.js'
import { SHARED_DIRS, type SaveStore } from '../saves/store.js'
import { sha1 } from '../util/fsx.js'
import { HttpError, assertSlug, cleanRelPath, isSaveDirName } from '../util/paths.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 << 20, files: 200 } })

/** Metadata cache for parsed save files, keyed by dir/name/mtime/size. */
const metaCache = new Map<string, Awaited<ReturnType<typeof readSaveMeta>>>()

export function createSavesRouter(store: SaveStore, db: Db): Router {
  const router = Router()

  const game = (req: Request): GameRow => {
    const g = db.getGame(assertSlug(req.params.slug))
    if (!g) throw new HttpError(404, 'Game not found')
    return g
  }
  const requireSaveDir = (g: GameRow): string => {
    if (!g.save_dir) throw new HttpError(409, 'The save folder of this game is not known yet. Start the game once, or set it in the game settings.')
    return g.save_dir
  }

  /**
   * Everything the in-game runtime needs before Ren'Py starts. ~/.renpy is one
   * central tree shared by all games, like on desktop: this game's save folder
   * and the shared folders come with their contents, every other folder only
   * as a listing (the runtime fetches those files if a game opens them).
   */
  router.get('/:slug/boot', async (req, res) => {
    const g = game(req)
    const files: Array<{ path: string; data: string; mtime: number }> = []
    const lazy: Array<{ path: string; size: number; mtime: number }> = []
    if (g.save_dir) {
      for (const f of await store.list(g.save_dir)) {
        files.push({ path: `${g.save_dir}/${f.name}`, data: (await store.read(g.save_dir, f.name)).toString('base64'), mtime: f.mtimeMs })
      }
    }
    for (const t of await store.sharedFiles()) files.push({ path: t.name, data: t.data.toString('base64'), mtime: t.mtimeMs })
    for (const dir of await store.listDirs()) {
      if (dir === g.save_dir) continue
      for (const f of await store.list(dir)) lazy.push({ path: `${dir}/${f.name}`, size: f.size, mtime: f.mtimeMs })
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json({ saveDir: g.save_dir || null, files, lazy, serverTime: Date.now() })
  })

  /** Resolves a ~/.renpy-relative path to (folder, name). Any folder is allowed. */
  const resolvePath = (g: GameRow, raw: unknown): { dir: string; name: string } => {
    const rel = cleanRelPath(raw)
    const slash = rel.indexOf('/')
    if (slash === -1) throw new HttpError(400, 'Path must be inside a save folder')
    const top = rel.slice(0, slash)
    const name = rel.slice(slash + 1)
    if (!isSaveDirName(top)) throw new HttpError(400, 'Invalid save folder')
    if (!g.save_dir && !(SHARED_DIRS as readonly string[]).includes(top)) {
      // First save of a game whose folder was not detected at install time;
      // the runtime confirms it with config.save_directory shortly after.
      db.updateGame(g.slug, { save_dir: top, save_dir_source: 'runtime' })
      g.save_dir = top
    }
    return { dir: top, name }
  }

  /** Raw read of any file in the central tree (lazy files in the runtime). */
  router.get('/:slug/raw', async (req, res) => {
    game(req)
    const rel = cleanRelPath(req.query['path'])
    const slash = rel.indexOf('/')
    if (slash === -1) throw new HttpError(400, 'Invalid path')
    const data = await store.read(rel.slice(0, slash), rel.slice(slash + 1))
    res.setHeader('Cache-Control', 'no-store')
    res.type('application/octet-stream').send(data)
  })

  router.put('/:slug/file', express.raw({ type: () => true, limit: '64mb' }), async (req, res) => {
    const g = game(req)
    const { dir, name } = resolvePath(g, req.query['path'])
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Expected a binary body')
    const mtime = Number(req.header('x-mtime')) || undefined
    const f = await store.write(dir, name, body, { mtimeMs: mtime, reason: 'game' })
    res.json({ ok: true, size: f.size, mtime: f.mtimeMs, sha1: sha1(body) })
  })

  router.delete('/:slug/file', async (req, res) => {
    const g = game(req)
    const { dir, name } = resolvePath(g, req.query['path'])
    await store.remove(dir, name, 'game-delete')
    res.json({ ok: true })
  })

  /** Reported by the runtime after Ren'Py starts (config.save_directory). */
  router.post('/:slug/save-dir', async (req, res) => {
    const g = game(req)
    const sd = req.body?.saveDir
    if (!isSaveDirName(sd)) throw new HttpError(400, 'Invalid save folder')
    let changed = false
    if (g.save_dir !== sd && g.save_dir_source !== 'manual') {
      db.updateGame(g.slug, { save_dir: sd, save_dir_source: 'runtime' })
      changed = true
    }
    res.json({ ok: true, changed, saveDir: changed ? sd : g.save_dir })
  })

  /** Save slots with metadata for the save browser. */
  router.get('/:slug', async (req, res) => {
    const g = game(req)
    if (!g.save_dir) {
      res.json({ saveDir: null, slots: [], other: [] })
      return
    }
    const files = await store.list(g.save_dir)
    const slots = []
    const other = []
    for (const f of files) {
      if (!f.name.endsWith('.save') || f.name.includes('/')) {
        other.push({ name: f.name, size: f.size, mtime: f.mtimeMs })
        continue
      }
      const info = slotInfo(f.name)
      const key = `${g.save_dir}/${f.name}/${f.mtimeMs}/${f.size}`
      let meta = metaCache.get(key)
      if (meta === undefined) {
        meta = await readSaveMeta(await store.read(g.save_dir, f.name))
        metaCache.set(key, meta)
        if (metaCache.size > 5000) metaCache.delete(metaCache.keys().next().value!)
      }
      slots.push({
        file: f.name,
        size: f.size,
        mtime: f.mtimeMs,
        kind: info.kind,
        label: info.label,
        page: info.page,
        slot: info.slot,
        name: meta?.name ?? '',
        ctime: meta?.ctime ? meta.ctime * 1000 : f.mtimeMs,
        renpyVersion: meta?.renpyVersion,
        gameVersion: meta?.gameVersion,
        runtime: meta?.runtime,
        screenshot: meta?.hasScreenshot ? `/api/saves/${g.slug}/screenshot?file=${encodeURIComponent(f.name)}&v=${f.mtimeMs}` : null,
        valid: !!meta,
      })
    }
    slots.sort((a, b) => b.ctime - a.ctime)
    res.json({ saveDir: g.save_dir, slots, other })
  })

  router.get('/:slug/screenshot', async (req, res) => {
    const g = game(req)
    const name = cleanRelPath(req.query['file'])
    const png = await readSaveScreenshot(await store.read(requireSaveDir(g), name))
    if (!png) throw new HttpError(404, 'No screenshot')
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.type('png').send(png)
  })

  router.get('/:slug/download', async (req, res) => {
    const g = game(req)
    const name = cleanRelPath(req.query['file'])
    const data = await store.read(requireSaveDir(g), name)
    res.attachment(name.split('/').pop()!)
    res.type('application/octet-stream').send(data)
  })

  router.delete('/:slug/slot', async (req, res) => {
    const g = game(req)
    const ok = await store.remove(requireSaveDir(g), cleanRelPath(req.query['file']), 'user-delete')
    if (!ok) throw new HttpError(404, 'Save not found')
    res.json({ ok: true })
  })

  router.get('/:slug/export', async (req, res) => {
    const g = game(req)
    const dir = requireSaveDir(g)
    res.attachment(`${g.slug}-saves-${new Date().toISOString().slice(0, 10)}.zip`)
    res.type('application/zip')
    await store.exportZip([dir], res, { includeTokens: req.query['tokens'] === '1' })
  })

  router.post('/:slug/import', upload.array('files'), async (req, res) => {
    const g = game(req)
    const dir = requireSaveDir(g)
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (!files.length) throw new HttpError(400, 'No files uploaded')
    const report = await store.importFiles(
      dir,
      files.map((f) => ({ filename: Buffer.from(f.originalname, 'latin1').toString('utf-8'), data: f.buffer })),
    )
    res.json(report)
  })

  /** Copies a save to another game (e.g. carry the end of season 1 into season 2). */
  router.post('/:slug/copy', async (req, res) => {
    const g = game(req)
    const target = db.getGame(assertSlug(req.body?.target))
    if (!target) throw new HttpError(404, 'Target game not found')
    const toDir = requireSaveDir(target)
    const name = await store.copySave(requireSaveDir(g), cleanRelPath(req.body?.file), toDir)
    res.json({ ok: true, file: name, target: target.slug })
  })

  router.get('/:slug/history', async (req, res) => {
    const g = game(req)
    const name = typeof req.query['file'] === 'string' ? cleanRelPath(req.query['file']) : undefined
    res.json({ versions: await store.history(requireSaveDir(g), name) })
  })

  router.post('/:slug/history/restore', async (req, res) => {
    const g = game(req)
    const id = req.body?.id
    if (typeof id !== 'string') throw new HttpError(400, 'Missing version id')
    const f = await store.restoreVersion(requireSaveDir(g), id)
    res.json({ ok: true, file: f })
  })

  return router
}

/** All save folders (including ones without a game) as one zip. */
export function createSavesExportAll(store: SaveStore, db: Db) {
  return async (_req: Request, res: express.Response) => {
    const dirs = new Set(await store.listDirs())
    for (const g of db.allGames()) if (g.save_dir) dirs.add(g.save_dir)
    res.attachment(`renplay-saves-${new Date().toISOString().slice(0, 10)}.zip`)
    res.type('application/zip')
    await store.exportZip([...dirs], res, { includeTokens: true })
  }
}
