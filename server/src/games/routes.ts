import { randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import express, { Router, type Request } from 'express'
import multer from 'multer'
import { enqueueImport } from '../pipeline/import.js'
import { toGame } from './game.js'
import { parseJson, type GameRow, type GameSource } from '../db.js'
import { exists, writeFileAtomic } from '../util/fsx.js'
import { HttpError, cleanRelPath, safeJoin } from '../util/paths.js'
import type { Services } from '../services.js'

/** What a walkthrough file is, from its first bytes (and its name for text), or null. */
export function walkthroughKind(data: Buffer, name = ''): { kind: 'pdf' | 'image' | 'text'; ext: string } | null {
  const head = data.subarray(0, 12).toString('latin1')
  if (head.startsWith('%PDF-')) return { kind: 'pdf', ext: 'pdf' }
  if (head.startsWith('\x89PNG')) return { kind: 'image', ext: 'png' }
  if (data[0] === 0xff && data[1] === 0xd8) return { kind: 'image', ext: 'jpg' }
  if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return { kind: 'image', ext: 'webp' }
  if (/\.(txt|md|markdown)$/i.test(name) && !data.includes(0) && !/^\s*<(!doctype|html|script|svg)/i.test(data.subarray(0, 200).toString('utf8'))) return { kind: 'text', ext: 'txt' }
  return null
}

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

export function createGamesRouter(deps: Services): Router {
  const { cfg, db, jobs, builds, telemetry } = deps
  const router = Router({ caseSensitive: true, strict: true })

  const get = (req: Request): GameRow => deps.content.game(req.params.id)

  router.get('/games', async (_req, res) => {
    res.json({ games: await Promise.all(db.allGames().filter((r) => !deps.content.hides(r)).map((r) => toGame(r, deps))) })
  })

  router.get('/games/:id', async (req, res) => {
    res.json({ game: await toGame(get(req), deps) })
  })

  /** Uninstalls (files go, saves and mods stay); `forget=1` also removes the library entry. */
  router.delete('/games/:id', async (req, res) => {
    const g = get(req)
    if (jobs.activeFor(g.id)) throw new HttpError(409, 'A job is running for this game')
    await builds.remove(g.id)
    if (req.query['forget'] === '1') {
      for (const w of db.walkthroughs(g.id)) await unlink(join(cfg.walkthroughsDir, w.file)).catch(() => {})
      deps.art.forgetGame(g.id)
      db.raw.prepare('DELETE FROM walkthroughs WHERE game = ?').run(g.id)
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

  router.delete('/games/:id/download', async (req, res) => {
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

  router.post('/games/:id/reinstall', async (req, res) => {
    const g = get(req)
    const src = parseJson<GameSource>(g.source, {})
    if (!src.archive) throw new HttpError(409, 'No source archive is known for this game. Add its archive to install it.')
    if (!(await exists(join(cfg.archivesDir, cleanRelPath(src.archive))))) throw new HttpError(409, `The source archive ${src.archive} is no longer in the archives folder`)
    if (jobs.activeFor(g.id)) throw new HttpError(409, 'A job is already running for this game')
    const jobId = enqueueImport(jobs, {
      source: { kind: 'archive', path: src.archive },
      game: g.id,
      recipeId: g.recipe_id || undefined,
      engine: typeof req.body?.engine === 'string' ? req.body.engine : undefined,
      reapplyMods: !!req.body?.reapplyMods,
    })
    if (g.status !== 'installed') db.updateGame(g.id, { status: 'installing' })
    res.json({ jobId })
  })

  /**
   * Python bytecode caches compiled by the browser on a game's first start.
   * Stored with the current build, they spare later starts the compile.
   */
  router.put('/games/:id/cache', express.raw({ type: () => true, limit: '64mb' }), async (req, res) => {
    const g = get(req)
    const name = cacheName(req.query['name'])
    if (req.query['build'] !== g.build || !g.build) throw new HttpError(409, 'Build changed')
    if (!Buffer.isBuffer(req.body) || req.body.length < 16) throw new HttpError(400, 'Empty cache')
    const path = safeJoin(join(builds.dir(g.id, g.build), 'cache'), name)
    await mkdir(dirname(path), { recursive: true })
    await writeFileAtomic(path, req.body)
    res.json({ ok: true })
  })

  // ---- walkthroughs --------------------------------------------------------

  /** A game's walkthrough file, or 404. */
  const walkthroughOf = (g: GameRow, file: string) => {
    const w = db.walkthroughs(g.id).find((x) => x.file === file)
    if (!w) throw new HttpError(404, 'Walkthrough not found')
    return w
  }

  // Several walkthrough files per game: PDFs, pictures and plain text. Not HTML: it would run as
  // part of Renplay's own page.
  router.post('/games/:id/walkthroughs', async (req, res) => {
    const g = get(req)
    // multer runs inside the handler and is awaited: as route middleware its stream callbacks would
    // lose the request's context, and with it who is asking (accounts/context.ts).
    await new Promise<void>((resolve, reject) => pdfs.single('file')(req, res, (error) => (error ? reject(error) : resolve())))
    const f = req.file
    if (!f) throw new HttpError(400, 'No file uploaded')
    const kind = walkthroughKind(f.buffer, f.originalname)
    if (!kind) throw new HttpError(400, 'Add a PDF, a picture (PNG, JPEG or WebP) or a plain text file')
    await mkdir(cfg.walkthroughsDir, { recursive: true })
    const name = `${g.id}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}.${kind.ext}`
    await writeFile(join(cfg.walkthroughsDir, name), f.buffer)
    const fallback = (f.originalname || 'Walkthrough').replace(/\.[a-z0-9]{1,5}$/i, '').trim().slice(0, 100) || 'Walkthrough'
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 100) : fallback
    const position = (db.walkthroughs(g.id).at(-1)?.position ?? -1) + 1
    db.raw.prepare('INSERT INTO walkthroughs (file, game, title, kind, size, added_at, position) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, g.id, title, kind.kind, f.size, new Date().toISOString(), position)
    telemetry.feature('walkthroughs')
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  /** Renames a walkthrough, or moves it to another place in the list. */
  router.put('/games/:id/walkthroughs/:file', async (req, res) => {
    const g = get(req)
    const w = walkthroughOf(g, req.params.file)
    if (req.body?.title !== undefined) {
      if (typeof req.body.title !== 'string' || !req.body.title.trim()) throw new HttpError(400, 'A walkthrough needs a title')
      db.raw.prepare('UPDATE walkthroughs SET title = ? WHERE file = ?').run(req.body.title.trim().slice(0, 100), w.file)
    }
    if (req.body?.position !== undefined) {
      const list = db.walkthroughs(g.id).filter((x) => x.file !== w.file)
      const at = Number(req.body.position)
      if (!Number.isInteger(at) || at < 0) throw new HttpError(400, 'Position must be a whole number from 0')
      list.splice(Math.min(at, list.length), 0, w)
      list.forEach((x, i) => db.raw.prepare('UPDATE walkthroughs SET position = ? WHERE file = ?').run(i, x.file))
    }
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  router.delete('/games/:id/walkthroughs/:file', async (req, res) => {
    const g = get(req)
    const w = walkthroughOf(g, req.params.file)
    db.raw.prepare('DELETE FROM walkthroughs WHERE file = ?').run(w.file)
    await unlink(join(cfg.walkthroughsDir, w.file)).catch(() => {})
    res.json({ ok: true, game: await toGame(db.getGame(g.id)!, deps) })
  })

  // Text walkthroughs are served as plain text, never sniffed as anything else.
  router.use('/walkthroughs', express.static(cfg.walkthroughsDir, { cacheControl: false, fallthrough: false, setHeaders: (res, path) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (path.endsWith('.txt')) res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  } }))

  return router
}
